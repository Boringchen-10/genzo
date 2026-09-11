use crate::anime_parser::{parse_file_name, ParsedAnime};
use crate::error::{AppError, AppResult};
use crate::models::{LibraryRoot, MediaFile, ScanJob, ScanResult};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug)]
struct ScannedFile {
    path: String,
    file_name: String,
    extension: String,
    media_type: String,
    size: i64,
    modified_at: Option<String>,
    parsed_anime: Option<ParsedAnime>,
}

#[derive(Debug, Default)]
struct WalkOutput {
    files: Vec<ScannedFile>,
    errors: Vec<String>,
}

pub fn normalize_existing_path(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Err(AppError::PathNotFound(path.to_path_buf()));
    }
    let canonical = dunce::canonicalize(path)?;
    Ok(canonical.to_string_lossy().to_string())
}

pub fn classify_extension(extension: &str) -> &'static str {
    match extension
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "mkv" | "mp4" | "avi" | "mov" | "webm" | "m4v" | "ts" => "video",
        "cbz" | "cbr" | "zip" | "rar" | "7z" | "jpg" | "jpeg" | "png" | "webp" | "avif" => "comic",
        "epub" | "pdf" | "txt" | "mobi" | "azw3" => "novel",
        "exe" | "lnk" | "bat" | "cmd" => "game",
        _ => "other",
    }
}

fn allowed_for_root(kind: &str, media_type: &str) -> bool {
    matches!(kind, "auto" | "mixed") || kind == media_type
}

fn system_time_to_string(value: SystemTime) -> Option<String> {
    let datetime: DateTime<Utc> = value.into();
    Some(datetime.to_rfc3339())
}

fn is_hidden(path: &Path, metadata: &std::fs::Metadata) -> bool {
    let dot_hidden = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with('.'));
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        dot_hidden || metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        dot_hidden
    }
}

fn collect_files(root: &Path, kind: &str, include_hidden: bool) -> WalkOutput {
    let mut output = WalkOutput::default();

    for item in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = match item {
            Ok(entry) => entry,
            Err(error) => {
                output.errors.push(error.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let media_type = classify_extension(&extension);
        if !allowed_for_root(kind, media_type) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                output
                    .errors
                    .push(format!("无法读取 {}：{error}", path.display()));
                continue;
            }
        };
        if !include_hidden && is_hidden(path, &metadata) {
            continue;
        }
        let normalized = dunce::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string();
        let file_name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        output.files.push(ScannedFile {
            path: normalized,
            file_name: file_name.clone(),
            extension,
            media_type: media_type.to_string(),
            size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
            modified_at: metadata.modified().ok().and_then(system_time_to_string),
            parsed_anime: (media_type == "video").then(|| parse_file_name(&file_name)),
        });
    }

    output.files.sort_by(|left, right| {
        let by_name = natord::compare_ignore_case(&left.file_name, &right.file_name);
        if by_name == Ordering::Equal {
            natord::compare_ignore_case(&left.path, &right.path)
        } else {
            by_name
        }
    });
    output
}

pub async fn scan_library_root(pool: &SqlitePool, root_id: &str) -> AppResult<ScanResult> {
    let root = sqlx::query_as::<_, LibraryRoot>(
        "SELECT id, path, kind, enabled, last_scanned_at, created_at, updated_at FROM library_roots WHERE id = ?",
    )
    .bind(root_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("扫描目录不存在".to_string()))?;

    if !root.enabled {
        return Err(AppError::Validation("该扫描目录已停用".to_string()));
    }

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO scan_jobs (id, library_root_id, status, started_at) VALUES (?, ?, 'running', ?)",
    )
    .bind(&job_id)
    .bind(&root.id)
    .bind(&started_at)
    .execute(pool)
    .await?;

    let include_hidden = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'scan.include_hidden'",
    )
    .fetch_optional(pool)
    .await?
    .is_some_and(|value| value == "true");
    let scan_path = PathBuf::from(&root.path);
    let scan_kind = root.kind.clone();
    let walk_output = tauri::async_runtime::spawn_blocking(move || {
        collect_files(&scan_path, &scan_kind, include_hidden)
    })
    .await
    .map_err(|error| AppError::System(format!("扫描任务异常结束：{error}")))?;

    let mut transaction = pool.begin().await?;
    // Records are deliberately retained when a root configuration is deleted. Include those
    // orphaned rows so re-adding the same directory reclaims them instead of violating path UNIQUE.
    let existing_files = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error FROM media_files WHERE library_root_id = ? OR (library_root_id IS NULL AND substr(path, 1, length(?)) = ? COLLATE NOCASE)",
    )
    .bind(&root.id)
    .bind(&root.path)
    .bind(&root.path)
    .fetch_all(&mut *transaction)
    .await?;
    let existing_by_path: HashMap<String, MediaFile> = existing_files
        .into_iter()
        .map(|file| (file.path.to_lowercase(), file))
        .collect();
    sqlx::query("UPDATE media_files SET missing = 1, updated_at = ? WHERE library_root_id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(&root.id)
        .execute(&mut *transaction)
        .await?;

    let mut added_count = 0_i64;
    let mut updated_count = 0_i64;
    let mut errors = walk_output.errors;

    for file in &walk_output.files {
        let now = Utc::now().to_rfc3339();
        if let Some(existing) = existing_by_path.get(&file.path.to_lowercase()) {
            if existing.size != file.size
                || existing.modified_at != file.modified_at
                || existing.missing
                || existing.media_type != file.media_type
                || existing.library_root_id.as_deref() != Some(root.id.as_str())
            {
                updated_count += 1;
            }
            if let Err(error) = sqlx::query(
                "UPDATE media_files SET library_root_id = ?, file_name = ?, extension = ?, media_type = ?, size = ?, modified_at = ?, missing = 0, parsed_title = ?, parsed_original_title = ?, parsed_season = ?, parsed_episode = ?, parsed_year = ?, parsed_release_group = ?, parsed_special_type = ?, parsed_media_info = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&root.id)
            .bind(&file.file_name)
            .bind(&file.extension)
            .bind(&file.media_type)
            .bind(file.size)
            .bind(&file.modified_at)
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.original_title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.season))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.year))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.release_group.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.special_type.as_ref()))
            .bind(serde_json::to_string(&file.parsed_anime.as_ref().map(|parsed| &parsed.media_info).cloned().unwrap_or_default())?)
            .bind(&now)
            .bind(&existing.id)
            .execute(&mut *transaction)
            .await
            {
                errors.push(format!("无法更新 {}：{error}", file.path));
            }
        } else {
            let result = sqlx::query(
                "INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&root.id)
            .bind(&file.path)
            .bind(&file.file_name)
            .bind(&file.extension)
            .bind(&file.media_type)
            .bind(file.size)
            .bind(&file.modified_at)
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.original_title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.season))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.year))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.release_group.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.special_type.as_ref()))
            .bind(serde_json::to_string(&file.parsed_anime.as_ref().map(|parsed| &parsed.media_info).cloned().unwrap_or_default())?)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await;
            match result {
                Ok(_) => added_count += 1,
                Err(error)
                    if error
                        .as_database_error()
                        .is_some_and(|database_error| database_error.is_unique_violation()) =>
                {
                    // Overlapping roots may discover a path already owned by another configured
                    // root. The global path record is authoritative, so this is an idempotent hit.
                }
                Err(error) => errors.push(format!("无法写入 {}：{error}", file.path)),
            }
        }
    }

    let missing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_files WHERE library_root_id = ? AND missing = 1",
    )
    .bind(&root.id)
    .fetch_one(&mut *transaction)
    .await?;
    let finished_at = Utc::now().to_rfc3339();
    let status = if errors.is_empty() {
        "completed"
    } else {
        "completed_with_errors"
    };
    let errors_json = serde_json::to_string(&errors)?;

    sqlx::query("UPDATE library_roots SET last_scanned_at = ?, updated_at = ? WHERE id = ?")
        .bind(&finished_at)
        .bind(&finished_at)
        .bind(&root.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "UPDATE scan_jobs SET status = ?, discovered_count = ?, added_count = ?, updated_count = ?, missing_count = ?, errors_json = ?, finished_at = ? WHERE id = ?",
    )
    .bind(status)
    .bind(i64::try_from(walk_output.files.len()).unwrap_or(i64::MAX))
    .bind(added_count)
    .bind(updated_count)
    .bind(missing_count)
    .bind(&errors_json)
    .bind(&finished_at)
    .bind(&job_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(ScanResult {
        job: ScanJob {
            id: job_id,
            library_root_id: root.id,
            status: status.to_string(),
            discovered_count: i64::try_from(walk_output.files.len()).unwrap_or(i64::MAX),
            added_count,
            updated_count,
            missing_count,
            errors_raw: errors_json,
            started_at,
            finished_at: Some(finished_at),
        },
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Utc;
    use std::fs;

    #[test]
    fn classifies_supported_extensions_case_insensitively() {
        assert_eq!(classify_extension("MKV"), "video");
        assert_eq!(classify_extension("cbz"), "comic");
        assert_eq!(classify_extension(".EPUB"), "novel");
        assert_eq!(classify_extension("exe"), "game");
        assert_eq!(classify_extension("unknown"), "other");
    }

    #[test]
    fn scans_in_natural_filename_order() {
        let temp = tempfile::tempdir().expect("create temp directory");
        fs::write(temp.path().join("第10话.mkv"), []).expect("write test file");
        fs::write(temp.path().join("第2话.mkv"), []).expect("write test file");
        fs::write(temp.path().join("第1话.mkv"), []).expect("write test file");

        let output = collect_files(temp.path(), "video", false);
        let names: Vec<_> = output
            .files
            .iter()
            .map(|file| file.file_name.as_str())
            .collect();
        assert_eq!(names, vec!["第1话.mkv", "第2话.mkv", "第10话.mkv"]);
    }

    #[tokio::test]
    async fn repeated_scan_deduplicates_and_removed_file_becomes_missing() {
        let pool = db::test_pool().await.expect("create database");
        let temp = tempfile::tempdir().expect("create temp directory");
        let media_path = temp.path().join("episode01.mkv");
        fs::write(&media_path, b"test").expect("write media file");
        let root_path = normalize_existing_path(temp.path()).expect("normalize root");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', ?, 'auto', 1, ?, ?)")
            .bind(root_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert root");

        let first = scan_library_root(&pool, "root").await.expect("first scan");
        assert_eq!(first.job.added_count, 1);
        assert_eq!(first.job.missing_count, 0);

        let second = scan_library_root(&pool, "root").await.expect("second scan");
        assert_eq!(second.job.added_count, 0);
        assert_eq!(second.job.updated_count, 0);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_files")
            .fetch_one(&pool)
            .await
            .expect("count media files");
        assert_eq!(count, 1);

        fs::remove_file(media_path).expect("remove temporary media file");
        let third = scan_library_root(&pool, "root").await.expect("third scan");
        assert_eq!(third.job.missing_count, 1);
        let missing: bool = sqlx::query_scalar("SELECT missing FROM media_files LIMIT 1")
            .fetch_one(&pool)
            .await
            .expect("read missing flag");
        assert!(missing);
    }

    #[tokio::test]
    async fn readding_deleted_root_reclaims_existing_paths_without_errors() {
        let pool = db::test_pool().await.expect("create database");
        let temp = tempfile::tempdir().expect("create temp directory");
        fs::write(temp.path().join("episode01.mkv"), b"test").expect("write media file");
        let root_path = normalize_existing_path(temp.path()).expect("normalize root");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('old-root', ?, 'video', 1, ?, ?)")
            .bind(&root_path).bind(&now).bind(&now).execute(&pool).await.expect("insert old root");
        scan_library_root(&pool, "old-root")
            .await
            .expect("initial scan");
        sqlx::query("DELETE FROM library_roots WHERE id = 'old-root'")
            .execute(&pool)
            .await
            .expect("delete root configuration");
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('new-root', ?, 'video', 1, ?, ?)")
            .bind(&root_path).bind(&now).bind(&now).execute(&pool).await.expect("insert replacement root");

        let result = scan_library_root(&pool, "new-root")
            .await
            .expect("rescan replacement root");
        assert!(result.errors.is_empty());
        assert_eq!(result.job.added_count, 0);
        assert_eq!(result.job.updated_count, 1);
        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT path, library_root_id FROM media_files")
                .fetch_all(&pool)
                .await
                .expect("read media records");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1.as_deref(), Some("new-root"));
    }
}
