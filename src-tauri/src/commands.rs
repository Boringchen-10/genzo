use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::grouping;
use crate::launcher::{self, TemplateContext};
use crate::metadata;
use crate::models::*;
use crate::scanner;
use chrono::Utc;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;
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
        sqlx::query("INSERT INTO work_tags (work_id, tag_id) VALUES (?, ?)")
            .bind(work_id)
            .bind(tag_id)
            .execute(&mut **transaction)
            .await?;
    }
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
        "SELECT id, title, original_title, type, description, cover_path, status, favorite, rating, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at FROM works ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;
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
    let work = sqlx::query_as::<_, Work>(
        "SELECT id, title, original_title, type, description, cover_path, status, favorite, rating, notes, created_at, updated_at, metadata_status, metadata_year, last_recognized_at FROM works WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("作品不存在".to_string()))?;
    let tags = tags_for_work(&state.pool, &id).await?;
    let media_files = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error FROM media_files WHERE work_id = ? ORDER BY file_name COLLATE NOCASE",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    let metadata = sqlx::query_as::<_, MetadataSummary>("SELECT e.provider, e.external_id, w.title, w.original_title, w.metadata_year AS year, w.cover_path AS cover_url, e.updated_at AS fetched_at FROM work_external_ids e JOIN works w ON w.id = e.work_id WHERE e.work_id = ? ORDER BY e.updated_at DESC LIMIT 1")
        .bind(&id).fetch_optional(&state.pool).await?;
    let field_locks = sqlx::query_scalar::<_, String>("SELECT field_name FROM work_field_locks WHERE work_id = ? AND locked = 1 ORDER BY field_name")
        .bind(&id).fetch_all(&state.pool).await?;
    let candidates = metadata::candidates_for_work(&state.pool, &id).await?;
    Ok(WorkDetail {
        work,
        tags,
        media_files,
        metadata,
        field_locks,
        candidates,
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
    let mut transaction = state.pool.begin().await?;
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
    let mut transaction = pool.begin().await?;
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
    let mut transaction = state.pool.begin().await?;
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
pub async fn list_unassigned_media(state: State<'_, AppState>) -> AppResult<Vec<MediaFile>> {
    Ok(sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error FROM media_files WHERE work_id IS NULL ORDER BY file_name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?)
}

#[tauri::command]
pub async fn list_unassigned_media_groups(
    state: State<'_, AppState>,
) -> AppResult<Vec<UnassignedMediaGroup>> {
    grouping::list_unassigned_groups(&state.pool).await
}

#[tauri::command]
pub async fn attach_media_file(
    work_id: String,
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let work_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id = ?)")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;
    if !work_exists {
        return Err(AppError::NotFound("作品不存在".to_string()));
    }
    let result = sqlx::query("UPDATE media_files SET work_id = ?, updated_at = ? WHERE id = ?")
        .bind(work_id)
        .bind(Utc::now().to_rfc3339())
        .bind(media_file_id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("媒体文件不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn detach_media_file(media_file_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let result = sqlx::query("UPDATE media_files SET work_id = NULL, updated_at = ? WHERE id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(media_file_id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("媒体文件不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn import_cover(source_path: String, state: State<'_, AppState>) -> AppResult<String> {
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
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_library_roots(state: State<'_, AppState>) -> AppResult<Vec<LibraryRoot>> {
    Ok(sqlx::query_as::<_, LibraryRoot>(
        "SELECT id, path, kind, enabled, last_scanned_at, created_at, updated_at FROM library_roots ORDER BY created_at DESC",
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
        "INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.path)
    .bind(&input.kind)
    .bind(input.enabled)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;
    Ok(LibraryRoot {
        id,
        path: input.path,
        kind: input.kind,
        enabled: input.enabled,
        last_scanned_at: None,
        created_at: now.clone(),
        updated_at: now,
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
pub async fn delete_library_root(id: String, state: State<'_, AppState>) -> AppResult<()> {
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
    let mut transaction = state.pool.begin().await?;
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
    let mut transaction = state.pool.begin().await?;
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
    state: State<'_, AppState>,
) -> AppResult<()> {
    let media = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at FROM media_files WHERE id = ?",
    )
    .bind(media_file_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
    if media.missing || !Path::new(&media.path).exists() {
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

    let path = media.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(tool) = selected_tool {
            let folder = launcher::parent_folder(&path);
            let context = TemplateContext {
                file: &path,
                folder: &folder,
                title: &title,
            };
            let arguments = launcher::expand_arguments(&tool.arguments_template, &context)?;
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
    let path: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id = ?")
        .bind(media_file_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("媒体文件不存在".to_string()))?;
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
    state: State<'_, AppState>,
) -> AppResult<RecognitionResult> {
    metadata::recognize_media(&state, &media_file_id, query).await
}

#[tauri::command]
pub async fn recognize_unmatched_media(
    state: State<'_, AppState>,
) -> AppResult<RecognitionSummary> {
    metadata::recognize_batch(&state).await
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
    state: State<'_, AppState>,
) -> AppResult<String> {
    metadata::confirm_candidate(&state, &media_file_id, &candidate_id).await
}

#[tauri::command]
pub async fn cancel_match_candidates(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    metadata::cancel_candidates(&state.pool, &media_file_id).await
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
    let allowed = ["theme", "scan.include_hidden"];
    if !allowed.contains(&key.as_str()) {
        return Err(AppError::Validation("不支持的设置项".to_string()));
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
