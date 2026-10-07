use crate::anime_parser::normalize_title;
use crate::bangumi::BangumiProvider;
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::metadata;
use crate::metadata_provider::{retry_network, supplemental_match_confidence, MetadataSearchQuery};
use crate::models::{
    ExploreOverview, ExploreSaveInput, ExploreSourceStatus, ExploreSubject, WeeklyCalendar,
    WeeklyCalendarDay, WorkMetadata,
};
#[cfg(not(test))]
use crate::providers::anilist::AniListProvider;
use chrono::{Datelike, Duration, Utc};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::Duration as StdDuration;
use tauri::AppHandle;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

#[cfg(test)]
const BANGUMI_DATA_URL: &str = "https://unpkg.com/bangumi-data@0.3/dist/data.json";
const BANGUMI_DATA_PACKAGE_URL: &str = "https://unpkg.com/bangumi-data@0.3/package.json";
const BANGUMI_DATA_VERSION: &str = "0.3.132";
const EMBEDDED_BANGUMI_DATA: &[u8] = include_bytes!("../resources/bangumi-data-0.3.132.json");
const BANGUMI_DATA_PROVIDER: &str = "bangumi-data";
const BANGUMI_PROVIDER: &str = "bangumi";
const CALENDAR_CACHE_KEY: &str = "explore:calendar";
const MAX_BACKGROUND_COVER_FETCHES_PER_RESULT: usize = 48;
#[cfg(test)]
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
    end: Option<String>,
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

struct BangumiDataIndex {
    items: Vec<BangumiDataItem>,
    titles: HashMap<String, Vec<usize>>,
    by_bangumi: HashMap<String, usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BangumiDataLinks {
    pub tmdb: Option<String>,
    pub anilist: Option<String>,
}

static BANGUMI_DATA_INDEX: OnceLock<Result<BangumiDataIndex, String>> = OnceLock::new();
static COVER_CACHE_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static DETAIL_CACHE_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static COVER_CACHE_LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();
static CALENDAR_REFRESH_IN_FLIGHT: OnceLock<Arc<Mutex<bool>>> = OnceLock::new();
static ENRICHMENT_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

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
    if year.is_some_and(|value| !(1900..=2200).contains(&value))
        || month.is_some_and(|value| season_start_month(value).is_none())
    {
        return Err(AppError::Validation(
            "探索年份必须在 1900 到 2200 之间，月份必须在 1 到 12 之间".to_string(),
        ));
    }
    let selected_month = month.and_then(season_start_month);
    let display_year = year.unwrap_or_else(|| now.year());
    let display_month = selected_month.unwrap_or_else(|| current_season_start(&now));

    let dataset = load_bangumi_data(pool).await?;
    let mut seasonal_metadata = dataset
        .value
        .iter()
        .filter(|item| {
            item_date(item).is_some_and(|date| {
                year.is_none_or(|value| date.year() == value)
                    && selected_month
                        .is_none_or(|value| season_start_month(date.month()) == Some(value))
            })
        })
        .filter_map(|item| data_item_to_metadata(item, &dataset.fetched_at))
        .collect::<Vec<_>>();
    seasonal_metadata.sort_by(|left, right| {
        right
            .air_date
            .cmp(&left.air_date)
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

    let bangumi_source_label = crate::bangumi_network::current().source_label().to_string();
    let calendar = if year.is_none_or(|value| value == now.year())
        && selected_month.is_none_or(|value| value == current_season_start(&now))
    {
        match load_calendar(pool).await {
            Ok(calendar) => {
                sources.push(ExploreSourceStatus {
                    key: BANGUMI_PROVIDER.to_string(),
                    label: bangumi_source_label.clone(),
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
                    label: bangumi_source_label.clone(),
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
            warning: Some("历史季度不使用实时番组日历，评分将在打开条目详情时获取".to_string()),
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
    merge_cached_details(pool, &mut seasonal_metadata).await?;
    // A broad "all years / all seasons" view must stay local and fast. It may
    // still use already cached AniList details, but never starts one request
    // per indexed title while the user is browsing the filter.
    let allow_network_refresh = year.is_some() && selected_month.is_some();
    enrich_with_anilist(pool, &mut seasonal_metadata, false).await?;
    if allow_network_refresh {
        schedule_enrichment(
            pool.clone(),
            seasonal_metadata.clone(),
            format!("{year:?}:{month:?}"),
        );
    }

    let local_states = load_local_states(pool).await?;
    let seasonal = seasonal_metadata
        .into_iter()
        .map(|item| to_explore_subject(item, &local_states, dataset.stale))
        .collect::<Vec<_>>();

    let seasonal_genres = seasonal
        .iter()
        .map(|item| (item.external_id.as_str(), item.genres.as_slice()))
        .collect::<HashMap<_, _>>();

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
    for item in &mut trending {
        if let Some(genres) = seasonal_genres.get(item.external_id.as_str()) {
            let mut merged = item.genres.clone();
            merged.extend(genres.iter().cloned());
            merged.sort();
            merged.dedup();
            item.genres = merged;
        }
    }
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
        year: display_year,
        month: display_month,
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
    let base_key = format!("search:{}", normalize_title(query));
    let key = crate::bangumi_network::current().cache_key(&base_key);
    let cached = load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &key).await?;
    let result = if cached.as_ref().is_some_and(|value| !value.stale) {
        cached.expect("fresh cache checked")
    } else {
        let provider = BangumiProvider::new()?;
        match retry_network(|| provider.search(query)).await {
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

pub async fn anime_ranking(
    pool: &SqlitePool,
    page: u32,
    page_size: u32,
) -> AppResult<Vec<ExploreSubject>> {
    if page == 0 || !(1..=100).contains(&page_size) {
        return Err(AppError::Validation(
            "排行榜页码必须从 1 开始，每页数量必须在 1 到 100 之间".to_string(),
        ));
    }
    let base_key = format!("ranking:{page}:{page_size}");
    let key = crate::bangumi_network::current().cache_key(&base_key);
    let cached = load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &key).await?;
    let result = if cached.as_ref().is_some_and(|value| !value.stale) {
        cached.expect("fresh ranking cache checked")
    } else {
        let offset = (page - 1).saturating_mul(page_size);
        match BangumiProvider::new()?.ranking(page_size, offset).await {
            Ok(items) => {
                save_cache(pool, BANGUMI_PROVIDER, &key, &items, Duration::hours(12)).await?;
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
    let aggregated = crate::metadata_aggregator::aggregate(pool, metadata.value).await?;
    let local_states = load_local_states(pool).await?;
    Ok(to_explore_subject(
        aggregated.metadata,
        &local_states,
        metadata.stale,
    ))
}

pub async fn anime_popular(pool: &SqlitePool, page: u32, refresh: bool) -> AppResult<crate::models::AnimePopularPage> {
    anime_popular_with(pool, page, refresh, async {
        BangumiProvider::new()?.popular(page).await
    }).await
}

async fn anime_popular_with(
    pool: &SqlitePool, page: u32, refresh: bool,
    fetch: impl std::future::Future<Output = AppResult<crate::bangumi::PopularSubjects>>,
) -> AppResult<crate::models::AnimePopularPage> {
    if !(1..=10_000).contains(&page) {
        return Err(AppError::Validation("热度列表页码必须在 1 到 10000 之间".into()));
    }
    let key = format!("popular:bangumi-p1-trends:v2:{page}");
    let cached = load_cache::<crate::bangumi::PopularSubjects>(pool, BANGUMI_PROVIDER, &key).await?;
    let result = if !refresh && cached.as_ref().is_some_and(|value| !value.stale) {
        cached.expect("fresh popular cache checked")
    } else {
        match fetch.await {
            Ok(value) => {
                save_cache(pool, BANGUMI_PROVIDER, &key, &value, Duration::hours(1)).await?;
                Cached { value, fetched_at: Utc::now().to_rfc3339(), stale: false }
            }
            Err(error) => {
                let mut fallback = cached.ok_or(error)?;
                fallback.stale = true;
                fallback
            }
        }
    };
    let local_states = load_local_states(pool).await?;
    let has_more = !result.value.items.is_empty() && u64::from(page) < result.value.total_pages;
    Ok(crate::models::AnimePopularPage {
        items: result.value.items.into_iter().map(|item| to_explore_subject(item, &local_states, result.stale)).collect(),
        total_pages: result.value.total_pages, page, page_size: 24,
        has_more, stale: result.stale,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn discovery_list(
    pool: &SqlitePool,
    category: &str,
    sort: &str,
    tags: &[String],
    year: Option<i32>,
    month: Option<u32>,
    page: u32,
    page_size: u32,
) -> AppResult<Vec<ExploreSubject>> {
    if page == 0 || !(1..=100).contains(&page_size) {
        return Err(AppError::Validation(
            "探索页码必须从 1 开始，每页数量必须在 1 到 100 之间".to_string(),
        ));
    }
    let now = Utc::now();
    let local_states = load_local_states(pool).await?;
    let mut items = match category {
        "recommended" => overview(pool, year, month).await?.trending,
        "seasonal" | "anime" => {
            if year.is_some_and(|value| !(1900..=2200).contains(&value))
                || month.is_some_and(|value| season_start_month(value).is_none())
            {
                return Err(AppError::Validation("探索年份或月份无效".to_string()));
            }
            let target_year = year;
            let target_month = month.and_then(season_start_month);
            let mut metadata = embedded_index()?
                .items
                .iter()
                .filter(|item| item.item_type != "resource")
                .filter(|item| {
                    if category == "seasonal" {
                        item_date(item).is_some_and(|date| {
                            date.year() == target_year.unwrap_or_else(|| now.year())
                                && season_start_month(date.month())
                                    == Some(
                                        target_month.unwrap_or_else(|| current_season_start(&now)),
                                    )
                        })
                    } else {
                        item_date(item).is_some_and(|date| {
                            target_year.is_none_or(|value| date.year() == value)
                                && target_month.is_none_or(|value| {
                                    season_start_month(date.month()) == Some(value)
                                })
                        })
                    }
                })
                .filter_map(|item| {
                    data_item_to_metadata(item, &format!("bangumi-data {BANGUMI_DATA_VERSION}"))
                })
                .collect::<Vec<_>>();
            let allow_network_refresh = category == "seasonal" || metadata.len() <= 100;
            enrich_with_anilist(pool, &mut metadata, allow_network_refresh).await?;
            metadata
                .into_iter()
                .map(|item| to_explore_subject(item, &local_states, false))
                .collect()
        }
        "manga" => {
            return Err(AppError::Validation(
                "漫画探索数据源尚未接入，本命令不会返回动画数据冒充漫画".to_string(),
            ))
        }
        _ => return Err(AppError::Validation("无效的探索分类".to_string())),
    };
    if !tags.is_empty() {
        items.retain(|item| tags.iter().all(|tag| item.genres.contains(tag)));
    }
    match sort {
        "title" => items.sort_by(|left, right| left.title.cmp(&right.title)),
        "score" => items.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        "date" => items.sort_by(|left, right| left.air_date.cmp(&right.air_date)),
        "popularity" => items.sort_by(|left, right| {
            right
                .rating_count
                .cmp(&left.rating_count)
                .then_with(|| right.collection_count.cmp(&left.collection_count))
        }),
        _ => return Err(AppError::Validation("无效的探索排序方式".to_string())),
    }
    let start = ((page - 1) * page_size) as usize;
    Ok(items
        .into_iter()
        .skip(start)
        .take(page_size as usize)
        .collect())
}

pub async fn weekly_calendar(pool: &SqlitePool) -> AppResult<WeeklyCalendar> {
    let now = Utc::now();
    let quarter_start = current_season_start(&now);
    let local_states = load_local_states(pool).await?;
    let mut days = (1..=7)
        .map(|weekday| WeeklyCalendarDay {
            weekday,
            label: weekday_label(weekday).to_string(),
            items: Vec::new(),
        })
        .collect::<Vec<_>>();
    let mut weekdays = HashMap::new();
    let mut metadata_items = Vec::new();
    for item in &embedded_index()?.items {
        let Some(date) = item_date(item) else {
            continue;
        };
        if date.year() != now.year() || !(quarter_start..=quarter_start + 2).contains(&date.month())
        {
            continue;
        }
        if let Some(metadata) =
            data_item_to_metadata(item, &format!("bangumi-data {BANGUMI_DATA_VERSION}"))
        {
            weekdays.insert(
                metadata.external_id.clone(),
                date.weekday().number_from_monday(),
            );
            metadata_items.push(metadata);
        }
    }
    enrich_with_anilist(pool, &mut metadata_items, true).await?;
    for metadata in metadata_items {
        if let Some(weekday) = weekdays.get(&metadata.external_id) {
            days[(*weekday - 1) as usize].items.push(to_explore_subject(
                metadata,
                &local_states,
                false,
            ));
        }
    }
    for day in &mut days {
        day.items
            .sort_by(|left, right| left.title.cmp(&right.title));
    }
    Ok(WeeklyCalendar {
        source_version: BANGUMI_DATA_VERSION.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        days,
    })
}

// Android reuses the existing Bangumi client and SQLite metadata cache. Weekday
// comes from /calendar buckets, not the premiere date or an embedded title index.
#[cfg(any(target_os = "android", test))]
pub async fn live_weekly_calendar(pool: &SqlitePool) -> AppResult<WeeklyCalendar> {
    live_calendar_with(pool, async { BangumiProvider::new()?.calendar_by_weekday().await }).await
}

#[cfg(any(target_os = "android", test))]
async fn live_calendar_with(pool: &SqlitePool, fetch: impl std::future::Future<Output = AppResult<Vec<(u32, WorkMetadata)>>>) -> AppResult<WeeklyCalendar> {
    const KEY: &str = "explore:weekly-live:v1";
    static REFRESH: Mutex<()> = Mutex::const_new(());
    let _guard = REFRESH.lock().await;
    let key = crate::bangumi_network::current().cache_key(KEY);
    let cached = load_cache::<Vec<(u32, WorkMetadata)>>(pool, BANGUMI_PROVIDER, &key).await?;
    let result = if cached.as_ref().is_some_and(|value| !value.stale) {
        cached.unwrap()
    } else {
        match fetch.await {
            Ok(items) => {
                save_cache(pool, BANGUMI_PROVIDER, &key, &items, Duration::hours(6)).await?;
                let fetched_at: String = sqlx::query_scalar("SELECT fetched_at FROM metadata_cache WHERE provider=? AND cache_key=?")
                    .bind(BANGUMI_PROVIDER).bind(&key).fetch_one(pool).await?;
                Cached { value: items, fetched_at, stale: false }
            }
            Err(error) => cached.ok_or(error)?,
        }
    };
    let local = load_local_states(pool).await?;
    let mut days: Vec<WeeklyCalendarDay> = (1..=7).map(|weekday| WeeklyCalendarDay {
        weekday, label:weekday_label(weekday).into(), items:vec![],
    }).collect();
    for (weekday, metadata) in result.value {
        if (1..=7).contains(&weekday) {
            days[(weekday-1) as usize].items.push(to_explore_subject(metadata, &local, result.stale));
        }
    }
    for day in &mut days { day.items.sort_by(|left,right| left.title.cmp(&right.title)); }
    Ok(WeeklyCalendar { source_version:"Bangumi /calendar".into(), generated_at:result.fetched_at, days })
}

pub async fn check_in_local_library(pool: &SqlitePool, external_id: &str) -> AppResult<bool> {
    let external_id = validated_external_id(external_id)?;
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM work_external_ids WHERE provider = 'bangumi' AND external_id = ?)")
        .bind(external_id)
        .fetch_one(pool)
        .await?)
}

async fn enrich_with_anilist(
    pool: &SqlitePool,
    items: &mut [WorkMetadata],
    allow_network_refresh: bool,
) -> AppResult<()> {
    let mut links = HashMap::new();
    let mut metadata_by_id = HashMap::new();
    let mut refresh_ids = Vec::new();

    let keys = items
        .iter()
        .filter_map(|item| linked_ids_for_bangumi(&item.external_id).ok()?.anilist)
        .map(|id| format!("detail:{id}"))
        .collect::<Vec<_>>();
    let mut cached_details = load_cache_batch::<WorkMetadata>(pool, "anilist", &keys).await?;
    for item in items.iter() {
        let Some(anilist_id) = linked_ids_for_bangumi(&item.external_id)?.anilist else {
            continue;
        };
        links.insert(item.external_id.clone(), anilist_id.clone());
        let cache_key = format!("detail:{anilist_id}");
        match cached_details.remove(&cache_key) {
            Some(cached) => {
                metadata_by_id.insert(anilist_id.clone(), cached.value);
                if cached.stale {
                    refresh_ids.push(anilist_id);
                }
            }
            None => refresh_ids.push(anilist_id),
        }
    }

    refresh_ids.sort();
    refresh_ids.dedup();
    #[cfg(not(test))]
    if allow_network_refresh && !refresh_ids.is_empty() {
        let provider = AniListProvider::new()?;
        for chunk in refresh_ids.chunks(50) {
            match retry_network(|| provider.get_details_many(chunk)).await {
                Ok(metadata) => {
                    for item in metadata {
                        save_cache(
                            pool,
                            "anilist",
                            &format!("detail:{}", item.external_id),
                            &item,
                            Duration::days(30),
                        )
                        .await?;
                        metadata_by_id.insert(item.external_id.clone(), item);
                    }
                }
                Err(error) => {
                    eprintln!("AniList 探索批量补全失败：{error}");
                }
            }
        }
    }
    #[cfg(test)]
    let _ = (refresh_ids, allow_network_refresh);

    for item in items {
        let Some(anilist_id) = links.get(&item.external_id) else {
            continue;
        };
        let Some(supplement) = metadata_by_id.get(anilist_id) else {
            continue;
        };
        let query = MetadataSearchQuery::from_primary(item);
        if supplemental_match_confidence(&query, supplement) >= 0.85 {
            crate::metadata_aggregator::merge_anilist(item, supplement);
        }
    }
    Ok(())
}

fn schedule_enrichment(pool: SqlitePool, mut items: Vec<WorkMetadata>, key: String) {
    tauri::async_runtime::spawn(async move {
        let running = ENRICHMENT_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()));
        if !running.lock().await.insert(key.clone()) {
            return;
        }
        if let Err(error) = enrich_with_anilist(&pool, &mut items, true).await {
            eprintln!("探索后台补全失败：{error}");
        }
        running.lock().await.remove(&key);
    });
}

pub(crate) async fn prepare_cover_cache(
    app: &AppHandle,
    state: &AppState,
    subjects: &mut [ExploreSubject],
) {
    let mut scheduled = 0usize;
    for subject in subjects {
        if scheduled >= MAX_BACKGROUND_COVER_FETCHES_PER_RESULT {
            break;
        }
        if subject.cover_url.is_none() {
            schedule_detail_cache_refresh(&state.pool, &subject.external_id);
            scheduled += 1;
            continue;
        }
        if let Some(remote_url) = subject.cover_url.clone() {
            let destination = state.cover_cache_path.join(format!(
                "explore-bangumi-{}-poster.jpg",
                subject.external_id
            ));
            let cached = prepare_cached_image(
                app,
                &remote_url,
                normalize_trusted_image_url(&remote_url),
                destination,
                true,
            )
            .await;
            if cached.starts_with("http://") || cached.starts_with("https://") {
                scheduled += 1;
            }
            subject.cover_url = Some(cached);
        }
        if let Some(remote_url) = subject.banner_url.clone() {
            let destination = state.cover_cache_path.join(format!(
                "explore-bangumi-{}-banner.jpg",
                subject.external_id
            ));
            if scheduled >= MAX_BACKGROUND_COVER_FETCHES_PER_RESULT {
                continue;
            }
            let cached = prepare_cached_image(
                app,
                &remote_url,
                normalize_trusted_image_url(&remote_url),
                destination,
                false,
            )
            .await;
            if cached.starts_with("http://") || cached.starts_with("https://") {
                scheduled += 1;
            }
            subject.banner_url = Some(cached);
        }
        if scheduled >= MAX_BACKGROUND_COVER_FETCHES_PER_RESULT {
            break;
        }
    }
}

/// The embedded bangumi-data index intentionally stays small and often has no
/// artwork. Warm the detail cache in the background so the next bounded refresh
/// can expose the cover without requiring the user to open every card.
fn schedule_detail_cache_refresh(pool: &SqlitePool, external_id: &str) {
    let in_flight = DETAIL_CACHE_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()));
    let pool = pool.clone();
    let external_id = external_id.to_string();
    tauri::async_runtime::spawn(async move {
        let mut running = in_flight.lock().await;
        if !running.insert(external_id.clone()) {
            return;
        }
        drop(running);
        let _ = load_subject_metadata(&pool, &external_id).await;
        in_flight.lock().await.remove(&external_id);
    });
}

async fn prepare_cached_image(
    app: &AppHandle,
    cache_url: &str,
    display_url: String,
    destination: std::path::PathBuf,
    use_thumbnail: bool,
) -> String {
    if !cache_url.starts_with("http://") && !cache_url.starts_with("https://") {
        return cache_url.to_string();
    }
    let thumbnail = crate::metadata_aggregator::thumbnail_path(&destination);
    let display_path = if use_thumbnail {
        &thumbnail
    } else {
        &destination
    };
    if display_path.is_file() && db::allow_cover_file(app, display_path).is_ok() {
        return display_path.to_string_lossy().to_string();
    }

    let cache_key = destination.to_string_lossy().to_string();
    let mut in_flight = cover_cache_in_flight().lock().await;
    if !in_flight.insert(cache_key.clone()) {
        return display_url;
    }
    drop(in_flight);

    let app = app.clone();
    let cache_url = normalize_trusted_image_url(cache_url);
    tauri::async_runtime::spawn(async move {
        let limiter = COVER_CACHE_LIMIT
            .get_or_init(|| Arc::new(Semaphore::new(4)))
            .clone();
        if let Ok(_permit) = limiter.acquire_owned().await {
            let cached = if use_thumbnail {
                crate::metadata_aggregator::cache_cover(&cache_url, &destination).await
            } else {
                crate::metadata_aggregator::cache_banner(&cache_url, &destination).await
            };
            if cached.is_ok() {
                let _ = db::allow_cover_file(&app, &destination);
                if use_thumbnail {
                    let _ = db::allow_cover_file(&app, &thumbnail);
                }
            }
        }
        cover_cache_in_flight().lock().await.remove(&cache_key);
    });
    display_url
}

fn cover_cache_in_flight() -> &'static Mutex<HashSet<String>> {
    COVER_CACHE_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

fn normalize_trusted_image_url(value: &str) -> String {
    if let Some(path) = value.strip_prefix("http://lain.bgm.tv/") {
        format!("https://lain.bgm.tv/{path}")
    } else if let Some(path) = value.strip_prefix("//lain.bgm.tv/") {
        format!("https://lain.bgm.tv/{path}")
    } else {
        value.to_string()
    }
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
    let primary = load_subject_metadata(&state.pool, &input.external_id)
        .await?
        .value;
    let aggregated = crate::metadata_aggregator::aggregate(&state.pool, primary).await?;
    let metadata = &aggregated.metadata;
    let cover_path = if let Some(url) = &metadata.cover_url {
        let destination = crate::metadata_aggregator::artwork_cache_path(
            &state.cover_cache_path, &format!("bangumi-{}", metadata.external_id), "cover", url);
        if destination.is_file()
            || crate::metadata_aggregator::cache_cover(url, &destination)
                .await
                .is_ok()
        {
            db::allow_cover_file(app, &destination)?;
            Some(destination.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };
    let banner_path = if let Some(url) = &metadata.banner_url {
        let destination = crate::metadata_aggregator::artwork_cache_path(
            &state.cover_cache_path, &format!("bangumi-{}", metadata.external_id), "banner", url);
        if destination.is_file()
            || crate::metadata_aggregator::cache_banner(url, &destination)
                .await
                .is_ok()
        {
            db::allow_cover_file(app, &destination)?;
            Some(destination.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };
    persist_subject(
        state,
        metadata,
        &input.status,
        input.favorite,
        cover_path,
        banner_path,
        Some(&aggregated),
    )
    .await
}

async fn persist_subject(
    state: &AppState,
    metadata: &WorkMetadata,
    status: &str,
    favorite: bool,
    cover_path: Option<String>,
    banner_path: Option<String>,
    aggregation: Option<&crate::metadata_aggregator::AggregationResult>,
) -> AppResult<String> {
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
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
        sqlx::query("INSERT INTO works (id, title, original_title, type, description, cover_path, banner_path, status, favorite, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at) VALUES (?, ?, ?, 'video', ?, ?, ?, ?, ?, '', ?, ?, 'matched', ?, ?)")
            .bind(&work_id)
            .bind(&metadata.title)
            .bind(&metadata.original_title)
            .bind(&metadata.description)
            .bind(&cover_path)
            .bind(&banner_path)
            .bind(status)
            .bind(favorite)
            .bind(&now)
            .bind(&now)
            .bind(metadata.year)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
    }
    metadata::apply_metadata(
        &mut transaction,
        &work_id,
        metadata,
        cover_path,
        banner_path,
        &now,
    )
    .await?;
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
    if let Some(aggregation) = aggregation {
        crate::metadata_aggregator::persist_for_work(&mut transaction, &work_id, aggregation)
            .await?;
    }
    transaction.commit().await?;
    Ok(work_id)
}

async fn load_bangumi_data(pool: &SqlitePool) -> AppResult<Cached<Vec<BangumiDataItem>>> {
    let _ = pool;
    let index = embedded_index()?;
    Ok(Cached {
        value: index.items.clone(),
        fetched_at: format!("bangumi-data {BANGUMI_DATA_VERSION}"),
        stale: false,
    })
}

pub(crate) fn warm_embedded_index() -> AppResult<()> {
    embedded_index().map(|_| ())
}

pub(crate) async fn check_bangumi_data_update(pool: &SqlitePool) -> AppResult<()> {
    let checked_at = Utc::now().to_rfc3339();
    let client = Client::builder()
        .timeout(StdDuration::from_secs(10))
        .user_agent("Genzo/0.3.0 (local media library)")
        .build()
        .map_err(|error| AppError::Network(format!("无法初始化 bangumi-data 更新检查：{error}")))?;
    let response = client
        .get(BANGUMI_DATA_PACKAGE_URL)
        .send()
        .await
        .map_err(bangumi_data_network_error)?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "bangumi-data 更新检查失败（HTTP {}）",
            response.status().as_u16()
        )));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|error| AppError::Network(format!("bangumi-data 版本信息无法解析：{error}")))?;
    let latest = body
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| {
            value
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
        })
        .unwrap_or(BANGUMI_DATA_VERSION);
    let status = serde_json::json!({
        "bundledVersion": BANGUMI_DATA_VERSION,
        "latestVersion": latest,
        "checkedAt": checked_at,
        "updateAvailable": latest != BANGUMI_DATA_VERSION
    });
    sqlx::query("INSERT INTO app_settings (key, value, updated_at) VALUES ('metadata.bangumi_data_status', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(status.to_string())
        .bind(&checked_at)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) fn lookup_title(query: &str) -> AppResult<Vec<WorkMetadata>> {
    let index = embedded_index()?;
    let normalized = normalize_title(query);
    let Some(indices) = index.titles.get(&normalized) else {
        return Ok(Vec::new());
    };
    Ok(indices
        .iter()
        .filter_map(|index_value| index.items.get(*index_value))
        .filter_map(|item| {
            data_item_to_metadata(item, &format!("bangumi-data {BANGUMI_DATA_VERSION}"))
        })
        .collect())
}

pub(crate) fn linked_ids_for_bangumi(external_id: &str) -> AppResult<BangumiDataLinks> {
    let index = embedded_index()?;
    let item = index
        .by_bangumi
        .get(external_id)
        .and_then(|position| index.items.get(*position));
    Ok(
        item.map_or_else(BangumiDataLinks::default, |item| BangumiDataLinks {
            tmdb: site_id(item, "tmdb"),
            anilist: site_id(item, "aniList"),
        }),
    )
}

fn offline_metadata_for_bangumi(external_id: &str) -> AppResult<Option<WorkMetadata>> {
    let fetched_at = format!("bangumi-data {BANGUMI_DATA_VERSION}");
    Ok(embedded_index()?
        .items
        .iter()
        .find(|item| site_id(item, "bangumi").as_deref() == Some(external_id))
        .and_then(|item| data_item_to_metadata(item, &fetched_at)))
}

fn embedded_index() -> AppResult<&'static BangumiDataIndex> {
    BANGUMI_DATA_INDEX
        .get_or_init(|| build_index(EMBEDDED_BANGUMI_DATA).map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|error| {
            AppError::System(format!(
                "内置 bangumi-data {BANGUMI_DATA_VERSION} 索引损坏：{error}"
            ))
        })
}

fn build_index(json: &[u8]) -> Result<BangumiDataIndex, serde_json::Error> {
    let mut document: BangumiDataDocument = serde_json::from_slice(json)?;
    for item in &mut document.items {
        item.sites
            .retain(|site| matches!(site.site.as_str(), "bangumi" | "tmdb" | "aniList" | "mal"));
    }
    let mut titles: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_bangumi = HashMap::new();
    for (index, item) in document.items.iter().enumerate() {
        if let Some(id) = site_id(item, "bangumi") {
            by_bangumi.insert(id, index);
        }
        let names = std::iter::once(&item.title).chain(item.title_translate.values().flatten());
        for name in names {
            let normalized = normalize_title(name);
            if !normalized.is_empty() {
                titles.entry(normalized).or_default().push(index);
            }
        }
    }
    Ok(BangumiDataIndex {
        items: document.items,
        titles,
        by_bangumi,
    })
}

async fn load_calendar(pool: &SqlitePool) -> AppResult<Cached<Vec<WorkMetadata>>> {
    let key = crate::bangumi_network::current().cache_key(CALENDAR_CACHE_KEY);
    let cached = load_cache::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &key).await?;
    if let Some(cached_value) = cached {
        if cached_value.stale {
            schedule_calendar_refresh(pool.clone());
        }
        return Ok(cached_value);
    }
    schedule_calendar_refresh(pool.clone());
    Err(AppError::Network(
        "日历正在后台更新，当前展示本地番组索引".to_string(),
    ))
}

fn schedule_calendar_refresh(pool: SqlitePool) {
    let in_flight = CALENDAR_REFRESH_IN_FLIGHT
        .get_or_init(|| Arc::new(Mutex::new(false)))
        .clone();
    tauri::async_runtime::spawn(async move {
        {
            let mut running = in_flight.lock().await;
            if *running {
                return;
            }
            *running = true;
        }
        let _ = fetch_calendar_and_cache(&pool).await;
        *in_flight.lock().await = false;
    });
}

async fn fetch_calendar_and_cache(pool: &SqlitePool) -> AppResult<Cached<Vec<WorkMetadata>>> {
    let provider = BangumiProvider::new()?;
    let key = crate::bangumi_network::current().cache_key(CALENDAR_CACHE_KEY);
    match retry_network(|| provider.calendar()).await {
        Ok(items) => {
            let fetched_at = Utc::now().to_rfc3339();
            save_cache(
                pool,
                BANGUMI_PROVIDER,
                &key,
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
        Err(error) => Err(error),
    }
}

async fn load_subject_metadata(
    pool: &SqlitePool,
    external_id: &str,
) -> AppResult<Cached<WorkMetadata>> {
    let external_id = validated_external_id(external_id)?;
    let base_key = format!("detail:{external_id}");
    let key = crate::bangumi_network::current().cache_key(&base_key);
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
    match retry_network(|| provider.get_details(&external_id)).await {
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
        Err(error) => {
            if let Some(cached) = cached {
                Ok(cached)
            } else if let Some(metadata) = offline_metadata_for_bangumi(&external_id)? {
                Ok(Cached {
                    fetched_at: metadata.fetched_at.clone(),
                    value: metadata,
                    stale: true,
                })
            } else {
                Err(error)
            }
        }
    }
}

async fn merge_cached_details(pool: &SqlitePool, items: &mut [WorkMetadata]) -> AppResult<()> {
    let keys = items
        .iter()
        .map(|item| format!("detail:{}", item.external_id))
        .collect::<Vec<_>>();
    let mut cached_details =
        load_cache_batch::<Vec<WorkMetadata>>(pool, BANGUMI_PROVIDER, &keys).await?;
    for item in items {
        let key = format!("detail:{}", item.external_id);
        if let Some(cached) = cached_details.remove(&key) {
            if let Some(details) = cached.value.into_iter().next() {
                *item = merge_metadata(item.clone(), details);
            }
        }
    }
    Ok(())
}

async fn load_cache_batch<T: DeserializeOwned>(
    pool: &SqlitePool,
    provider: &str,
    keys: &[String],
) -> AppResult<HashMap<String, Cached<T>>> {
    let mut result = HashMap::new();
    let now = Utc::now().to_rfc3339();
    for chunk in keys.chunks(400) {
        let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT cache_key, response_json, fetched_at, expires_at FROM metadata_cache WHERE provider = ");
        query.push_bind(provider).push(" AND cache_key IN (");
        let mut list = query.separated(",");
        for key in chunk {
            list.push_bind(key);
        }
        list.push_unseparated(")");
        let rows = query
            .build_query_as::<(String, String, String, String)>()
            .fetch_all(pool)
            .await?;
        for (key, json, fetched_at, expires_at) in rows {
            if let Ok(value) = serde_json::from_str(&json) {
                result.insert(
                    key,
                    Cached {
                        value,
                        fetched_at,
                        stale: expires_at <= now,
                    },
                );
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
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

fn season_start_month(month: u32) -> Option<u32> {
    match month {
        1..=3 => Some(1),
        4..=6 => Some(4),
        7..=9 => Some(7),
        10..=12 => Some(10),
        _ => None,
    }
}

fn current_season_start(now: &chrono::DateTime<Utc>) -> u32 {
    season_start_month(now.month()).expect("calendar month is always valid")
}

#[allow(dead_code)]
fn item_matches_season(item: &BangumiDataItem, year: i32, season_month: u32) -> bool {
    item_date(item).is_some_and(|date| {
        date.year() == year && season_start_month(date.month()) == Some(season_month)
    })
}

fn item_date(item: &BangumiDataItem) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    let recurrence_start = item
        .broadcast
        .as_deref()
        .and_then(|broadcast| broadcast.strip_prefix("R/"))
        .and_then(|broadcast| broadcast.split('/').next());
    chrono::DateTime::parse_from_rfc3339(recurrence_start.unwrap_or(&item.begin)).ok()
}

fn weekday_label(weekday: u32) -> &'static str {
    match weekday {
        1 => "周一",
        2 => "周二",
        3 => "周三",
        4 => "周四",
        5 => "周五",
        6 => "周六",
        _ => "周日",
    }
}

fn data_item_to_metadata(item: &BangumiDataItem, fetched_at: &str) -> Option<WorkMetadata> {
    let external_id = site_id(item, "bangumi")?;
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
        source_keys: vec![BANGUMI_DATA_PROVIDER.to_string()],
        cover_provider: None,
        banner_provider: None,
        score_provider: None,
        fetched_at: fetched_at.to_string(),
    })
}

fn site_id(item: &BangumiDataItem, key: &str) -> Option<String> {
    item.sites.iter().find_map(|site| {
        (site.site == key).then(|| {
            site.id.as_ref().and_then(|id| {
                id.as_str()
                    .map(str::to_string)
                    .or_else(|| id.as_i64().map(|id| id.to_string()))
            })
        })?
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
    details.source_keys.extend(base.source_keys);
    details.source_keys.sort();
    details.source_keys.dedup();
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
        .and_then(|date| date.get(5..7).and_then(|month| month.parse::<u32>().ok()))
        .and_then(season_start_month);
    ExploreSubject {
        provider: BANGUMI_PROVIDER.to_string(),
        external_id: metadata.external_id,
        title: metadata.title,
        original_title: metadata.original_title,
        aliases: metadata.aliases,
        description: metadata.description,
        cover_url: metadata.cover_url,
        banner_url: metadata.banner_url,
        year: metadata.year,
        month,
        air_date: metadata.air_date,
        broadcast: metadata.broadcast,
        subject_type: metadata.subject_type,
        genres: localized_genres(&metadata.genres),
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
        source_keys: metadata.source_keys,
        cover_provider: metadata.cover_provider,
        banner_provider: metadata.banner_provider,
        score_provider: metadata.score_provider,
    }
}

/// 统一探索页标签语言。AniList 通常返回英文标签，而 Bangumi 的标签可能已经是中文。
fn localized_genres(genres: &[String]) -> Vec<String> {
    let mut localized = genres
        .iter()
        .filter_map(|genre| {
            let trimmed = genre.trim();
            if trimmed.is_empty() {
                return None;
            }
            let value = match trimmed.to_ascii_lowercase().as_str() {
                "action" => "动作",
                "adventure" => "冒险",
                "comedy" => "喜剧",
                "drama" => "剧情",
                "ecchi" => "卖肉",
                "fantasy" => "奇幻",
                "horror" => "恐怖",
                "mahou shoujo" | "magical girl" => "魔法少女",
                "mecha" => "机战",
                "music" => "音乐",
                "mystery" => "悬疑",
                "psychological" => "心理",
                "romance" => "恋爱",
                "sci-fi" | "science fiction" => "科幻",
                "slice of life" => "日常",
                "sports" => "运动",
                "supernatural" => "超自然",
                "thriller" => "惊悚",
                _ if !trimmed.is_ascii() => trimmed,
                _ => return None,
            };
            Some(value.to_string())
        })
        .collect::<Vec<_>>();
    localized.sort();
    localized.dedup();
    localized
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

    #[tokio::test]
    async fn popular_cache_is_separate_from_ranking_and_preserves_failed_refresh() {
        let pool = db::test_pool().await.unwrap();
        let first = anime_popular_with(&pool,1,false,async {
            Ok(crate::bangumi::PopularSubjects { items:vec![sample_metadata()],total_pages:42 })
        }).await.unwrap();
        assert!(!first.stale);
        let fresh = anime_popular_with(&pool,1,false,async { panic!("fresh cache must not fetch") }).await.unwrap();
        assert_eq!(fresh.total_pages,42); assert!(fresh.has_more);
        let stale = anime_popular_with(&pool,1,true,async { Err(AppError::Network("offline".into())) }).await.unwrap();
        assert!(stale.stale && stale.items[0].stale);
        assert_eq!(stale.items[0].external_id,first.items[0].external_id);
        let missing_page = anime_popular_with(&pool,2,false,async { Err(AppError::Network("offline".into())) }).await;
        assert!(missing_page.is_err());
        let old_ranking = load_cache::<Vec<WorkMetadata>>(&pool,BANGUMI_PROVIDER,"ranking:1:24").await.unwrap();
        assert!(old_ranking.is_none());
        sqlx::query("UPDATE metadata_cache SET expires_at='2000-01-01'").execute(&pool).await.unwrap();
        assert!(anime_popular_with(&pool,1,false,async { Err(AppError::Network("offline".into())) }).await.unwrap().stale);
        let last = anime_popular_with(&pool,42,false,async { Ok(crate::bangumi::PopularSubjects { items:vec![sample_metadata()],total_pages:42 }) }).await.unwrap();
        assert!(!last.has_more);
        for page in [0,10_001,u32::MAX] {
            assert!(anime_popular_with(&pool,page,false,async { panic!("invalid pagination must not fetch") }).await.is_err());
        }
    }

    #[tokio::test]
    async fn live_calendar_persists_success_and_preserves_stale_cache_on_failure() {
        let pool = db::test_pool().await.unwrap();
        let first = live_calendar_with(&pool, async { Ok(vec![(2,sample_metadata())]) }).await.unwrap();
        assert_eq!(first.days[1].items.len(),1);
        assert_eq!(first.source_version,"Bangumi /calendar");
        let fresh = live_calendar_with(&pool, async { panic!("fresh cache must not access network") }).await.unwrap();
        assert_eq!(fresh.generated_at,first.generated_at);
        assert_eq!(live_weekly_calendar(&pool).await.unwrap().generated_at,first.generated_at);
        sqlx::query("UPDATE metadata_cache SET expires_at='2000-01-01' WHERE cache_key='explore:weekly-live:v1'").execute(&pool).await.unwrap();
        let offline = live_calendar_with(&pool, async { Err(AppError::Network("offline".into())) }).await.unwrap();
        assert_eq!(offline.days[1].items[0].external_id,first.days[1].items[0].external_id);
        assert!(offline.days[1].items[0].stale);
        assert_eq!(offline.generated_at,first.generated_at);
        let cold = db::test_pool().await.unwrap();
        assert!(live_calendar_with(&cold, async { Err(AppError::Network("offline".into())) }).await.is_err());
    }

    #[tokio::test]
    async fn cold_overview_returns_local_content_without_waiting_for_network() {
        let pool = db::test_pool().await.unwrap();
        warm_embedded_index().unwrap();
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(StdDuration::from_secs(2), overview(&pool, None, None))
            .await
            .unwrap()
            .unwrap();
        assert!(!result.seasonal.is_empty());
        eprintln!(
            "cold local overview: {} items in {:?}",
            result.seasonal.len(),
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn batch_details_preserve_stale_cache_and_ignore_corrupt_entries() {
        let pool = db::test_pool().await.unwrap();
        let detail = sample_metadata();
        let key = format!("detail:{}", detail.external_id);
        save_cache(
            &pool,
            BANGUMI_PROVIDER,
            &key,
            &vec![detail.clone()],
            Duration::days(-1),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES ('bangumi', 'detail:broken', 'invalid', '', '')").execute(&pool).await.unwrap();
        let result = load_cache_batch::<Vec<WorkMetadata>>(
            &pool,
            BANGUMI_PROVIDER,
            &[key.clone(), "detail:broken".into()],
        )
        .await
        .unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[&key].stale);
        let mut items = vec![detail];
        items[0].description.clear();
        merge_cached_details(&pool, &mut items).await.unwrap();
        assert_eq!(items[0].description, "简介");
    }

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
            "sites": [
                {"site": "bangumi", "id": "558064"},
                {"site": "tmdb", "id": "tv/123/season/2"},
                {"site": "aniList", "id": "456"}
            ]
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
            source_keys: vec!["bangumi".to_string()],
            cover_provider: None,
            banner_provider: None,
            score_provider: Some("bangumi".to_string()),
            fetched_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn maps_bangumi_data_title_alias_and_schedule() {
        let item = sample_item();
        assert!(item_matches_season(&item, 2026, 7));
        assert!(!item_matches_season(&item, 2026, 10));
        let metadata = data_item_to_metadata(&item, "2026-09-14T00:00:00Z").expect("metadata");
        assert_eq!(metadata.external_id, "558064");
        assert_eq!(metadata.title, "女主角？圣女？不，我是杂役女仆（自豪）！");
        assert_eq!(metadata.air_date.as_deref(), Some("2026-07-01"));
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
    fn maps_calendar_months_to_anime_seasons() {
        assert_eq!(season_start_month(1), Some(1));
        assert_eq!(season_start_month(2), Some(1));
        assert_eq!(season_start_month(4), Some(4));
        assert_eq!(season_start_month(6), Some(4));
        assert_eq!(season_start_month(9), Some(7));
        assert_eq!(season_start_month(12), Some(10));
        assert_eq!(season_start_month(0), None);
    }

    #[test]
    fn localizes_explore_genres_for_chinese_ui() {
        let genres = localized_genres(&[
            "Action".to_string(),
            "Fantasy".to_string(),
            "Slice of Life".to_string(),
            "悬疑".to_string(),
            "Unknown English".to_string(),
        ]);
        assert_eq!(genres, vec!["动作", "奇幻", "悬疑", "日常"]);
    }

    #[test]
    fn builds_multilingual_title_index_and_retains_metadata_links() {
        let document = serde_json::json!({"items": [sample_item()]});
        let index = build_index(document.to_string().as_bytes()).expect("index");
        for title in [
            "女主角？圣女？不，我是杂役女仆（自豪）！",
            "Heroine? Saint? No, I'm an All-Works Maid (and Proud of It)!",
            "ヒロイン？聖女？いいえ、オールワークスメイドです(誇)！",
        ] {
            assert_eq!(index.titles.get(&normalize_title(title)), Some(&vec![0]));
        }
        assert_eq!(
            site_id(&index.items[0], "tmdb").as_deref(),
            Some("tv/123/season/2")
        );
        assert_eq!(site_id(&index.items[0], "aniList").as_deref(), Some("456"));
    }

    #[test]
    fn creates_offline_anchor_for_known_bangumi_subject() {
        let known = embedded_index()
            .expect("embedded index")
            .items
            .iter()
            .find_map(|item| site_id(item, "bangumi"))
            .expect("known Bangumi subject");
        let metadata = offline_metadata_for_bangumi(&known)
            .expect("offline lookup")
            .expect("offline metadata");
        assert_eq!(metadata.external_id, known);
        assert_eq!(metadata.provider, "bangumi");
        assert!(metadata
            .source_keys
            .iter()
            .any(|source| source == BANGUMI_DATA_PROVIDER));
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

    #[test]
    fn keeps_high_resolution_bangumi_images_for_explore_cards() {
        assert_eq!(
            normalize_trusted_image_url("http://lain.bgm.tv/pic/cover/l/92/97/975_GFGYI.jpg"),
            "https://lain.bgm.tv/pic/cover/l/92/97/975_GFGYI.jpg"
        );
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
        fetch_calendar_and_cache(&pool)
            .await
            .expect("live calendar refresh");
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
        assert!(cache_count >= 1);
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
            thumbnail_cache_path: directory.path().join("thumbnails"),
        };
        let metadata = sample_metadata();
        let first = persist_subject(&state, &metadata, "planned", false, None, None, None)
            .await
            .expect("first save");
        let second = persist_subject(
            &state,
            &metadata,
            "in_progress",
            true,
            None,
            Some("C:\\cache\\banner.jpg".to_string()),
            None,
        )
        .await
        .expect("second save");
        assert_eq!(first, second);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM works")
            .fetch_one(&state.pool)
            .await
            .expect("work count");
        let local: (String, bool, Option<String>) =
            sqlx::query_as("SELECT status, favorite, banner_path FROM works WHERE id = ?")
                .bind(first)
                .fetch_one(&state.pool)
                .await
                .expect("saved work");
        assert_eq!(count, 1);
        assert_eq!(
            local,
            (
                "in_progress".to_string(),
                true,
                Some("C:\\cache\\banner.jpg".to_string())
            )
        );
    }

    #[tokio::test]
    async fn discovery_supports_full_anime_paging_without_network() {
        let pool = db::test_pool().await.expect("test pool");
        let page = discovery_list(&pool, "anime", "title", &[], None, None, 2, 3)
            .await
            .expect("discovery page");
        assert_eq!(page.len(), 3);
        assert!(page
            .windows(2)
            .all(|items| items[0].title <= items[1].title));
    }

    #[tokio::test]
    async fn seasonal_discovery_groups_february_into_january_season() {
        let pool = db::test_pool().await.expect("test pool");
        let january = discovery_list(&pool, "seasonal", "date", &[], Some(2026), Some(1), 1, 100)
            .await
            .expect("January season");
        let february = discovery_list(&pool, "seasonal", "date", &[], Some(2026), Some(2), 1, 100)
            .await
            .expect("February maps to January season");
        assert_eq!(
            january
                .iter()
                .map(|item| &item.external_id)
                .collect::<Vec<_>>(),
            february
                .iter()
                .map(|item| &item.external_id)
                .collect::<Vec<_>>()
        );
        assert!(january.iter().all(|item| item.month == Some(1)));
    }

    #[tokio::test]
    async fn weekly_calendar_has_monday_through_sunday_buckets() {
        let pool = db::test_pool().await.expect("test pool");
        let calendar = weekly_calendar(&pool).await.expect("calendar");
        assert_eq!(calendar.days.len(), 7);
        assert_eq!(calendar.days[0].label, "周一");
        assert_eq!(calendar.days[6].label, "周日");
    }

    #[tokio::test]
    async fn local_library_check_uses_bangumi_external_id() {
        let pool = db::test_pool().await.expect("test pool");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '作品', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("work");
        sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES ('work', 'bangumi', '400602', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("external id");
        assert!(check_in_local_library(&pool, "400602")
            .await
            .expect("check"));
        assert!(!check_in_local_library(&pool, "1")
            .await
            .expect("check missing"));
    }
}
