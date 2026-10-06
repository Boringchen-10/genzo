use crate::bangumi::BangumiProvider;
use crate::error::{AppError, AppResult};
use crate::explore;
use crate::metadata_provider::{
    retry_network, supplemental_match_confidence, MetadataProvider, MetadataSearchQuery,
};
use crate::models::{AnimeEpisodeMetadata, MetadataProviderStatus, WorkMetadata};
use crate::providers::{anilist::AniListProvider, douban::DoubanProvider, tmdb::TmdbProvider};
use chrono::{Duration, Utc};
use lru::LruCache;
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::io::Cursor;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration as StdDuration;
use tokio::sync::Mutex;

const CACHE_PROVIDER: &str = "aggregate-v2";
const SUPPLEMENTAL_THRESHOLD: f64 = 0.85;

static MEMORY_CACHE: OnceLock<Mutex<LruCache<String, AggregationResult>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub year: Option<i64>,
    pub confidence: f64,
    pub metadata: WorkMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregationResult {
    pub metadata: WorkMetadata,
    pub records: Vec<ProviderRecord>,
    pub episodes: Vec<AnimeEpisodeMetadata>,
    pub warnings: Vec<String>,
}

pub async fn provider_statuses(pool: &SqlitePool) -> AppResult<Vec<MetadataProviderStatus>> {
    let bangumi = BangumiProvider::new()?.status();
    let anilist = AniListProvider::new()?.status();
    let douban = DoubanProvider.status();
    let tmdb_token = crate::credentials::tmdb_token(pool)
        .await?
        .or_else(|| std::env::var("TMDB_READ_TOKEN").ok())
        .filter(|value| !value.trim().is_empty());
    let tmdb = match tmdb_token {
        Some(token) => TmdbProvider::new(&token)?.status(),
        None => MetadataProviderStatus {
            key: "tmdb".to_string(),
            label: "TMDB".to_string(),
            available: false,
            configured: false,
            requires_credential: true,
            message: Some("配置 TMDB Read Access Token 后启用高清海报与背景图补全".to_string()),
        },
    };
    Ok(vec![bangumi, tmdb, anilist, douban])
}

pub async fn aggregate(pool: &SqlitePool, primary: WorkMetadata) -> AppResult<AggregationResult> {
    aggregate_internal(pool, primary, false).await
}

pub async fn aggregate_fresh(
    pool: &SqlitePool,
    primary: WorkMetadata,
) -> AppResult<AggregationResult> {
    aggregate_internal(pool, primary, true).await
}

async fn aggregate_internal(
    pool: &SqlitePool,
    mut primary: WorkMetadata,
    force_refresh: bool,
) -> AppResult<AggregationResult> {
    if !primary.source_keys.iter().any(|key| key == "bangumi") {
        primary.source_keys.push("bangumi".to_string());
    }
    if primary.cover_url.is_some() && primary.cover_provider.is_none() {
        primary.cover_provider = Some("bangumi".to_string());
    }
    if primary.score.is_some() && primary.score_provider.is_none() {
        primary.score_provider = Some("bangumi".to_string());
    }

    let tmdb_token = crate::credentials::tmdb_token(pool)
        .await?
        .or_else(|| std::env::var("TMDB_READ_TOKEN").ok())
        .filter(|value| !value.trim().is_empty());
    let cache_key = format!(
        "bangumi:{}:tmdb:{}",
        primary.external_id,
        u8::from(tmdb_token.is_some())
    );
    if !force_refresh {
        if let Some(cached) = memory_get(&cache_key).await {
            return Ok(cached);
        }
        if let Some(cached) = persistent_get(pool, &cache_key).await? {
            memory_put(cache_key, cached.clone()).await;
            return Ok(cached);
        }
    }

    let query = MetadataSearchQuery::from_primary(&primary);
    let links = explore::linked_ids_for_bangumi(&primary.external_id)?;
    let mut result = AggregationResult {
        records: vec![ProviderRecord {
            provider: "bangumi".to_string(),
            external_id: primary.external_id.clone(),
            title: primary.title.clone(),
            year: primary.year,
            confidence: 1.0,
            metadata: primary.clone(),
        }],
        metadata: primary,
        episodes: Vec::new(),
        warnings: Vec::new(),
    };

    if let Some(token) = tmdb_token {
        match TmdbProvider::new(&token) {
            Ok(provider) => {
                match supplemental_metadata(&provider, &query, links.tmdb.as_deref()).await {
                    Ok(Some((mut metadata, confidence))) => {
                        result.warnings.extend(crate::tmdb_artwork::enrich(pool, &mut metadata, force_refresh).await);
                        merge_tmdb(&mut result.metadata, &metadata);
                        result.records.push(record(metadata, confidence));
                    }
                    Ok(None) => result
                        .warnings
                        .push("TMDB 未找到通过标题与年份校验的同一条目，未合并其数据".to_string()),
                    Err(error) => result.warnings.push(error.to_string()),
                }
            }
            Err(error) => result.warnings.push(error.to_string()),
        }
    }

    match AniListProvider::new() {
        Ok(provider) => {
            match supplemental_metadata(&provider, &query, links.anilist.as_deref()).await {
                Ok(Some((metadata, confidence))) => {
                    merge_anilist(&mut result.metadata, &metadata);
                    result.records.push(record(metadata, confidence));
                }
                Ok(None) => result
                    .warnings
                    .push("AniList 未找到通过标题与年份校验的同一条目，未合并其数据".to_string()),
                Err(error) => result.warnings.push(error.to_string()),
            }
        }
        Err(error) => result.warnings.push(error.to_string()),
    }

    match BangumiProvider::new() {
        Ok(provider) => {
            match retry_network(|| provider.episodes(&result.metadata.external_id)).await {
                Ok(episodes) => result.episodes = episodes,
                Err(error) => result.warnings.push(format!("分集信息未更新：{error}")),
            }
        }
        Err(error) => result.warnings.push(error.to_string()),
    }

    result.metadata.source_keys.sort();
    result.metadata.source_keys.dedup();
    persistent_put(pool, &cache_key, &result).await?;
    memory_put(cache_key, result.clone()).await;
    Ok(result)
}

pub async fn persist_for_work(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
    result: &AggregationResult,
) -> AppResult<()> {
    for record in &result.records {
        sqlx::query("INSERT INTO metadata_provider_records (work_id, provider, external_id, title, year, confidence, response_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(work_id, provider) DO UPDATE SET external_id = excluded.external_id, title = excluded.title, year = excluded.year, confidence = excluded.confidence, response_json = excluded.response_json, fetched_at = excluded.fetched_at")
            .bind(work_id)
            .bind(&record.provider)
            .bind(&record.external_id)
            .bind(&record.title)
            .bind(record.year)
            .bind(record.confidence)
            .bind(serde_json::to_string(&record.metadata)?)
            .bind(&record.metadata.fetched_at)
            .execute(&mut **transaction)
            .await?;
        if record.provider != "bangumi" {
            sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
                .bind(work_id)
                .bind(&record.provider)
                .bind(&record.external_id)
                .bind(&record.metadata.fetched_at)
                .bind(&record.metadata.fetched_at)
                .execute(&mut **transaction)
                .await?;
            sqlx::query("UPDATE work_external_ids SET external_id = ?, updated_at = ? WHERE work_id = ? AND provider = ? AND NOT EXISTS (SELECT 1 FROM work_external_ids existing WHERE existing.provider = ? AND existing.external_id = ? AND existing.work_id != ?)")
                .bind(&record.external_id)
                .bind(&record.metadata.fetched_at)
                .bind(work_id)
                .bind(&record.provider)
                .bind(&record.provider)
                .bind(&record.external_id)
                .bind(work_id)
                .execute(&mut **transaction)
                .await?;
        }
    }
    let existing_episode_ids = sqlx::query_scalar::<_, String>(
        "SELECT external_id FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi'",
    )
    .bind(work_id)
    .fetch_all(&mut **transaction)
    .await?;
    let refreshed_episode_ids = result
        .episodes
        .iter()
        .map(|episode| episode.external_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for episode in &result.episodes {
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, episode_type, title, original_title, description, air_date, duration, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(work_id, provider, external_id) DO UPDATE SET episode_number = excluded.episode_number, sort_number = excluded.sort_number, episode_type = excluded.episode_type, title = excluded.title, original_title = excluded.original_title, description = excluded.description, air_date = excluded.air_date, duration = excluded.duration, fetched_at = excluded.fetched_at")
            .bind(work_id)
            .bind(&episode.provider)
            .bind(&episode.external_id)
            .bind(episode.episode_number.map(i64::from))
            .bind(i64::from(episode.sort_number))
            .bind(episode.episode_type.map(i64::from))
            .bind(&episode.title)
            .bind(&episode.original_title)
            .bind(&episode.description)
            .bind(&episode.air_date)
            .bind(&episode.duration)
            .bind(&episode.fetched_at)
            .execute(&mut **transaction)
            .await?;
    }
    for external_id in existing_episode_ids {
        if !refreshed_episode_ids.contains(external_id.as_str()) {
            sqlx::query("DELETE FROM anime_episodes WHERE work_id = ? AND provider = 'bangumi' AND external_id = ?")
                .bind(work_id)
                .bind(external_id)
                .execute(&mut **transaction)
                .await?;
        }
    }
    Ok(())
}

pub async fn episodes_for_work(
    pool: &SqlitePool,
    work_id: &str,
) -> AppResult<Vec<AnimeEpisodeMetadata>> {
    let rows = sqlx::query_as::<_, EpisodeRow>("SELECT provider, external_id, episode_number, sort_number, episode_type, title, original_title, description, air_date, duration, fetched_at FROM anime_episodes WHERE work_id = ? ORDER BY sort_number, episode_number")
        .bind(work_id)
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(TryInto::try_into).collect()
}

pub async fn cache_cover(url: &str, destination: &Path) -> AppResult<()> {
    cache_image(url, destination, true).await
}

pub async fn cache_banner(url: &str, destination: &Path) -> AppResult<()> {
    cache_image(url, destination, false).await
}

/// Version the encoding policy and source URL so refreshing can upgrade legacy
/// low-resolution artwork without overwriting images still used by the UI.
pub(crate) fn artwork_cache_path(directory: &Path, identity: &str, kind: &str, url: &str) -> PathBuf {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(format!("{identity}:{kind}:{url}").as_bytes()));
    directory.join(format!("art-v2-{}-{kind}.jpg", &digest[..24]))
}

async fn cache_image(url: &str, destination: &Path, create_thumbnail: bool) -> AppResult<()> {
    let normalized_url = if let Some(path) = url.strip_prefix("http://lain.bgm.tv/") {
        format!("https://lain.bgm.tv/{path}")
    } else {
        url.to_string()
    };
    let parsed = reqwest::Url::parse(&normalized_url)
        .map_err(|_| AppError::Network("元数据封面地址无效".to_string()))?;
    let trusted = matches!(
        parsed.host_str(),
        Some("lain.bgm.tv" | "bgm.tv" | "image.tmdb.org" | "s4.anilist.co")
    ) || parsed.host_str().is_some_and(|host| host.ends_with(".mangafunb.fun"));
    if parsed.scheme() != "https" || !trusted {
        return Err(AppError::Network(
            "元数据源返回了不受信任的封面地址".to_string(),
        ));
    }
    let response = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(20))
        .user_agent("Genzo/0.3.0 (local media library)")
        .build()
        .map_err(|error| AppError::Network(format!("无法初始化封面客户端：{error}")))?
        .get(parsed)
        .send()
        .await
        .map_err(|error| AppError::Network(format!("封面下载失败：{error}")))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "封面下载失败（HTTP {}）",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|size| size > 20 * 1024 * 1024)
    {
        return Err(AppError::Network("封面超过 20 MB 安全限制".to_string()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Network(format!("封面读取失败：{error}")))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(AppError::Network("封面超过 20 MB 安全限制".to_string()));
    }
    let destination = destination.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        decode_and_save_image(&bytes, &destination, create_thumbnail)
    })
    .await
    .map_err(|error| AppError::System(format!("封面处理任务失败：{error}")))??;
    Ok(())
}

fn decode_and_save_image(
    bytes: &[u8],
    destination: &Path,
    create_thumbnail: bool,
) -> AppResult<()> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| AppError::Validation(format!("无法识别图片格式：{error}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12_000);
    limits.max_image_height = Some(12_000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let format = reader.format();
    let image = reader
        .decode()
        .map_err(|error| AppError::Validation(format!("下载内容不是有效图片：{error}")))?;
    if image.width() < 80 || image.height() < 80 {
        return Err(AppError::Validation(
            "元数据封面分辨率过低，已拒绝缓存".to_string(),
        ));
    }
    // JPEG sources have already been compressed by the provider. Preserve them
    // byte-for-byte instead of adding another lossy encoding pass.
    let original = if format == Some(image::ImageFormat::Jpeg) {
        bytes.to_vec()
    } else {
        encode_artwork(&image)?
    };
    write_artwork(&original, destination)?;
    if create_thumbnail {
        // Triangle downsampling avoids ringing around the line art in posters.
        // Never enlarge a small source to fabricate detail.
        let thumbnail = image.resize(600.min(image.width()), 900.min(image.height()), image::imageops::FilterType::Triangle);
        let thumbnail_path = thumbnail_path(destination);
        write_artwork(&encode_artwork(&thumbnail)?, &thumbnail_path)?;
    }
    Ok(())
}

fn encode_artwork(image: &image::DynamicImage) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
        .encode_image(&image.to_rgb8())
        .map_err(|error| AppError::System(format!("封面编码失败：{error}")))?;
    Ok(bytes)
}

pub(crate) fn write_artwork(bytes: &[u8], destination: &Path) -> AppResult<()> {
    let temporary = destination.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, destination)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result.map_err(|error| AppError::System(format!("封面写入失败：{error}")))
}

pub(crate) fn thumbnail_path(destination: &Path) -> PathBuf {
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("cover");
    destination.with_file_name(format!("{stem}-thumb.jpg"))
}

async fn supplemental_metadata<P: MetadataProvider>(
    provider: &P,
    query: &MetadataSearchQuery,
    linked_id: Option<&str>,
) -> AppResult<Option<(WorkMetadata, f64)>> {
    if let Some(external_id) = linked_id {
        let metadata = retry_network(|| provider.get_details(external_id)).await?;
        if metadata.provider != provider.key() {
            return Err(AppError::System(format!(
                "{} Provider 返回了错误的数据源标识",
                provider.key()
            )));
        }
        let confidence = supplemental_match_confidence(query, &metadata);
        return Ok((confidence >= SUPPLEMENTAL_THRESHOLD).then_some((metadata, confidence)));
    }
    let candidates = retry_network(|| provider.search(query)).await?;
    let best = candidates
        .into_iter()
        .map(|metadata| {
            let confidence = supplemental_match_confidence(query, &metadata);
            (metadata, confidence)
        })
        .max_by(|left, right| left.1.total_cmp(&right.1));
    let Some((candidate, _confidence)) = best.filter(|(_, score)| *score >= SUPPLEMENTAL_THRESHOLD)
    else {
        return Ok(None);
    };
    let detail = retry_network(|| provider.get_details(&candidate.external_id)).await?;
    if detail.provider != provider.key() {
        return Err(AppError::System(format!(
            "{} Provider 返回了错误的数据源标识",
            provider.key()
        )));
    }
    let detail_confidence = supplemental_match_confidence(query, &detail);
    Ok((detail_confidence >= SUPPLEMENTAL_THRESHOLD).then_some((detail, detail_confidence)))
}

fn record(metadata: WorkMetadata, confidence: f64) -> ProviderRecord {
    ProviderRecord {
        provider: metadata.provider.clone(),
        external_id: metadata.external_id.clone(),
        title: metadata.title.clone(),
        year: metadata.year,
        confidence,
        metadata,
    }
}

fn merge_tmdb(base: &mut WorkMetadata, supplement: &WorkMetadata) {
    if base.cover_url.is_none() {
        base.cover_url.clone_from(&supplement.cover_url);
        base.cover_provider.clone_from(&supplement.cover_provider);
    }
    if supplement.banner_url.is_some() {
        base.banner_url.clone_from(&supplement.banner_url);
        base.banner_provider.clone_from(&supplement.banner_provider);
    }
    merge_description(base, supplement);
    merge_common(base, supplement);
}

pub(crate) fn merge_anilist(base: &mut WorkMetadata, supplement: &WorkMetadata) {
    if base.cover_url.is_none() {
        base.cover_url.clone_from(&supplement.cover_url);
        base.cover_provider.clone_from(&supplement.cover_provider);
    }
    if base.banner_url.is_none() {
        base.banner_url.clone_from(&supplement.banner_url);
        base.banner_provider.clone_from(&supplement.banner_provider);
    }
    merge_description(base, supplement);
    if supplement.score.is_some() {
        base.score = supplement.score;
        base.score_provider.clone_from(&supplement.score_provider);
    }
    merge_common(base, supplement);
}

pub(crate) fn looks_chinese(description: &str) -> bool {
    let han_count = description.chars().filter(|character| matches!(character, '\u{4e00}'..='\u{9fff}')).count();
    let kana_count = description.chars().filter(|character| matches!(character, '\u{3040}'..='\u{30ff}')).count();
    han_count >= 8 && kana_count == 0
}

fn merge_description(base: &mut WorkMetadata, supplement: &WorkMetadata) {
    let candidate = supplement.description.trim();
    if !candidate.is_empty() && (base.description.trim().is_empty()
        || (!looks_chinese(&base.description) && looks_chinese(candidate))) {
        base.description = candidate.to_string();
    }
}

fn merge_common(base: &mut WorkMetadata, supplement: &WorkMetadata) {
    base.aliases.push(supplement.title.clone());
    base.aliases.extend(supplement.aliases.iter().cloned());
    if let Some(original) = &supplement.original_title {
        base.aliases.push(original.clone());
    }
    base.aliases.retain(|alias| {
        alias != &base.title && Some(alias.as_str()) != base.original_title.as_deref()
    });
    base.aliases.sort();
    base.aliases.dedup();
    base.genres.extend(supplement.genres.iter().cloned());
    base.genres.sort();
    base.genres.dedup();
    base.source_keys.push(supplement.provider.clone());
}

async fn memory_get(key: &str) -> Option<AggregationResult> {
    MEMORY_CACHE
        .get_or_init(|| {
            Mutex::new(LruCache::new(
                NonZeroUsize::new(100).expect("non-zero cache size"),
            ))
        })
        .lock()
        .await
        .get(key)
        .cloned()
}

async fn memory_put(key: String, value: AggregationResult) {
    MEMORY_CACHE
        .get_or_init(|| {
            Mutex::new(LruCache::new(
                NonZeroUsize::new(100).expect("non-zero cache size"),
            ))
        })
        .lock()
        .await
        .put(key, value);
}

async fn persistent_get(pool: &SqlitePool, key: &str) -> AppResult<Option<AggregationResult>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT response_json, expires_at FROM metadata_cache WHERE provider = ? AND cache_key = ?",
    )
    .bind(CACHE_PROVIDER)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    row.filter(|(_, expires_at)| expires_at > &Utc::now().to_rfc3339())
        .map(|(json, _)| serde_json::from_str(&json).map_err(AppError::from))
        .transpose()
}

async fn persistent_put(pool: &SqlitePool, key: &str, value: &AggregationResult) -> AppResult<()> {
    let now = Utc::now();
    sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, cache_key) DO UPDATE SET response_json = excluded.response_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at")
        .bind(CACHE_PROVIDER)
        .bind(key)
        .bind(serde_json::to_string(value)?)
        .bind(now.to_rfc3339())
        .bind((now + Duration::days(30)).to_rfc3339())
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct EpisodeRow {
    provider: String,
    external_id: String,
    episode_number: Option<i64>,
    sort_number: i64,
    episode_type: Option<i64>,
    title: String,
    original_title: Option<String>,
    description: String,
    air_date: Option<String>,
    duration: Option<String>,
    fetched_at: String,
}

impl TryFrom<EpisodeRow> for AnimeEpisodeMetadata {
    type Error = AppError;

    fn try_from(row: EpisodeRow) -> Result<Self, Self::Error> {
        Ok(Self {
            provider: row.provider,
            external_id: row.external_id,
            episode_number: row
                .episode_number
                .map(u32::try_from)
                .transpose()
                .map_err(|_| AppError::System("数据库中的分集编号超出范围".to_string()))?,
            sort_number: u32::try_from(row.sort_number)
                .map_err(|_| AppError::System("数据库中的分集排序号超出范围".to_string()))?,
            episode_type: row
                .episode_type
                .map(u32::try_from)
                .transpose()
                .map_err(|_| AppError::System("数据库中的分集类型超出范围".to_string()))?,
            title: row.title,
            original_title: row.original_title,
            description: row.description,
            air_date: row.air_date,
            duration: row.duration,
            fetched_at: row.fetched_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn metadata(provider: &str, title: &str) -> WorkMetadata {
        WorkMetadata {
            provider: provider.to_string(),
            external_id: "1".to_string(),
            title: title.to_string(),
            original_title: None,
            aliases: Vec::new(),
            description: String::new(),
            cover_url: None,
            banner_url: None,
            year: Some(2023),
            season: None,
            subject_type: "tv".to_string(),
            genres: Vec::new(),
            score: None,
            rank: None,
            rating_count: 0,
            collection_count: 0,
            air_date: None,
            broadcast: None,
            source_keys: vec![provider.to_string()],
            cover_provider: None,
            banner_provider: None,
            score_provider: None,
            fetched_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn anilist_overrides_network_score_and_tmdb_supplies_banner() {
        let mut base = metadata("bangumi", "作品");
        base.score = Some(7.5);
        base.score_provider = Some("bangumi".to_string());
        let mut tmdb = metadata("tmdb", "作品");
        tmdb.banner_url = Some("https://image.tmdb.org/t/p/original/a.jpg".to_string());
        tmdb.banner_provider = Some("tmdb".to_string());
        merge_tmdb(&mut base, &tmdb);
        let mut anilist = metadata("anilist", "作品");
        anilist.score = Some(8.9);
        anilist.score_provider = Some("anilist".to_string());
        merge_anilist(&mut base, &anilist);
        assert_eq!(base.banner_provider.as_deref(), Some("tmdb"));
        assert_eq!(base.score, Some(8.9));
        assert_eq!(base.score_provider.as_deref(), Some("anilist"));
    }

    #[test]
    fn prefers_available_chinese_summary_without_discarding_otherwise_useful_text() {
        let mut base = metadata("bangumi", "作品");
        base.description = "これは日本語の作品紹介です。物語は続きます。".into();
        let mut tmdb = metadata("tmdb", "作品");
        tmdb.description = "这是一部关于少年和少女共同冒险的动画作品。".into();
        merge_tmdb(&mut base, &tmdb);
        assert_eq!(base.description, tmdb.description);

        let mut anilist = metadata("anilist", "作品");
        anilist.description = "An English synopsis.".into();
        merge_anilist(&mut base, &anilist);
        assert_eq!(base.description, tmdb.description);

        let mut original = metadata("bangumi", "作品");
        original.description = "Original English synopsis.".into();
        tmdb.description = "".into();
        merge_tmdb(&mut original, &tmdb);
        assert_eq!(original.description, "Original English synopsis.");
    }

    #[tokio::test]
    async fn episode_rows_round_trip_as_integers() {
        let pool = db::test_pool().await.expect("test pool");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '作品', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("work");
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, title, fetched_at) VALUES ('work', 'bangumi', 'ep-1', 2, 2, '第二集', ?)")
            .bind(&now)
            .execute(&pool)
            .await
            .expect("episode");
        let episodes = episodes_for_work(&pool, "work").await.expect("episodes");
        assert_eq!(episodes[0].episode_number, Some(2));
        assert_eq!(episodes[0].sort_number, 2);
    }

    #[test]
    fn rejects_non_image_cover_payload() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let destination = directory.path().join("cover.jpg");
        let result = decode_and_save_image(b"not an image", &destination, true);
        assert!(matches!(result, Err(AppError::Validation(_))));
        assert!(!destination.exists());
    }

    #[test]
    fn artwork_cache_preserves_jpeg_and_versions_sources() {
        let directory = tempfile::tempdir().unwrap();
        let low = artwork_cache_path(directory.path(), "movie/1", "banner", "https://image.tmdb.org/t/p/w780/a.jpg");
        let original = artwork_cache_path(directory.path(), "movie/1", "banner", "https://image.tmdb.org/t/p/original/a.jpg");
        assert_ne!(low, original);
        std::fs::write(&low, b"legacy cache").unwrap();
        let image = image::DynamicImage::new_rgb8(1200, 1800);
        let bytes = encode_artwork(&image).unwrap();
        decode_and_save_image(&bytes, &original, true).unwrap();
        assert_eq!(std::fs::read(&original).unwrap(), bytes);
        assert_eq!(image::image_dimensions(thumbnail_path(&original)).unwrap(), (600, 900));
        assert_eq!(std::fs::read(&low).unwrap(), b"legacy cache");
        assert!(decode_and_save_image(b"invalid response", &original, true).is_err());
        assert_eq!(std::fs::read(&original).unwrap(), bytes);
    }

    #[test]
    fn banner_cache_keeps_full_image_without_poster_thumbnail() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let destination = directory.path().join("banner.jpg");
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(160, 90)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .expect("encode test image");

        decode_and_save_image(bytes.get_ref(), &destination, false).expect("cache banner");

        assert!(destination.is_file());
        assert!(!thumbnail_path(&destination).exists());
    }

    #[tokio::test]
    #[ignore = "requires the live Bangumi and AniList APIs"]
    async fn live_aggregation_anchors_on_bangumi_and_enriches_from_anilist() {
        let pool = db::test_pool().await.expect("test pool");
        let primary = BangumiProvider::new()
            .expect("Bangumi provider")
            .get_details("400602")
            .await
            .expect("Bangumi details");
        let result = aggregate(&pool, primary).await.expect("aggregation");
        assert_eq!(result.metadata.provider, "bangumi");
        assert_eq!(result.metadata.external_id, "400602");
        assert!(result
            .metadata
            .source_keys
            .iter()
            .any(|key| key == "anilist"));
        assert_eq!(result.metadata.score_provider.as_deref(), Some("anilist"));
        assert!(!result.episodes.is_empty());
    }
}
