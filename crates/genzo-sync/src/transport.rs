use crate::protocol::{Document, MAX_BYTES};
use crate::{Error, Result};
use reqwest::{header, Client, Method, Response, StatusCode, Url};
use std::time::Duration;
use uuid::Uuid;

/// Credentials are borrowed from the host store and never serialized.
pub struct DavTransport {
    base: Url,
    username: String,
    password: String,
    client: Client,
}
pub struct Remote {
    pub document: Document,
    pub etag: String,
}
fn status(status: StatusCode) -> Result<()> {
    match status.as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(Error::Auth),
        404 => Err(Error::NotFound),
        412 => Err(Error::Precondition),
        _ => Err(Error::Offline),
    }
}
pub fn endpoint(address: &str, allow_loopback_http: bool) -> Result<Url> {
    let mut url = Url::parse(address.trim()).map_err(|_| Error::Invalid)?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(allow_loopback_http && loopback && url.scheme() == "http"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Invalid);
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}
impl DavTransport {
    pub fn new(
        address: &str,
        username: String,
        password: String,
        allow_loopback_http: bool,
    ) -> Result<Self> {
        Ok(Self {
            base: endpoint(address, allow_loopback_http)?,
            username,
            password,
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .user_agent("Genzo-Sync/1")
                .build()
                .map_err(|_| Error::Offline)?,
        })
    }
    fn request(&self, method: Method, name: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, self.base.join(name).expect("fixed resource name"))
            .basic_auth(&self.username, Some(&self.password))
    }
    async fn get(&self, name: &str) -> Result<Option<(Vec<u8>, String)>> {
        let mut response = self
            .request(Method::GET, name)
            .send()
            .await
            .map_err(|_| Error::Offline)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        status(response.status())?;
        let etag = strong_etag(&response)?;
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err(Error::Limit);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Offline)? {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(Error::Limit);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some((bytes, etag)))
    }
    async fn put(&self, name: &str, bytes: Vec<u8>, etag: Option<&str>) -> Result<()> {
        let mut request = self
            .request(Method::PUT, name)
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8");
        request = if let Some(etag) = etag {
            request.header(header::IF_MATCH, etag)
        } else {
            request.header(header::IF_NONE_MATCH, "*")
        };
        let response = request
            .body(bytes)
            .send()
            .await
            .map_err(|_| Error::Offline)?;
        status(response.status())
    }
    pub async fn probe(&self) -> Result<()> {
        let name = format!("probe-{}.json", Uuid::new_v4());
        let result = self.probe_at(&name).await;
        // Best effort cleanup must not conceal the original failure.
        let cleanup = self.request(Method::DELETE, &name).send().await;
        match result {
            Err(error) => Err(error),
            Ok(()) => match cleanup {
                Ok(response) => status(response.status()),
                Err(_) => Err(Error::Offline),
            },
        }
    }
    async fn probe_at(&self, name: &str) -> Result<()> {
        self.put(name, b"{\"probe\":1}".to_vec(), None).await?;
        let (bytes, etag) = self.get(name).await?.ok_or(Error::ConditionUnsupported)?;
        if bytes != b"{\"probe\":1}" {
            return Err(Error::ConditionUnsupported);
        }
        if !matches!(
            self.put(name, b"{\"probe\":2}".to_vec(), None).await,
            Err(Error::Precondition)
        ) {
            return Err(Error::ConditionUnsupported);
        }
        if !matches!(
            self.put(
                name,
                b"{\"probe\":2}".to_vec(),
                Some("\"genzo-impossible-etag\"")
            )
            .await,
            Err(Error::Precondition)
        ) {
            return Err(Error::ConditionUnsupported);
        }
        self.put(name, b"{\"probe\":2}".to_vec(), Some(&etag))
            .await?;
        let (bytes, next) = self.get(name).await?.ok_or(Error::ConditionUnsupported)?;
        if bytes != b"{\"probe\":2}" || etag == next {
            return Err(Error::ConditionUnsupported);
        }
        if !matches!(
            self.put(name, b"{\"probe\":3}".to_vec(), Some(&etag)).await,
            Err(Error::Precondition)
        ) {
            return Err(Error::ConditionUnsupported);
        }
        Ok(())
    }
    pub async fn read(&self) -> Result<Option<Remote>> {
        self.get("state.json")
            .await?
            .map(|(bytes, etag)| {
                Ok(Remote {
                    document: Document::parse(&bytes)?,
                    etag,
                })
            })
            .transpose()
    }
    pub async fn write(&self, document: &Document, etag: Option<&str>) -> Result<()> {
        self.put("state.json", document.bytes()?, etag).await
    }
}
fn strong_etag(response: &Response) -> Result<String> {
    let value = response
        .headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::ConditionUnsupported)?;
    if value.starts_with("W/")
        || value.len() < 2
        || !value.starts_with('"')
        || !value.ends_with('"')
    {
        return Err(Error::ConditionUnsupported);
    }
    Ok(value.into())
}
