use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::WorkMetadata;
use chrono::{Duration as ChronoDuration, Utc};
use reqwest::Client;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::time::Duration;
use std::sync::OnceLock;
use tauri::State;

const API_ROOT: &str = "https://api.bgm.tv/v0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookCandidate {
    pub external_id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub summary: String,
    pub cover_url: Option<String>,
    pub category: Option<String>,
    pub series: Option<bool>,
    pub confidence: f64,
    pub stale: bool,
}

fn category(value: &Value) -> Option<&'static str> {
    match value.get("platform").and_then(Value::as_str) {
        Some("漫画" | "Manga" | "manga") => Some("comic"),
        Some("小说" | "轻小说" | "Novel" | "novel") => Some("novel"),
        Some("画集" | "Illustration") => Some("comic"),
        _ => None,
    }
}

fn candidate(value: &Value, query: &str, stale: bool) -> Option<BookCandidate> {
    if value.get("type").and_then(Value::as_i64) != Some(1) { return None; }
    let id = value.get("id")?.as_i64()?;
    let original = value.get("name").and_then(Value::as_str).filter(|text| !text.trim().is_empty());
    let chinese = value.get("name_cn").and_then(Value::as_str).filter(|text| !text.trim().is_empty());
    let title = chinese.or(original)?.to_string();
    let cover_url = value.get("images")
        .and_then(|images| images.get("large").or_else(|| images.get("common")))
        .and_then(Value::as_str).map(str::to_string);
    let confidence = [chinese, original].into_iter().flatten()
        .map(|name| strsim::jaro_winkler(&crate::anime_parser::normalize_title(query), &crate::anime_parser::normalize_title(name)))
        .fold(0.0_f64, f64::max);
    Some(BookCandidate {
        external_id: id.to_string(), title,
        original_title: original.map(str::to_string),
        summary: value.get("summary").or_else(|| value.get("short_summary")).and_then(Value::as_str).unwrap_or_default().to_string(),
        cover_url, category: category(value).map(str::to_string),
        series: value.get("series").and_then(Value::as_bool),
        confidence, stale,
    })
}

fn client() -> AppResult<Client> {
    Client::builder().timeout(Duration::from_secs(12))
        .user_agent("Genzo/0.5.0 (local media library)")
        .build().map_err(|error| AppError::Network(format!("无法初始化 Bangumi 书籍客户端：{error}")))
}

async fn search_response(pool: &SqlitePool, query: &str) -> AppResult<(Value, bool)> {
    let key = format!("book-search:{}", query.to_lowercase());
    let cached: Option<(String, String)> = sqlx::query_as("SELECT response_json, expires_at FROM metadata_cache WHERE provider = 'bangumi_book' AND cache_key = ?")
        .bind(&key).fetch_optional(pool).await?;
    if let Some((body, expires_at)) = &cached {
        if expires_at.as_str() > Utc::now().to_rfc3339().as_str() {
            if let Ok(value) = serde_json::from_str(body) { return Ok((value, false)); }
        }
    }
    let response = client()?.post(format!("{API_ROOT}/search/subjects"))
        .query(&[("limit", "20")])
        .json(&json!({ "keyword": query, "sort": "match", "filter": { "type": [1] } }))
        .send().await;
    let result = match response {
        Ok(response) if response.status().is_success() => response.json::<Value>().await
            .map_err(|error| AppError::Network(format!("Bangumi 书籍搜索响应无效：{error}"))),
        Ok(response) if response.status().as_u16() == 429 => Err(AppError::Network("Bangumi 请求过于频繁，请稍后重试".into())),
        Ok(response) => Err(AppError::Network(format!("Bangumi 书籍搜索失败（HTTP {}）", response.status()))),
        Err(error) => Err(AppError::Network(format!("无法搜索 Bangumi 书籍：{error}"))),
    };
    match result {
        Ok(value) => {
            let now = Utc::now();
            if let Ok((_guard, mut transaction)) = crate::db::begin_write(pool).await {
                let _ = sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES ('bangumi_book', ?, ?, ?, ?) ON CONFLICT(provider, cache_key) DO UPDATE SET response_json = excluded.response_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at")
                    .bind(&key).bind(value.to_string()).bind(now.to_rfc3339()).bind((now + ChronoDuration::days(7)).to_rfc3339())
                    .execute(&mut *transaction).await;
                let _ = transaction.commit().await;
            }
            Ok((value, false))
        }
        Err(error) => cached.and_then(|(body, _)| serde_json::from_str(&body).ok().map(|value| (value, true)))
            .ok_or(error),
    }
}

pub async fn search_in_pool(pool: &SqlitePool, work_id: &str, query: Option<&str>) -> AppResult<Vec<BookCandidate>> {
    let work: Option<(String, String)> = sqlx::query_as("SELECT type, title FROM works WHERE id = ?")
        .bind(work_id).fetch_optional(pool).await?;
    let (kind, title) = work.ok_or_else(|| AppError::NotFound("作品不存在".into()))?;
    if !matches!(kind.as_str(), "comic" | "novel") { return Err(AppError::Validation("请选择漫画或小说作品".into())); }
    search_for_kind_in_pool(pool, &kind, query.unwrap_or(&title)).await
}

pub async fn search_for_kind_in_pool(pool: &SqlitePool, kind: &str, query: &str) -> AppResult<Vec<BookCandidate>> {
    if !matches!(kind, "comic" | "novel") { return Err(AppError::Validation("请选择漫画或小说类型".into())); }
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 { return Err(AppError::Validation("请输入不超过 100 字的书名".into())); }
    let (body, stale) = search_response(pool, query).await?;
    let mut candidates = body.get("data").and_then(Value::as_array).into_iter().flatten()
        .filter_map(|value| candidate(value, query, stale))
        .filter(|candidate| candidate.category.as_deref().is_none_or(|category| category == kind))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    Ok(candidates)
}

#[tauri::command]
pub async fn search_book_candidates(work_id: String, query: Option<String>, state: State<'_, AppState>) -> AppResult<Vec<BookCandidate>> {
    search_in_pool(&state.pool, &work_id, query.as_deref()).await
}

#[tauri::command]
pub async fn search_book_import_candidates(media_type: String, query: String, state: State<'_, AppState>) -> AppResult<Vec<BookCandidate>> {
    search_for_kind_in_pool(&state.pool, &media_type, &query).await
}

async fn fetch_details(external_id: &str) -> AppResult<Value> {
    if external_id.is_empty() || !external_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AppError::Validation("Bangumi 书籍 ID 无效".into()));
    }
    let response = client()?.get(format!("{API_ROOT}/subjects/{external_id}"))
        .send().await.map_err(|error| AppError::Network(format!("无法读取 Bangumi 书籍详情：{error}")))?;
    if !response.status().is_success() { return Err(AppError::Network(format!("Bangumi 书籍详情失败（HTTP {}）", response.status()))); }
    response.json().await.map_err(|error| AppError::Network(format!("Bangumi 书籍详情响应无效：{error}")))
}

pub(crate) struct PreparedBookMatch {
    pub(crate) external_id: String,
    pub(crate) metadata: WorkMetadata,
    pub(crate) cover_path: Option<String>,
    pub(crate) single_volume: bool,
}

pub(crate) async fn prepare_match(state: &AppState, external_id: &str, kind: &str, unit_count: usize) -> AppResult<PreparedBookMatch> {
    if !matches!(kind, "comic" | "novel") { return Err(AppError::Validation("只能为漫画或小说匹配书籍资料".into())); }
    let details = fetch_details(external_id).await?;
    if details.get("type").and_then(Value::as_i64) != Some(1) {
        return Err(AppError::Validation("候选不是 Bangumi 书籍条目".into()));
    }
    if let Some(candidate_kind) = category(&details) {
        if candidate_kind != kind { return Err(AppError::Validation("候选书籍品类与当前作品不符".into())); }
    }
    if details.get("series").and_then(Value::as_bool) == Some(false) && unit_count > 1 {
        return Err(AppError::Validation("该候选是单册条目，当前作品包含多册；请选择系列条目或先拆分作品".into()));
    }
    let mut metadata = crate::bangumi::subject_to_metadata(&details)
        .ok_or_else(|| AppError::Validation("Bangumi 书籍资料缺少标题或 ID".into()))?;
    metadata.subject_type = kind.to_string();
    metadata.season = None;
    let cover_path = if let Some(url) = metadata.cover_url.as_deref() {
        let destination = crate::metadata_aggregator::artwork_cache_path(&state.cover_cache_path, &format!("bangumi-book-{external_id}"), "cover", url);
        if destination.is_file() || crate::metadata_aggregator::cache_cover(url, &destination).await.is_ok() {
            Some(destination.to_string_lossy().to_string())
        } else { None }
    } else { None };
    Ok(PreparedBookMatch { external_id: external_id.to_string(), metadata, cover_path, single_volume: details.get("series").and_then(Value::as_bool) == Some(false) })
}

pub(crate) async fn apply_prepared_match(transaction: &mut Transaction<'_, Sqlite>, work_id: &str, prepared: PreparedBookMatch, now: &str) -> AppResult<()> {
    let owner: Option<String> = sqlx::query_scalar("SELECT work_id FROM work_external_ids WHERE provider = 'bangumi' AND external_id = ?")
        .bind(&prepared.external_id).fetch_optional(&mut **transaction).await?;
    if owner.as_deref().is_some_and(|owner| owner != work_id) {
        return Err(AppError::Validation("该 Bangumi 条目已关联另一部作品".into()));
    }
    sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES (?, 'bangumi', ?, ?, ?) ON CONFLICT(work_id, provider) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at")
        .bind(work_id).bind(&prepared.external_id).bind(now).bind(now).execute(&mut **transaction).await?;
    crate::metadata::apply_metadata(transaction, work_id, &prepared.metadata, prepared.cover_path, None, now).await?;
    Ok(())
}

pub async fn confirm_in_state(state: &AppState, work_id: &str, external_id: &str) -> AppResult<()> {
    let work_type: Option<String> = sqlx::query_scalar("SELECT type FROM works WHERE id = ?")
        .bind(work_id).fetch_optional(&state.pool).await?;
    let kind = work_type.ok_or_else(|| AppError::NotFound("作品不存在".into()))?;
    let unit_count = crate::bookshelf::entries_in_pool(&state.pool, work_id).await?.len();
    let prepared = prepare_match(state, external_id, &kind, unit_count).await?;
    let now = Utc::now().to_rfc3339();
    let (_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let current_kind: Option<String> = sqlx::query_scalar("SELECT type FROM works WHERE id = ?")
        .bind(work_id).fetch_optional(&mut *transaction).await?;
    if current_kind.as_deref() != Some(kind.as_str()) { return Err(AppError::Validation("作品类型已变化，请刷新后重试".into())); }
    apply_prepared_match(&mut transaction, work_id, prepared, &now).await?;
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn confirm_book_candidate(work_id: String, external_id: String, state: State<'_, AppState>) -> AppResult<()> {
    confirm_in_state(&state, &work_id, &external_id).await
}

#[tauri::command]
pub async fn refresh_book_metadata(work_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let external_id: Option<String> = sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'")
        .bind(&work_id).fetch_optional(&state.pool).await?;
    let external_id = external_id.ok_or_else(|| AppError::Validation("此书尚未关联 Bangumi 条目".into()))?;
    confirm_in_state(&state, &work_id, &external_id).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookVolumeCandidate {
    external_id: String,
    title: String,
    cover_url: Option<String>,
    volume_number: Option<f64>,
    linked_to_series: bool,
    stale: bool,
}

fn volume_number(value: &str) -> Option<f64> {
    static PARENTHESIZED: OnceLock<Regex> = OnceLock::new();
    let suffix = PARENTHESIZED.get_or_init(|| Regex::new(r"[（(]\s*(\d{1,3}(?:\.\d+)?)\s*[）)]\s*$").unwrap());
    suffix.captures(value).and_then(|found| found.get(1)?.as_str().parse().ok())
        .or_else(|| crate::bookshelf::parse_book_numbers(value).0)
}

fn volume_candidate(value: &Value, linked_to_series: bool, stale: bool) -> Option<BookVolumeCandidate> {
    if value.get("type").and_then(Value::as_i64) != Some(1) { return None; }
    if linked_to_series && value.get("relation").and_then(Value::as_str) != Some("单行本") { return None; }
    if !linked_to_series && value.get("series").and_then(Value::as_bool) == Some(true) { return None; }
    let external_id = value.get("id")?.as_i64()?.to_string();
    let original = value.get("name").and_then(Value::as_str).unwrap_or_default();
    let chinese = value.get("name_cn").and_then(Value::as_str).filter(|name| !name.is_empty());
    let title = chinese.unwrap_or(original).trim();
    if title.is_empty() { return None; }
    let volume_number = [chinese, Some(original)].into_iter().flatten().find_map(volume_number);
    let cover_url = value.get("images").and_then(|images| images.get("large").or_else(|| images.get("common")))
        .and_then(Value::as_str).map(str::to_string);
    Some(BookVolumeCandidate { external_id, title: title.to_string(), cover_url, volume_number, linked_to_series, stale })
}

fn validate_volume_details(details: &Value, kind: &str, expected_number: Option<f64>) -> AppResult<(String, Option<String>, Option<f64>)> {
    if details.get("type").and_then(Value::as_i64) != Some(1) || details.get("series").and_then(Value::as_bool) != Some(false) {
        return Err(AppError::Validation("候选不是 Bangumi 单册书籍条目".into()));
    }
    if category(details).is_some_and(|found| found != kind) {
        return Err(AppError::Validation("候选书籍品类与当前作品不符".into()));
    }
    let titles = ["name_cn", "name"].into_iter().filter_map(|key| details.get(key).and_then(Value::as_str)).filter(|title| !title.trim().is_empty()).collect::<Vec<_>>();
    if let Some(expected) = expected_number {
        if titles.iter().filter_map(|title| volume_number(title)).any(|actual| (actual - expected).abs() > 0.001) {
            return Err(AppError::Validation("候选卷号与本地卷号不同，请核对后选择正确条目".into()));
        }
    }
    let title = titles.first().ok_or_else(|| AppError::Validation("Bangumi 单册条目缺少标题".into()))?.to_string();
    let cover_url = details.get("images").and_then(|images| images.get("large").or_else(|| images.get("common")))
        .and_then(Value::as_str).map(str::to_string);
    let number = titles.iter().find_map(|title| volume_number(title));
    Ok((title, cover_url, number))
}

async fn related_volume_candidates(pool: &SqlitePool, series_id: &str) -> AppResult<Vec<BookVolumeCandidate>> {
    if !series_id.bytes().all(|byte| byte.is_ascii_digit()) { return Err(AppError::Validation("Bangumi 系列 ID 无效".into())); }
    let key = format!("book-relations:{series_id}");
    let cached: Option<(String, String)> = sqlx::query_as("SELECT response_json, expires_at FROM metadata_cache WHERE provider = 'bangumi_book' AND cache_key = ?")
        .bind(&key).fetch_optional(pool).await?;
    if let Some((body, expires_at)) = &cached {
        if expires_at.as_str() > Utc::now().to_rfc3339().as_str() {
            if let Ok(value) = serde_json::from_str::<Value>(body) {
                return Ok(value.as_array().into_iter().flatten().filter_map(|item| volume_candidate(item, true, false)).collect());
            }
        }
    }
    let response = client()?.get(format!("{API_ROOT}/subjects/{series_id}/subjects")).send().await;
    let result = match response {
        Ok(response) if response.status().is_success() => response.json::<Value>().await
            .map_err(|error| AppError::Network(format!("Bangumi 系列卷册响应无效：{error}"))),
        Ok(response) => Err(AppError::Network(format!("Bangumi 系列卷册读取失败（HTTP {}）", response.status()))),
        Err(error) => Err(AppError::Network(format!("无法读取 Bangumi 系列卷册：{error}"))),
    };
    let (body, stale) = match result {
        Ok(body) if body.is_array() => {
            let now = Utc::now();
            if let Ok((_guard, mut transaction)) = crate::db::begin_write(pool).await {
                let _ = sqlx::query("INSERT INTO metadata_cache (provider, cache_key, response_json, fetched_at, expires_at) VALUES ('bangumi_book', ?, ?, ?, ?) ON CONFLICT(provider, cache_key) DO UPDATE SET response_json = excluded.response_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at")
                    .bind(&key).bind(body.to_string()).bind(now.to_rfc3339()).bind((now + ChronoDuration::days(7)).to_rfc3339()).execute(&mut *transaction).await;
                let _ = transaction.commit().await;
            }
            (body, false)
        }
        Ok(_) => return Err(AppError::Network("Bangumi 系列卷册响应无效".into())),
        Err(error) => cached.and_then(|(body, _)| serde_json::from_str::<Value>(&body).ok().filter(Value::is_array).map(|value| (value, true))).ok_or(error)?,
    };
    Ok(body.as_array().into_iter().flatten().filter_map(|item| volume_candidate(item, true, stale)).collect())
}

pub async fn search_volume_in_state(state: &AppState, work_id: &str, entry_id: &str, query: Option<&str>) -> AppResult<Vec<BookVolumeCandidate>> {
    let entries = crate::bookshelf::entries_in_pool(&state.pool, work_id).await?;
    let entry = entries.iter().find(|entry| entry.id == entry_id).ok_or_else(|| AppError::Validation("卷册已变化，请刷新后重试".into()))?;
    let (kind, title): (String, String) = sqlx::query_as("SELECT type, title FROM works WHERE id = ?").bind(work_id).fetch_one(&state.pool).await?;
    let series_id: Option<String> = sqlx::query_scalar("SELECT external_id FROM work_external_ids WHERE work_id = ? AND provider = 'bangumi'")
        .bind(work_id).fetch_optional(&state.pool).await?;
    let mut candidates = if query.is_none() {
        if let Some(series_id) = series_id.as_deref() { related_volume_candidates(&state.pool, series_id).await? } else { Vec::new() }
    } else { Vec::new() };
    if candidates.is_empty() {
        let search_query = query.map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
            .unwrap_or_else(|| entry.volume_number.map_or_else(|| entry.title.clone(), |number| format!("{title} {number}")));
        let (body, stale) = search_response(&state.pool, &search_query).await?;
        candidates = body.get("data").and_then(Value::as_array).into_iter().flatten()
            .filter(|value| category(value).is_none_or(|found| found == kind))
            .filter_map(|value| volume_candidate(value, false, stale)).collect();
    }
    candidates.sort_by(|left, right| {
        let distance = |candidate: &BookVolumeCandidate| match (entry.volume_number, candidate.volume_number) {
            (Some(expected), Some(actual)) => (expected - actual).abs(),
            (Some(_), None) => f64::MAX,
            _ => 0.0,
        };
        distance(left).total_cmp(&distance(right)).then_with(|| left.volume_number.partial_cmp(&right.volume_number).unwrap_or(std::cmp::Ordering::Equal))
    });
    candidates.truncate(30);
    Ok(candidates)
}

#[tauri::command]
pub async fn search_book_volume_candidates(work_id: String, entry_id: String, query: Option<String>, state: State<'_, AppState>) -> AppResult<Vec<BookVolumeCandidate>> {
    search_volume_in_state(&state, &work_id, &entry_id, query.as_deref()).await
}

pub async fn confirm_volume_in_state(state: &AppState, work_id: &str, entry_id: &str, external_id: &str) -> AppResult<()> {
    let entries = crate::bookshelf::entries_in_pool(&state.pool, work_id).await?;
    let entry = entries.iter().find(|entry| entry.id == entry_id).ok_or_else(|| AppError::Validation("卷册已变化，请刷新后重试".into()))?;
    if entries.iter().any(|other| other.id != entry_id && other.bangumi_id.as_deref() == Some(external_id)) {
        return Err(AppError::Validation("该 Bangumi 单册已关联同作品的另一卷".into()));
    }
    let kind: String = sqlx::query_scalar("SELECT type FROM works WHERE id = ?").bind(work_id).fetch_one(&state.pool).await?;
    let details = fetch_details(external_id).await?;
    let (title, cover_url, number) = validate_volume_details(&details, &kind, entry.volume_number)?;
    let cover_path = if let Some(url) = cover_url.as_deref() {
        let destination = crate::metadata_aggregator::artwork_cache_path(&state.cover_cache_path, &format!("bangumi-volume-{external_id}"), "cover", url);
        if destination.is_file() || crate::metadata_aggregator::cache_cover(url, &destination).await.is_ok() { Some(destination.to_string_lossy().to_string()) } else { None }
    } else { None };
    let (_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let current_kind: Option<String> = sqlx::query_scalar("SELECT type FROM works WHERE id = ?")
        .bind(work_id).fetch_optional(&mut *transaction).await?;
    if current_kind.as_deref() != Some(kind.as_str()) { return Err(AppError::Validation("作品类型已变化，请刷新后重试".into())); }
    let still_linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files WHERE id = ? AND work_id = ?)")
        .bind(entry_id).bind(work_id).fetch_one(&mut *transaction).await?;
    if !still_linked { return Err(AppError::Validation("卷册已变化，请刷新后重试".into())); }
    let used_by: Vec<String> = sqlx::query_scalar("SELECT v.media_file_id FROM book_volume_matches v JOIN media_files m ON m.id = v.media_file_id WHERE m.work_id = ? AND v.external_id = ?")
        .bind(work_id).bind(external_id).fetch_all(&mut *transaction).await?;
    if used_by.iter().any(|id| !entry.media_file_ids.contains(id)) {
        return Err(AppError::Validation("该 Bangumi 单册已关联同作品的另一卷".into()));
    }
    for media_file_id in &entry.media_file_ids {
        sqlx::query("DELETE FROM book_volume_matches WHERE media_file_id = ? AND EXISTS(SELECT 1 FROM media_files WHERE id = ? AND work_id = ?)")
            .bind(media_file_id).bind(media_file_id).bind(work_id).execute(&mut *transaction).await?;
    }
    sqlx::query("INSERT INTO book_volume_matches (media_file_id, external_id, title, volume_number, cover_path, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(entry_id).bind(external_id).bind(title).bind(number).bind(cover_path).bind(Utc::now().to_rfc3339()).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn confirm_book_volume_candidate(work_id: String, entry_id: String, external_id: String, state: State<'_, AppState>) -> AppResult<()> {
    confirm_volume_in_state(&state, &work_id, &entry_id, &external_id).await
}

#[tauri::command]
pub async fn clear_book_volume_candidate(work_id: String, entry_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let entries = crate::bookshelf::entries_in_pool(&state.pool, &work_id).await?;
    let entry = entries.iter().find(|entry| entry.id == entry_id).ok_or_else(|| AppError::Validation("卷册已变化，请刷新后重试".into()))?;
    let (_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    for media_file_id in &entry.media_file_ids {
        sqlx::query("DELETE FROM book_volume_matches WHERE media_file_id = ? AND EXISTS(SELECT 1 FROM media_files WHERE id = ? AND work_id = ?)")
            .bind(media_file_id).bind(media_file_id).bind(&work_id).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_books_are_candidates() {
        let anime = json!({"id": 1, "type": 2, "name": "同名动画"});
        assert!(candidate(&anime, "同名", false).is_none());
        let novel = json!({"id": 2, "type": 1, "name": "小说", "platform": "小说", "series": true});
        let candidate = candidate(&novel, "小说", false).unwrap();
        assert_eq!(candidate.category.as_deref(), Some("novel"));
        assert_eq!(candidate.series, Some(true));
    }

    #[test]
    fn related_subjects_only_offer_single_volumes_and_parse_numbers() {
        let series = json!({"id": 343241, "type": 1, "name": "負けヒロインが多すぎる!", "relation": "书籍"});
        let volume = json!({"id": 495572, "type": 1, "name": "負けヒロインが多すぎる! (7)", "relation": "单行本", "images": {"large": "https://example.test/7.jpg"}});
        let extra = json!({"id": 495573, "type": 1, "name": "SSS", "relation": "番外篇"});
        assert!(volume_candidate(&series, true, false).is_none());
        assert!(volume_candidate(&extra, true, false).is_none());
        let candidate = volume_candidate(&volume, true, false).unwrap();
        assert_eq!(candidate.volume_number, Some(7.0));
        assert!(candidate.linked_to_series);
        assert_eq!(volume_number("第八卷"), Some(8.0));
        assert_eq!(volume_number("負けヒロインが多すぎる! (8.5)"), Some(8.5));
    }

    #[test]
    fn confirmation_rejects_series_and_wrong_volume() {
        let single = json!({"id": 495572, "type": 1, "series": false, "name": "負けヒロインが多すぎる! (7)", "platform": "小说"});
        assert!(validate_volume_details(&single, "novel", Some(7.0)).is_ok());
        assert!(validate_volume_details(&single, "novel", Some(8.0)).is_err());
        assert!(validate_volume_details(&single, "comic", Some(7.0)).is_err());
        let series = json!({"id": 343241, "type": 1, "series": true, "name": "負けヒロインが多すぎる!", "platform": "小说"});
        assert!(validate_volume_details(&series, "novel", Some(7.0)).is_err());
    }
}
