use crate::anime_parser::{parse_file_name, ParsedAnime};
use crate::error::{AppError, AppResult};
use crate::models::{LibraryRoot, MediaFile, ScanJob, ScanResult};
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
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
    content_fingerprint: Option<String>,
    remote: Option<(String, Option<String>)>,
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

fn fingerprint_file(path: &Path, size: u64) -> std::io::Result<String> {
    const SAMPLE_SIZE: u64 = 64 * 1024;
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    hasher.update(b"genzo-media-fingerprint-v1");
    hasher.update(size.to_le_bytes());
    let last = size.saturating_sub(SAMPLE_SIZE);
    let middle = size.saturating_sub(SAMPLE_SIZE) / 2;
    let mut positions = vec![0, middle, last];
    positions.sort_unstable();
    positions.dedup();
    let mut buffer = vec![0_u8; SAMPLE_SIZE as usize];
    for position in positions {
        file.seek(SeekFrom::Start(position))?;
        let sample_length = usize::try_from((size - position).min(SAMPLE_SIZE)).unwrap_or(0);
        let read = file.read(&mut buffer[..sample_length])?;
        hasher.update(position.to_le_bytes());
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256-sampled-v1:{:x}", hasher.finalize()))
}

#[cfg(test)]
fn collect_files(root: &Path, kind: &str, include_hidden: bool) -> WalkOutput {
    collect_local_files(root, kind, include_hidden, false)
}

fn collect_local_files(root: &Path, kind: &str, include_hidden: bool, mounted: bool) -> WalkOutput {
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
        let content_fingerprint = if media_type == "video" && !mounted {
            match fingerprint_file(path, metadata.len()) {
                Ok(value) => Some(value),
                Err(error) => {
                    output.errors.push(format!(
                        "无法生成 {} 的移动识别指纹：{error}",
                        path.display()
                    ));
                    None
                }
            }
        } else {
            None
        };
        output.files.push(ScannedFile {
            path: normalized,
            file_name: file_name.clone(),
            extension,
            media_type: media_type.to_string(),
            size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
            modified_at: metadata.modified().ok().and_then(system_time_to_string),
            parsed_anime: (media_type == "video").then(|| parse_file_name(&file_name)),
            content_fingerprint,
            remote: None,
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
        "SELECT id, path, kind, enabled, last_scanned_at, created_at, updated_at, source_type, availability FROM library_roots WHERE id = ?",
    )
    .bind(root_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("扫描目录不存在".to_string()))?;

    if !root.enabled {
        return Err(AppError::Validation("该扫描目录已停用".to_string()));
    }

    let lock = SCAN_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = lock.lock().await;

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

    let result: AppResult<ScanResult> = async {
    let include_hidden = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'scan.include_hidden'",
    )
    .fetch_optional(pool)
    .await?
    .is_some_and(|value| value == "true");
    let scan_path = PathBuf::from(&root.path);
    let scan_kind = root.kind.clone();
    let walk_output = if root.source_type == "webdav" {
        match collect_remote_files(pool, &root, include_hidden).await {
            Ok(files) => WalkOutput {
                files,
                errors: vec![],
            },
            Err(error) => WalkOutput {
                files: vec![],
                errors: vec![error.to_string()],
            },
        }
    } else {
        let mounted = root.source_type == "mounted";
        let task = tauri::async_runtime::spawn_blocking(move || {
            collect_local_files(&scan_path, &scan_kind, include_hidden, mounted)
        });
        match tokio::time::timeout(std::time::Duration::from_secs(300), task).await {
            Ok(Ok(output)) => output,
            _ => WalkOutput {
                files: vec![],
                errors: vec!["目录扫描超时或中断，已保留原有文件状态".into()],
            },
        }
    };

    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    let root_paths: HashMap<String, String> =
        sqlx::query_as::<_, (String, String)>("SELECT id, path FROM library_roots")
            .fetch_all(&mut *transaction)
            .await?
            .into_iter()
            .collect();
    // Include every existing row below this directory. A more specific configured root owns
    // overlapping files; scanning a parent may refresh metadata but must not steal ownership.
    let existing_files = sqlx::query_as::<_, MediaFile>(
        "SELECT id, work_id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, created_at, updated_at, recognition_status, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, last_recognized_at, recognition_error, content_fingerprint, thumbnail_path FROM media_files WHERE path = ? COLLATE NOCASE OR (substr(path, 1, length(?)) = ? COLLATE NOCASE AND substr(path, length(?) + 1, 1) IN ('\\', '/'))",
    )
    .bind(&root.path)
    .bind(&root.path)
    .bind(&root.path)
    .bind(&root.path)
    .fetch_all(&mut *transaction)
    .await?;
    let scanned_paths = walk_output
        .files
        .iter()
        .map(|file| file.path.to_lowercase())
        .collect::<HashSet<_>>();
    let mut move_candidates: HashMap<String, Vec<MediaFile>> = HashMap::new();
    for file in &existing_files {
        if !scanned_paths.contains(&file.path.to_lowercase()) {
            if let Some(fingerprint) = &file.content_fingerprint {
                move_candidates
                    .entry(fingerprint.clone())
                    .or_default()
                    .push(file.clone());
            }
        }
    }
    let existing_by_path: HashMap<String, MediaFile> = existing_files
        .into_iter()
        .map(|file| (file.path.to_lowercase(), file))
        .collect();
    if walk_output.errors.is_empty() {
        sqlx::query("UPDATE media_files SET missing = 1, updated_at = ? WHERE library_root_id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(&root.id)
            .execute(&mut *transaction)
            .await?;
    }

    let mut added_count = 0_i64;
    let mut updated_count = 0_i64;
    let mut errors = walk_output.errors;

    for file in &walk_output.files {
        let now = Utc::now().to_rfc3339();
        if let Some(existing) = existing_by_path.get(&file.path.to_lowercase()) {
            let existing_root_path = existing
                .library_root_id
                .as_ref()
                .and_then(|id| root_paths.get(id));
            let claim_for_current_root = existing.library_root_id.is_none()
                || existing.library_root_id.as_deref() == Some(root.id.as_str())
                || existing_root_path.is_some_and(|owner| is_more_specific_root(&root.path, owner));
            let target_root_id = if claim_for_current_root {
                Some(root.id.as_str())
            } else {
                existing.library_root_id.as_deref()
            };
            if existing.size != file.size
                || existing.modified_at != file.modified_at
                || existing.missing
                || existing.media_type != file.media_type
                || claim_for_current_root
                    && existing.library_root_id.as_deref() != Some(root.id.as_str())
            {
                updated_count += 1;
            }
            if let Err(error) = sqlx::query(
                "UPDATE media_files SET library_root_id = ?, file_name = ?, extension = ?, media_type = ?, thumbnail_path = CASE WHEN size = ? AND modified_at IS ? THEN thumbnail_path ELSE NULL END, size = ?, modified_at = ?, missing = 0, parsed_title = ?, parsed_original_title = ?, parsed_season = ?, parsed_episode = ?, parsed_episode_start = ?, parsed_episode_end = ?, parsed_year = ?, parsed_release_group = ?, parsed_special_type = ?, parsed_media_info = ?, content_fingerprint = COALESCE(?, content_fingerprint), updated_at = ? WHERE id = ?",
            )
            .bind(target_root_id)
            .bind(&file.file_name)
            .bind(&file.extension)
            .bind(&file.media_type)
            .bind(file.size)
            .bind(&file.modified_at)
            .bind(file.size)
            .bind(&file.modified_at)
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.original_title.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.season))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_start).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_end).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.year))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.release_group.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.special_type.as_ref()))
            .bind(serde_json::to_string(&file.parsed_anime.as_ref().map(|parsed| &parsed.media_info).cloned().unwrap_or_default())?)
            .bind(&file.content_fingerprint)
            .bind(&now)
            .bind(&existing.id)
            .execute(&mut *transaction)
            .await
            {
                return Err(error.into());
            }
        } else if let Some(moved) = file
            .content_fingerprint
            .as_ref()
            .and_then(|fingerprint| move_candidates.get(fingerprint))
            .filter(|candidates| candidates.len() == 1)
            .and_then(|candidates| candidates.first())
        {
            let result = sqlx::query(
                "UPDATE media_files SET library_root_id = ?, path = ?, file_name = ?, extension = ?, media_type = ?, size = ?, modified_at = ?, missing = 0, parsed_title = ?, parsed_original_title = ?, parsed_season = ?, parsed_episode = ?, parsed_episode_start = ?, parsed_episode_end = ?, parsed_year = ?, parsed_release_group = ?, parsed_special_type = ?, parsed_media_info = ?, content_fingerprint = ?, updated_at = ? WHERE id = ? AND missing = 1",
            )
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
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_start).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_end).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.year))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.release_group.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.special_type.as_ref()))
            .bind(serde_json::to_string(&file.parsed_anime.as_ref().map(|parsed| &parsed.media_info).cloned().unwrap_or_default())?)
            .bind(&file.content_fingerprint)
            .bind(&now)
            .bind(&moved.id)
            .execute(&mut *transaction)
            .await;
            match result {
                Ok(result) if result.rows_affected() == 1 => updated_count += 1,
                Ok(_) => errors.push(format!("无法重新关联已移动文件 {}", file.path)),
                Err(error) => return Err(error.into()),
            }
        } else {
            let result = sqlx::query(
                "INSERT INTO media_files (id, library_root_id, path, file_name, extension, media_type, size, modified_at, missing, parsed_title, parsed_original_title, parsed_season, parsed_episode, parsed_episode_start, parsed_episode_end, parsed_year, parsed_release_group, parsed_special_type, parsed_media_info, content_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_start).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.episode_end).map(i64::from))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.year))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.release_group.as_ref()))
            .bind(file.parsed_anime.as_ref().and_then(|parsed| parsed.special_type.as_ref()))
            .bind(serde_json::to_string(&file.parsed_anime.as_ref().map(|parsed| &parsed.media_info).cloned().unwrap_or_default())?)
            .bind(&file.content_fingerprint)
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
                Err(error) => return Err(error.into()),
            }
        }
    }

    for file in &walk_output.files {
        if let Some((href, etag)) = &file.remote {
            sqlx::query("INSERT INTO remote_files(media_file_id,source_id,href,etag) SELECT id,?,?,? FROM media_files WHERE path = ? ON CONFLICT(media_file_id) DO UPDATE SET href=excluded.href,etag=excluded.etag")
                .bind(&root.id).bind(href).bind(etag).bind(&file.path).execute(&mut *transaction).await?;
        }
    }

    // Handles legacy records with no root or parsed episode, including moves
    // between scan roots, while preserving episode/subtitle associations.
    if root.source_type == "local" && errors.is_empty() {
        crate::media_reconciliation::reconcile(&mut transaction, None).await?;
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
    sqlx::query("UPDATE library_roots SET availability = ? WHERE id = ?")
        .bind(if errors.is_empty() {
            "online"
        } else {
            "unavailable"
        })
        .bind(&root.id)
        .execute(&mut *transaction)
        .await?;

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
            id: job_id.clone(),
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
    }.await;
    if let Err(error) = &result {
        // The indexing transaction has rolled back before recording its failure.
        // If another process still owns the database, preserve the original error.
        let _ = sqlx::query(
            "UPDATE scan_jobs SET status='failed', errors_json=?, finished_at=? WHERE id=?",
        )
        .bind(serde_json::to_string(&vec![error.to_string()])?)
        .bind(Utc::now().to_rfc3339())
        .bind(&job_id)
        .execute(pool)
        .await;
    }
    result
}

static SCAN_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

async fn collect_remote_files(
    pool: &SqlitePool,
    root: &LibraryRoot,
    hidden: bool,
) -> AppResult<Vec<ScannedFile>> {
    let source = crate::remote_storage::source(pool, &root.id).await?;
    let client = crate::remote_storage::client(&source)?;
    let directory = client.directory_url(&source.directory)?;
    let base = crate::webdav::decoded_path(directory.path())?;
    let entries = crate::remote_storage::collect(pool, root, hidden).await?;
    let mut files = Vec::new();
    for entry in entries {
        let extension = Path::new(&entry.name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let media_type = classify_extension(&extension);
        let subtitle = matches!(extension.as_str(), "ass" | "ssa" | "srt" | "vtt" | "sub");
        if media_type == "game"
            || (!allowed_for_root(&root.kind, media_type) && !(root.kind == "video" && subtitle))
        {
            continue;
        }
        let decoded = crate::webdav::decoded_path(&entry.href)?;
        let relative = decoded
            .strip_prefix(&base)
            .ok_or_else(|| AppError::Validation("文件超出扫描目录".into()))?;
        files.push(ScannedFile {
            path: crate::remote_storage::virtual_path(&root.id, relative),
            file_name: entry.name.clone(),
            extension,
            media_type: media_type.into(),
            size: entry.size,
            modified_at: entry.modified_at,
            parsed_anime: (media_type == "video" || subtitle).then(|| {
                crate::anime_parser::parse_media_path(&entry.name, Path::new(&decoded), None)
            }),
            content_fingerprint: None,
            remote: Some((entry.href, entry.etag)),
        });
    }
    Ok(files)
}

fn normalized_directory(path: &str) -> String {
    path.trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}

fn is_more_specific_root(candidate: &str, owner: &str) -> bool {
    let candidate = normalized_directory(candidate);
    let owner = normalized_directory(owner);
    candidate.len() > owner.len()
        && candidate
            .strip_prefix(&owner)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Utc;
    use std::fs;

    #[tokio::test]
    async fn database_write_failure_rolls_back_missing_flags_and_marks_job_failed() {
        let pool = db::test_pool().await.unwrap();
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("01.mkv"), b"fixture").unwrap();
        let path = dunce::canonicalize(directory.path())
            .unwrap()
            .to_string_lossy()
            .to_string();
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at) VALUES('r',?,'video',1,'now','now')").bind(path).execute(&pool).await.unwrap();
        scan_library_root(&pool, "r").await.unwrap();
        sqlx::query("CREATE TRIGGER reject_file_update BEFORE UPDATE OF file_name ON media_files BEGIN SELECT RAISE(ABORT, 'injected write failure'); END").execute(&pool).await.unwrap();
        assert!(scan_library_root(&pool, "r").await.is_err());
        let missing: bool = sqlx::query_scalar("SELECT missing FROM media_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            !missing,
            "failed write must roll back earlier missing flags"
        );
        let failed: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scan_jobs WHERE status='failed' AND finished_at IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(failed, 1);
        sqlx::query("DROP TRIGGER reject_file_update")
            .execute(&pool)
            .await
            .unwrap();
        scan_library_root(&pool, "r").await.unwrap();
    }

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

    #[test]
    fn mounted_scan_does_not_read_video_contents() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("episode01.mkv"), b"fixture").unwrap();
        let output = collect_local_files(temp.path(), "video", false, true);
        assert_eq!(output.files.len(), 1);
        assert!(output.files[0].content_fingerprint.is_none());
        assert!(output.errors.is_empty());
    }

    #[tokio::test]
    async fn disconnected_mount_preserves_existing_files_and_recovers() {
        let pool = db::test_pool().await.unwrap();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("mounted");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("episode01.mkv"), b"fixture").unwrap();
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES('offline-mount',?,'video',1,'now','now','mounted')")
            .bind(normalize_existing_path(&root).unwrap()).execute(&pool).await.unwrap();
        scan_library_root(&pool, "offline-mount").await.unwrap();
        // Rename only this test's temporary fixture to simulate an unavailable mount.
        fs::rename(&root, temp.path().join("disconnected")).unwrap();
        let failed = scan_library_root(&pool, "offline-mount").await.unwrap();
        assert!(!failed.errors.is_empty());
        assert_eq!(failed.job.missing_count, 0);
        fs::rename(temp.path().join("disconnected"), &root).unwrap();
        let recovered = scan_library_root(&pool, "offline-mount").await.unwrap();
        assert!(recovered.errors.is_empty());
        assert_eq!(recovered.job.added_count, 0);
    }

    #[test]
    fn only_child_roots_are_more_specific() {
        assert!(is_more_specific_root("G:\\影音\\动漫", "G:\\影音"));
        assert!(!is_more_specific_root("G:\\影音", "G:\\影音\\动漫"));
        assert!(!is_more_specific_root("G:\\影音2", "G:\\影音"));
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
    async fn moving_video_inside_root_preserves_record_and_work_link() {
        let pool = db::test_pool().await.expect("create database");
        let temp = tempfile::tempdir().expect("create temp directory");
        let original = temp.path().join("episode01.mkv");
        fs::write(&original, b"stable video content").expect("write media file");
        let root_path = normalize_existing_path(temp.path()).expect("normalize root");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('root', ?, 'video', 1, ?, ?)")
            .bind(&root_path).bind(&now).bind(&now).execute(&pool).await.expect("root");
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '测试动画', 'video', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.expect("work");

        scan_library_root(&pool, "root").await.expect("first scan");
        let original_id: String = sqlx::query_scalar("SELECT id FROM media_files")
            .fetch_one(&pool)
            .await
            .expect("media id");
        sqlx::query("UPDATE media_files SET work_id = 'work' WHERE id = ?")
            .bind(&original_id)
            .execute(&pool)
            .await
            .expect("link work");
        let moved_directory = temp.path().join("Season 1");
        fs::create_dir(&moved_directory).expect("create destination");
        fs::rename(&original, moved_directory.join("episode01.mkv")).expect("move media file");

        let result = scan_library_root(&pool, "root").await.expect("rescan");
        assert_eq!(result.job.added_count, 0);
        assert_eq!(result.job.updated_count, 1);
        let row: (String, Option<String>, bool) =
            sqlx::query_as("SELECT id, work_id, missing FROM media_files")
                .fetch_one(&pool)
                .await
                .expect("moved row");
        assert_eq!(row.0, original_id);
        assert_eq!(row.1.as_deref(), Some("work"));
        assert!(!row.2);
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

    #[tokio::test]
    async fn child_root_claims_overlap_and_parent_does_not_steal_it_back() {
        let pool = db::test_pool().await.expect("create database");
        let temp = tempfile::tempdir().expect("create temp directory");
        let child = temp.path().join("Anime");
        fs::create_dir(&child).expect("create child root");
        fs::write(child.join("episode01.mkv"), b"test").expect("write media file");
        let parent_path = normalize_existing_path(temp.path()).expect("normalize parent");
        let child_path = normalize_existing_path(&child).expect("normalize child");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots (id, path, kind, enabled, created_at, updated_at) VALUES ('parent', ?, 'video', 1, ?, ?), ('child', ?, 'video', 1, ?, ?)")
            .bind(&parent_path)
            .bind(&now)
            .bind(&now)
            .bind(&child_path)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("insert overlapping roots");

        let parent_scan = scan_library_root(&pool, "parent")
            .await
            .expect("scan parent");
        assert_eq!(parent_scan.job.added_count, 1);
        let child_scan = scan_library_root(&pool, "child").await.expect("scan child");
        assert_eq!(child_scan.job.added_count, 0);
        assert_eq!(child_scan.job.updated_count, 1);
        let owner_after_child: String =
            sqlx::query_scalar("SELECT library_root_id FROM media_files")
                .fetch_one(&pool)
                .await
                .expect("owner after child scan");
        assert_eq!(owner_after_child, "child");

        let parent_rescan = scan_library_root(&pool, "parent")
            .await
            .expect("rescan parent");
        assert_eq!(parent_rescan.job.updated_count, 0);
        let owner_after_parent: String =
            sqlx::query_scalar("SELECT library_root_id FROM media_files")
                .fetch_one(&pool)
                .await
                .expect("owner after parent rescan");
        assert_eq!(owner_after_parent, "child");
    }
}
