use crate::error::{AppError, AppResult};
use crate::metadata_provider::{MetadataProvider, MetadataSearchQuery, ProviderRateLimiter};
use crate::models::{
    AnimeCharacter, AnimeCredit, AnimeEpisodeMetadata, AnimeSeasonOption, MetadataProviderStatus,
    WorkMetadata,
};
use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

const API_ROOT: &str = "https://api.bgm.tv/v0";
static RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();

#[derive(Clone)]
pub struct BangumiProvider {
    client: Client,
    pool: Option<sqlx::SqlitePool>,
    warnings: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl BangumiProvider {
    pub fn new() -> AppResult<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .user_agent("Genzo/0.2.0 (local media library)")
            .build()
            .map_err(|error| AppError::Network(format!("无法初始化 Bangumi 客户端：{error}")))?;
        Ok(Self {
            client,
            pool: None,
            warnings: Default::default(),
        })
    }

    pub fn with_pool(mut self, pool: &sqlx::SqlitePool) -> Self {
        self.pool = Some(pool.clone());
        self
    }

    pub fn warn(&self, warning: String) {
        self.warnings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(warning);
    }

    pub fn has_warnings(&self) -> bool {
        !self
            .warnings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty()
    }

    pub fn take_warnings(&self) -> Vec<String> {
        std::mem::take(&mut *self.warnings.lock().unwrap_or_else(|e| e.into_inner()))
    }

    async fn request(&self, builder: reqwest::RequestBuilder) -> AppResult<Value> {
        let request = builder.build().map_err(network_error)?;
        let key = format!(
            "http:{}:{}:{}",
            request.method(),
            request.url(),
            request
                .body()
                .and_then(|b| b.as_bytes())
                .map(|b| String::from_utf8_lossy(b))
                .unwrap_or_default()
        );
        let cached: Option<String> = if let Some(pool) = &self.pool {
            sqlx::query_scalar(
                "SELECT response_json FROM metadata_cache WHERE provider='bangumi' AND cache_key=?",
            )
            .bind(&key)
            .fetch_optional(pool)
            .await?
        } else {
            None
        };
        let mut error = AppError::Network("Bangumi 请求失败".into());
        for attempt in 0..3u32 {
            let cloned = request
                .try_clone()
                .ok_or_else(|| AppError::System("Bangumi 请求无法重试".into()))?;
            let mut delay = Duration::from_millis(250 * (1 << attempt));
            let retry;
            match self.client.execute(cloned).await {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        match response.json::<Value>().await {
                            Ok(body) => {
                                if !(body.is_array()
                                    || body.get("data").is_some_and(Value::is_array)
                                    || body.get("id").is_some_and(Value::is_number))
                                {
                                    error = AppError::Network(
                                        "Bangumi 返回的数据结构无效，保留旧缓存".into(),
                                    );
                                    break;
                                }
                                // An empty first episode page must not overwrite useful cached data.
                                let empty_episodes = request.url().path().ends_with("/episodes")
                                    && body
                                        .get("data")
                                        .and_then(Value::as_array)
                                        .is_some_and(Vec::is_empty);
                                if !empty_episodes {
                                    if let Some(pool) = &self.pool {
                                        let now = Utc::now();
                                        sqlx::query("INSERT INTO metadata_cache (provider,cache_key,response_json,fetched_at,expires_at) VALUES ('bangumi',?,?,?,?) ON CONFLICT(provider,cache_key) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
                                            .bind(&key).bind(body.to_string()).bind(now.to_rfc3339())
                                            .bind((now+chrono::Duration::days(7)).to_rfc3339()).execute(pool).await?;
                                    }
                                    return Ok(body);
                                }
                                if cached.is_none() {
                                    self.warn("Bangumi 返回空分集，保留已有分集与手动关联".into());
                                    return Ok(body);
                                }
                                error = AppError::Network("Bangumi 返回空分集，保留旧缓存".into());
                                break;
                            }
                            Err(e) => {
                                retry = e.is_timeout() || e.is_connect();
                                error = network_error(e);
                            }
                        }
                    } else {
                        retry = matches!(status.as_u16(), 408 | 425 | 429 | 500..=599);
                        if let Some(value) = response
                            .headers()
                            .get(reqwest::header::RETRY_AFTER)
                            .and_then(|v| v.to_str().ok())
                        {
                            delay = delay.max(retry_after(value));
                        }
                        error = AppError::Network(format!(
                            "Bangumi 请求失败（HTTP {}）",
                            status.as_u16()
                        ));
                    }
                }
                Err(e) => {
                    retry = e.is_connect() || e.is_timeout();
                    error = network_error(e);
                }
            }
            // Do not retry earlier than Retry-After; long waits return the cache instead.
            if !retry || attempt == 2 || delay > Duration::from_secs(30) {
                break;
            }
            tokio::time::sleep(delay).await;
        }
        if let Some(value) = cached.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            self.warnings
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(format!("{error}；已使用本地缓存（可能已过期）"));
            return Ok(value);
        }
        Err(error)
    }

    pub async fn search(&self, query: &str) -> AppResult<Vec<WorkMetadata>> {
        self.wait().await;
        let body = self
            .request(
                self.client
                    .post(format!("{API_ROOT}/search/subjects"))
                    .json(&json!({ "keyword": query, "sort": "match", "filter": { "type": [2] } })),
            )
            .await?;
        Ok(body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(12)
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn ranking(&self, limit: u32, offset: u32) -> AppResult<Vec<WorkMetadata>> {
        self.wait().await;
        let body = self
            .request(
                self.client
                    .post(format!("{API_ROOT}/search/subjects"))
                    .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
                    .json(&json!({
                        "keyword": "",
                        "sort": "rank",
                        "filter": { "type": [2], "rank": [">=1"] }
                    })),
            )
            .await?;
        Ok(body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        self.wait().await;
        let body = self
            .request(
                self.client
                    .get(format!("{API_ROOT}/subjects/{external_id}")),
            )
            .await?;
        subject_to_metadata(&body)
            .ok_or_else(|| AppError::Network("Bangumi 详情缺少必要字段".to_string()))
    }

    pub async fn calendar(&self) -> AppResult<Vec<WorkMetadata>> {
        self.wait().await;
        let body = self
            .request(self.client.get("https://api.bgm.tv/calendar"))
            .await?;
        Ok(body
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|day| day.get("items").and_then(Value::as_array))
            .flatten()
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn episodes(&self, external_id: &str) -> AppResult<Vec<AnimeEpisodeMetadata>> {
        let subject_id = external_id
            .trim()
            .parse::<i64>()
            .map_err(|_| AppError::Validation("Bangumi 条目 ID 无效".to_string()))?;
        let mut episodes = Vec::new();
        let mut offset = 0_u32;
        loop {
            self.wait().await;
            let body = self
                .request(self.client.get(format!("{API_ROOT}/episodes")).query(&[
                    ("subject_id", subject_id.to_string()),
                    ("type", "0".to_string()),
                    ("limit", "100".to_string()),
                    ("offset", offset.to_string()),
                ]))
                .await?;
            let data = body
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let fetched_at = Utc::now().to_rfc3339();
            episodes.extend(
                data.iter()
                    .filter_map(|item| episode_to_metadata(item, &fetched_at)),
            );
            if data.len() < 100 {
                break;
            }
            offset += 100;
        }
        Ok(episodes)
    }

    pub async fn related_subjects(&self, external_id: &str) -> AppResult<Vec<AnimeSeasonOption>> {
        let body = self
            .get_subject_collection(external_id, "subjects", "关联作品")
            .await?;
        Ok(collection_items(&body)
            .filter_map(|item| {
                let subject = item.get("subject").unwrap_or(item);
                let metadata = subject_to_metadata(subject)?;
                Some(AnimeSeasonOption {
                    external_id: metadata.external_id,
                    title: metadata.title,
                    original_title: metadata.original_title,
                    relation: item
                        .get("relation")
                        .and_then(Value::as_str)
                        .unwrap_or("关联作品")
                        .to_string(),
                    season_number: metadata.season.and_then(|value| u32::try_from(value).ok()),
                    cover_url: metadata.cover_url,
                    local_work_id: None,
                    current: false,
                })
            })
            .collect())
    }

    pub async fn staff(&self, external_id: &str) -> AppResult<Vec<AnimeCredit>> {
        let body = self
            .get_subject_collection(external_id, "persons", "制作人员")
            .await?;
        Ok(collection_items(&body)
            .filter_map(|item| {
                let person = item.get("person").unwrap_or(item);
                Some(AnimeCredit {
                    external_id: person.get("id")?.as_i64()?.to_string(),
                    name: nonempty(person.get("name").and_then(Value::as_str))?,
                    role: item
                        .get("relation")
                        .and_then(Value::as_str)
                        .unwrap_or("制作人员")
                        .to_string(),
                    image_url: best_image_url(person),
                })
            })
            .collect())
    }

    pub async fn characters(&self, external_id: &str) -> AppResult<Vec<AnimeCharacter>> {
        let body = self
            .get_subject_collection(external_id, "characters", "角色信息")
            .await?;
        Ok(collection_items(&body)
            .filter_map(|item| {
                let character = item.get("character").unwrap_or(item);
                let actors = item
                    .get("actors")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|actor| actor.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect();
                Some(AnimeCharacter {
                    external_id: character.get("id")?.as_i64()?.to_string(),
                    name: nonempty(character.get("name").and_then(Value::as_str))?,
                    role: item
                        .get("relation")
                        .and_then(Value::as_str)
                        .unwrap_or("角色")
                        .to_string(),
                    image_url: best_image_url(character),
                    actors,
                })
            })
            .collect())
    }

    async fn get_subject_collection(
        &self,
        external_id: &str,
        collection: &str,
        label: &str,
    ) -> AppResult<Value> {
        self.wait().await;
        let _ = label;
        self.request(
            self.client
                .get(format!("{API_ROOT}/subjects/{external_id}/{collection}")),
        )
        .await
    }

    async fn wait(&self) {
        RATE_LIMITER
            .get_or_init(|| ProviderRateLimiter::new(Duration::from_secs(2)))
            .wait()
            .await;
    }
}

fn retry_after(value: &str) -> Duration {
    if let Ok(seconds) = value.trim().parse::<u64>() {
        return Duration::from_secs(seconds);
    }
    chrono::DateTime::parse_from_rfc2822(value)
        .ok()
        .and_then(|date| (date.with_timezone(&Utc) - Utc::now()).to_std().ok())
        .unwrap_or_default()
}

fn collection_items(value: &Value) -> impl Iterator<Item = &Value> {
    value
        .as_array()
        .or_else(|| value.get("data").and_then(Value::as_array))
        .into_iter()
        .flatten()
}

fn best_image_url(value: &Value) -> Option<String> {
    let images = value.get("images")?;
    ["large", "medium", "common", "grid", "small"]
        .into_iter()
        .find_map(|key| images.get(key).and_then(Value::as_str))
        .map(normalize_bangumi_image_url)
}

fn episode_to_metadata(item: &Value, fetched_at: &str) -> Option<AnimeEpisodeMetadata> {
    let id = item.get("id")?.as_i64()?.to_string();
    let sort = item.get("sort").and_then(Value::as_f64).unwrap_or_default();
    let episode_number = (sort >= 0.0 && sort.fract() == 0.0).then_some(sort as u32);
    let original_title = nonempty(item.get("name").and_then(Value::as_str));
    let title = nonempty(item.get("name_cn").and_then(Value::as_str))
        .or_else(|| original_title.clone())
        .unwrap_or_else(|| {
            episode_number.map_or_else(|| "特别篇".to_string(), |number| format!("第 {number} 集"))
        });
    Some(AnimeEpisodeMetadata {
        provider: "bangumi".to_string(),
        external_id: id,
        episode_number,
        sort_number: sort.max(0.0).round() as u32,
        title,
        original_title,
        description: item
            .get("desc")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        air_date: nonempty(item.get("airdate").and_then(Value::as_str)),
        duration: nonempty(item.get("duration").and_then(Value::as_str)),
        fetched_at: fetched_at.to_string(),
    })
}

#[async_trait]
impl MetadataProvider for BangumiProvider {
    fn key(&self) -> &'static str {
        "bangumi"
    }

    fn status(&self) -> MetadataProviderStatus {
        MetadataProviderStatus {
            key: "bangumi".to_string(),
            label: "Bangumi".to_string(),
            available: true,
            configured: true,
            requires_credential: false,
            message: Some("主匹配源，使用官方 API".to_string()),
        }
    }

    async fn search(&self, query: &MetadataSearchQuery) -> AppResult<Vec<WorkMetadata>> {
        BangumiProvider::search(self, &query.title).await
    }

    async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        BangumiProvider::get_details(self, external_id).await
    }
}

fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Network("连接 Bangumi 超时，请检查网络后重试".to_string())
    } else if error.is_connect() {
        AppError::Network("无法连接 Bangumi，本地媒体库仍可正常使用".to_string())
    } else {
        AppError::Network(format!("Bangumi 请求失败：{error}"))
    }
}

pub(crate) fn subject_to_metadata(value: &Value) -> Option<WorkMetadata> {
    let external_id = value.get("id")?.as_i64()?.to_string();
    let original = nonempty(value.get("name").and_then(Value::as_str));
    let chinese = nonempty(value.get("name_cn").and_then(Value::as_str));
    let title = chinese.clone().or_else(|| original.clone())?;
    let aliases = extract_aliases(value, &title, original.as_deref());
    let year = value
        .get("date")
        .or_else(|| value.get("air_date"))
        .and_then(Value::as_str)
        .and_then(|date| date.get(..4))
        .and_then(|year| year.parse::<i64>().ok());
    let subject_type = match value.get("platform").and_then(Value::as_str) {
        Some("剧场版") => "movie",
        Some("OVA") | Some("OAD") => "ova",
        Some("WEB") => "web",
        _ => "tv",
    }
    .to_string();
    let genres = value
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tag| tag.get("name").and_then(Value::as_str))
        .take(12)
        .map(str::to_string)
        .collect();
    let rating = value.get("rating");
    let collection_count = value
        .get("collection")
        .and_then(Value::as_object)
        .map(|collection| collection.values().filter_map(Value::as_i64).sum::<i64>())
        .unwrap_or_default();
    let cover_url = value
        .get("images")
        .and_then(|images| images.get("large").or_else(|| images.get("common")))
        .and_then(Value::as_str)
        .map(normalize_bangumi_image_url);
    let air_date = value
        .get("date")
        .or_else(|| value.get("air_date"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(WorkMetadata {
        provider: "bangumi".to_string(),
        external_id,
        title,
        original_title: original,
        aliases,
        description: value
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        cover_url: cover_url.clone(),
        banner_url: None,
        year,
        season: extract_season(value),
        subject_type,
        genres,
        score: rating
            .and_then(|value| value.get("score"))
            .and_then(Value::as_f64),
        rank: value.get("rank").and_then(Value::as_i64).or_else(|| {
            rating
                .and_then(|value| value.get("rank"))
                .and_then(Value::as_i64)
        }),
        rating_count: rating
            .and_then(|value| value.get("total"))
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        collection_count,
        air_date,
        broadcast: None,
        source_keys: vec!["bangumi".to_string()],
        cover_provider: cover_url.map(|_| "bangumi".to_string()),
        banner_provider: None,
        score_provider: rating
            .and_then(|value| value.get("score"))
            .and_then(Value::as_f64)
            .map(|_| "bangumi".to_string()),
        fetched_at: Utc::now().to_rfc3339(),
    })
}

fn normalize_bangumi_image_url(value: &str) -> String {
    if let Some(path) = value.strip_prefix("http://lain.bgm.tv/") {
        format!("https://lain.bgm.tv/{path}")
    } else if let Some(path) = value.strip_prefix("//lain.bgm.tv/") {
        format!("https://lain.bgm.tv/{path}")
    } else {
        value.to_string()
    }
}

fn nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn extract_aliases(value: &Value, title: &str, original: Option<&str>) -> Vec<String> {
    let mut aliases = Vec::new();
    if let Some(items) = value.get("infobox").and_then(Value::as_array) {
        for item in items {
            let key = item.get("key").and_then(Value::as_str).unwrap_or_default();
            if matches!(key, "别名" | "中文名" | "英文名" | "日文名") {
                match item.get("value") {
                    Some(Value::String(alias)) => aliases.push(alias.clone()),
                    Some(Value::Array(values)) => aliases.extend(
                        values
                            .iter()
                            .filter_map(|entry| {
                                entry
                                    .get("v")
                                    .and_then(Value::as_str)
                                    .or_else(|| entry.as_str())
                            })
                            .map(str::to_string),
                    ),
                    _ => {}
                }
            }
        }
    }
    aliases.retain(|alias| alias != title && Some(alias.as_str()) != original);
    aliases.sort();
    aliases.dedup();
    aliases
}

fn extract_season(value: &Value) -> Option<i64> {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let re = regex::Regex::new(r"(?i)(?:season\s*|\sS)(\d{1,2})\b").expect("static regex");
    re.captures(name)
        .and_then(|captures| captures.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture(responses: Vec<(u16, &'static str)>) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/episodes", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            for (status, body) in responses {
                let (mut stream, _) =
                    tokio::time::timeout(Duration::from_secs(10), listener.accept())
                        .await
                        .unwrap()
                        .unwrap();
                let mut input = [0; 4096];
                stream.read(&mut input).await.unwrap();
                if status == 0 {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
                let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nRetry-After: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (url, task)
    }

    #[tokio::test]
    async fn retries_502_and_preserves_stale_episode_cache_and_empty_refresh() {
        let pool = crate::db::test_pool().await.unwrap();
        let provider = BangumiProvider::new().unwrap().with_pool(&pool);
        let (url, task) = fixture(vec![
            (502, "{}"),
            (200, r#"{"data":[{"id":1,"sort":1}]}"#),
            (502, "{}"),
            (502, "{}"),
            (502, "{}"),
            (200, r#"{"data":[]}"#),
        ])
        .await;
        let expected = provider.request(provider.client.get(&url)).await.unwrap();
        sqlx::query("UPDATE metadata_cache SET expires_at='2000-01-01'")
            .execute(&pool)
            .await
            .unwrap();
        let cached = provider.request(provider.client.get(&url)).await.unwrap();
        assert_eq!(cached, expected);
        assert!(provider
            .take_warnings()
            .iter()
            .any(|s| s.contains("502") && s.contains("缓存")));
        assert_eq!(
            provider.request(provider.client.get(&url)).await.unwrap(),
            expected
        );
        let expiry: String = sqlx::query_scalar("SELECT expires_at FROM metadata_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(expiry, "2000-01-01", "fallback must not renew stale caches");
        task.await.unwrap();
    }

    #[tokio::test]
    async fn permanent_errors_are_not_retried() {
        let provider = BangumiProvider::new().unwrap();
        let (url, task) = fixture(vec![(404, "{}")]).await;
        assert!(provider
            .request(provider.client.get(url))
            .await
            .unwrap_err()
            .to_string()
            .contains("404"));
        task.await.unwrap();
        assert_eq!(retry_after("2"), Duration::from_secs(2));
        let future = (Utc::now() + chrono::Duration::seconds(60)).to_rfc2822();
        assert!(retry_after(&future) >= Duration::from_secs(58));
    }

    #[tokio::test]
    async fn transient_statuses_and_timeouts_recover() {
        let provider = BangumiProvider::new().unwrap();
        let (url, task) = fixture(vec![
            (408, "{}"),
            (425, "{}"),
            (200, "[]"),
            (429, "{}"),
            (200, "[]"),
            (503, "{}"),
            (200, "[]"),
        ])
        .await;
        for _ in 0..3 {
            assert_eq!(
                provider.request(provider.client.get(&url)).await.unwrap(),
                json!([])
            );
        }
        task.await.unwrap();
        let mut provider = BangumiProvider::new().unwrap();
        provider.client = Client::builder()
            .timeout(Duration::from_millis(100))
            .build()
            .unwrap();
        let (url, task) = fixture(vec![(0, ""), (200, "[]")]).await;
        assert_eq!(
            provider.request(provider.client.get(&url)).await.unwrap(),
            json!([])
        );
        task.await.unwrap();
    }
    #[test]
    fn maps_subject_json() {
        let value = json!({"id": 123, "name": "Sousou no Frieren", "name_cn": "葬送的芙莉莲", "summary": "简介", "date": "2023-09-29", "platform": "TV", "images": {"large": "https://lain.bgm.tv/pic/cover/l/test.jpg"}, "tags": [{"name": "奇幻"}], "rating": {"rank": 42, "total": 36198, "score": 8.5}, "collection": {"wish": 10, "collect": 20, "doing": 5}});
        let metadata = subject_to_metadata(&value).expect("metadata");
        assert_eq!(metadata.external_id, "123");
        assert_eq!(metadata.title, "葬送的芙莉莲");
        assert_eq!(metadata.year, Some(2023));
        assert_eq!(metadata.score, Some(8.5));
        assert_eq!(metadata.rank, Some(42));
        assert_eq!(metadata.rating_count, 36_198);
        assert_eq!(metadata.collection_count, 35);
    }

    #[test]
    fn normalizes_bangumi_cover_urls_to_https() {
        assert_eq!(
            normalize_bangumi_image_url("http://lain.bgm.tv/pic/cover/l/test.jpg"),
            "https://lain.bgm.tv/pic/cover/l/test.jpg"
        );
        assert_eq!(
            normalize_bangumi_image_url("//lain.bgm.tv/pic/cover/l/test.jpg"),
            "https://lain.bgm.tv/pic/cover/l/test.jpg"
        );
    }
    #[test]
    fn fetched_at_is_recorded() {
        let m = subject_to_metadata(&json!({"id": 1, "name": "A"})).unwrap();
        assert!(!m.fetched_at.is_empty());
    }

    #[test]
    fn maps_legacy_calendar_rating_shape() {
        let metadata = subject_to_metadata(&json!({
            "id": 456080,
            "name": "Calendar anime",
            "rating": {"total": 599, "score": 5.0},
            "rank": 9798,
            "collection": {"doing": 2151}
        }))
        .expect("calendar metadata");
        assert_eq!(metadata.rating_count, 599);
        assert_eq!(metadata.rank, Some(9798));
        assert_eq!(metadata.collection_count, 2151);
    }

    #[test]
    fn maps_episode_numbers_as_integers() {
        let episode = episode_to_metadata(
            &json!({
                "id": 100,
                "sort": 12,
                "name": "The End of the Journey",
                "name_cn": "旅途的终点",
                "airdate": "2023-12-01",
                "duration": "00:24:00"
            }),
            "2026-09-15T00:00:00Z",
        )
        .expect("episode");
        assert_eq!(episode.episode_number, Some(12));
        assert_eq!(episode.sort_number, 12);
        assert_eq!(episode.title, "旅途的终点");
    }

    #[tokio::test]
    #[ignore = "requires the live Bangumi API"]
    async fn live_episode_contract_is_parseable() {
        let provider = BangumiProvider::new().expect("provider");
        let episodes = provider.episodes("400602").await.expect("episodes");
        assert!(!episodes.is_empty());
        assert!(episodes
            .iter()
            .any(|episode| episode.episode_number.is_some()));
    }

    #[tokio::test]
    #[ignore = "requires the live Bangumi API"]
    async fn live_ranking_and_detail_collections_are_parseable() {
        let provider = BangumiProvider::new().expect("provider");
        let ranking = provider.ranking(3, 0).await.expect("ranking");
        assert_eq!(ranking.len(), 3);
        assert!(ranking
            .iter()
            .all(|item| item.rank.is_some_and(|rank| rank >= 1)));

        let related = provider
            .related_subjects("400602")
            .await
            .expect("relations");
        assert!(!related.is_empty());
        let staff = provider.staff("400602").await.expect("staff");
        assert!(!staff.is_empty());
        let characters = provider.characters("400602").await.expect("characters");
        assert!(!characters.is_empty());
    }
}
