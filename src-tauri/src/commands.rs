use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::explore;
use crate::grouping;
use crate::launcher::{self, TemplateContext};
use crate::media_mapping;
use crate::metadata;
use crate::models::*;
use crate::scanner;
use chrono::Utc;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const WORK_TYPES: &[&str] = &["video", "comic", "novel", "game", "other"];
const WORK_STATUSES: &[&str] = &["planned", "in_progress", "completed", "paused", "dropped"];
const ROOT_KINDS: &[&str] = &["auto", "video", "comic", "novel", "game", "mixed"];

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

fn validate_work(input: &mut WorkInput) -> AppResult<()> {
    input.title = input.title.trim().to_string();
    input.original_title = clean_optional(input.original_title.take());
    input.cover_path = clean_optional(input.cover_path.take());
    if input.title.is_empty() {
        return Err(AppError::Validation("作品标题不能为空".to_string()));
    }
    if !WORK_TYPES.contains(&input.work_type.as_str()) {
        return Err(AppError::Validation("无效的作品类型".to_string()));
    }
    if !WORK_STATUSES.contains(&input.status.as_str()) {
        return Err(AppError::Validation("无效的收藏状态".to_string()));
    }
    if input
        .rating
        .is_some_and(|rating| !(0.0..=10.0).contains(&rating))
    {
        return Err(AppError::Validation("评分必须在 0 到 10 之间".to_string()));
    }
    let mut seen = HashSet::new();
    input.tags = input
        .tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.to_lowercase()))
        .map(str::to_string)
        .collect();
    Ok(())
}

async fn replace_tags(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: &str,
    tags: &[String],
) -> AppResult<()> {
    sqlx::query("DELETE FROM work_tags WHERE work_id = ?")
        .bind(work_id)
        .execute(&mut **transaction)
        .await?;
    for name in tags {
        let existing_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
                .bind(name)
                .fetch_optional(&mut **transaction)
                .await?;
        let tag_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
            .bind(&tag_id)
            .bind(name)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut **transaction)
            .await?;
        sqlx::query("INSERT INTO work_tags (work_id, tag_id, source) VALUES (?, ?, 'manual')")
            .bind(work_id)
            .bind(tag_id)
            .execute(&mut **transaction)
            .await?;
    }
    sqlx::query("INSERT INTO work_field_sources (work_id, field_name, provider, updated_at) VALUES (?, 'tags', 'manual', ?) ON CONFLICT(work_id, field_name) DO UPDATE SET provider = 'manual', updated_at = excluded.updated_at")
        .bind(work_id)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM work_tags)")
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn tags_for_work(pool: &SqlitePool, work_id: &str) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT t.name FROM tags t JOIN work_tags wt ON wt.tag_id = t.id WHERE wt.work_id = ? ORDER BY t.name COLLATE NOCASE",
    )
    .bind(work_id)
    .fetch_all(pool)
    .await?)
}

async fn work_list_items(pool: &SqlitePool) -> AppResult<Vec<WorkListItem>> {
    let works = sqlx::query_as::<_, Work>(
        "SELECT id, title, original_title, type, description, cover_path, banner_path, status, favorite, rating, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at FROM works ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;
    let mut categories = crate::work_category::load(pool, None).await?;
    let mut items = Vec::with_capacity(works.len());
    for work in works {
        let tags = tags_for_work(pool, &work.id).await?;
        let (media_count, missing_count): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN missing = 1 THEN 1 ELSE 0 END), 0) FROM media_files WHERE work_id = ?",
        )
        .bind(&work.id)
        .fetch_one(pool)
        .await?;
        items.push(WorkListItem {
            category: categories.remove(&work.id).unwrap_or_else(|| work.work_type.clone()),
            cover_thumbnail_path: work.cover_path.as_deref().map(Path::new)
                .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("art-v2-")))
                .map(crate::metadata_aggregator::thumbnail_path)
                .filter(|path| path.is_file()).map(|path| path.to_string_lossy().into_owned()),
            work,
            tags,
            media_count,
            missing_count,
        });
    }
    Ok(items)
}

#[tauri::command]
pub async fn list_works(state: State<'_, AppState>) -> AppResult<Vec<WorkListItem>> {
    work_list_items(&state.pool).await
}

#[tauri::command]
pub async fn get_work(id: String, state: State<'_, AppState>) -> AppResult<WorkDetail> {
    // Browsing must not compete with scans for the SQLite write lock.
    let work = sqlx::query_as::<_, Work>(
        "SELECT id, title, original_title, type, description, cover_path, banner_path, status, favorite, rating, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at FROM works WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("作品不存在".to_string()))?;
    let tags = tags_for_work(&state.pool, &id).await?;
    let media_files = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path FROM media_files WHERE work_id = ? ORDER BY parsed_season, parsed_episode_start, file_name COLLATE NOCASE",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    let metadata = sqlx::query_as::<_, MetadataSummary>("SELECT e.provider, e.external_id, w.title, w.original_title, w.metadata_year AS year, w.cover_path AS cover_url, e.updated_at AS fetched_at FROM work_external_ids e JOIN works w ON w.id = e.work_id WHERE e.work_id = ? ORDER BY CASE e.provider WHEN 'bangumi' THEN 0 WHEN 'tmdb' THEN 1 ELSE 2 END, e.updated_at DESC LIMIT 1")
        .bind(&id).fetch_optional(&state.pool).await?;
    let provider_records: Vec<(String, String)> = sqlx::query_as(
        "SELECT provider, response_json FROM metadata_provider_records WHERE work_id = ? ORDER BY CASE provider WHEN 'bangumi' THEN 0 WHEN 'anilist' THEN 1 ELSE 2 END",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    let network_rating = provider_records.into_iter().find_map(|(provider, json)| {
        let record = serde_json::from_str::<WorkMetadata>(&json).ok()?;
        record.score.filter(|score| score.is_finite() && (0.0..=10.0).contains(score))
            .map(|score| (score, provider, record.rating_count))
    });
    let field_locks = sqlx::query_scalar::<_, String>("SELECT field_name FROM work_field_locks WHERE work_id = ? AND locked = 1 ORDER BY field_name")
        .bind(&id).fetch_all(&state.pool).await?;
    let candidates = metadata::candidates_for_work(&state.pool, &id).await?;
    let subtitle_links = sqlx::query_as::<_, SubtitleLink>("SELECT subtitle_media_file_id, video_media_file_id, episode, match_method FROM subtitle_links WHERE work_id = ? ORDER BY episode, subtitle_media_file_id")
        .bind(&id).fetch_all(&state.pool).await?;
    let category = crate::work_category::load(&state.pool, Some(&id)).await?
        .remove(&id).unwrap_or_else(|| work.work_type.clone());
    Ok(WorkDetail {
        category,
        work,
        tags,
        media_files,
        metadata,
        network_score: network_rating.as_ref().map(|(score, _, _)| *score),
        network_score_provider: network_rating.as_ref().map(|(_, provider, _)| provider.clone()),
        network_rating_count: network_rating.map(|(_, _, count)| count),
        field_locks,
        candidates,
        subtitle_links,
    })
}

#[tauri::command]
pub async fn create_work(
    mut input: WorkInput,
    state: State<'_, AppState>,
) -> AppResult<WorkDetail> {
    validate_work(&mut input)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    sqlx::query(
        "INSERT INTO works (id, title, original_title, type, description, cover_path, status, favorite, rating, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.title)
    .bind(&input.original_title)
    .bind(&input.work_type)
    .bind(&input.description)
    .bind(&input.cover_path)
    .bind(&input.status)
    .bind(input.favorite)
    .bind(input.rating)
    .bind(&input.notes)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    replace_tags(&mut transaction, &id, &input.tags).await?;
    transaction.commit().await?;
    get_work(id, state).await
}

async fn create_work_from_media_in_pool(
    pool: &SqlitePool,
    media_file_id: String,
    mut input: WorkInput,
) -> AppResult<String> {
    validate_work(&mut input)?;
    let media_file_ids = grouping::unassigned_group_member_ids(pool, &media_file_id).await?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let media_is_unassigned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM media_files WHERE id = ? AND work_id IS NULL)",
    )
    .bind(&media_file_id)
    .fetch_one(&mut *transaction)
    .await?;
    if !media_is_unassigned {
        return Err(AppError::Validation(
            "该文件不存在或已经关联到其他作品".to_string(),
        ));
    }
    sqlx::query(
        "INSERT INTO works (id, title, original_title, type, description, cover_path, status, favorite, rating, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.title)
    .bind(&input.original_title)
    .bind(&input.work_type)
    .bind(&input.description)
    .bind(&input.cover_path)
    .bind(&input.status)
    .bind(input.favorite)
    .bind(input.rating)
    .bind(&input.notes)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    replace_tags(&mut transaction, &id, &input.tags).await?;
    for member_id in media_file_ids {
        sqlx::query(
            "UPDATE media_files SET work_id = ?, updated_at = ? WHERE id = ? AND work_id IS NULL",
        )
        .bind(&id)
        .bind(&now)
        .bind(member_id)
        .execute(&mut *transaction)
        .await?;
    }
    media_mapping::rebuild_subtitle_links(&mut transaction, &id).await?;
    transaction.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn create_work_from_media(
    media_file_id: String,
    input: WorkInput,
    state: State<'_, AppState>,
) -> AppResult<WorkDetail> {
    let id = create_work_from_media_in_pool(&state.pool, media_file_id, input).await?;
    get_work(id, state).await
}

#[tauri::command]
pub async fn update_work(
    id: String,
    mut input: WorkInput,
    state: State<'_, AppState>,
) -> AppResult<WorkDetail> {
    validate_work(&mut input)?;
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let result = sqlx::query(
        "UPDATE works SET title = ?, original_title = ?, type = ?, description = ?, cover_path = ?, status = ?, favorite = ?, rating = ?, notes = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&input.title)
    .bind(&input.original_title)
    .bind(&input.work_type)
    .bind(&input.description)
    .bind(&input.cover_path)
    .bind(&input.status)
    .bind(input.favorite)
    .bind(input.rating)
    .bind(&input.notes)
    .bind(Utc::now().to_rfc3339())
    .bind(&id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("作品不存在".to_string()));
    }
    replace_tags(&mut transaction, &id, &input.tags).await?;
    transaction.commit().await?;
    get_work(id, state).await
}

#[tauri::command]
pub async fn delete_work(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM works WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("作品不存在".to_string()));
    }
    sqlx::query("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM work_tags)")
        .execute(&state.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_unassigned_media(destination: Option<String>, state: State<'_, AppState>) -> AppResult<Vec<MediaFile>> {
    if destination.as_deref().is_some_and(|value| !matches!(value, "media" | "bookshelf")) {
        return Err(AppError::Validation("无效的待整理目标".into()));
    }
    let mut files = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path FROM media_files WHERE work_id IS NULL ORDER BY parsed_season, parsed_episode_start, file_name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    if let Some(destination) = destination {
        let destinations = grouping::unassigned_file_destinations(&state.pool).await?;
        files.retain(|file| destinations.get(&file.id).is_some_and(|value| value == &destination));
    }
    Ok(files)
}

#[tauri::command]
pub async fn list_unassigned_media_groups(
    state: State<'_, AppState>,
) -> AppResult<Vec<UnassignedMediaGroup>> {
    grouping::list_unassigned_groups(&state.pool).await
}

#[tauri::command]
pub async fn list_recognition_group_members(
    media_file_id: String,
    group_scope: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<RecognitionGroupInfo> {
    let scope = grouping::GroupScope::parse(group_scope.as_deref());
    let context = grouping::recognition_scope_context(&state.pool, &media_file_id, scope)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    Ok(RecognitionGroupInfo {
        scope: context.scope.as_str().to_string(),
        title: context.title,
        folder_path: context.folder_path,
        members: context.members,
        linked_work_id: context.linked_work_id,
        linked_work_title: context.linked_work_title,
    })
}

#[tauri::command]
pub async fn attach_media_files(
    work_id: String,
    media_file_ids: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    attach_unassigned_media_in_pool(&state.pool, &work_id, &media_file_ids).await
}

async fn attach_unassigned_media_in_pool(
    pool: &SqlitePool,
    work_id: &str,
    ids: &[String],
) -> AppResult<()> {
    if ids.is_empty() {
        return Err(AppError::Validation("请选择文件".into()));
    }
    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let undo = crate::recognition_history::begin(&mut transaction, work_id, ids).await?;
    // Start with a write so a concurrent scan cannot invalidate a read snapshot.
    let exists = sqlx::query("UPDATE works SET updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(work_id)
        .execute(&mut *transaction)
        .await?;
    if exists.rows_affected() == 0 {
        return Err(AppError::NotFound("作品不存在".into()));
    }
    for id in ids {
        let result = sqlx::query("UPDATE media_files SET work_id = ?, recognition_status = 'matched', updated_at = ? WHERE id = ? AND (work_id IS NULL OR work_id = ?)")
            .bind(work_id).bind(Utc::now().to_rfc3339()).bind(id).bind(work_id).execute(&mut *transaction).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::Validation(
                "文件已关联其他作品或已不存在，请刷新后重试".into(),
            ));
        }
    }
    media_mapping::rebuild_subtitle_links(&mut transaction, work_id).await?;
    crate::anime_details::rebuild_episode_links(&mut transaction, work_id).await?;
    let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id=?")
        .bind(work_id).fetch_one(&mut *transaction).await?;
    crate::recognition_preferences::learn(&mut transaction, work_id, ids).await?;
    crate::recognition_history::finish(&mut transaction, undo, work_id, &title).await?;
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn attach_media_file(
    work_id: String,
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let work_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(&work_id)
        .fetch_one(&mut *transaction)
        .await?;
    if !work_exists {
        return Err(AppError::NotFound("作品不存在".to_string()));
    }
    let result = sqlx::query("UPDATE media_files SET work_id = ?, updated_at = ? WHERE id = ?")
        .bind(&work_id)
        .bind(Utc::now().to_rfc3339())
        .bind(&media_file_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("媒体文件不存在".to_string()));
    }
    sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
        .bind(&media_file_id)
        .execute(&mut *transaction)
        .await?;
    media_mapping::rebuild_subtitle_links(&mut transaction, &work_id).await?;
    crate::anime_details::rebuild_episode_links(&mut transaction, &work_id).await?;
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn detach_media_file(media_file_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    let work_id: Option<String> =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = ?")
            .bind(&media_file_id)
            .fetch_optional(&mut *transaction)
            .await?
            .flatten();
    let result = sqlx::query("UPDATE media_files SET work_id = NULL, updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(&media_file_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("媒体文件不存在".to_string()));
    }
    sqlx::query("DELETE FROM media_episode_links WHERE media_file_id = ?")
        .bind(&media_file_id)
        .execute(&mut *transaction)
        .await?;
    if let Some(work_id) = work_id {
        media_mapping::rebuild_subtitle_links(&mut transaction, &work_id).await?;
        crate::anime_details::rebuild_episode_links(&mut transaction, &work_id).await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn import_cover(
    source_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<String> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err(AppError::PathNotFound(source));
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp", "avif"].contains(&extension.as_str()) {
        return Err(AppError::Validation(
            "封面必须是 JPG、PNG、WebP 或 AVIF 图片".to_string(),
        ));
    }
    let metadata = tokio::fs::metadata(&source).await?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err(AppError::Validation("封面文件不能超过 20 MB".to_string()));
    }
    let destination = state
        .cover_cache_path
        .join(format!("{}.{}", Uuid::new_v4(), extension));
    tokio::fs::copy(&source, &destination).await?;
    db::allow_cover_file(&app, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_library_roots(state: State<'_, AppState>) -> AppResult<Vec<LibraryRoot>> {
    Ok(sqlx::query_as::<_, LibraryRoot>(
        "SELECT id, path, kind, destination, enabled, last_scanned_at, created_at, updated_at, source_type, availability, (SELECT name FROM remote_sources WHERE remote_sources.id=library_roots.id) AS display_name FROM library_roots ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?)
}

#[tauri::command]
pub async fn add_library_root(
    mut input: LibraryRootInput,
    state: State<'_, AppState>,
) -> AppResult<LibraryRoot> {
    if !ROOT_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Validation("无效的目录类型".to_string()));
    }
    let destination = input.destination.unwrap_or_else(|| {
        if matches!(input.kind.as_str(), "comic" | "novel") { "bookshelf" } else { "media" }.into()
    });
    if !matches!(destination.as_str(), "media" | "bookshelf") {
        return Err(AppError::Validation("请选择媒体库或书架".into()));
    }
    let raw_path = PathBuf::from(input.path.trim());
    input.path =
        tauri::async_runtime::spawn_blocking(move || scanner::normalize_existing_path(&raw_path))
            .await
            .map_err(|error| AppError::System(format!("目录检查失败：{error}")))??;
    if !Path::new(&input.path).is_dir() {
        return Err(AppError::Validation("请选择一个文件夹".to_string()));
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO library_roots (id, path, kind, destination, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.path)
    .bind(&input.kind)
    .bind(&destination)
    .bind(input.enabled)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;
    Ok(LibraryRoot {
        id,
        path: input.path,
        kind: input.kind,
        destination,
        enabled: input.enabled,
        last_scanned_at: None,
        created_at: now.clone(),
        updated_at: now,
        source_type: "local".into(),
        availability: "unknown".into(),
        display_name: None,
    })
}

#[tauri::command]
pub async fn update_library_root(
    id: String,
    kind: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if !ROOT_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Validation("无效的目录类型".to_string()));
    }
    let result =
        sqlx::query("UPDATE library_roots SET kind = ?, enabled = ?, updated_at = ? WHERE id = ?")
            .bind(kind)
            .bind(enabled)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&state.pool)
            .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("扫描目录不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_root_destination(id: String, destination: String, state: State<'_, AppState>) -> AppResult<()> {
    set_root_destination_in_pool(&state.pool, &id, &destination).await
}

pub async fn set_root_destination_in_pool(pool: &SqlitePool, id: &str, destination: &str) -> AppResult<()> {
    if !matches!(destination, "media" | "bookshelf") {
        return Err(AppError::Validation("请选择媒体库或书架".into()));
    }
    let result = sqlx::query("UPDATE library_roots SET destination = ?, updated_at = ? WHERE id = ?")
        .bind(destination).bind(Utc::now().to_rfc3339()).bind(id)
        .execute(pool).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("资源目录不存在".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_library_root(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let remote: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM remote_sources WHERE id = ?)")
            .bind(&id)
            .fetch_one(&state.pool)
            .await?;
    if remote {
        return Err(AppError::Validation(
            "WebDAV 来源请使用停用，以保留文件索引和离线缓存".into(),
        ));
    }
    let result = sqlx::query("DELETE FROM library_roots WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("扫描目录不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_library_root(id: String, state: State<'_, AppState>) -> AppResult<ScanResult> {
    scanner::scan_library_root(&state.pool, &id).await
}

#[tauri::command]
pub async fn list_scan_jobs(state: State<'_, AppState>) -> AppResult<Vec<ScanResult>> {
    let rows = sqlx::query_as::<_, ScanJob>(
        "SELECT id, library_root_id, status, discovered_count, added_count, updated_count, missing_count, errors_json, started_at, finished_at FROM scan_jobs ORDER BY started_at DESC LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await?;
    rows.into_iter()
        .map(|job| {
            let errors = serde_json::from_str(&job.errors_raw)?;
            Ok(ScanResult { job, errors })
        })
        .collect()
}

async fn list_tools(pool: &SqlitePool) -> AppResult<Vec<ExternalTool>> {
    let rows = sqlx::query_as::<_, ExternalToolRow>(
        "SELECT id, name, executable_path, supported_media_types, arguments_template, working_directory, is_default, created_at, updated_at FROM external_tools ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| row.try_into().map_err(AppError::from))
        .collect()
}

fn validate_tool(input: &mut ExternalToolInput) -> AppResult<()> {
    input.name = input.name.trim().to_string();
    input.executable_path = input.executable_path.trim().to_string();
    input.working_directory = clean_optional(input.working_directory.take());
    input
        .supported_media_types
        .retain(|value| WORK_TYPES.contains(&value.as_str()));
    input.supported_media_types.sort();
    input.supported_media_types.dedup();
    if input.name.is_empty() {
        return Err(AppError::Validation("工具名称不能为空".to_string()));
    }
    if !Path::new(&input.executable_path).is_file() {
        return Err(AppError::PathNotFound(PathBuf::from(
            &input.executable_path,
        )));
    }
    if let Some(directory) = &input.working_directory {
        if !Path::new(directory).is_dir() {
            return Err(AppError::Validation("工作目录不存在".to_string()));
        }
    }
    if input.supported_media_types.is_empty() {
        return Err(AppError::Validation("请至少选择一种媒体类型".to_string()));
    }
    let context = TemplateContext {
        file: "file",
        folder: "folder",
        title: "title",
    };
    launcher::expand_arguments(&input.arguments_template, &context)?;
    Ok(())
}

async fn clear_overlapping_defaults(
    transaction: &mut Transaction<'_, Sqlite>,
    media_types: &[String],
    except_id: Option<&str>,
) -> AppResult<()> {
    if media_types.is_empty() {
        return Ok(());
    }
    let rows = sqlx::query_as::<_, ExternalToolRow>(
        "SELECT id, name, executable_path, supported_media_types, arguments_template, working_directory, is_default, created_at, updated_at FROM external_tools WHERE is_default = 1",
    )
    .fetch_all(&mut **transaction)
    .await?;
    for row in rows {
        if except_id == Some(row.id.as_str()) {
            continue;
        }
        let supported: Vec<String> = serde_json::from_str(&row.supported_media_types)?;
        if supported.iter().any(|value| media_types.contains(value)) {
            sqlx::query("UPDATE external_tools SET is_default = 0, updated_at = ? WHERE id = ?")
                .bind(Utc::now().to_rfc3339())
                .bind(row.id)
                .execute(&mut **transaction)
                .await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_external_tools(state: State<'_, AppState>) -> AppResult<Vec<ExternalTool>> {
    list_tools(&state.pool).await
}

#[tauri::command]
pub async fn create_external_tool(
    mut input: ExternalToolInput,
    state: State<'_, AppState>,
) -> AppResult<ExternalTool> {
    validate_tool(&mut input)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    if input.is_default {
        clear_overlapping_defaults(&mut transaction, &input.supported_media_types, None).await?;
    }
    let supported = serde_json::to_string(&input.supported_media_types)?;
    sqlx::query(
        "INSERT INTO external_tools (id, name, executable_path, supported_media_types, arguments_template, working_directory, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.executable_path)
    .bind(&supported)
    .bind(&input.arguments_template)
    .bind(&input.working_directory)
    .bind(input.is_default)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(ExternalTool {
        id,
        name: input.name,
        executable_path: input.executable_path,
        supported_media_types: input.supported_media_types,
        arguments_template: input.arguments_template,
        working_directory: input.working_directory,
        is_default: input.is_default,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn update_external_tool(
    id: String,
    mut input: ExternalToolInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    validate_tool(&mut input)?;
    let (_write_guard, mut transaction) = crate::db::begin_write(&state.pool).await?;
    if input.is_default {
        clear_overlapping_defaults(&mut transaction, &input.supported_media_types, Some(&id))
            .await?;
    }
    let result = sqlx::query(
        "UPDATE external_tools SET name = ?, executable_path = ?, supported_media_types = ?, arguments_template = ?, working_directory = ?, is_default = ?, updated_at = ? WHERE id = ?",
    )
    .bind(input.name)
    .bind(input.executable_path)
    .bind(serde_json::to_string(&input.supported_media_types)?)
    .bind(input.arguments_template)
    .bind(input.working_directory)
    .bind(input.is_default)
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("外部工具不存在".to_string()));
    }
    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_external_tool(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM external_tools WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("外部工具不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn detect_external_tools(state: State<'_, AppState>) -> AppResult<Vec<ExternalTool>> {
    let mut candidates: Vec<(&str, PathBuf)> = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let root = PathBuf::from(program_files);
        candidates.extend([
            ("VLC media player", root.join("VideoLAN/VLC/vlc.exe")),
            ("mpv", root.join("mpv/mpv.exe")),
            ("PotPlayer", root.join("DAUM/PotPlayer/PotPlayerMini64.exe")),
            ("MPC-BE", root.join("MPC-BE x64/mpc-be64.exe")),
        ]);
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        let root = PathBuf::from(program_files_x86);
        candidates.extend([
            ("VLC media player", root.join("VideoLAN/VLC/vlc.exe")),
            ("PotPlayer", root.join("DAUM/PotPlayer/PotPlayerMini.exe")),
        ]);
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push((
            "mpv",
            PathBuf::from(local_app_data).join("Programs/mpv/mpv.exe"),
        ));
    }

    for (name, path) in candidates.into_iter().filter(|(_, path)| path.is_file()) {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR IGNORE INTO external_tools (id, name, executable_path, supported_media_types, arguments_template, working_directory, is_default, created_at, updated_at) VALUES (?, ?, ?, '[\"video\"]', '{file}', NULL, 0, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(name)
        .bind(path.to_string_lossy().to_string())
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await?;
    }
    list_tools(&state.pool).await
}

#[tauri::command]
pub async fn test_external_tool(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let path: String =
        sqlx::query_scalar("SELECT executable_path FROM external_tools WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound("外部工具不存在".to_string()))?;
    tauri::async_runtime::spawn_blocking(move || launcher::launch_executable(&path, &[], None))
        .await
        .map_err(|error| AppError::System(format!("工具测试任务失败：{error}")))?
}

#[tauri::command]
pub async fn launch_media(
    media_file_id: String,
    tool_id: Option<String>,
    use_system: bool,
    restart: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let media = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at FROM media_files WHERE id = ?",
    )
    .bind(media_file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    let remote = media.path.starts_with("webdav://");
    if !remote && (media.missing || !Path::new(&media.path).exists()) {
        return Err(AppError::PathNotFound(PathBuf::from(media.path)));
    }
    let title: String = if let Some(work_id) = &media.work_id {
        sqlx::query_scalar("SELECT title FROM works WHERE id = ?")
            .bind(work_id)
            .fetch_optional(&state.pool)
            .await?
            .unwrap_or_else(|| media.file_name.clone())
    } else {
        media.file_name.clone()
    };

    let selected_tool = if let Some(id) = tool_id {
        let row = sqlx::query_as::<_, ExternalToolRow>(
            "SELECT id, name, executable_path, supported_media_types, arguments_template, working_directory, is_default, created_at, updated_at FROM external_tools WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("外部工具不存在".to_string()))?;
        Some(ExternalTool::try_from(row)?)
    } else if !use_system {
        list_tools(&state.pool)
            .await?
            .into_iter()
            .find(|tool| tool.is_default && tool.supported_media_types.contains(&media.media_type))
    } else {
        None
    };

    let supports_stream = selected_tool.as_ref().is_some_and(|tool| {
        let name = Path::new(&tool.executable_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_lowercase();
        [
            "mpv",
            "vlc",
            "potplayermini64",
            "potplayermini",
            "potplayer64",
            "potplayer",
            "mpc-be64",
            "mpc-be",
            "mpc-hc64",
            "mpc-hc",
        ]
        .contains(&name.as_str())
    });
    let path = if remote {
        crate::remote_transfer::open_path(
            &state,
            &media.id,
            media.media_type == "video" && supports_stream,
        )
        .await?
    } else {
        media.path.clone()
    };
    let tracked = media.media_type == "video" && selected_tool.as_ref().is_some_and(|tool| crate::playback::is_potplayer(&tool.executable_path));
    let seek = if tracked { crate::playback::resume_position(&state.pool, &media.id, restart.unwrap_or(false)).await? } else { None };
    let pool = state.pool.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(tool) = selected_tool {
            let path = launcher::shell_compatible_path(&path);
            let folder = launcher::parent_folder(&path);
            let context = TemplateContext {
                file: &path,
                folder: &folder,
                title: &title,
            };
            let arguments = launcher::expand_arguments(&tool.arguments_template, &context)?;
            if tracked {
                return crate::playback::launch(pool, media.id, tool.id, &tool.executable_path, arguments, tool.working_directory.as_deref(), path, seek).map(|_| ());
            }
            launcher::launch_executable(
                &tool.executable_path,
                &arguments,
                tool.working_directory.as_deref(),
            )
        } else if media.media_type == "game" && !use_system {
            launcher::launch_game(&path)
        } else {
            launcher::open_with_system(&path)
        }
    })
    .await
    .map_err(|error| AppError::System(format!("启动任务失败：{error}")))?
}

#[tauri::command]
pub async fn open_media_directory(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut path: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id = ?")
        .bind(&media_file_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    if path.starts_with("webdav://") {
        path = crate::remote_transfer::cached_path(&state, &media_file_id)
            .await?
            .ok_or_else(|| AppError::Validation("远程文件尚未下载，请先缓存或保留离线".into()))?
            .to_string_lossy()
            .into();
    }
    tauri::async_runtime::spawn_blocking(move || launcher::open_directory(&path))
        .await
        .map_err(|error| AppError::System(format!("打开目录任务失败：{error}")))?
}

#[tauri::command]
pub async fn get_dashboard(state: State<'_, AppState>) -> AppResult<Dashboard> {
    let items = work_list_items(&state.pool).await?;
    let mut dashboard = Dashboard {
        total_works: i64::try_from(items.len()).unwrap_or(i64::MAX),
        ..Dashboard::default()
    };
    for item in &items {
        match item.work.work_type.as_str() {
            "video" => dashboard.video_count += 1,
            "comic" => dashboard.comic_count += 1,
            "novel" => dashboard.novel_count += 1,
            "game" => dashboard.game_count += 1,
            _ => dashboard.other_count += 1,
        }
        if item.work.favorite {
            dashboard.favorite_count += 1;
        }
        dashboard.missing_file_count += item.missing_count;
    }
    dashboard.recent_works = items.iter().take(6).cloned().collect();
    dashboard.favorite_works = items
        .iter()
        .filter(|item| item.work.favorite)
        .take(6)
        .cloned()
        .collect();
    let last_job = sqlx::query_as::<_, ScanJob>(
        "SELECT id, library_root_id, status, discovered_count, added_count, updated_count, missing_count, errors_json, started_at, finished_at FROM scan_jobs ORDER BY started_at DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?;
    dashboard.last_scan = last_job
        .map(|job| {
            let errors = serde_json::from_str(&job.errors_raw)?;
            Ok::<_, AppError>(ScanResult { job, errors })
        })
        .transpose()?;
    Ok(dashboard)
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        database_path: state.database_path.to_string_lossy().to_string(),
        cover_cache_path: state.cover_cache_path.to_string_lossy().to_string(),
        data_directory: state.data_directory.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn open_data_directory(state: State<'_, AppState>) -> AppResult<()> {
    let path = state.data_directory.to_string_lossy().to_string();
    tauri::async_runtime::spawn_blocking(move || launcher::open_directory(&path))
        .await
        .map_err(|error| AppError::System(format!("打开数据目录任务失败：{error}")))?
}

#[tauri::command]
pub async fn get_setting(key: String, state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&state.pool)
            .await?,
    )
}

#[tauri::command]
pub async fn recognize_media_file(
    media_file_id: String,
    query: Option<String>,
    kind: Option<String>,
    season: Option<i64>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<RecognitionResult> {
    let result = match kind.as_deref().unwrap_or("anime") {
        "anime" => metadata::recognize_media(&state, &media_file_id, query).await?,
        kind => crate::film_tv::recognize(&state, &media_file_id, query, crate::film_tv::Kind::parse(kind)?, season).await?,
    };
    if result.status == "matched" {
        allow_media_work_artwork(&app, &state.pool, &media_file_id).await?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn recognize_unmatched_media(
    kind: Option<String>,
    media_file_ids: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<RecognitionSummary> {
    let result = match kind.as_deref().unwrap_or("anime") {
        "anime" => metadata::recognize_batch(&state).await?,
        kind => crate::film_tv::batch(&state, crate::film_tv::Kind::parse(kind)?, &media_file_ids.unwrap_or_default()).await?,
    };
    db::allow_cached_images(&app, &state.cover_cache_path)?;
    Ok(result)
}

async fn allow_media_work_artwork(
    app: &AppHandle,
    pool: &SqlitePool,
    media_file_id: &str,
) -> AppResult<()> {
    let paths: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT w.cover_path, w.banner_path FROM works w JOIN media_files m ON m.work_id = w.id WHERE m.id = ?",
    )
    .bind(media_file_id)
    .fetch_optional(pool)
    .await?;
    if let Some(paths) = paths {
        for path in [paths.0, paths.1].into_iter().flatten() {
            db::allow_cover_file(app, Path::new(&path))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_match_candidates(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<MatchCandidate>> {
    metadata::candidates_for_media(&state.pool, &media_file_id).await
}

#[tauri::command]
pub async fn confirm_match_candidate(
    media_file_id: String,
    candidate_id: String,
    selected_media_ids: Option<Vec<String>>,
    group_scope: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<String> {
    let json: String = sqlx::query_scalar("SELECT metadata_json FROM match_candidates WHERE id = ? AND media_file_id = ?")
        .bind(&candidate_id).bind(&media_file_id).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("候选作品不存在或已失效".into()))?;
    let candidate: WorkMetadata = serde_json::from_str(&json)?;
    let work_id = match selected_media_ids {
        Some(ids) => metadata::confirm_candidate_local_selected(&state, &media_file_id, &candidate_id, &ids, grouping::GroupScope::parse(group_scope.as_deref())).await?,
        None => metadata::confirm_candidate_local(&state, &media_file_id, &candidate_id).await?,
    };
    let artwork_paths: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT cover_path, banner_path FROM works WHERE id = ?")
            .bind(&work_id)
            .fetch_one(&state.pool)
            .await?;
    for path in [artwork_paths.0, artwork_paths.1].into_iter().flatten() {
        db::allow_cover_file(&app, Path::new(&path))?;
    }
    let state = state.inner().clone();
    let target = work_id.clone();
    tauri::async_runtime::spawn(async move {
        static ENRICHMENT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
        let Ok(_permit) = ENRICHMENT.acquire().await else { return; };
        match metadata::enrich_confirmed_work(&state, &target, candidate).await {
            Ok(paths) => {
                for path in paths { let _ = db::allow_cover_file(&app, Path::new(&path)); }
                let _ = app.emit("work-metadata-updated", &target);
            }
            Err(error) => { eprintln!("作品补充资料更新失败：{error}"); let _ = app.emit("work-metadata-updated", &target); }
        }
    });
    Ok(work_id)
}

#[tauri::command]
pub async fn cancel_match_candidates(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    metadata::cancel_candidates(&state.pool, &media_file_id).await
}

#[tauri::command]
pub async fn list_recognition_history(work_id: Option<String>, state: State<'_, AppState>) -> AppResult<Vec<crate::recognition_history::HistoryEntry>> {
    match work_id {
        Some(work_id) => crate::recognition_history::list_for_work(&state.pool, &work_id).await,
        None => crate::recognition_history::list(&state.pool).await,
    }
}

#[tauri::command]
pub async fn undo_recognition(id: String, state: State<'_, AppState>) -> AppResult<()> {
    crate::recognition_history::undo(&state.pool, &id).await
}

#[tauri::command]
pub async fn set_work_field_lock(
    work_id: String,
    field: String,
    locked: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    metadata::set_field_lock(&state.pool, &work_id, &field, locked).await
}

#[tauri::command]
pub async fn set_setting(key: String, value: String, state: State<'_, AppState>) -> AppResult<()> {
    let allowed = ["theme", "scan.include_hidden", "metadata.tmdb_read_token"];
    if !allowed.contains(&key.as_str()) {
        return Err(AppError::Validation("不支持的设置项".to_string()));
    }
    if key == "metadata.tmdb_read_token" && value.chars().count() > 512 {
        return Err(AppError::Validation(
            "TMDB Read Access Token 长度无效".to_string(),
        ));
    }
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(Utc::now().to_rfc3339())
    .execute(&state.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_explore_overview(
    year: Option<i32>,
    month: Option<u32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ExploreOverview> {
    let mut result = explore::overview(&state.pool, year, month).await?;
    explore::prepare_cover_cache(&app, &state, &mut result.seasonal).await;
    explore::prepare_cover_cache(&app, &state, &mut result.trending).await;
    Ok(result)
}

#[tauri::command]
pub async fn search_explore_subjects(
    query: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<ExploreSubject>> {
    let mut result = explore::search(&state.pool, &query).await?;
    explore::prepare_cover_cache(&app, &state, &mut result).await;
    Ok(result)
}

#[tauri::command]
pub async fn get_explore_subject(
    external_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ExploreSubject> {
    let mut result = explore::subject(&state.pool, &external_id).await?;
    explore::prepare_cover_cache(&app, &state, std::slice::from_mut(&mut result)).await;
    Ok(result)
}

#[tauri::command]
pub async fn save_explore_subject(
    input: ExploreSaveInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    explore::save_subject(&app, &state, input).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_discovery_list(
    category: String,
    sort: String,
    tags: Vec<String>,
    year: Option<i32>,
    month: Option<u32>,
    page: u32,
    page_size: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<ExploreSubject>> {
    let mut result = explore::discovery_list(
        &state.pool,
        &category,
        &sort,
        &tags,
        year,
        month,
        page,
        page_size,
    )
    .await?;
    explore::prepare_cover_cache(&app, &state, &mut result).await;
    Ok(result)
}

#[tauri::command]
pub async fn get_weekly_calendar(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<WeeklyCalendar> {
    let mut result = explore::weekly_calendar(&state.pool).await?;
    for day in &mut result.days {
        explore::prepare_cover_cache(&app, &state, &mut day.items).await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn check_in_local_library(
    bangumi_id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    explore::check_in_local_library(&state.pool, &bangumi_id).await
}

#[tauri::command]
pub async fn get_metadata_provider_statuses(
    state: State<'_, AppState>,
) -> AppResult<Vec<MetadataProviderStatus>> {
    crate::metadata_aggregator::provider_statuses(&state.pool).await
}

#[tauri::command]
pub async fn list_anime_episodes(
    work_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<AnimeEpisodeMetadata>> {
    crate::metadata_aggregator::episodes_for_work(&state.pool, &work_id).await
}

#[tauri::command]
pub async fn get_anime_work_structure(
    work_id: String,
    state: State<'_, AppState>,
) -> AppResult<AnimeWorkStructure> {
    crate::anime_details::work_structure(&state.pool, &work_id).await
}

#[tauri::command]
pub async fn refresh_work_metadata(
    work_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AnimeWorkStructure> {
    crate::anime_details::refresh_work_metadata(&state, &app, &work_id).await
}

#[tauri::command]
pub async fn set_media_episode(
    media_file_id: String,
    episode_external_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::anime_details::set_episode_link(
        &state.pool,
        &media_file_id,
        episode_external_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn get_media_thumbnail(
    media_file_id: String,
    force: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    crate::anime_details::media_thumbnail(&state, &app, &media_file_id, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn get_anime_ranking(
    page: u32,
    page_size: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<ExploreSubject>> {
    let mut result = explore::anime_ranking(&state.pool, page, page_size).await?;
    explore::prepare_cover_cache(&app, &state, &mut result).await;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn migrations_create_expected_tables_and_constraints() {
        let pool = db::test_pool().await.expect("create test database");
        let table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('works', 'media_files', 'library_roots', 'external_tools', 'tags', 'work_tags', 'scan_jobs', 'app_settings')",
        )
        .fetch_one(&pool)
        .await
        .expect("query tables");
        assert_eq!(table_count, 8);
        let subtitle_links_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subtitle_links')",
        )
        .fetch_one(&pool)
        .await
        .expect("query subtitle links table");
        assert!(subtitle_links_exists);
        let metadata_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('metadata_provider_records', 'anime_episodes')",
        )
        .fetch_one(&pool)
        .await
        .expect("query metadata aggregation tables");
        assert_eq!(metadata_tables, 2);
        let banner_column_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('works') WHERE name = 'banner_path')",
        )
        .fetch_one(&pool)
        .await
        .expect("query banner_path column");
        assert!(banner_column_exists);
        let anime_structure_ready: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_episode_links') AND EXISTS(SELECT 1 FROM pragma_table_info('media_files') WHERE name = 'content_fingerprint') AND EXISTS(SELECT 1 FROM pragma_table_info('media_files') WHERE name = 'thumbnail_path') AND EXISTS(SELECT 1 FROM pragma_table_info('work_tags') WHERE name = 'source')",
        )
        .fetch_one(&pool)
        .await
        .expect("query anime structure migration");
        assert!(anime_structure_ready);

        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('1', '测试', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert valid work");
        let invalid = sqlx::query("INSERT INTO works (id, title, type, rating, created_at, updated_at) VALUES ('2', '错误评分', 'video', 11, ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await;
        assert!(invalid.is_err());
    }

    #[tokio::test]
    async fn work_list_serializes_cached_banner_path() {
        let pool = db::test_pool().await.expect("create test database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, banner_path, created_at, updated_at) VALUES ('banner-work', '横版背景作品', 'video', 'C:\\cache\\banner.jpg', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert work with banner");

        let items = work_list_items(&pool).await.expect("list works");
        let value = serde_json::to_value(&items[0]).expect("serialize work list item");
        assert_eq!(value["bannerPath"], "C:\\cache\\banner.jpg");
    }

    #[tokio::test]
    async fn attaches_batch_to_existing_work_atomically_without_overwriting_records() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works (id,title,type,status,notes,created_at,updated_at) VALUES ('w','已有作品','video','completed','保留笔记','now','now'),('other','其他作品','video','planned','','now','now')").execute(&pool).await.unwrap();
        for (id, owner) in [("a", None), ("b", None), ("owned", Some("other"))] {
            sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES (?,?,?,'01.mkv','mkv','video','now','now')")
                .bind(id).bind(owner).bind(format!(r"\\?\UNC\server\Anime\{id}\01.mkv")).execute(&pool).await.unwrap();
        }
        let error =
            attach_unassigned_media_in_pool(&pool, "w", &["a".into(), "owned".into()]).await;
        assert!(error.is_err());
        let owner: Option<String> =
            sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            owner.is_none(),
            "failed batches must roll back earlier files"
        );
        attach_unassigned_media_in_pool(&pool, "w", &["a".into(), "b".into()])
            .await
            .unwrap();
        let records = crate::recognition_history::list(&pool).await.unwrap();
        let record = serde_json::to_value(&records[0]).unwrap();
        assert_eq!(record["fileCount"], 2);
        crate::recognition_history::undo(&pool, record["id"].as_str().unwrap()).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE work_id='w'").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        attach_unassigned_media_in_pool(&pool, "w", &["a".into(), "b".into()]).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,title,description,fetched_at) VALUES ('w','bangumi','e1',1,1,'第一集','','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES ('a','w','bangumi','e1','manual',1,'now')").execute(&pool).await.unwrap();
        attach_unassigned_media_in_pool(&pool, "w", &["a".into(), "b".into()])
            .await
            .unwrap();
        let retained: (String, String) =
            sqlx::query_as("SELECT status,notes FROM works WHERE id='w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(retained, ("completed".into(), "保留笔记".into()));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE work_id='w'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
        let method: String = sqlx::query_scalar(
            "SELECT match_method FROM media_episode_links WHERE media_file_id='a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(method, "manual");
        assert!(
            attach_unassigned_media_in_pool(&pool, "missing", &["b".into()])
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn creates_work_and_associates_unassigned_media_atomically() {
        let pool = db::test_pool().await.expect("create test database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO media_files (id, path, file_name, extension, media_type, created_at, updated_at) VALUES ('media', 'C:\\Anime\\episode01.mkv', 'episode01.mkv', 'mkv', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert unassigned media");

        let work_id = create_work_from_media_in_pool(
            &pool,
            "media".to_string(),
            WorkInput {
                title: "第一话".to_string(),
                original_title: None,
                work_type: "video".to_string(),
                description: String::new(),
                cover_path: None,
                status: "planned".to_string(),
                favorite: false,
                rating: None,
                tags: vec!["待整理".to_string()],
                notes: String::new(),
            },
        )
        .await
        .expect("create work from media");

        let associated_work_id: String =
            sqlx::query_scalar("SELECT work_id FROM media_files WHERE id = 'media'")
                .fetch_one(&pool)
                .await
                .expect("read media association");
        let work_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM works WHERE id = ?")
            .bind(&work_id)
            .fetch_one(&pool)
            .await
            .expect("read work");
        assert_eq!(associated_work_id, work_id);
        assert_eq!(work_count, 1);
    }

    #[tokio::test]
    async fn creating_work_from_group_associates_nested_sibling_files() {
        let pool = db::test_pool().await.expect("create test database");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', 'C:\\Anime', 'video', 1, ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("insert root");
        for (id, path, name) in [
            ("episode-1", "C:\\Anime\\Work A\\Season 1\\01.mkv", "01.mkv"),
            ("episode-2", "C:\\Anime\\Work A\\Season 1\\02.mkv", "02.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, created_at, updated_at) VALUES (?, 'root', ?, ?, 'mkv', 'video', ?, ?)")
                .bind(id).bind(path).bind(name).bind(&now).bind(&now).execute(&pool).await.expect("insert media");
        }
        let work_id = create_work_from_media_in_pool(
            &pool,
            "episode-1".to_string(),
            WorkInput {
                title: "Work A".to_string(),
                original_title: None,
                work_type: "video".to_string(),
                description: String::new(),
                cover_path: None,
                status: "planned".to_string(),
                favorite: false,
                rating: None,
                tags: Vec::new(),
                notes: String::new(),
            },
        )
        .await
        .expect("create grouped work");
        let associated: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE work_id = ?")
                .bind(work_id)
                .fetch_one(&pool)
                .await
                .expect("count associated files");
        assert_eq!(associated, 2);
    }
}
