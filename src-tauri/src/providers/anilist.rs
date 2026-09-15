use crate::error::{AppError, AppResult};
use crate::metadata_provider::{MetadataProvider, MetadataSearchQuery, ProviderRateLimiter};
use crate::models::{MetadataProviderStatus, WorkMetadata};
use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::sync::OnceLock;
use std::time::Duration;

const API_URL: &str = "https://graphql.anilist.co";
static RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();

#[derive(Clone)]
pub struct AniListProvider {
    client: Client,
}

impl AniListProvider {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("Genzo/0.3.0 (local media library)")
                .build()
                .map_err(|error| {
                    AppError::Network(format!("无法初始化 AniList 客户端：{error}"))
                })?,
        })
    }

    async fn request(&self, variables: serde_json::Value) -> AppResult<Vec<WorkMetadata>> {
        RATE_LIMITER
            .get_or_init(|| ProviderRateLimiter::new(Duration::from_secs(1)))
            .wait()
            .await;
        let response = self
            .client
            .post(API_URL)
            .json(&json!({ "query": QUERY, "variables": variables }))
            .send()
            .await
            .map_err(network_error)?;
        if response.status().as_u16() == 429 {
            return Err(AppError::Network(
                "AniList 请求过于频繁，请稍后重试".to_string(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "AniList 请求失败（HTTP {}）",
                response.status().as_u16()
            )));
        }
        let body: GraphQlResponse = response
            .json()
            .await
            .map_err(|error| AppError::Network(format!("AniList 返回了无法解析的数据：{error}")))?;
        if let Some(errors) = body.errors {
            let message = errors
                .into_iter()
                .map(|error| error.message)
                .collect::<Vec<_>>()
                .join("；");
            return Err(AppError::Network(format!("AniList 返回错误：{message}")));
        }
        Ok(body
            .data
            .map(|data| data.page.media.into_iter().map(map_media).collect())
            .unwrap_or_default())
    }
}

#[async_trait]
impl MetadataProvider for AniListProvider {
    fn key(&self) -> &'static str {
        "anilist"
    }

    fn status(&self) -> MetadataProviderStatus {
        MetadataProviderStatus {
            key: "anilist".to_string(),
            label: "AniList".to_string(),
            available: true,
            configured: true,
            requires_credential: false,
            message: Some("使用 AniList 公共 GraphQL API".to_string()),
        }
    }

    async fn search(&self, query: &MetadataSearchQuery) -> AppResult<Vec<WorkMetadata>> {
        self.request(json!({ "search": query.title, "page": 1, "perPage": 10 }))
            .await
    }

    async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        let id = external_id
            .trim()
            .parse::<i64>()
            .map_err(|_| AppError::Validation("AniList 条目 ID 无效".to_string()))?;
        self.request(json!({ "id": id, "page": 1, "perPage": 1 }))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound("AniList 条目不存在".to_string()))
    }
}

const QUERY: &str = r#"
query GenzoAnime($id: Int, $search: String, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    media(id: $id, search: $search, type: ANIME, isAdult: false) {
      id
      title { romaji english native }
      startDate { year month day }
      averageScore
      genres
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      format
    }
  }
}
"#;

#[derive(Debug, Deserialize)]
struct GraphQlResponse {
    data: Option<GraphQlData>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlData {
    #[serde(rename = "Page")]
    page: GraphQlPage,
}

#[derive(Debug, Deserialize)]
struct GraphQlPage {
    #[serde(default)]
    media: Vec<AniListMedia>,
}

#[derive(Debug, Deserialize)]
struct AniListMedia {
    id: i64,
    title: AniListTitle,
    #[serde(rename = "startDate")]
    start_date: AniListDate,
    #[serde(rename = "averageScore")]
    average_score: Option<f64>,
    #[serde(default)]
    genres: Vec<String>,
    description: Option<String>,
    #[serde(rename = "coverImage")]
    cover_image: AniListCover,
    #[serde(rename = "bannerImage")]
    banner_image: Option<String>,
    format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AniListTitle {
    romaji: Option<String>,
    english: Option<String>,
    native: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AniListDate {
    year: Option<i64>,
    month: Option<u32>,
    day: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct AniListCover {
    #[serde(rename = "extraLarge")]
    extra_large: Option<String>,
    large: Option<String>,
}

fn map_media(item: AniListMedia) -> WorkMetadata {
    let title = item
        .title
        .native
        .clone()
        .or_else(|| item.title.romaji.clone())
        .or_else(|| item.title.english.clone())
        .unwrap_or_else(|| format!("AniList {}", item.id));
    let mut aliases = [item.title.romaji, item.title.english, item.title.native]
        .into_iter()
        .flatten()
        .filter(|value| value != &title)
        .collect::<Vec<_>>();
    aliases.sort();
    aliases.dedup();
    let cover_url = item.cover_image.extra_large.or(item.cover_image.large);
    let air_date = item.start_date.year.map(|year| {
        format!(
            "{year:04}-{:02}-{:02}",
            item.start_date.month.unwrap_or(1),
            item.start_date.day.unwrap_or(1)
        )
    });
    WorkMetadata {
        provider: "anilist".to_string(),
        external_id: item.id.to_string(),
        title,
        original_title: aliases.first().cloned(),
        aliases,
        description: item.description.unwrap_or_default(),
        cover_url: cover_url.clone(),
        banner_url: item.banner_image.clone(),
        year: item.start_date.year,
        season: None,
        subject_type: map_format(item.format.as_deref()).to_string(),
        genres: item.genres,
        score: item.average_score.map(|score| score / 10.0),
        rank: None,
        rating_count: 0,
        collection_count: 0,
        air_date,
        broadcast: None,
        source_keys: vec!["anilist".to_string()],
        cover_provider: cover_url.map(|_| "anilist".to_string()),
        banner_provider: item.banner_image.map(|_| "anilist".to_string()),
        score_provider: item.average_score.map(|_| "anilist".to_string()),
        fetched_at: Utc::now().to_rfc3339(),
    }
}

fn map_format(format: Option<&str>) -> &'static str {
    match format {
        Some("MOVIE") => "movie",
        Some("OVA" | "SPECIAL") => "ova",
        Some("ONA") => "web",
        _ => "tv",
    }
}

fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Network("连接 AniList 超时，请稍后重试".to_string())
    } else if error.is_connect() {
        AppError::Network("无法连接 AniList，本地媒体库仍可正常使用".to_string())
    } else {
        AppError::Network(format!("AniList 请求失败：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_graphql_media_without_html_description() {
        let item: AniListMedia = serde_json::from_value(serde_json::json!({
            "id": 154587,
            "title": {"romaji": "Sousou no Frieren", "english": "Frieren", "native": "葬送のフリーレン"},
            "startDate": {"year": 2023, "month": 9, "day": 29},
            "averageScore": 89,
            "genres": ["Adventure", "Fantasy"],
            "description": "description",
            "coverImage": {"extraLarge": "https://s4.anilist.co/file/test.jpg", "large": null},
            "bannerImage": "https://s4.anilist.co/file/banner.jpg",
            "format": "TV"
        })).expect("AniList media");
        let metadata = map_media(item);
        assert_eq!(metadata.external_id, "154587");
        assert_eq!(metadata.score, Some(8.9));
        assert_eq!(metadata.year, Some(2023));
        assert_eq!(metadata.subject_type, "tv");
    }

    #[tokio::test]
    #[ignore = "requires the live AniList GraphQL API"]
    async fn live_anilist_contract_is_parseable() {
        let provider = AniListProvider::new().expect("provider");
        let metadata = provider
            .get_details("154587")
            .await
            .expect("AniList details");
        assert_eq!(metadata.external_id, "154587");
        assert!(metadata.score.is_some());
        assert!(metadata.cover_url.is_some());
    }
}
