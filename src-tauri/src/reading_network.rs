//! Device-local COPY/HOT settings. No account credentials or media in sync.
use crate::{db::AppState, error::{AppError, AppResult}};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::Duration;
use tauri::State;

const KEY: &str = "reading.network";
pub const ROUTES: [[&str; 3]; 2] = [
    ["mapi.hotmangasg.com", "mapi.hotmangasd.com", "mapi.hotmangasf.com"],
    ["mapi.elfgjfghkk.club", "mapi.fgjfghkkcenter.club", "mapi.fgjfghkk.club"],
];
static SETTINGS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CLIENTS: std::sync::Mutex<Vec<(String, Duration, reqwest::Client)>> = std::sync::Mutex::new(Vec::new());

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReadingNetwork {
    pub api_host: String,
    pub app_version: String,
    pub route: usize,
    pub node: String,
    pub proxy_mode: String,
    pub proxy_url: String,
    pub auto_update: bool,
    pub updated_at: Option<String>,
    pub attempted_at: Option<String>,
    pub comic_concurrency: usize,
    pub novel_concurrency: usize,
}
impl Default for ReadingNetwork {
    fn default() -> Self {
        Self { api_host: "api.copy202601.com".into(), app_version: "3.0.9".into(), route: 0, node: String::new(),
            proxy_mode: "system".into(), proxy_url: String::new(), auto_update: true, updated_at: None, attempted_at: None,
            comic_concurrency: 4, novel_concurrency: 2 }
    }
}
fn invalid(message: &str) -> AppError { AppError::Validation(message.into()) }
fn api_host(host: &str) -> bool {
    // COPY publishes rotating monthly domains; accept this family, never arbitrary/private endpoints.
    host == "api.copymanga.com" || host.strip_prefix("api.copy").and_then(|v| v.strip_suffix(".com"))
        .is_some_and(|v| v.len() == 6 && v.bytes().all(|c| c.is_ascii_digit()))
}
impl ReadingNetwork {
    pub fn validate(&self) -> AppResult<()> {
        if !api_host(&self.api_host) { return Err(invalid("COPY API 请填写受支持的域名，如 api.copy202601.com（不带路径）")); }
        if self.app_version.is_empty() || self.app_version.len() > 30 || !self.app_version.split('.').all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit())) {
            return Err(invalid("COPY 请求版本号无效"));
        }
        if self.route >= ROUTES.len() || (!self.node.is_empty() && !ROUTES[self.route].contains(&self.node.as_str())) {
            return Err(invalid("请选择当前线路中的有效节点"));
        }
        if !matches!(self.proxy_mode.as_str(), "system" | "direct" | "manual") { return Err(invalid("代理模式无效")); }
        if self.proxy_mode == "manual" && self.proxy_url.is_empty() { return Err(invalid("请输入 HTTP / HTTPS 代理地址和端口")); }
        if !self.proxy_url.is_empty() {
            let url = reqwest::Url::parse(&self.proxy_url).map_err(|_| invalid("请输入 HTTP / HTTPS 代理地址和端口"))?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
                || url.port_or_known_default().is_none() || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
                return Err(invalid("代理只支持不带账号密码的 HTTP / HTTPS 地址和端口"));
            }
        }
        if !(1..=8).contains(&self.comic_concurrency) || !(1..=4).contains(&self.novel_concurrency) { return Err(invalid("漫画并发应为 1–8，小说并发应为 1–4")); }
        for time in [&self.updated_at, &self.attempted_at].into_iter().flatten() {
            if chrono::DateTime::parse_from_rfc3339(time).is_err() { return Err(invalid("阅读网络更新时间无效")); }
        }
        Ok(())
    }
    pub fn client(&self, timeout: Duration) -> AppResult<reqwest::Client> {
        self.validate()?;
        let key = format!("{}\n{}\n{}",self.app_version,self.proxy_mode,self.proxy_url);
        let mut clients = CLIENTS.lock().map_err(|_| invalid("阅读连接池不可用"))?;
        if let Some((_,_,client)) = clients.iter().find(|(stored,duration,_)| stored == &key && *duration == timeout) { return Ok(client.clone()); }
        let mut builder = reqwest::Client::builder().timeout(timeout).connect_timeout(Duration::from_secs(6))
            .http1_only()
            .pool_idle_timeout(Duration::from_secs(120)).pool_max_idle_per_host(8).tcp_keepalive(Duration::from_secs(30))
            .user_agent(format!("COPY/{}", self.app_version))
            .redirect(reqwest::redirect::Policy::none());
        if self.proxy_mode == "direct" { builder = builder.no_proxy(); }
        if self.proxy_mode == "manual" { builder = builder.no_proxy().proxy(reqwest::Proxy::all(&self.proxy_url).map_err(|_| invalid("代理地址无效"))?); }
        let client = builder.build().map_err(|_| invalid("无法创建阅读来源连接"))?;
        if clients.len() >= 4 { clients.remove(0); }
        clients.push((key,timeout,client.clone()));
        Ok(client)
    }
    pub fn detail_hosts(&self) -> Vec<String> {
        if self.node.is_empty() {
            ROUTES[self.route].iter().chain(ROUTES.iter().enumerate().filter(|(index,_)|*index!=self.route).flat_map(|(_,hosts)|hosts.iter()))
                .map(|host|format!("https://{host}")).collect()
        }
        else { vec![format!("https://{}", self.node)] }
    }
}
pub async fn load(pool: &SqlitePool) -> AppResult<ReadingNetwork> {
    let json: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?").bind(KEY).fetch_optional(pool).await?;
    let config: ReadingNetwork = match json { Some(json) => serde_json::from_str(&json)?, None => ReadingNetwork::default() };
    config.validate()?; Ok(config)
}
async fn save(pool: &SqlitePool, config: &ReadingNetwork) -> AppResult<()> {
    config.validate()?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(KEY).bind(serde_json::to_string(config)?).bind(chrono::Utc::now().to_rfc3339()).execute(pool).await?;
    Ok(())
}
#[tauri::command]
pub async fn get_reading_network(state: State<'_, AppState>) -> AppResult<ReadingNetwork> { load(&state.pool).await }
#[tauri::command]
pub async fn save_reading_network(mut config: ReadingNetwork, state: State<'_, AppState>) -> AppResult<()> {
    let _guard = SETTINGS_LOCK.lock().await;
    let previous = load(&state.pool).await?;
    config.attempted_at = previous.attempted_at;
    // A successful manual fill returns its timestamp with the editable fields.
    if config.updated_at.is_none() { config.updated_at = previous.updated_at; }
    save(&state.pool, &config).await
}
#[tauri::command]
pub async fn fill_reading_network(config: ReadingNetwork) -> AppResult<ReadingNetwork> { fill(config).await }
async fn fill(mut config: ReadingNetwork) -> AppResult<ReadingNetwork> {
    config.validate()?;
    let host = format!("https://{}", config.api_host);
    let params = [("platform".into(), "3".into())];
    let network = crate::comic_explore::request_configured(&config, &host, "/api/v3/system/network2", &params, false).await?;
    let version = crate::comic_explore::request_configured(&config, &host, "/api/v3/system/appVersion/last", &params, false).await?;
    let published = network["api"][0][0].as_str().ok_or_else(|| invalid("来源没有提供当前 API 地址"))?;
    let updated_version = version["android"]["version"].as_str().or_else(|| version["version"].as_str())
        .ok_or_else(|| invalid("来源没有提供 Android 请求版本号"))?;
    config.api_host = published.into(); config.app_version = updated_version.into(); config.validate()?;
    config.updated_at = Some(chrono::Utc::now().to_rfc3339()); Ok(config)
}
pub async fn auto_update(pool: SqlitePool) {
    let _guard = SETTINGS_LOCK.lock().await;
    let Ok(mut config) = load(&pool).await else { return };
    if !config.auto_update || config.attempted_at.as_deref().and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .is_some_and(|v| chrono::Utc::now().signed_duration_since(v).num_hours() < 24) { return; }
    config.attempted_at = Some(chrono::Utc::now().to_rfc3339());
    match fill(config.clone()).await { Ok(updated) => config = updated, Err(_) => {} }
    let _ = save(&pool, &config).await;
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeProbe { host: String, route: Option<usize>, milliseconds: Option<u128>, error: Option<String> }
#[tauri::command]
pub async fn test_reading_network(config: ReadingNetwork) -> AppResult<Vec<NodeProbe>> {
    config.validate()?;
    let mut tasks = tokio::task::JoinSet::new();
    for (route, host) in ROUTES.iter().enumerate().flat_map(|(r, hosts)| hosts.iter().map(move |h| (Some(r), h.to_string())))
        .chain(std::iter::once((None, config.api_host.clone()))) {
        let config = config.clone();
        tasks.spawn(async move {
            let started = std::time::Instant::now();
            let path = if route.is_some() { "/api/v3/comic2/modujingbingdenuli" } else { "/api/v3/system/appVersion/last" };
            let result = crate::comic_explore::request_configured(&config, &format!("https://{host}"), path, &[("platform".into(), "3".into())], route.is_some()).await;
            NodeProbe { host, route, milliseconds: result.as_ref().ok().map(|_| started.elapsed().as_millis()), error: result.err().map(|e| e.to_string()) }
        });
    }
    let mut results = vec![];
    while let Some(value) = tasks.join_next().await { results.push(value.map_err(|_| invalid("节点测试失败"))?); }
    results.sort_by(|a,b| a.route.cmp(&b.route).then(a.host.cmp(&b.host))); Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_nodes_can_recover_from_a_dead_route_and_fixed_nodes_stay_fixed() {
        let mut config=ReadingNetwork::default();let hosts=config.detail_hosts();
        assert_eq!(hosts.len(),6);assert!(hosts[0].contains(ROUTES[0][0]));assert!(hosts[3].contains(ROUTES[1][0]));
        config.node=ROUTES[0][1].into();assert_eq!(config.detail_hosts(),vec![format!("https://{}",config.node)]);
    }
    #[tokio::test]
    async fn repeated_clients_reuse_one_http_connection() {
        use tokio::io::{AsyncReadExt,AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream,_) = listener.accept().await.unwrap();
            for _ in 0..2 {
                let mut header = Vec::new();
                while !header.ends_with(b"\r\n\r\n") { header.push(tokio::time::timeout(Duration::from_secs(2),stream.read_u8()).await.unwrap().unwrap()); }
                assert!(String::from_utf8(header).unwrap().to_lowercase().contains("accept-encoding: gzip"));
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await.unwrap();
            }
        });
        let config = ReadingNetwork {proxy_mode:"direct".into(),..Default::default()};
        for _ in 0..2 { assert_eq!(config.client(Duration::from_secs(3)).unwrap().get(format!("http://{address}/pool")).send().await.unwrap().text().await.unwrap(),"ok"); }
        server.await.unwrap();
    }
    #[test]
    fn rejects_untrusted_hosts_credentials_and_invalid_limits() {
        let mut c = ReadingNetwork::default(); assert!(c.validate().is_ok());
        c.api_host = "api.copy202601.com.evil.test".into(); assert!(c.validate().is_err());
        c.api_host = "api.copy202610.com".into(); c.proxy_mode = "manual".into();
        for url in ["http://user:secret@localhost:7890", "http://localhost:7890/path", "socks5://localhost:7890"] { c.proxy_url = url.into(); assert!(c.validate().is_err()); }
        c.proxy_url = "http://127.0.0.1:7890".into(); assert!(c.validate().is_ok());
        c.comic_concurrency = 9; assert!(c.validate().is_err());
        c.comic_concurrency = 4; c.route = 1; c.node = ROUTES[0][0].into(); assert!(c.validate().is_err());
    }
    #[tokio::test]
    async fn settings_round_trip_preserves_other_device_data() {
        let pool = crate::db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('theme','dark','now')").execute(&pool).await.unwrap();
        let mut config = load(&pool).await.unwrap(); config.route = 1; config.proxy_mode = "direct".into();
        save(&pool, &config).await.unwrap(); assert_eq!(load(&pool).await.unwrap(), config);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT value FROM app_settings WHERE key='theme'").fetch_one(&pool).await.unwrap(), "dark");
    }
    #[tokio::test]
    async fn manual_proxy_is_used_by_the_real_http_client() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut config = ReadingNetwork::default(); config.proxy_mode = "manual".into(); config.proxy_url = format!("http://{}",listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap(); let mut request = [0;4096];
            let n = socket.read(&mut request).await.unwrap(); let request = String::from_utf8_lossy(&request[..n]);
            assert!(request.starts_with("GET http://reading-proxy.test/probe HTTP/1.1"));
            assert!(!request.to_ascii_lowercase().contains("authorization:"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
        });
        assert_eq!(config.client(Duration::from_secs(2)).unwrap().get("http://reading-proxy.test/probe").send().await.unwrap().text().await.unwrap(),"ok");
        server.await.unwrap();
    }
}
