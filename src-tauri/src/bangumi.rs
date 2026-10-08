use crate::error::{AppError, AppResult};
use crate::metadata_provider::{MetadataProvider, MetadataSearchQuery, ProviderRateLimiter};
use crate::models::{
    AnimeCharacter, AnimeCredit, AnimeEpisodeMetadata, AnimeSeasonOption, BangumiComment,
    BangumiCommentPage, MetadataProviderStatus, WorkMetadata,
};
use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
static RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();
static BACKGROUND_RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();
static WEBSITE_RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();

#[derive(Clone)]
pub struct BangumiProvider {
    client: Client,
    api_root: String,
    background: bool,
}

impl BangumiProvider {
    pub fn structure_cache_key(&self, subject: &str, section: &str) -> String {
        format!("subject:{}:{subject}:{section}", self.api_root)
    }
    pub fn new() -> AppResult<Self> {
        let (config, client) = crate::bangumi_network::transport()?;
        Ok(Self::with_transport(&config, client))
    }

    pub fn with_transport(config: &crate::bangumi_network::BangumiNetwork, client: Client) -> Self {
        Self { client, api_root: format!("{}/v0", config.base_url()), background:false }
    }

    pub fn configured(config: &crate::bangumi_network::BangumiNetwork) -> AppResult<Self> {
        Ok(Self { client: config.client()?, api_root: format!("{}/v0", config.base_url()), background:false })
    }
    pub fn background() -> AppResult<Self> { let mut provider = Self::new()?; provider.background = true; Ok(provider) }

    pub async fn search(&self, query: &str) -> AppResult<Vec<WorkMetadata>> {
        self.wait().await;
        let response = self
            .client
            .post(format!("{}/search/subjects", self.api_root))
            .json(&json!({ "keyword": query, "sort": "match", "filter": { "type": [2] } }))
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 429 {
            return Err(AppError::Network(
                "Bangumi 请求过于频繁，请稍后再试".to_string(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 搜索失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
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
        let response = self
            .client
            .post(format!("{}/search/subjects", self.api_root))
            .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
            .json(&json!({
                "keyword": "",
                "sort": "rank",
                "filter": { "type": [2], "rank": [">=1"] }
            }))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 动画排行榜读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response.json().await.map_err(|error| {
            AppError::Network(format!("Bangumi 返回了无法解析的排行榜数据：{error}"))
        })?;
        Ok(body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(subject_to_metadata)
            .collect())
    }

    pub async fn popular(&self, page: u32) -> AppResult<PopularSubjects> {
        // Do not queue interactive website reads behind v0 background detail hydration.
        WEBSITE_RATE_LIMITER.get_or_init(|| ProviderRateLimiter::new(Duration::from_secs(2)))
            .wait().await;
        // Website trends differs from v0 search heat (all-time collections).
        // P1 belongs to the official website; v0 mirrors do not promise this route.
        let response = self.client.get("https://next.bgm.tv/p1/subjects")
            .query(&[("type", "2".to_string()), ("sort", "trends".to_string()),
                ("page", page.to_string())])
            .send().await.map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!("Bangumi 热度列表读取失败（HTTP {}）", response.status().as_u16())));
        }
        let body = response.json().await.map_err(|error| {
            AppError::Network(format!("Bangumi 返回了无法解析的热度数据：{error}"))
        })?;
        parse_popular_subjects(body)
    }

    pub async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        self.wait().await;
        let response = self
            .client
            .get(format!("{}/subjects/{external_id}", self.api_root))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 详情读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
        subject_to_metadata(&body)
            .ok_or_else(|| AppError::Network("Bangumi 详情缺少必要字段".to_string()))
    }

    pub async fn calendar(&self) -> AppResult<Vec<WorkMetadata>> {
        Ok(self.calendar_by_weekday().await?.into_iter().map(|(_, item)| item).collect())
    }

    pub async fn calendar_by_weekday(&self) -> AppResult<Vec<(u32, WorkMetadata)>> {
        self.wait().await;
        let response = self
            .client
            .get(format!("{}/calendar", self.api_root.trim_end_matches("/v0")))
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 429 {
            return Err(AppError::Network(
                "Bangumi 请求过于频繁，请稍后再试".to_string(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi 番组日历读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的数据：{error}")))?;
        calendar_by_weekday(&body)
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
            let request = self
                .client
                .get(format!("{}/episodes", self.api_root))
                .query(&[
                    ("subject_id", subject_id.to_string()),
                    ("limit", "100".to_string()),
                    ("offset", offset.to_string()),
                ]);
            let response = retry_public_get(request).await?;
            if response.status().as_u16() == 429 {
                return Err(AppError::Network(
                    "Bangumi 请求过于频繁，请稍后再试".to_string(),
                ));
            }
            if !response.status().is_success() {
                return Err(AppError::Network(format!(
                    "Bangumi 分集读取失败（HTTP {}）",
                    response.status().as_u16()
                )));
            }
            let body: Value = response.json().await.map_err(|error| {
                AppError::Network(format!("Bangumi 返回了无法解析的分集数据：{error}"))
            })?;
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

    pub async fn comments(&self, external_id: &str, offset: u32, limit: u32) -> AppResult<BangumiCommentPage> {
        let subject_id = external_id.trim().parse::<i64>().map_err(|_| AppError::Validation("Bangumi 条目 ID 无效".into()))?;
        if offset > 1_000_000 || !(1..=100).contains(&limit) { return Err(AppError::Validation("Bangumi 评论分页参数无效".into())); }
        WEBSITE_RATE_LIMITER.get_or_init(|| ProviderRateLimiter::new(Duration::from_secs(2))).wait().await;
        let website = if self.api_root == "https://api.bgm.tv/v0" { "https://next.bgm.tv" } else { self.api_root.trim_end_matches("/v0") };
        let response = self.client.get(format!("{website}/p1/subjects/{subject_id}/comments"))
            .query(&[("limit", limit.to_string()), ("offset", offset.to_string())])
            .send().await.map_err(network_error)?;
        if !response.status().is_success() { return Err(AppError::Network(format!("Bangumi 吐槽读取失败（HTTP {}）", response.status().as_u16()))); }
        let body: Value = response.json().await.map_err(|error| AppError::Network(format!("Bangumi 返回了无法解析的吐槽数据：{error}")))?;
        parse_comments(body,subject_id,offset,limit)
    }

    async fn get_subject_collection(
        &self,
        external_id: &str,
        collection: &str,
        label: &str,
    ) -> AppResult<Value> {
        self.wait().await;
        let response = self
            .client
            .get(format!("{}/subjects/{external_id}/{collection}", self.api_root))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Bangumi {label}读取失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        response.json().await.map_err(|error| {
            AppError::Network(format!("Bangumi 返回了无法解析的{label}数据：{error}"))
        })
    }

    async fn wait(&self) {
        (if self.background { &BACKGROUND_RATE_LIMITER } else { &RATE_LIMITER })
            .get_or_init(|| ProviderRateLimiter::new(Duration::from_secs(2)))
            .wait()
            .await;
    }
}

fn parse_comments(body: Value, subject_id: i64, offset: u32, limit: u32) -> AppResult<BangumiCommentPage> {
        let (rows, declared_total) = if let Some(rows) = body.as_array() {
            (rows.clone(), None)
        } else {
            (body.get("data").or_else(|| body.get("list")).and_then(Value::as_array).cloned().ok_or_else(|| AppError::Network("Bangumi 吐槽列表格式无效".into()))?, body.get("total").and_then(Value::as_u64))
        };
        let items = rows.into_iter().filter_map(|row| {
            let user = row.get("user").unwrap_or(&row);
            let id = row.get("id").and_then(|v| v.as_i64()).map(|id|id.to_string())
                .or_else(|| user["id"].as_i64().map(|id|format!("{subject_id}:{id}")))?;
            let comment = row.get("comment").or_else(|| row.get("content")).and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if comment.is_empty() { return None; }
            Some(BangumiComment {
                id,
                user_name: user.get("nickname").or_else(|| user.get("username")).and_then(Value::as_str).unwrap_or("匿名用户").to_string(),
                user_avatar: user.get("avatar").and_then(|v| v.get("large").or_else(|| v.get("medium")).or_else(|| v.get("small"))).and_then(Value::as_str).map(normalize_bangumi_image_url),
                comment,
                created_at: row.get("updatedAt").or_else(|| row.get("created_at")).or_else(|| row.get("createdAt"))
                    .map(|value|value.as_str().map(str::to_owned).or_else(||value.as_i64().and_then(|time|chrono::DateTime::from_timestamp(time,0)).map(|time|time.to_rfc3339())).unwrap_or_default()).unwrap_or_default(),
                rate: row.get("rate").and_then(Value::as_f64),
            })
        }).collect::<Vec<_>>();
        let total = declared_total.unwrap_or_else(|| offset as u64 + items.len() as u64);
        Ok(BangumiCommentPage { items, total, offset, limit })
}

fn calendar_by_weekday(body: &Value) -> AppResult<Vec<(u32, WorkMetadata)>> {
    let days = body.as_array().ok_or_else(|| AppError::Network("Bangumi 日历响应格式无效，保留已有缓存".into()))?;
    if days.is_empty() { return Err(AppError::Network("Bangumi 日历响应为空，保留已有缓存".into())); }
    let mut items = Vec::new();
    for day in days {
        let weekday = day["weekday"]["id"].as_u64().filter(|day| (1..=7).contains(day))
            .ok_or_else(|| AppError::Network("Bangumi 日历星期无效，保留已有缓存".into()))?;
        let subjects = day["items"].as_array().ok_or_else(|| AppError::Network("Bangumi 日历条目无效，保留已有缓存".into()))?;
        for subject in subjects {
            if let Some(metadata) = subject_to_metadata(subject) { items.push((weekday as u32, metadata)); }
        }
    }
    Ok(items)
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
        episode_type: item
            .get("type")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
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

async fn retry_public_get(request: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
    let request = request.timeout(Duration::from_secs(4));
    let retry = request.try_clone().expect("public GET has no streaming body");
    match request.send().await {
        Ok(response) => Ok(response),
        Err(error) if error.is_timeout() || error.is_connect() || error.is_request() => retry.send().await.map_err(network_error),
        Err(error) => Err(network_error(error)),
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PopularSubjects {
    pub items: Vec<WorkMetadata>,
    pub total_pages: u64,
}

fn parse_popular_subjects(body: Value) -> AppResult<PopularSubjects> {
    let invalid = || AppError::Network("Bangumi 热度列表没有返回有效动画资料".into());
    let rows = body["data"].as_array().ok_or_else(invalid)?;
    // P1 total is the number of pages, not the number of subjects.
    let total_pages = body["total"].as_u64().ok_or_else(invalid)?;
    let items = rows.iter().map(|row| {
        if row["type"].as_u64() != Some(2) || !row["id"].as_i64().is_some_and(|id| id > 0) {
            return Err(invalid());
        }
        let mut normalized = row.clone();
        normalized["name_cn"] = row["nameCN"].clone();
        let tags = row["metaTags"].as_array().ok_or_else(invalid)?;
        normalized["tags"] = Value::Array(tags.iter().map(|name| json!({"name": name})).collect());
        normalized["platform"] = tags.iter().find(|tag| {
            tag.as_str().is_some_and(|name| matches!(name, "TV" | "WEB" | "OVA" | "OAD" | "剧场版"))
        }).cloned().unwrap_or(Value::Null);
        subject_to_metadata(&normalized).ok_or_else(invalid)
    }).collect::<AppResult<Vec<_>>>()?;
    if rows.len() > 24 || (total_pages == 0 && !items.is_empty()) { return Err(invalid()); }
    Ok(PopularSubjects { items, total_pages })
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
    ["name_cn", "name"].into_iter().filter_map(|key| value.get(key).and_then(Value::as_str))
        .find_map(|name| crate::anime_parser::parse_folder_name(name).season)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn public_get_retries_a_dropped_connection_but_not_rate_limit_responses() {
        use tokio::io::{AsyncReadExt,AsyncWriteExt};
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let address=listener.local_addr().unwrap();
        let server=tokio::spawn(async move {
            let (mut first,_)=listener.accept().await.unwrap();first.read(&mut [0;1024]).await.unwrap();drop(first);
            let (mut second,_)=tokio::time::timeout(std::time::Duration::from_secs(2),listener.accept()).await.unwrap().unwrap();second.read(&mut [0;1024]).await.unwrap();second.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
        });
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(super::retry_public_get(client.get(format!("http://{address}/episodes"))).await.unwrap().text().await.unwrap(),"ok");server.await.unwrap();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let address=listener.local_addr().unwrap();
        let server=tokio::spawn(async move {let (mut stream,_)=listener.accept().await.unwrap();stream.read(&mut [0;1024]).await.unwrap();stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();assert!(tokio::time::timeout(std::time::Duration::from_millis(100),listener.accept()).await.is_err());});
        assert_eq!(super::retry_public_get(client.get(format!("http://{address}/episodes"))).await.unwrap().status().as_u16(),429);server.await.unwrap();
    }
    #[test]
    fn parses_p1_comments_without_a_comment_id_and_keeps_pagination() {
        let page = super::parse_comments(serde_json::json!({"data":[{"user":{"id":42,"nickname":"读者"},"comment":"测试吐槽","rate":8,"updatedAt":1700000000}],"total":123}),400602,0,20).unwrap();
        assert_eq!(page.items.len(),1);
        assert_eq!(page.items[0].id,"400602:42");
        assert_eq!(page.items[0].rate,Some(8.0));
        assert!(!page.items[0].created_at.is_empty());
        assert_eq!(page.total,123);
        assert!(super::parse_comments(serde_json::json!({"error":"failed"}),400602,0,20).is_err());
    }
    use super::*;

    #[test]
    fn website_trends_preserves_order_and_normalizes_p1_metadata() {
        let body = json!({"total":42,"data":[
            {"id":11,"type":2,"name":"Original","nameCN":"热门动画","metaTags":["WEB","漫画改"],"rating":{"rank":900,"score":7.2,"total":123},"images":{"large":"https://lain.bgm.tv/cover.jpg"}},
            {"id":12,"type":2,"name":"Lower popularity","nameCN":"","metaTags":["剧场版"],"rating":{"rank":1,"score":9.5}}
        ]});
        let result = parse_popular_subjects(body.clone()).unwrap();
        assert_eq!(result.total_pages,42);
        assert_eq!(result.items.iter().map(|item| item.external_id.as_str()).collect::<Vec<_>>(), ["11","12"]);
        assert_eq!(result.items[0].title,"热门动画");
        assert_eq!(result.items[0].subject_type,"web");
        assert_eq!(result.items[1].subject_type,"movie");
        assert_eq!(result.items[0].genres,["WEB","漫画改"]);
        assert_eq!(result.items[0].rank,Some(900));
        assert!(result.items[0].air_date.is_none());
        let mut one_page = body.clone(); one_page["total"] = json!(1);
        assert_eq!(parse_popular_subjects(one_page).unwrap().items.len(),2);
        let mut invalid = body;
        invalid["data"][0]["type"] = json!(1);
        assert!(parse_popular_subjects(invalid).is_err());
        assert!(parse_popular_subjects(json!({"data":[]})).is_err());
        assert!(parse_popular_subjects(json!({"data":null,"total":0})).is_err());
    }

    #[tokio::test]
    #[ignore = "explicit official website metadata smoke test"]
    async fn live_discovery_feeds_bangumi() {
        let provider = BangumiProvider::new().unwrap();
        let result = provider.popular(1).await.unwrap();
        assert_eq!(result.items.len(),24);
        assert!(result.total_pages > 1);
        let next = provider.popular(2).await.unwrap();
        assert_ne!(result.items[0].external_id,next.items[0].external_id);
        println!("Bangumi trends: {:?}",result.items.iter().map(|item| (&item.external_id,&item.title)).collect::<Vec<_>>());
    }
    #[test]
    fn calendar_uses_weekday_buckets_and_rejects_bad_responses() {
        let items = calendar_by_weekday(&json!([{"weekday":{"id":2},"items":[{"id":123,"name":"Test","air_date":"2023-09-29"}]}])).unwrap();
        assert_eq!(items.len(),1);
        assert_eq!(items[0].0,2);
        assert_eq!(items[0].1.external_id,"123");
        for bad in [json!({"error":"offline"}),json!([]),json!([{"weekday":{"id":8},"items":[]}]),json!([{"weekday":{"id":1},"items":null}])] {
            assert!(calendar_by_weekday(&bad).is_err());
        }
    }
    #[test]
    fn preserves_explicit_chinese_and_ordinal_seasons() {
        for (name, name_cn) in [("Show 2nd season", "作品 第二季"), ("Show Season 2", "作品"), ("Show", "作品 第2季")] {
            assert_eq!(extract_season(&json!({"name": name, "name_cn": name_cn})), Some(2));
        }
        assert_eq!(extract_season(&json!({"name": "Show", "name_cn": "作品"})), None);
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
                "type": 0,
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
        assert_eq!(episode.episode_type, Some(0));
    }

    #[test]
    fn maps_special_and_creditless_episode_types() {
        let special = episode_to_metadata(
            &json!({ "id": 200, "sort": 1, "type": 1, "name_cn": "特别篇" }),
            "2026-09-15T00:00:00Z",
        )
        .expect("special");
        assert_eq!(special.episode_type, Some(1));
        let creditless = episode_to_metadata(
            &json!({ "id": 201, "sort": 1, "type": 2, "name": "NCOP" }),
            "2026-09-15T00:00:00Z",
        )
        .expect("opening");
        assert_eq!(creditless.episode_type, Some(2));
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
