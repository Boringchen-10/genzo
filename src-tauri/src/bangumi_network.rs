//! Device-local public Bangumi transport. Account authorization is separate.
use crate::{db::AppState, error::{AppError, AppResult}};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{sync::Mutex, time::Duration};
use tauri::State;

const KEY: &str = "bangumi.network";
static TRANSPORT: Mutex<Option<(BangumiNetwork, Client)>> = Mutex::new(None);
static SETTINGS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BangumiNetwork {
    pub mode: String,
    pub mirror_url: String,
}

impl Default for BangumiNetwork {
    fn default() -> Self {
        Self { mode: "system".into(), mirror_url: String::new() }
    }
}

impl BangumiNetwork {
    pub fn normalized(mut self) -> AppResult<Self> {
        self.mirror_url = self.mirror_url.trim().trim_end_matches('/').to_string();
        if !matches!(self.mode.as_str(), "system" | "direct" | "mirror") {
            return Err(AppError::Validation("Bangumi 连接方式无效".into()));
        }
        if self.mode == "mirror" && self.mirror_url.is_empty() {
            return Err(AppError::Validation("请输入 Bangumi 镜像根地址".into()));
        }
        if !self.mirror_url.is_empty() {
            let url = reqwest::Url::parse(&self.mirror_url)
                .map_err(|_| AppError::Validation("镜像地址须为有效的 HTTPS 根地址".into()))?;
            let local_http = url.scheme() == "http"
                && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
            if (url.scheme() != "https" && !local_http)
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path().trim_end_matches('/').ends_with("/v0")
            {
                return Err(AppError::Validation("镜像请填写提供 /v0 和 /calendar 的根地址，不带账号、查询参数或 /v0 后缀；远程地址须使用 HTTPS".into()));
            }
            self.mirror_url = url.to_string().trim_end_matches('/').to_string();
        }
        Ok(self)
    }

    pub fn base_url(&self) -> &str {
        if self.mode == "mirror" { &self.mirror_url } else { "https://api.bgm.tv" }
    }

    pub fn source_label(&self) -> &'static str {
        if self.mode == "mirror" { "Bangumi 自定义镜像" } else { "Bangumi 官方 API" }
    }

    pub fn cache_key(&self, key: &str) -> String {
        if self.mode == "mirror" { format!("mirror:{}:{key}", self.mirror_url) } else { key.to_string() }
    }

    pub fn client(&self) -> AppResult<Client> {
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent(concat!("Genzo/", env!("CARGO_PKG_VERSION"), " (local media library)"))
            .redirect(reqwest::redirect::Policy::none());
        if self.mode != "system" { builder = builder.no_proxy(); }
        builder.build().map_err(|error| AppError::Network(format!("无法初始化 Bangumi 客户端：{error}")))
    }
}

pub fn current() -> BangumiNetwork {
    TRANSPORT.lock().expect("Bangumi transport lock")
        .as_ref().map(|(config, _)| config.clone()).unwrap_or_default()
}

pub fn transport() -> AppResult<(BangumiNetwork, Client)> {
    let mut state = TRANSPORT.lock().expect("Bangumi transport lock");
    if state.is_none() {
        let config = BangumiNetwork::default();
        let client = config.client()?;
        *state = Some((config, client));
    }
    Ok(state.as_ref().expect("initialized transport").clone())
}

pub async fn load(pool: &SqlitePool) -> AppResult<BangumiNetwork> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=?")
        .bind(KEY).fetch_optional(pool).await?;
    let config = match value {
        Some(value) => serde_json::from_str(&value)?,
        None => BangumiNetwork::default(),
    };
    config.normalized()
}

pub async fn initialize(pool: &SqlitePool) -> AppResult<()> {
    let config = load(pool).await?;
    let client = config.client()?;
    *TRANSPORT.lock().expect("Bangumi transport lock") = Some((config, client));
    Ok(())
}

#[tauri::command]
pub async fn get_bangumi_network(state: State<'_, AppState>) -> AppResult<BangumiNetwork> {
    load(&state.pool).await
}

#[tauri::command]
pub async fn save_bangumi_network(config: BangumiNetwork, state: State<'_, AppState>) -> AppResult<()> {
    let _guard = SETTINGS_LOCK.lock().await;
    let config = config.normalized()?;
    let client = config.client()?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(KEY).bind(serde_json::to_string(&config)?).bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.pool).await?;
    *TRANSPORT.lock().expect("Bangumi transport lock") = Some((config, client));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BangumiProbe {
    pub name: String,
    pub milliseconds: Option<u128>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_bangumi_network(config: BangumiNetwork) -> AppResult<Vec<BangumiProbe>> {
    let config = config.normalized()?;
    let provider = crate::bangumi::BangumiProvider::configured(&config)?;
    let mut probes = vec![];
    for name in ["目录 / 搜索", "条目详情", "每周时间表"] {
        let start = std::time::Instant::now();
        let result = match name {
            "目录 / 搜索" => provider.ranking(1, 0).await.map(|_| ()),
            "条目详情" => provider.get_details("326").await.map(|_| ()),
            _ => provider.calendar_by_weekday().await.map(|_| ()),
        };
        probes.push(BangumiProbe {
            name: name.into(),
            milliseconds: result.as_ref().ok().map(|_| start.elapsed().as_millis()),
            error: result.err().map(|error| error.to_string()),
        });
    }
    Ok(probes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_modes_and_mirror_base_urls() {
        for mode in ["system", "direct"] {
            assert!(BangumiNetwork { mode: mode.into(), mirror_url: String::new() }.normalized().is_ok());
        }
        for value in ["", "http://example.com", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com/#fragment", "https://example.com/v0"] {
            assert!(BangumiNetwork { mode: "mirror".into(), mirror_url: value.into() }.normalized().is_err(), "{value}");
        }
        let config = BangumiNetwork { mode: "mirror".into(), mirror_url: " https://example.com/bangumi/ ".into() }.normalized().unwrap();
        assert_eq!(config.base_url(), "https://example.com/bangumi");
        assert_eq!(config.source_label(), "Bangumi 自定义镜像");
        assert!(BangumiNetwork { mode: "mirror".into(), mirror_url: "http://127.0.0.1:8080".into() }.normalized().is_ok());
    }

    #[tokio::test]
    async fn settings_remain_device_local_and_defaults_are_compatible() {
        let pool = crate::db::test_pool().await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), BangumiNetwork::default());
        let config = BangumiNetwork { mode: "mirror".into(), mirror_url: "https://example.com".into() };
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,'test')")
            .bind(KEY).bind(serde_json::to_string(&config).unwrap()).execute(&pool).await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), config);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM works").fetch_one(&pool).await.unwrap(), 0);
    }
}
