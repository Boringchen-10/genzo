use crate::credentials::Credentials;
use crate::error::{AppError, AppResult};
use percent_encoding::percent_decode_str;
use reqwest::{Client, Method, Response, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone)]
pub struct DavClient {
    pub base: Url,
    credentials: Credentials,
    client: Client,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DavEntry {
    pub href: String,
    pub name: String,
    pub directory: bool,
    pub size: i64,
    pub modified_at: Option<String>,
    pub etag: Option<String>,
}

#[derive(Deserialize)]
struct MultiStatus {
    #[serde(rename = "response", default)]
    responses: Vec<DavResponse>,
}
#[derive(Deserialize)]
struct DavResponse {
    href: String,
    status: Option<String>,
    #[serde(default)]
    propstat: Vec<PropStat>,
}
#[derive(Deserialize)]
struct PropStat {
    status: String,
    prop: Prop,
}
#[derive(Deserialize, Default)]
struct Prop {
    resourcetype: Option<ResourceType>,
    // A directory's unavailable properties may be empty in a 404 propstat.
    // Parse the number only after selecting successful properties.
    getcontentlength: Option<String>,
    getlastmodified: Option<String>,
    getetag: Option<String>,
}
#[derive(Deserialize)]
struct ResourceType {
    collection: Option<()>,
}

fn invalid(message: &str) -> AppError {
    AppError::Validation(message.into())
}
fn network() -> AppError {
    AppError::Network("WebDAV 请求失败，请检查网络、地址和凭据".into())
}
fn request_error(error: reqwest::Error) -> AppError {
    AppError::Network(if error.is_timeout() {
        "network_timeout：WebDAV 连接超时，请检查网络后重试"
    } else {
        "source_offline：WebDAV 请求失败，请检查网络和服务状态"
    }.into())
}

pub fn endpoint(value: &str) -> AppResult<Url> {
    let mut url = Url::parse(value.trim()).map_err(|_| invalid("WebDAV 地址无效"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "请填写 HTTP(S) 服务地址，账号密码使用独立输入框，地址不能包含查询参数",
        ));
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    decoded_path(url.path())?;
    Ok(url)
}

pub fn decoded_path(path: &str) -> AppResult<String> {
    let mut decoded = Vec::new();
    for segment in path.split('/') {
        let value = percent_decode_str(segment)
            .decode_utf8()
            .map_err(|_| invalid("远程路径不是有效 UTF-8"))?;
        if matches!(value.as_ref(), "." | "..")
            || value.contains(['/', '\\', '\0'])
            || value.chars().any(char::is_control)
        {
            return Err(invalid("远程路径包含不支持的字符"));
        }
        decoded.push(value.to_string());
    }
    Ok(decoded.join("/"))
}

impl DavClient {
    pub fn new(address: &str, credentials: Credentials) -> AppResult<Self> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .user_agent("Genzo/0.4 WebDAV")
            .build()
            .map_err(|_| network())?;
        Ok(Self {
            base: endpoint(address)?,
            credentials,
            client,
        })
    }

    pub fn directory_url(&self, directory: &str) -> AppResult<Url> {
        let mut url = self.base.clone();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| invalid("地址不能包含目录"))?;
            segments.pop_if_empty();
            for part in directory
                .trim_matches('/')
                .split('/')
                .filter(|p| !p.is_empty())
            {
                if matches!(part, "." | "..")
                    || part.contains(['\\', '\0'])
                    || part.chars().any(char::is_control)
                {
                    return Err(invalid("目录路径无效"));
                }
                segments.push(part);
            }
            segments.push("");
        }
        Ok(url)
    }

    pub fn resource_url(&self, href: &str) -> AppResult<Url> {
        let url = self
            .base
            .join(href)
            .map_err(|_| invalid("远程资源地址无效"))?;
        if url.origin() != self.base.origin()
            || !url.path().starts_with(self.base.path())
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid("远程资源超出所配置的 WebDAV 目录"));
        }
        decoded_path(url.path())?;
        Ok(url)
    }

    pub async fn list(&self, href: &str) -> AppResult<Vec<DavEntry>> {
        let url = self.resource_url(href)?;
        let response = self.client.request(Method::from_bytes(b"PROPFIND").unwrap(), url.clone())
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("Depth", "1").header("Content-Type", "application/xml; charset=utf-8")
            .body("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>")
            .timeout(Duration::from_secs(60)).send().await.map_err(request_error)?;
        if response.status().as_u16() != 207 {
            return Err(status_error(response.status().as_u16()));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| network())? {
            if bytes.len() + chunk.len() > 20 * 1024 * 1024 {
                return Err(invalid("目录响应过大，请选择更小的扫描目录"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let xml = std::str::from_utf8(&bytes).map_err(|_| invalid("WebDAV 目录编码无效"))?;
        parse_listing(self, &url, xml)
    }

    pub async fn get(
        &self,
        href: &str,
        range: Option<&str>,
        head: bool,
        if_range: Option<&str>,
    ) -> AppResult<Response> {
        let mut url = self.resource_url(href)?;
        for _ in 0..6 {
            let mut request = self
                .client
                .request(if head { Method::HEAD } else { Method::GET }, url.clone())
                .header("Accept-Encoding", "identity");
            if url.origin() == self.base.origin() {
                request = request
                    .basic_auth(&self.credentials.username, Some(&self.credentials.password));
            }
            if let Some(range) = range {
                request = request.header("Range", range);
            }
            if let Some(value) = if_range {
                request = request.header("If-Range", value);
            }
            let response = request.send().await.map_err(request_error)?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(network)?;
                let next = url.join(location).map_err(|_| network())?;
                if !matches!(next.scheme(), "http" | "https")
                    || (url.scheme() == "https" && next.scheme() != "https")
                    || !next.username().is_empty()
                    || next.password().is_some()
                {
                    return Err(network());
                }
                url = next;
            } else {
                return Ok(response);
            }
        }
        Err(AppError::Network("WebDAV 重定向次数过多".into()))
    }
}

pub fn status_error(code: u16) -> AppError {
    AppError::Network(match code {
        401 => "credential_invalid：WebDAV 认证失败，请更新凭据".into(),
        403 => "permission_denied：WebDAV 无权访问此目录或文件".into(),
        404 => "WebDAV 目录或文件不存在".into(),
        301 | 302 | 307 | 308 => "WebDAV 目录地址发生重定向，请填写最终服务地址".into(),
        _ => format!("WebDAV 服务返回 HTTP {code}"),
    })
}

fn parse_listing(client: &DavClient, requested: &Url, xml: &str) -> AppResult<Vec<DavEntry>> {
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err(invalid("不支持带 DTD 的目录响应"));
    }
    let document: MultiStatus =
        quick_xml::de::from_str(xml).map_err(|_| invalid("无法解析 WebDAV 目录响应"))?;
    if document.responses.is_empty() {
        return Err(invalid("WebDAV 响应未包含目录状态"));
    }
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let requested_path = decoded_path(requested.path())?;
    for item in document.responses {
        if item.status.as_deref().is_some_and(|s| {
            !s.split_whitespace()
                .nth(1)
                .is_some_and(|s| s.starts_with('2'))
        }) {
            return Err(invalid("WebDAV 返回部分失败，已保留原有索引"));
        }
        let url = requested
            .join(&item.href)
            .map_err(|_| invalid("目录响应包含无效路径"))?;
        client.resource_url(url.as_str())?;
        let path = decoded_path(url.path())?;
        let mut successful = item
            .propstat
            .into_iter()
            .filter(|p| p.status.split_whitespace().nth(1) == Some("200"));
        let prop = successful
            .find(|p| p.prop.resourcetype.is_some())
            .ok_or_else(|| invalid("目录响应缺少有效资源类型，已保留原有索引"))?
            .prop;
        if path.trim_end_matches('/') == requested_path.trim_end_matches('/') {
            continue;
        }
        let relative = path
            .strip_prefix(&requested_path)
            .ok_or_else(|| invalid("目录响应超出请求范围"))?
            .trim_end_matches('/');
        if relative.is_empty() || relative.contains('/') {
            return Err(invalid("目录响应不是直接子项"));
        }
        let directory = prop.resourcetype.and_then(|r| r.collection).is_some();
        let size = if directory {
            0
        } else {
            match prop.getcontentlength.as_deref().map(str::trim) {
                None | Some("") => 0,
                Some(value) => value
                    .parse::<i64>()
                    .ok()
                    .filter(|size| *size >= 0)
                    .ok_or_else(|| invalid("WebDAV 文件大小无效，已保留原有索引"))?,
            }
        };
        let mut href = url.path().to_string();
        if directory && !href.ends_with('/') {
            href.push('/');
        }
        if !seen.insert(href.clone()) {
            continue;
        }
        entries.push(DavEntry {
            href,
            name: relative.into(),
            directory,
            size,
            modified_at: prop.getlastmodified,
            etag: prop.getetag,
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| natord::compare(&a.name, &b.name))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_empty_length_on_unavailable_directory_properties() {
        let c = DavClient::new("https://example.test/dav/", Credentials::default()).unwrap();
        let xml = r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:getlastmodified>Sun, 27 Sep 2026 00:00:00 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat><D:propstat><D:prop><D:getcontentlength/><D:getetag/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>"#;
        assert!(parse_listing(&c, &c.base, xml).unwrap().is_empty());
    }
    #[test]
    fn lists_chinese_directories_and_files_with_empty_failed_properties() {
        let c = DavClient::new("https://example.test/dav/", Credentials::default()).unwrap();
        let xml = r#"<multistatus xmlns="DAV:"><response><href>/dav/动漫/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><getcontentlength></getcontentlength><getetag/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response><response><href>/dav/01.mkv</href><propstat><prop><resourcetype/><getcontentlength> 42 </getcontentlength></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;
        let rows = parse_listing(&c, &c.base, xml).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "动漫");
        assert!(rows[0].directory);
        assert_eq!(rows[0].size, 0);
        assert_eq!(rows[1].size, 42);
        let directory = c.directory_url("动漫/").unwrap();
        let nested = xml.replace("/dav/01.mkv", "/dav/动漫/01.mkv");
        let rows = parse_listing(&c, &directory, &nested).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "01.mkv");
    }
    #[test]
    fn rejects_invalid_successful_file_size_but_ignores_failed_property_values() {
        let c = DavClient::new("https://example.test/dav/", Credentials::default()).unwrap();
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/01.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>42</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength>unavailable</d:getcontentlength></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>"#;
        assert_eq!(parse_listing(&c, &c.base, xml).unwrap()[0].size, 42);
        for value in ["invalid", "-1", "9223372036854775808"] {
            assert!(
                parse_listing(&c, &c.base, &xml.replace(">42<", &format!(">{value}<"))).is_err()
            );
        }
        for value in ["", "0"] {
            assert_eq!(
                parse_listing(&c, &c.base, &xml.replace(">42<", &format!(">{value}<"))).unwrap()[0]
                    .size,
                0
            );
        }
    }
    #[test]
    fn handles_namespaces_escaped_names_and_partial_property_failures() {
        let c = DavClient::new("https://example.test/dav/", Credentials::default()).unwrap();
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/A%20%26%20B.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>42</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>"#;
        let rows = parse_listing(&c, &c.base, xml).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "A & B.mkv");
        assert_eq!(rows[0].size, 42);
        assert!(parse_listing(
            &c,
            &c.base,
            &xml.replace("/dav/A%20%26%20B.mkv", "https://evil.test/x")
        )
        .is_err());
    }
    #[test]
    fn rejects_credentials_and_encoded_traversal_in_addresses() {
        assert!(endpoint("https://user:pass@example.test/").is_err());
        assert!(decoded_path("/dav/%2e%2e/").is_err());
        assert!(decoded_path("/dav/a%2fb/").is_err());
        let c = DavClient::new("http://localhost:5244/dav", Credentials::default()).unwrap();
        assert_eq!(
            c.directory_url("动漫/第一季").unwrap().path(),
            "/dav/%E5%8A%A8%E6%BC%AB/%E7%AC%AC%E4%B8%80%E5%AD%A3/"
        );
        assert!(c.resource_url("/outside/").is_err());
        assert!(c.resource_url("/dav/file?password=x").is_err());
    }
}
