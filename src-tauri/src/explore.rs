use crate::anime_parser::normalize_title;
use crate::bangumi::BangumiProvider;
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::metadata;
use crate::models::{
    ExploreOverview, ExploreSaveInput, ExploreSourceStatus, ExploreSubject, WorkMetadata,
};
use chrono::{Datelike, Duration, Utc};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::time::Duration as StdDuration;
use tauri::AppHandle;
use uuid::Uuid;

const BANGUMI_DATA_URL: &str = "https://unpkg.com/bangumi-data@0.3/dist/data.json";
const BANGUMI_DATA_PROVIDER: &str = "bangumi-data";
const BANGUMI_PROVIDER: &str = "bangumi";
const DATASET_CACHE_KEY: &str = "explore:dataset:0.3";
const CALENDAR_CACHE_KEY: &str = "explore:calendar";
const MAX_DATASET_BYTES: usize = 20 * 1024 * 1024;
const WORK_STATUSES: &[&str] = &["planned", "in_progress", "completed", "paused", "dropped"];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BangumiDataItem {
    title: String,
    #[serde(rename = "titleTranslate", default)]
    title_translate: HashMap<String, Vec<String>>,
    #[serde(rename = "type")]
    item_type: String,
    begin: String,
    #[serde(default)]
    broadcast: Option<String>,
    #[serde(default)]
    sites: Vec<BangumiDataSite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BangumiDataSite {
    site: String,
    #[serde(default)]
    id: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct BangumiDataDocument {
    items: Vec<BangumiDataItem>,
}

#[derive(Debug, FromRow)]
struct CacheRow {
    response_json: String,
    fetched_at: String,
    expires_at: String,
}

struct Cached<T> {
    value: T,
    fetched_at: String,
    stale: bool,
}

#[derive(Clone)]
struct LocalWorkState {
    work_id: String,
    status: String,
    favorite: bool,
}

pub async fn overview(
    pool: &SqlitePool,
    year: Option<i32>,
    month: Option<u32>,
) -> AppResult<ExploreOverview> {
    let now = Utc::now();
    let year = year.unwrap_or_else(|| now.year());
    let month = month.unwrap_or_else(|| now.month());
    if !(1900..=2200).contains(&year) || !(1..=12).contains(&month) {
        return Err(AppError::Validation(
            "探索年份必须在 1900 到 2200 之间，月份必须在 1 到 12 之间".to_string(),
        ));
    }

    let dataset = load_bangumi_data(pool).await?;
    let mut seasonal_metadata = dataset
        .value
        .iter()
        .filter(|item| item_matches_month(item, year, month))
        .filter_map(|item| data_item_to_metadata(item, &dataset.fetched_at))
        .collect::<Vec<_>>();
    seasonal_metadata.sort_by(|left, right| {
        left.air_date
            .cmp(&right.air_date)
            .then_with(|| left.title.cmp(&right.title))
    });
    let mut seen_seasonal = HashSet::new();
    seasonal_metadata.retain(|item| seen_seasonal.insert(item.external_id.clone()));

    let mut sources = vec![ExploreSourceStatus {
        key: BANGUMI_DATA_PROVIDER.to_string(),
        label: "bangumi-data 番组索引".to_string(),
        available: true,
        stale: dataset.stale,
        fetched_at: Some(dataset.fetched_at.clone()),
        warning: dataset
            .stale
            .then(|| "网络更新失败，当前使用本地过期番组索引".to_string()),
    }];

    let calendar = if year == now.year() && month == now.month() {
        match load_calendar(pool).await {
            Ok(calendar) => {
                sources.push(ExploreSourceStatus {
                    key: BANGUMI_PROVIDER.to_string(),
                    label: "Bangumi 官方 API".to_string(),
                    available: true,
                    stale: calendar.stale,
                    fetched_at: Some(calendar.fetched_at.clone()),
                    warning: calendar
                        .stale
                        .then(|| "网络更新失败，当前使用本地过期番组日历".to_string()),
                });
                Some(calendar)
            }
            Err(error) => {
                sources.push(ExploreSourceStatus {
                    key: BANGUMI_PROVIDER.to_string(),
                    label: "Bangumi 官方 API".to_string(),
                    available: false,
                    stale: false,
                    fetched_at: None,
                    warning: Some(error.to_string()),
                });
                None
            }
        }
    } else {
        sources.push(ExploreSourceStatus {
            key: BANGUMI_PROVIDER.to_string(),
            label: "Bangumi 官方 API".to_string(),
            available: false,
            stale: false,
            fetched_at: None,
            warning: Some("历史月份不使用实时番组日历，评分将在打开条目详情时获取".to_string()),
        });
        None
    };

    if let Some(calendar) = &calendar {
        let enrichment = calendar
            .value
            .iter()
            .map(|item| (item.external_id.as_str(), item))
            .collect::<HashMap<_, _>>();
        for item in &mut seasonal_metadata {
            if let Some(details) = enrichment.get(item.external_id.as_str()) {
                *item = merge_metadata(item.clone(), (*details).clone());
            }
        }
    }

    let local_states = load_local_states(pool).await?;
    let seasonal = seasonal_metadata
        .into_iter()
        .map(|item| to_explore_subject(item, &local_states, dataset.stale))
        .collect::<Vec<_>>();

    let mut trending = calendar
        .as_ref()
        .map(|calendar| {
            calendar
                .value
                .iter()
                .cloned()
                .map(|item| to_explore_subject(item, &local_states, calendar.stale))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    trending.sort_by(|left, right| {
        right
            .rating_count
            .cmp(&left.rating_count)
            .then_with(|| right.collection_count.cmp(&left.collection_count))
            .then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    let mut seen_trending = HashSet::new();
    trending.retain(|item| seen_trending.insert(item.external_id.clone()));
    trending.truncate(12);

    let mut available_tags = seasonal
        .iter()
        .chain(trending.iter())
        .flat_map(|item| item.genres.iter().cloned())
        .collect::<Vec<_>>();
    available_tags.sort();
    available_tags.dedup();

    let stale = sources.iter().any(|source| source.stale);
    Ok(ExploreOverview {
        year,
        month,
        seasonal,
        trending,
        available_tags,
        sources,
        fetched_at: Utc::now().to_rfc3339(),
        stale,
    })
}

pub async fn search(pool: &SqlitePool, query: &str) -> AppResult<Vec<ExploreSubject>> {
    let query = query.trim();
    if query.is_empty() {
        return Err(AppError::Validation("探索搜索词不能为空".to_string()));
    }
    if query.chars().count() > 200 {
        return Err(AppError::Validation(
            "探索搜索词不能超过 200 个字符".to_string(),
        ));
    }
    let key = format!("search:{}", normalize_title(query));
    let cached = load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &key).await?;
    let result = if cached.as_ref().is_some_and(|value| !value.stale) {
        cached.expect("fresh cache checked")
    } else {
        let provider = BangumiProvider::new()?;
        match provider.search(query).await {
            Ok(items) => {
                save_cache(pool, BANGUMI_PROVIDER, &key, &items, Duration::days(7)).await?;
                Cached {
                    value: items,
                    fetched_at: Utc::now().to_rfc3339(),
                    stale: false,
                }
            }
            Err(error) => cached.ok_or(error)?,
        }
    };
    let local_states = load_local_states(pool).await?;
    Ok(result
        .value
        .into_iter()
        .map(|item| to_explore_subject(item, &local_states, result.stale))
        .collect())
}

pub async fn subject(pool: &SqlitePool, external_id: &str) -> AppResult<ExploreSubject> {
    let metadata = load_subject_metadata(pool, external_id).await?;
    let local_states = load_local_states(pool).await?;
    Ok(to_explore_subject(
        metadata.value,
        &local_states,
        metadata.stale,
    ))
}

pub async fn save_subject(
    app: &AppHandle,
    state: &AppState,
    mut input: ExploreSaveInput,
) -> AppResult<String> {
    input.external_id = validated_external_id(&input.external_id)?;
    if !WORK_STATUSES.contains(&input.status.as_str()) {
        return Err(AppError::Validation("无效的本地追番状态".to_string()));
    }
    let metadata = load_subject_metadata(&state.pool, &input.external_id)
        .await?
        .value;
    let cover_path = if let Some(url) = &metadata.cover_url {
        let destination = state
            .cover_cache_path
            .join(format!("bangumi-{}.jpg", metadata.external_id));
        let provider = BangumiProvider::new()?;
        if destination.is_file() || provider.download_cover(url, &destination).await.is_ok() {
            db::allow_cover_file(app, &destination)?;
            Some(destination.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };
    persist_subject(state, &metadata, &input.status, input.favorite, cover_path).await
}

async fn persist_subject(
    state: &AppState,
    metadata: &WorkMetadata,
    status: &str,
    favorite: bool,
    cover_path: Option<String>,
) -> AppResult<String> {
    let now = Utc::now().to_rfc3339();
    let mut transaction = state.pool.begin().await?;
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT work_id FROM work_external_ids WHERE provider = 'bangumi' AND external_id = ?",
    )
    .bind(&metadata.external_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let work_id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(&work_id)
        .fetch_one(&mut *transaction)
        .await?;
    if !exists {
        sqlx::query("INSERT INTO works (id, title, original_title, type, description, cover_path, status, favorite, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at) VALUES (?, ?, ?, 'video', ?, ?, ?, ?, '', ?, ?, 'matched', ?, ?)")
            .bind(&work_id)
            .bind(&metadata.title)
            .bind(&metadata.original_title)
            .bind(&metadata.description)
            .bind(&cover_path)
            .bind(status)
            .bind(favorite)
            .bind(&now)
            .bind(&now)
            .bind(metadata.year)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
    }
    metadata::apply_metadata(&mut transaction, &work_id, metadata, cover_path, &now).await?;
    sqlx::query("UPDATE works SET status = ?, favorite = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(favorite)
        .bind(&now)
        .bind(&work_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES (?, 'bangumi', ?, ?, ?) ON CONFLICT(work_id, provider) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at")
        .bind(&work_id)
        .bind(&metadata.external_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(work_id)
}

async fn load_bangumi_data(pool: &SqlitePool) -> AppResult<Cached<Vec<BangumiDataItem>>> {
    let cached =
        load_cache::<Vec<BangumiDataItem>>(pool, BANGUMI_DATA_PROVIDER, DATASET_CACHE_KEY).await?;
    if cached.as_ref().is_some_and(|value| !value.stale) {
        return Ok(cached.expect("fresh cache checked"));
    }

    match fetch_bangumi_data().await {
        Ok(items) => {
            let fetched_at = Utc::now().to_rfc3339();
            save_cache(
                pool,
                BANGUMI_DATA_PROVIDER,
                DATASET_CACHE_KEY,
                &items,
                Duration::days(7),
            )
            .await?;
            Ok(Cached {
                value: items,
                fetched_at,
                stale: false,
            })
        }
        Err(error) => cached.ok_or(error),
    }
}

async fn load_calendar(pool: &SqlitePool) -> AppResult<Cached<Vec<WorkMetadata>>> {
    let cached =
        load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, CALENDAR_CACHE_KEY).await?;
    if cached.as_ref().is_some_and(|value| !value.stale) {
        return Ok(cached.expect("fresh cache checked"));
    }
    let provider = BangumiProvider::new()?;
    match provider.calendar().await {
        Ok(items) => {
            let fetched_at = Utc::now().to_rfc3339();
            save_cache(
                pool,
                BANGUMI_PROVIDER,
                CALENDAR_CACHE_KEY,
                &items,
                Duration::hours(6),
            )
            .await?;
            Ok(Cached {
                value: items,
                fetched_at,
                stale: false,
            })
        }
        Err(error) => cached.ok_or(error),
    }
}

async fn load_subject_metadata(
    pool: &SqlitePool,
    external_id: &str,
) -> AppResult<Cached<WorkMetadata>> {
    let external_id = validated_external_id(external_id)?;
    let key = format!("detail:{external_id}");
    let cached_list = load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &key).await?;
    let cached = cached_list.and_then(|value| {
        value.value.into_iter().next().map(|metadata| Cached {
            value: metadata,
            fetched_at: value.fetched_at,
            stale: value.stale,
        })
    });
    if cached.as_ref().is_some_and(|value| !value.stale) {
        return Ok(cached.expect("fresh cache checked"));
    }
    let provider = BangumiProvider::new()?;
    match provider.get_details(&external_id).await {
        Ok(metadata) => {
            save_cache(
                pool,
                BANGUMI_PROVIDER,
                &key,
                std::slice::from_ref(&metadata),
                Duration::days(30),
            )
            .await?;
            Ok(Cached {
                fetched_at: metadata.fetched_at.clone(),
                value: metadata,
                stale: false,
            })
        }
        Err(error) => cached.ok_or(error),
    }
}

async fn fetch_bangumi_data() -> AppResult<Vec<BangumiDataItem>> {
    let client = Client::builder()
        .timeout(StdDuration::from_secs(30))
        .user_agent("Genzo/0.3.0 (local media library)")
        .build()
        .map_err(|error| AppError::Network(format!("无法初始化 bangumi-data 客户端：{error}")))?;
    let response = client
        .get(BANGUMI_DATA_URL)
        .send()
        .await
        .map_err(bangumi_data_network_error)?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "bangumi-data 番组索引读取失败（HTTP {}）",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_DATASET_BYTES as u64)
    {
        return Err(AppError::Network(
            "bangumi-data 番组索引超过 20 MB 安全限制".to_string(),
        ));
    }
    let bytes = response.bytes().await.map_err(bangumi_data_network_error)?;
    if bytes.len() > MAX_DATASET_BYTES {
        return Err(AppError::Network(
            "bangumi-data 番组索引超过 20 MB 安全限制".to_string(),
        ));
    }
    let document: BangumiDataDocument = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::Network(format!("bangumi-data 返回了无法解析的数据：{error}"))
    })?;
    let mut items = document.items;
    for item in &mut items {
        item.sites.retain(|site| site.site == "bangumi");
    }
    if items.is_empty() {
        return Err(AppError::Network(
            "bangumi-data 返回了空番组索引".to_string(),
        ));
    }
    Ok(items)
}

fn bangumi_data_network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Network("连接 bangumi-data 超时，请检查网络后重试".to_string())
    } else if error.is_connect() {
        AppError::Network("无法连接 bangumi-data，本地媒体库仍可正常使用".to_string())
    } else {
        AppError::Network(format!("bangumi-data 请求失败：{error}"))
    }
}

async fn load_cache<T: DeserializeOwned>(
    pool: &SqlitePool,
    provider: &str,
    key: &str,
) -> AppResult<Option<Cached<T>>> {
    let row = sqlx::query_as::<_, CacheRow>(
        "SELECT response_json, fetched_at, expires_at FROM metadata_cache WHERE provider = ? AND cache_key = ?",
    )
    .bind(provider)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    row.map(|row| {
        let stale = row.expires_at <= Utc::now().to_rfc3339();
        Ok(Cached {
            value: serde_json::from_str(&row.response_json)?,
            fetched_at: row.fetched_at,
            stale,
        })
    })
    .transpose()
}

async fn save_cache<T: Serialize + ?Sized>(
    pool: &SqlitePool,
    provider: &str,
    key: &str,
    value: &T,
    ttl: Duration,
) -> AppResult<()> {
    let now = Utc::now();
    sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, cache_key) DO UPDATE SET response_json = excluded.response_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at")
        .bind(provider)
        .bind(key)
        .bind(serde_json::to_string(value)?)
        .bind(now.to_rfc3339())
        .bind((now + ttl).to_rfc3339())
        .execute(pool)
        .await?;
    Ok(())
}

async fn load_local_states(pool: &SqlitePool) -> AppResult<HashMap<String, LocalWorkState>> {
    let rows = sqlx::query_as::<_, (String, String, String, bool)>(
        "SELECT e.external_id, w.id, w.status, w.favorite FROM work_external_ids e JOIN works w ON w.id = e.work_id WHERE e.provider = 'bangumi'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(external_id, work_id, status, favorite)| {
            (
                external_id,
                LocalWorkState {
                    work_id,
                    status,
                    favorite,
                },
            )
        })
        .collect())
}

fn item_matches_month(item: &BangumiDataItem, year: i32, month: u32) -> bool {
    chrono::DateTime::parse_from_rfc3339(&item.begin)
        .map(|date| date.year() == year && date.month() == month)
        .unwrap_or(false)
}

fn data_item_to_metadata(item: &BangumiDataItem, fetched_at: &str) -> Option<WorkMetadata> {
    let external_id = item.sites.iter().find_map(|site| {
        if site.site != "bangumi" {
            return None;
        }
        site.id.as_ref().and_then(|id| {
            id.as_str()
                .map(str::to_string)
                .or_else(|| id.as_i64().map(|id| id.to_string()))
        })
    })?;
    let date = chrono::DateTime::parse_from_rfc3339(&item.begin).ok()?;
    let chinese = item
        .title_translate
        .get("zh-Hans")
        .or_else(|| item.title_translate.get("zh-Hant"))
        .and_then(|titles| titles.iter().find(|title| !title.trim().is_empty()))
        .cloned();
    let title = chinese.unwrap_or_else(|| item.title.clone());
    let original_title = (item.title != title).then(|| item.title.clone());
    let mut aliases = item
        .title_translate
        .values()
        .flatten()
        .map(|title| title.trim().to_string())
        .filter(|alias| !alias.is_empty() && alias != &title && alias != &item.title)
        .collect::<Vec<_>>();
    aliases.sort();
    aliases.dedup();
    Some(WorkMetadata {
        provider: BANGUMI_PROVIDER.to_string(),
        external_id,
        title,
        original_title,
        aliases,
        description: String::new(),
        cover_url: None,
        banner_url: None,
        year: Some(date.year() as i64),
        season: None,
        subject_type: item.item_type.clone(),
        genres: Vec::new(),
        score: None,
        rank: None,
        rating_count: 0,
        collection_count: 0,
        air_date: Some(item.begin.chars().take(10).collect()),
        broadcast: item
            .broadcast
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        fetched_at: fetched_at.to_string(),
    })
}

fn merge_metadata(base: WorkMetadata, mut details: WorkMetadata) -> WorkMetadata {
    let mut aliases = details.aliases;
    aliases.extend(base.aliases);
    aliases.push(base.title);
    if let Some(original) = base.original_title {
        aliases.push(original);
    }
    aliases.retain(|alias| {
        alias != &details.title && Some(alias.as_str()) != details.original_title.as_deref()
    });
    aliases.sort();
    aliases.dedup();
    details.aliases = aliases;
    details.year = details.year.or(base.year);
    details.air_date = details.air_date.or(base.air_date);
    details.broadcast = base.broadcast.or(details.broadcast);
    details
}

fn to_explore_subject(
    metadata: WorkMetadata,
    local_states: &HashMap<String, LocalWorkState>,
    stale: bool,
) -> ExploreSubject {
    let local = local_states.get(&metadata.external_id);
    let month = metadata
        .air_date
        .as_deref()
        .and_then(|date| date.get(5..7).and_then(|month| month.parse::<u32>().ok()));
    ExploreSubject {
        provider: BANGUMI_PROVIDER.to_string(),
        external_id: metadata.external_id,
        title: metadata.title,
        original_title: metadata.original_title,
        aliases: metadata.aliases,
        description: metadata.description,
        cover_url: metadata.cover_url,
        year: metadata.year,
        month,
        air_date: metadata.air_date,
        broadcast: metadata.broadcast,
        subject_type: metadata.subject_type,
        genres: metadata.genres,
        score: metadata.score,
        rank: metadata.rank,
        rating_count: metadata.rating_count,
        collection_count: metadata.collection_count,
        in_library: local.is_some(),
        favorite: local.is_some_and(|state| state.favorite),
        local_work_id: local.map(|state| state.work_id.clone()),
        local_status: local.map(|state| state.status.clone()),
        fetched_at: metadata.fetched_at,
        stale,
    }
}

fn validated_external_id(value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(AppError::Validation("Bangumi 条目 ID 无效".to_string()));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_item() -> BangumiDataItem {
        serde_json::from_value(serde_json::json!({
            "title": "ヒロイン？聖女？いいえ、オールワークスメイドです(誇)！",
            "titleTranslate": {
                "zh-Hans": ["女主角？圣女？不，我是杂役女仆（自豪）！"],
                "en": ["Heroine? Saint? No, I'm an All-Works Maid (and Proud of It)!"]
            },
            "type": "tv",
            "begin": "2026-07-01T13:00:00.000Z",
            "broadcast": "R/2026-07-01T13:00:00.000Z/P7D",
            "sites": [{"site": "bangumi", "id": "558064"}]
        }))
        .expect("sample bangumi-data item")
    }

    fn sample_metadata() -> WorkMetadata {
        WorkMetadata {
            provider: "bangumi".to_string(),
            external_id: "400602".to_string(),
            title: "葬送的芙莉莲".to_string(),
            original_title: Some("葬送のフリーレン".to_string()),
            aliases: vec!["Frieren".to_string()],
            description: "简介".to_string(),
            cover_url: None,
            banner_url: None,
            year: Some(2023),
            season: None,
            subject_type: "tv".to_string(),
            genres: vec!["奇幻".to_string()],
            score: Some(8.5),
            rank: Some(42),
            rating_count: 36_198,
            collection_count: 72_459,
            air_date: Some("2023-09-29".to_string()),
            broadcast: None,
            fetched_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn maps_bangumi_data_title_alias_and_schedule() {
        let item = sample_item();
        assert!(item_matches_month(&item, 2026, 7));
        assert!(!item_matches_month(&item, 2026, 10));
        let metadata = data_item_to_metadata(&item, "2026-09-14T00:00:00Z").expect("metadata");
        assert_eq!(metadata.external_id, "558064");
        assert_eq!(metadata.title, "女主角？圣女？不，我是杂役女仆（自豪）！");
        assert_eq!(
            metadata.original_title.as_deref(),
            Some("ヒロイン？聖女？いいえ、オールワークスメイドです(誇)！")
        );
        assert!(metadata
            .aliases
            .iter()
            .any(|alias| alias.starts_with("Heroine?")));
        assert_eq!(
            metadata.broadcast.as_deref(),
            Some("R/2026-07-01T13:00:00.000Z/P7D")
        );
    }

    #[test]
    fn parses_bangumi_data_document_envelope() {
        let document: BangumiDataDocument = serde_json::from_value(serde_json::json!({
            "siteMeta": {"bangumi": {"title": "番组计划"}},
            "items": [{
                "title": "测试番组",
                "titleTranslate": {"zh-Hans": ["测试番组"]},
                "type": "tv",
                "begin": "2026-09-01T00:00:00.000Z",
                "broadcast": "",
                "sites": [{"site": "bangumi", "id": "1"}]
            }]
        }))
        .expect("bangumi-data document");
        assert_eq!(document.items.len(), 1);
    }

    #[tokio::test]
    #[ignore = "requires the live bangumi-data CDN"]
    async fn live_bangumi_data_contract_is_parseable() {
        let items = fetch_bangumi_data().await.expect("live bangumi-data");
        assert!(items.len() > 8_000);
        assert!(items
            .iter()
            .any(|item| { data_item_to_metadata(item, "2026-09-14T00:00:00Z").is_some() }));
    }

    #[tokio::test]
    #[ignore = "requires the live bangumi-data CDN and Bangumi API"]
    async fn live_overview_combines_sources_and_sqlite_cache() {
        let pool = db::test_pool().await.expect("test pool");
        let overview = overview(&pool, None, None).await.expect("live overview");
        assert!(!overview.seasonal.is_empty());
        assert!(!overview.trending.is_empty());
        assert!(overview
            .sources
            .iter()
            .any(|source| source.key == "bangumi-data" && source.available));
        assert!(overview
            .sources
            .iter()
            .any(|source| source.key == "bangumi" && source.available));
        let cache_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM metadata_cache")
            .fetch_one(&pool)
            .await
            .expect("cache count");
        assert_eq!(cache_count, 2);
    }

    #[tokio::test]
    async fn cache_round_trip_preserves_values() {
        let pool = db::test_pool().await.expect("test pool");
        let value = vec![sample_item()];
        save_cache(
            &pool,
            BANGUMI_DATA_PROVIDER,
            "test",
            &value,
            Duration::days(1),
        )
        .await
        .expect("save cache");
        let cached = load_cache::<Vec<BangumiDataItem>>(&pool, BANGUMI_DATA_PROVIDER, "test")
            .await
            .expect("load cache")
            .expect("cache exists");
        assert!(!cached.stale);
        assert_eq!(cached.value[0].title, value[0].title);
    }

    #[tokio::test]
    async fn saving_subject_is_idempotent_and_updates_local_state() {
        let pool = db::test_pool().await.expect("test pool");
        let directory = tempdir().expect("temporary directory");
        let state = AppState {
            pool,
            database_path: directory.path().join("genzo.db"),
            data_directory: directory.path().to_path_buf(),
            cover_cache_path: directory.path().join("covers"),
        };
        let metadata = sample_metadata();
        let first = persist_subject(&state, &metadata, "planned", false, None)
            .await
            .expect("first save");
        let second = persist_subject(&state, &metadata, "in_progress", true, None)
            .await
            .expect("second save");
        assert_eq!(first, second);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM works")
            .fetch_one(&state.pool)
            .await
            .expect("work count");
        let local: (String, bool) =
            sqlx::query_as("SELECT status, favorite FROM works WHERE id = ?")
                .bind(first)
                .fetch_one(&state.pool)
                .await
                .expect("saved work");
        assert_eq!(count, 1);
        assert_eq!(local, ("in_progress".to_string(), true));
    }
}
