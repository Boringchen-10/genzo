use crate::error::{AppError, AppResult};
use crate::metadata_provider::{MetadataProvider, MetadataSearchQuery};
#[cfg(not(target_os = "android"))]
use crate::metadata_provider::ProviderRateLimiter;
use crate::models::{MetadataProviderStatus, WorkMetadata};
use async_trait::async_trait;
use chrono::Utc;
#[cfg(not(target_os = "android"))]
use std::{sync::OnceLock, time::Duration};
use tmdb_rs::{MovieShort, TvShort};
#[cfg(not(target_os = "android"))]
use tmdb_rs::Language;

#[cfg(not(target_os = "android"))]
static RATE_LIMITER: OnceLock<ProviderRateLimiter> = OnceLock::new();

#[derive(Clone)]
pub struct TmdbProvider {
    #[cfg(not(target_os = "android"))]
    client: tmdb_rs::Client,
    #[cfg(target_os = "android")]
    token: String,
}

impl TmdbProvider {
    #[cfg(not(target_os = "android"))]
    fn preferred_language() -> Language {
        Language::from_639_1("zh").expect("ISO 639-1 Chinese language code")
    }

    pub fn new(token: &str) -> AppResult<Self> {
        let token = token.trim();
        if token.is_empty() {
            return Err(AppError::Validation(
                "TMDB Read Access Token 未配置".to_string(),
            ));
        }
        #[cfg(target_os = "android")]
        {
            Ok(Self { token: token.into() })
        }
        #[cfg(not(target_os = "android"))]
        {
            let http = reqwest13::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("Genzo/0.3.0 (local media library)")
                .build()
                .map_err(|error| AppError::Network(format!("无法初始化 TMDB 客户端：{error}")))?;
            Ok(Self {
                client: tmdb_rs::Client::with_read_token(token).with_http_client(http),
            })
        }
    }

    #[cfg(not(target_os = "android"))]
    async fn wait(&self) {
        RATE_LIMITER
            .get_or_init(|| ProviderRateLimiter::new(Duration::from_millis(250)))
            .wait()
            .await;
    }

    #[cfg(target_os = "android")]
    async fn request<T: serde::de::DeserializeOwned>(&self, path: &str, params: &[(&str, String)]) -> AppResult<T> {
        // reqwest 0.13's platform verifier needs separate Android JNI setup.
        let data = crate::film_tv::fetch_once("https://api.themoviedb.org/3", &self.token, path, params).await?;
        serde_json::from_value(data).map_err(|_| AppError::Network("TMDB 返回了无效资料".into()))
    }

    async fn tv_details(&self, id: u64) -> AppResult<WorkMetadata> {
        #[cfg(not(target_os = "android"))]
        self.wait().await;
        #[cfg(not(target_os = "android"))]
        let item = self.client.tv(id).language(Self::preferred_language()).send().await.map_err(tmdb_error)?;
        #[cfg(target_os = "android")]
        let item: tmdb_rs::TvDetails = self.request(&format!("tv/{id}"), &[]).await?;
        Ok(WorkMetadata {
            provider: "tmdb".to_string(),
            external_id: format!("tv/{id}"),
            title: item.name,
            original_title: nonempty(item.original_name),
            aliases: Vec::new(),
            description: item.overview,
            cover_url: item.poster.as_ref().map(|poster| poster.original()),
            banner_url: item.backdrop.as_ref().map(|backdrop| backdrop.original()),
            year: item.release_date.map(|date| i64::from(date.year())),
            season: None,
            subject_type: "tv".to_string(),
            genres: item.genres.into_iter().map(|genre| genre.name).collect(),
            score: (item.vote_count > 0).then_some(item.vote_average),
            rank: None,
            rating_count: i64::from(item.vote_count),
            collection_count: 0,
            air_date: item.release_date.map(|date| date.to_string()),
            broadcast: None,
            source_keys: vec!["tmdb".to_string()],
            cover_provider: item.poster.as_ref().map(|_| "tmdb".to_string()),
            banner_provider: item.backdrop.as_ref().map(|_| "tmdb".to_string()),
            score_provider: (item.vote_count > 0).then(|| "tmdb".to_string()),
            fetched_at: Utc::now().to_rfc3339(),
        })
    }

    async fn movie_details(&self, id: u64) -> AppResult<WorkMetadata> {
        #[cfg(not(target_os = "android"))]
        self.wait().await;
        #[cfg(not(target_os = "android"))]
        let item = self.client.movie(id).language(Self::preferred_language()).send().await.map_err(tmdb_error)?;
        #[cfg(target_os = "android")]
        let item: tmdb_rs::MovieDetails = self.request(&format!("movie/{id}"), &[]).await?;
        Ok(WorkMetadata {
            provider: "tmdb".to_string(),
            external_id: format!("movie/{id}"),
            title: item.name,
            original_title: nonempty(item.original_name),
            aliases: Vec::new(),
            description: item.overview,
            cover_url: item.poster.as_ref().map(|poster| poster.original()),
            banner_url: item.backdrop.as_ref().map(|backdrop| backdrop.original()),
            year: item.release_date.map(|date| i64::from(date.year())),
            season: None,
            subject_type: "movie".to_string(),
            genres: item.genres.into_iter().map(|genre| genre.name).collect(),
            score: (item.vote_count > 0).then_some(item.vote_average),
            rank: None,
            rating_count: i64::from(item.vote_count),
            collection_count: 0,
            air_date: item.release_date.map(|date| date.to_string()),
            broadcast: None,
            source_keys: vec!["tmdb".to_string()],
            cover_provider: item.poster.as_ref().map(|_| "tmdb".to_string()),
            banner_provider: item.backdrop.as_ref().map(|_| "tmdb".to_string()),
            score_provider: (item.vote_count > 0).then(|| "tmdb".to_string()),
            fetched_at: Utc::now().to_rfc3339(),
        })
    }
}

#[async_trait]
impl MetadataProvider for TmdbProvider {
    fn key(&self) -> &'static str {
        "tmdb"
    }

    fn status(&self) -> MetadataProviderStatus {
        MetadataProviderStatus {
            key: "tmdb".to_string(),
            label: "TMDB".to_string(),
            available: true,
            configured: true,
            requires_credential: true,
            message: None,
        }
    }

    async fn search(&self, query: &MetadataSearchQuery) -> AppResult<Vec<WorkMetadata>> {
        let mut results = Vec::new();
        #[cfg(target_os = "android")]
        {
            let movie = query.subject_type == "movie";
            let mut params = vec![("query", query.title.clone())];
            if let Some(year) = query.year.and_then(|year| u32::try_from(year).ok()) {
                params.push((if movie { "primary_release_year" } else { "first_air_date_year" }, year.to_string()));
            }
            if movie {
                let page: tmdb_rs::Page<MovieShort> = self.request("search/movie", &params).await?;
                results.extend(page.results.into_iter().take(8).map(movie_short));
            } else {
                let page: tmdb_rs::Page<TvShort> = self.request("search/tv", &params).await?;
                results.extend(page.results.into_iter().take(8).map(tv_short));
            }
        }
        #[cfg(not(target_os = "android"))]
        if query.subject_type == "movie" {
            self.wait().await;
            let mut request = self.client.search_movies(&query.title).language(Self::preferred_language());
            if let Some(year) = query.year.and_then(|year| u32::try_from(year).ok()) {
                request = request.primary_release_year(year);
            }
            let page = request.send().await.map_err(tmdb_error)?;
            results.extend(page.results.into_iter().take(8).map(movie_short));
        } else {
            self.wait().await;
            let mut request = self.client.search_tv(&query.title).language(Self::preferred_language());
            if let Some(year) = query.year.and_then(|year| u32::try_from(year).ok()) {
                request = request.first_air_date_year(year);
            }
            let page = request.send().await.map_err(tmdb_error)?;
            results.extend(page.results.into_iter().take(8).map(tv_short));
        }
        Ok(results)
    }

    async fn get_details(&self, external_id: &str) -> AppResult<WorkMetadata> {
        let mut parts = external_id.split('/');
        let kind = parts.next().unwrap_or_default();
        let id = parts
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| AppError::Validation("TMDB 条目 ID 无效".to_string()))?;
        match kind {
            "tv" => self.tv_details(id).await,
            "movie" => self.movie_details(id).await,
            _ => Err(AppError::Validation("TMDB 条目类型无效".to_string())),
        }
    }
}

fn tv_short(item: TvShort) -> WorkMetadata {
    let poster = item.poster.as_ref().map(|value| value.original());
    let banner = item.backdrop.as_ref().map(|value| value.original());
    WorkMetadata {
        provider: "tmdb".to_string(),
        external_id: format!("tv/{}", item.id),
        title: item.name,
        original_title: nonempty(item.original_name),
        aliases: Vec::new(),
        description: item.overview,
        cover_url: poster.clone(),
        banner_url: banner.clone(),
        year: item.release_date.map(|date| i64::from(date.year())),
        season: None,
        subject_type: "tv".to_string(),
        genres: Vec::new(),
        score: (item.vote_count > 0).then_some(item.vote_average),
        rank: None,
        rating_count: i64::from(item.vote_count),
        collection_count: 0,
        air_date: item.release_date.map(|date| date.to_string()),
        broadcast: None,
        source_keys: vec!["tmdb".to_string()],
        cover_provider: poster.map(|_| "tmdb".to_string()),
        banner_provider: banner.map(|_| "tmdb".to_string()),
        score_provider: (item.vote_count > 0).then(|| "tmdb".to_string()),
        fetched_at: Utc::now().to_rfc3339(),
    }
}

fn movie_short(item: MovieShort) -> WorkMetadata {
    let poster = item.poster.as_ref().map(|value| value.original());
    let banner = item.backdrop.as_ref().map(|value| value.original());
    WorkMetadata {
        provider: "tmdb".to_string(),
        external_id: format!("movie/{}", item.id),
        title: item.name,
        original_title: nonempty(item.original_name),
        aliases: Vec::new(),
        description: item.overview,
        cover_url: poster.clone(),
        banner_url: banner.clone(),
        year: item.release_date.map(|date| i64::from(date.year())),
        season: None,
        subject_type: "movie".to_string(),
        genres: Vec::new(),
        score: (item.vote_count > 0).then_some(item.vote_average),
        rank: None,
        rating_count: i64::from(item.vote_count),
        collection_count: 0,
        air_date: item.release_date.map(|date| date.to_string()),
        broadcast: None,
        source_keys: vec!["tmdb".to_string()],
        cover_provider: poster.map(|_| "tmdb".to_string()),
        banner_provider: banner.map(|_| "tmdb".to_string()),
        score_provider: (item.vote_count > 0).then(|| "tmdb".to_string()),
        fetched_at: Utc::now().to_rfc3339(),
    }
}

fn nonempty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

#[cfg(not(target_os = "android"))]
fn tmdb_error(error: tmdb_rs::Error) -> AppError {
    match error {
        tmdb_rs::Error::RateLimited { .. } => {
            AppError::Network("TMDB 请求过于频繁，请稍后重试".to_string())
        }
        tmdb_rs::Error::NotFound => AppError::NotFound("TMDB 条目不存在".to_string()),
        other => AppError::Network(format!("TMDB 请求失败：{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_external_id() {
        let provider = TmdbProvider::new("token").expect("provider");
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let result = runtime.block_on(provider.get_details("invalid"));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }
}
