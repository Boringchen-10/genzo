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
    saf: Option<crate::android_sources::DocumentLocator>,
    reused: bool,
}

#[derive(Debug, Default)]
struct WalkOutput {
    files: Vec<ScannedFile>,
    errors: Vec<String>,
    failed_directories: Vec<String>,
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

type FingerprintCache = HashMap<String, (i64, Option<String>, Option<String>)>;

enum WalkEvent {
    Directory(PathBuf),
    File(Box<ScannedFile>),
    Error(String),
    Progress,
    Finished,
}

fn is_network_location(path: &Path) -> bool {
    let value = path.to_string_lossy().replace('/', "\\");
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("\\\\?\\unc\\")
        || (lower.starts_with("\\\\") && !lower.starts_with("\\\\?\\"))
    {
        return true;
    }
    #[cfg(windows)]
    {
        let drive = value.strip_prefix("\\\\?\\").unwrap_or(&value);
        if drive.as_bytes().get(1) == Some(&b':') {
            let root: Vec<u16> = format!("{}\\", &drive[..2])
                .encode_utf16()
                .chain(Some(0))
                .collect();
            // DRIVE_REMOTE is 4. Query the drive type once, not once per file.
            return unsafe {
                windows::Win32::Storage::FileSystem::GetDriveTypeW(windows::core::PCWSTR(
                    root.as_ptr(),
                )) == 4
            };
        }
    }
    false
}

fn visit_directory(
    root: &Path,
    kind: &str,
    include_hidden: bool,
    mounted: bool,
    known: &FingerprintCache,
    emit: &mut impl FnMut(WalkEvent) -> bool,
) {
    // DirEntry metadata is cached by Windows enumeration. Avoid opening every
    // remote file again for canonicalization, hashing, or thumbnails.
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            emit(WalkEvent::Error(format!(
                "无法读取目录 {}：{error}",
                root.display()
            )));
            return;
        }
    };
    for item in entries {
        if !emit(WalkEvent::Progress) {
            return;
        }
        let entry = match item {
            Ok(entry) => entry,
            Err(error) => {
                if !emit(WalkEvent::Error(format!(
                    "无法枚举 {}：{error}",
                    root.display()
                ))) {
                    return;
                }
                continue;
            }
        };
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                if !emit(WalkEvent::Error(format!(
                    "无法读取 {}：{error}",
                    path.display()
                ))) {
                    return;
                }
                continue;
            }
        };
        if !include_hidden && is_hidden(&path, &metadata) {
            continue;
        }
        // Do not follow symlinks/junctions into another tree or create cycles.
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !emit(WalkEvent::Directory(path)) {
                return;
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let media_type = classify_extension(&extension);
        if !allowed_for_root(kind, media_type) {
            continue;
        }
        let normalized = path.to_string_lossy().to_string();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let size = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
        let modified_at = metadata.modified().ok().and_then(system_time_to_string);
        let saved = known
            .get(&normalized.to_lowercase())
            .filter(|(bytes, modified, _)| {
                modified_at.is_some() && *bytes == size && *modified == modified_at
            });
        let content_fingerprint = if media_type == "video" && !mounted {
            if let Some((_, _, Some(fingerprint))) = saved {
                Some(fingerprint.clone())
            } else {
                match fingerprint_file(&path, metadata.len()) {
                    Ok(value) => Some(value),
                    Err(error) => {
                        if !emit(WalkEvent::Error(format!(
                            "无法生成 {} 的移动识别指纹：{error}",
                            path.display()
                        ))) {
                            return;
                        }
                        None
                    }
                }
            }
        } else {
            saved.and_then(|(_, _, fingerprint)| fingerprint.clone())
        };
        let reused = saved.is_some();
        let file = ScannedFile {
            path: normalized,
            file_name: file_name.clone(),
            extension,
            media_type: media_type.to_string(),
            size,
            modified_at,
            parsed_anime: (media_type == "video" && !reused).then(|| parse_file_name(&file_name)),
            content_fingerprint,
            remote: None,
            saf: None,
            reused,
        };
        if !emit(WalkEvent::File(Box::new(file))) {
            return;
        }
    }
}

fn sort_scanned_files(output: &mut WalkOutput) {
    let mut seen = HashSet::new();
    output
        .files
        .retain(|file| seen.insert(file.path.to_lowercase()));
    output.failed_directories.sort();
    output.failed_directories.dedup();
    output.files.sort_by(|left, right| {
        let by_name = natord::compare_ignore_case(&left.file_name, &right.file_name);
        if by_name == Ordering::Equal {
            natord::compare_ignore_case(&left.path, &right.path)
        } else {
            by_name
        }
    });
}

#[cfg(test)]
fn collect_files(root: &Path, kind: &str, include_hidden: bool) -> WalkOutput {
    collect_local_files(root, kind, include_hidden, false)
}

#[cfg(test)]
fn collect_local_files(root: &Path, kind: &str, include_hidden: bool, mounted: bool) -> WalkOutput {
    let mut output = WalkOutput::default();
    let mut pending = std::collections::VecDeque::from([root.to_path_buf()]);
    while let Some(directory) = pending.pop_front() {
        visit_directory(
            &directory,
            kind,
            include_hidden,
            mounted,
            &HashMap::new(),
            &mut |event| {
                match event {
                    WalkEvent::Directory(path) => pending.push_back(path),
                    WalkEvent::File(file) => output.files.push(*file),
                    WalkEvent::Error(error) => output.errors.push(error),
                    _ => {}
                }
                true
            },
        );
    }
    sort_scanned_files(&mut output);
    output
}

#[cfg(test)]
async fn receive_directory(
    receiver: &mut tokio::sync::mpsc::Receiver<WalkEvent>,
    directory: &Path,
    pending: &mut std::collections::VecDeque<PathBuf>,
    output: &mut WalkOutput,
    idle_timeout: std::time::Duration,
) {
    receive_directory_monitored(receiver, directory, pending, output, idle_timeout, None).await
}

async fn receive_directory_monitored(
    receiver: &mut tokio::sync::mpsc::Receiver<WalkEvent>,
    directory: &Path,
    pending: &mut std::collections::VecDeque<PathBuf>,
    output: &mut WalkOutput,
    idle_timeout: std::time::Duration,
    task: Option<&crate::scan_tasks::TaskHandle>,
) {
    let before_errors = output.errors.len();
    loop {
        if let Some(task) = task {
            task.update(|state| {
                state.discovered = output.files.len();
                state.pending_directories = pending.len();
                state.errors = output.errors.clone();
            });
        }
        match tokio::time::timeout(idle_timeout, receiver.recv()).await {
            Ok(Some(WalkEvent::File(file))) => output.files.push(*file),
            Ok(Some(WalkEvent::Directory(path))) => pending.push_back(path),
            Ok(Some(WalkEvent::Error(error))) => output.errors.push(error),
            Ok(Some(WalkEvent::Progress)) => {}
            Ok(Some(WalkEvent::Finished)) => {
                if output.errors.len() > before_errors {
                    output
                        .failed_directories
                        .push(directory.to_string_lossy().into());
                }
                return;
            }
            Ok(None) => {
                output
                    .failed_directories
                    .push(directory.to_string_lossy().into());
                output.errors.push(format!(
                    "目录扫描中断：{}；已保留本轮发现的文件",
                    directory.display()
                ));
                return;
            }
            Err(_) => {
                output
                    .failed_directories
                    .push(directory.to_string_lossy().into());
                output.errors.push(format!(
                    "目录连续 {} 秒无响应：{}；已保留本轮发现的文件并继续其他目录",
                    idle_timeout.as_secs(),
                    directory.display()
                ));
                return;
            }
        }
    }
}

#[cfg(test)]
async fn collect_local_tree(
    root: PathBuf,
    kind: String,
    include_hidden: bool,
    mounted: bool,
    known: FingerprintCache,
) -> WalkOutput {
    collect_local_tree_monitored(vec![root], kind, include_hidden, mounted, known, None).await
}

async fn collect_local_tree_monitored(
    directories: Vec<PathBuf>,
    kind: String,
    include_hidden: bool,
    mounted: bool,
    known: FingerprintCache,
    task: Option<&crate::scan_tasks::TaskHandle>,
) -> WalkOutput {
    use std::sync::{Arc, OnceLock};
    // A blocked Windows network call cannot be force-cancelled safely. Bound
    // abandoned workers across scans; they release slots when the OS returns.
    static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let slots = WORKERS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(4)));
    let known = Arc::new(known);
    let mut output = WalkOutput::default();
    let mut pending = std::collections::VecDeque::from(directories);
    while let Some(directory) = pending.pop_front() {
        if let Some(task) = task {
            task.update(|state| {
                state.current_directory = directory.to_string_lossy().into();
                state.pending_directories = pending.len();
            });
        }
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            output.errors.push(format!(
                "网络目录仍有 4 个读取未返回，暂停剩余 {} 个目录；已保留扫描结果，请恢复连接后重试",
                pending.len() + 1
            ));
            output
                .failed_directories
                .push(directory.to_string_lossy().into());
            output
                .failed_directories
                .extend(pending.iter().map(|path| path.to_string_lossy().into()));
            break;
        };
        let (sender, mut receiver) = tokio::sync::mpsc::channel(128);
        let task_directory = directory.clone();
        let task_kind = kind.clone();
        let task_known = known.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            visit_directory(
                &task_directory,
                &task_kind,
                include_hidden,
                mounted,
                &task_known,
                &mut |event| sender.blocking_send(event).is_ok(),
            );
            let _ = sender.blocking_send(WalkEvent::Finished);
        });
        receive_directory_monitored(
            &mut receiver,
            &directory,
            &mut pending,
            &mut output,
            std::time::Duration::from_secs(30),
            task,
        )
        .await;
        // Closing the receiver cooperatively stops a timed-out worker as soon
        // as its current OS operation returns; it cannot continue traversing.
        drop(receiver);
        if let Some(task) = task {
            task.update(|state| state.visited_directories += 1);
        }
    }
    sort_scanned_files(&mut output);
    output
}

pub async fn scan_library_root(pool: &SqlitePool, root_id: &str) -> AppResult<ScanResult> {
    scan_with_options(pool, root_id, None).await
}

pub async fn scan_with_options(
    pool: &SqlitePool,
    root_id: &str,
    retry: Option<(String, Vec<String>)>,
) -> AppResult<ScanResult> {
    run_prepared(pool, prepare_scan(pool, root_id, retry).await?).await
}

pub struct PreparedScan {
    root: LibraryRoot,
    retry: Option<(String, Vec<String>)>,
    job_id: String,
    started_at: String,
    task: std::sync::Arc<crate::scan_tasks::TaskHandle>,
}

impl PreparedScan {
    pub fn id(&self) -> &str { &self.job_id }
}

pub async fn prepare_scan(
    pool: &SqlitePool,
    root_id: &str,
    retry: Option<(String, Vec<String>)>,
) -> AppResult<PreparedScan> {
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

    let scope_key = crate::scan_tasks::scope_key(pool, &root).await?;
    if retry
        .as_ref()
        .is_some_and(|(key, paths)| key != &scope_key || paths.is_empty())
    {
        return Err(AppError::Validation(
            "来源配置已变更，请重新完整扫描".into(),
        ));
    }
    let directories = retry.as_ref().map(|(_, paths)| paths.clone());
    if root.source_type != "webdav" && !root.path.starts_with("saf://") {
        if let Some(paths) = &directories {
            for path in paths {
                if !(normalized_directory(path) == normalized_directory(&root.path)
                    || is_more_specific_root(path, &root.path))
                    || path
                        .split(['\\', '/'])
                        .any(|part| part == ".." || part == ".")
                {
                    return Err(AppError::Validation("重试目录超出媒体源范围".into()));
                }
            }
        }
    }
    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339();
    {
        let (_write_guard, mut job_transaction) = crate::db::begin_write(pool).await?;
        sqlx::query(
        "INSERT INTO scan_jobs (id, library_root_id, status, started_at) VALUES (?, ?, 'running', ?)",
    )
    .bind(&job_id)
    .bind(&root.id)
    .bind(&started_at)
    .execute(&mut *job_transaction)
    .await?;
        job_transaction.commit().await?;
    }

    let task = crate::scan_tasks::register(&job_id, &root, scope_key, retry.is_some());
    crate::scan_tasks::persist(pool, &task).await?;
    Ok(PreparedScan { root, retry, job_id, started_at, task })
}

pub async fn run_prepared(pool: &SqlitePool, prepared: PreparedScan) -> AppResult<ScanResult> {
    let PreparedScan { root, retry, job_id, started_at, task } = prepared;
    let directories = retry.as_ref().map(|(_, paths)| paths.clone());
    let result: AppResult<ScanResult> = async {
    let lock = SCAN_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = tokio::select! {
        guard = lock.lock() => guard,
        _ = task.cancellation() => { task.check()?; unreachable!() },
    };
    task.check()?;
    task.update(|state| state.stage = "scanning".into());
    let include_hidden = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'scan.include_hidden'",
    )
    .fetch_optional(pool)
    .await?
    .is_some_and(|value| value == "true");
    let scan_path = PathBuf::from(&root.path);
    let scan_kind = root.kind.clone();
    let mounted_source = root.source_type == "mounted"
        || (root.source_type != "webdav" && is_network_location(&scan_path));
    // Metadata enumeration is still necessary for additions and moves; unchanged files
    // reuse parsing/fingerprints without touching content, including mounted roots.
    let known: FingerprintCache = sqlx::query_as::<_, (String, i64, Option<String>, Option<String>)>(
        "SELECT path, size, modified_at, content_fingerprint FROM media_files WHERE path = ? COLLATE NOCASE OR (substr(path,1,length(?)) = ? COLLATE NOCASE AND substr(path,length(?) + 1,1) IN ('\\', '/'))")
        .bind(&root.path).bind(&root.path).bind(&root.path).bind(&root.path).fetch_all(pool).await?.into_iter()
        .map(|(path, size, modified, fingerprint)| (path.to_lowercase(), (size, modified, fingerprint))).collect();
    let walk = async {
        if root.path.starts_with("saf://") {
            collect_saf_files(pool, &root, include_hidden, directories.clone(), &known, &task).await
        } else if root.source_type == "webdav" {
            collect_remote_files(pool, &root, include_hidden, directories.clone(), &known, &task).await
        } else {
            Ok(collect_local_tree_monitored(directories.clone().unwrap_or_else(|| vec![root.path.clone()]).into_iter().map(PathBuf::from).collect(), scan_kind, include_hidden, mounted_source, known, Some(&task)).await)
        }
    };
    let walk_output = tokio::select! {
        output = walk => output?,
        _ = task.cancellation() => { task.check()?; unreachable!() },
    };
    task.update(|state| {
        state.stage = "indexing".into(); state.discovered = walk_output.files.len();
        state.errors = walk_output.errors.clone(); state.failed_directories = walk_output.failed_directories.clone();
    });

    let (_write_guard, mut transaction) = crate::db::begin_write(pool).await?;
    task.check()?;
    // A source edited/removed during enumeration cannot be indexed using the old configuration.
    let current_root: Option<(String,String,String,bool)> = sqlx::query_as(
        "SELECT path,kind,source_type,enabled FROM library_roots WHERE id=?")
        .bind(&root.id).fetch_optional(&mut *transaction).await?;
    let remote_config: Option<(String,String)> = sqlx::query_as(
        "SELECT endpoint,directory FROM remote_sources WHERE id=? UNION ALL SELECT tree_uri,'' FROM android_saf_sources WHERE source_id=?")
        .bind(&root.id)
        .bind(&root.id).fetch_optional(&mut *transaction).await?;
    if !current_root.is_some_and(|(path,kind,source_type,enabled)| enabled && serde_json::to_string(&(path,kind,source_type,remote_config)).ok().as_deref() == Some(task.snapshot().scope_key.as_str())) {
        return Err(AppError::Validation("扫描期间来源配置已变更，本轮索引未提交，请重新扫描".into()));
    }
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
        // A partial scan cannot prove an unseen old path is absent.
        if retry.is_none() && walk_output.errors.is_empty() && !scanned_paths.contains(&file.path.to_lowercase()) {
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
    // Only a complete full scan can establish absence. No missing flip on every
    // existing row: unchanged timestamps and thumbnails must remain stable.
    if retry.is_none() && walk_output.errors.is_empty() {
        for existing in existing_by_path.values().filter(|file| !file.missing && file.library_root_id.as_deref() == Some(root.id.as_str()) && !scanned_paths.contains(&file.path.to_lowercase())) {
            task.check()?;
            sqlx::query("UPDATE media_files SET missing=1,updated_at=? WHERE id=?")
                .bind(Utc::now().to_rfc3339()).bind(&existing.id).execute(&mut *transaction).await?;
        }
    }

    let mut added_count = 0_i64;
    let mut updated_count = 0_i64;
    let mut errors = walk_output.errors;

    for file in &walk_output.files {
        task.check()?;
        task.update(|state| state.processed += 1);
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
            let changed = existing.size != file.size
                || existing.modified_at != file.modified_at
                || existing.missing
                || existing.media_type != file.media_type
                || claim_for_current_root
                    && existing.library_root_id.as_deref() != Some(root.id.as_str());
            if changed { updated_count += 1; }
            let same_metadata = existing.size == file.size && existing.modified_at == file.modified_at
                && existing.media_type == file.media_type && existing.file_name == file.file_name;
            if same_metadata && file.reused {
                task.update(|state| state.reused += 1);
                if changed || file.content_fingerprint != existing.content_fingerprint {
                    sqlx::query("UPDATE media_files SET library_root_id=?,missing=0,content_fingerprint=COALESCE(?,content_fingerprint),updated_at=? WHERE id=?")
                        .bind(target_root_id).bind(&file.content_fingerprint).bind(&now).bind(&existing.id).execute(&mut *transaction).await?;
                }
                continue;
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
            sqlx::query("INSERT INTO remote_files(media_file_id,source_id,href,etag) SELECT id,?,?,? FROM media_files WHERE path = ? ON CONFLICT(media_file_id) DO UPDATE SET href=excluded.href,etag=excluded.etag WHERE remote_files.href IS NOT excluded.href OR remote_files.etag IS NOT excluded.etag")
                .bind(&root.id).bind(href).bind(etag).bind(&file.path).execute(&mut *transaction).await?;
        }
        if let Some(locator) = &file.saf {
            sqlx::query("INSERT INTO android_documents(media_file_id,source_id,document_id,uri,parent_uri,relative_path) SELECT id,?,?,?,?,? FROM media_files WHERE path=? ON CONFLICT(media_file_id) DO UPDATE SET uri=excluded.uri,parent_uri=excluded.parent_uri,relative_path=excluded.relative_path WHERE android_documents.uri IS NOT excluded.uri OR android_documents.parent_uri IS NOT excluded.parent_uri OR android_documents.relative_path IS NOT excluded.relative_path")
                .bind(&root.id).bind(&locator.document_id).bind(&locator.uri).bind(&locator.parent_uri).bind(&locator.relative_path).bind(&locator.path).execute(&mut *transaction).await?;
        }
    }

    // Handles legacy records with no root or parsed episode, including moves
    // between scan roots, while preserving episode/subtitle associations.
    if retry.is_none() && root.source_type == "local" && !root.path.starts_with("saf://") && !mounted_source && errors.is_empty() && (added_count > 0 || updated_count > 0) {
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
        .bind(if errors.iter().any(|error| error.contains("permission_denied")) {
            "permission_denied"
        } else if errors.is_empty() {
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
    task.committing()?;
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
        let recorded: AppResult<()> = async {
            let (_write_guard, mut failed_transaction) = crate::db::begin_write(pool).await?;
            sqlx::query(
                "UPDATE scan_jobs SET status='failed', errors_json=?, finished_at=? WHERE id=?",
            )
            .bind(serde_json::to_string(&vec![error.to_string()])?)
            .bind(Utc::now().to_rfc3339())
            .bind(&job_id)
            .execute(&mut *failed_transaction)
            .await?;
            failed_transaction.commit().await?;
            Ok(())
        }
        .await;
        if let Err(error) = recorded {
            eprintln!("无法记录扫描失败：{error}");
        }
    }
    task.update(|state| {
        state.stage = if task.check().is_err() {
            "cancelled"
        } else if result.is_err() {
            "failed"
        } else {
            "completed"
        }
        .into();
        if let Err(error) = &result {
            state.errors.push(error.to_string());
        }
    });
    if let Err(error) = crate::scan_tasks::persist(pool, &task).await {
        eprintln!("无法保存扫描任务摘要：{error}");
    }
    result
}

static SCAN_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

async fn collect_saf_files(
    pool: &SqlitePool,
    root: &LibraryRoot,
    hidden: bool,
    directories: Option<Vec<String>>,
    known: &FingerprintCache,
    task: &crate::scan_tasks::TaskHandle,
) -> AppResult<WalkOutput> {
    let tree: String = sqlx::query_scalar("SELECT tree_uri FROM android_saf_sources WHERE source_id=?")
        .bind(&root.id).fetch_one(pool).await?;
    let names: HashMap<String, String> = sqlx::query_as::<_, (String, String)>("SELECT path,file_name FROM media_files WHERE library_root_id=?")
        .bind(&root.id).fetch_all(pool).await?.into_iter().collect();
    walk_saf(&root.id, &tree, hidden, directories, known, &names, task,
        |uri| async move { crate::android_sources::directory(&uri).await }).await
}

async fn walk_saf<F, Fut>(
    source_id: &str, tree: &str, hidden: bool, directories: Option<Vec<String>>,
    known: &FingerprintCache, names: &HashMap<String, String>,
    task: &crate::scan_tasks::TaskHandle, enumerate: F,
) -> AppResult<WalkOutput>
where F: Fn(String) -> Fut, Fut: std::future::Future<Output = AppResult<crate::android_sources::Directory>> {
    let mut pending: std::collections::VecDeque<(String, String)> = directories
        .unwrap_or_else(|| vec![tree.into()]).into_iter().map(|uri| (uri, String::new())).collect();
    let mut seen = HashSet::new();
    let mut documents = HashSet::new();
    let mut output = WalkOutput::default();
    while let Some((uri, relative)) = pending.pop_front() {
        task.check()?;
        if uri != tree && !uri.starts_with(&format!("{tree}/document/")) {
            return Err(AppError::Validation("重试目录超出安卓授权树范围".into()));
        }
        if !seen.insert(uri.clone()) { continue; }
        task.update(|state| {
            state.current_directory = relative.clone(); state.pending_directories = pending.len();
        });
        if seen.len() > 20_000 || output.files.len() > 200_000 {
            output.errors.push("扫描范围过大，请拆分媒体源目录".into());
            output.failed_directories.push(uri);
            output.failed_directories.extend(pending.into_iter().map(|(uri, _)| uri));
            break;
        }
        let directory = enumerate(uri.clone()).await;
        match directory {
            Ok(directory) if directory.status == "available" => {
                for entry in directory.files {
                    task.check()?;
                    if !hidden && entry.name.starts_with('.') { continue; }
                    if entry.name.is_empty() || entry.name.contains('/') || entry.name == ".." || entry.document_id.is_empty()
                        || !entry.uri.starts_with(&format!("{tree}/document/")) {
                        output.errors.push("source_offline：目录提供者返回无效条目".into());
                        output.failed_directories.push(uri.clone());
                        continue;
                    }
                    let relative_path = if relative.is_empty() { entry.name.clone() } else { format!("{relative}/{}", entry.name) };
                    if entry.mime_type == "vnd.android.document/directory" {
                        pending.push_back((entry.uri, relative_path));
                        continue;
                    }
                    if !documents.insert(entry.document_id.clone()) { continue; }
                    let extension = Path::new(&entry.name).extension().and_then(|s| s.to_str()).unwrap_or_default().to_lowercase();
                    let media_type = classify_extension(&extension);
                    let subtitle = matches!(extension.as_str(), "srt" | "ass" | "ssa" | "vtt" | "sub");
                    if media_type != "video" && !subtitle { continue; }
                    let path = crate::android_sources::virtual_path(source_id, &entry.document_id);
                    let modified_at = entry.modified_ms.filter(|ms| *ms > 0).and_then(DateTime::<Utc>::from_timestamp_millis).map(|date| date.to_rfc3339());
                    let reused = names.get(&path) == Some(&entry.name) && modified_at.is_some() && entry.size.is_some()
                        && known.get(&path).is_some_and(|(size, modified, _)| Some(*size) == entry.size && *modified == modified_at);
                    output.files.push(ScannedFile {
                        path: path.clone(), file_name: entry.name.clone(), extension,
                        media_type: media_type.into(), size: entry.size.unwrap_or(0).max(0), modified_at,
                        parsed_anime: (!reused).then(|| crate::anime_parser::parse_media_path(&entry.name, Path::new(&relative_path), None)),
                        content_fingerprint: None, remote: None,
                        saf: Some(crate::android_sources::DocumentLocator { path, document_id: entry.document_id, uri: entry.uri,
                            parent_uri: uri.clone(), relative_path }), reused,
                    });
                    task.update(|state| state.discovered = output.files.len());
                }
            }
            result => {
                let message = match result { Ok(directory) => directory.status, Err(error) => error.to_string() };
                output.errors.push(format!("{relative}：{message}"));
                output.failed_directories.push(uri);
            }
        }
        task.update(|state| { state.visited_directories += 1; state.errors = output.errors.clone(); });
    }
    sort_scanned_files(&mut output);
    Ok(output)
}

async fn collect_remote_files(
    pool: &SqlitePool,
    root: &LibraryRoot,
    hidden: bool,
    directories: Option<Vec<String>>,
    known: &FingerprintCache,
    task: &crate::scan_tasks::TaskHandle,
) -> AppResult<WalkOutput> {
    let source = crate::remote_storage::source(pool, &root.id).await?;
    let client = crate::remote_storage::client(&source)?;
    let directory = client.directory_url(&source.directory)?;
    let base = crate::webdav::decoded_path(directory.path())?;
    let remote_versions: HashMap<String, (String, Option<String>)> = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT m.path,r.href,r.etag FROM remote_files r JOIN media_files m ON m.id=r.media_file_id WHERE r.source_id=?")
        .bind(&root.id).fetch_all(pool).await?.into_iter()
        .map(|(path,href,etag)| (path.to_lowercase(),(href,etag))).collect();
    let mut pending = std::collections::VecDeque::from(
        directories.unwrap_or_else(|| vec![directory.path().into()]),
    );
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let mut output = WalkOutput::default();
    while let Some(path) = pending.pop_front() {
        if !seen.insert(path.clone()) {
            continue;
        }
        let url = client.resource_url(&path)?;
        if !crate::webdav::decoded_path(url.path())?.starts_with(&base) {
            return Err(AppError::Validation("重试目录超出媒体源范围".into()));
        }
        task.update(|state| {
            state.current_directory =
                crate::webdav::decoded_path(&path).unwrap_or_else(|_| path.clone());
            state.pending_directories = pending.len();
        });
        if seen.len() > 20_000 || entries.len() > 200_000 {
            output.errors.push("扫描范围过大，请拆分媒体源目录".into());
            output.failed_directories.push(path);
            output.failed_directories.extend(pending);
            break;
        }
        match client.list(&path).await {
            Ok(rows) => {
                for entry in rows {
                    if !hidden && entry.name.starts_with('.') {
                        continue;
                    }
                    if entry.directory {
                        pending.push_back(entry.href);
                    } else {
                        entries.push(entry);
                    }
                }
            }
            Err(error) => {
                output
                    .errors
                    .push(format!("{}：{error}", crate::webdav::decoded_path(&path)?));
                output.failed_directories.push(path);
            }
        }
        task.update(|state| {
            state.visited_directories += 1;
            state.discovered = entries.len();
            state.errors = output.errors.clone();
        });
    }
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
        let path = crate::remote_storage::virtual_path(&root.id, relative);
        let reused = remote_unchanged(
            known.get(&path.to_lowercase()),
            remote_versions.get(&path.to_lowercase()),
            &entry,
        );
        files.push(ScannedFile {
            path,
            file_name: entry.name.clone(),
            extension,
            media_type: media_type.into(),
            size: entry.size,
            modified_at: entry.modified_at,
            parsed_anime: (!reused && (media_type == "video" || subtitle)).then(|| {
                crate::anime_parser::parse_media_path(&entry.name, Path::new(&decoded), None)
            }),
            content_fingerprint: None,
            remote: Some((entry.href, entry.etag)),
            saf: None,
            reused,
        });
    }
    output.files = files;
    sort_scanned_files(&mut output);
    Ok(output)
}

fn normalized_directory(path: &str) -> String {
    let normalized = path
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase();
    if let Some(unc) = normalized.strip_prefix("\\\\?\\unc\\") {
        format!("\\\\{unc}")
    } else {
        normalized
            .strip_prefix("\\\\?\\")
            .unwrap_or(&normalized)
            .to_string()
    }
}

fn remote_unchanged(
    known: Option<&(i64, Option<String>, Option<String>)>,
    remote: Option<&(String, Option<String>)>,
    entry: &crate::webdav::DavEntry,
) -> bool {
    let (Some((size, modified, _)), Some((href, etag))) = (known, remote) else {
        return false;
    };
    if *size != entry.size || *modified != entry.modified_at || *href != entry.href {
        return false;
    }
    match (etag.as_deref(), entry.etag.as_deref()) {
        (Some(old), Some(new)) if !old.is_empty() && !new.is_empty() => old == new,
        (None, None) => entry.modified_at.is_some(),
        _ => false,
    }
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

    async fn saf_fixture() -> (SqlitePool, PreparedScan) {
        let pool = db::test_pool().await.unwrap();
        sqlx::raw_sql("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at) VALUES('saf-test','saf://saf-test','video',1,'t','t'); INSERT INTO android_saf_sources(source_id,tree_uri,label) VALUES('saf-test','content://provider/tree/test','测试');").execute(&pool).await.unwrap();
        let prepared = prepare_scan(&pool, "saf-test", None).await.unwrap();
        (pool, prepared)
    }

    #[tokio::test]
    async fn saf_recurses_keeps_case_identity_subtitles_and_failed_directories() {
        let (_pool, prepared) = saf_fixture().await;
        let tree = "content://provider/tree/test";
        let sub = format!("{tree}/document/sub");
        let denied = format!("{tree}/document/denied");
        let directories = HashMap::from([
            (tree.to_owned(), serde_json::json!({"status":"available","files":[
                {"documentId":"sub","name":"Season 2","mimeType":"vnd.android.document/directory","uri":sub},
                {"documentId":"denied","name":"Offline","mimeType":"vnd.android.document/directory","uri":denied}]})),
            (sub, serde_json::json!({"status":"available","files":[
                {"documentId":"A","name":"Example S02E03.mkv","mimeType":"video/x-matroska","size":42,"modifiedMs":1000,"uri":format!("{tree}/document/A")},
                {"documentId":"a","name":"example S02E03.mkv","mimeType":"video/x-matroska","size":42,"modifiedMs":1000,"uri":format!("{tree}/document/a")},
                {"documentId":"sub-ass","name":"Example S02E03.ass","mimeType":"text/plain","uri":format!("{tree}/document/sub-ass")},
                {"documentId":"image","name":"cover.jpg","mimeType":"image/jpeg","uri":format!("{tree}/document/image")}]})),
            (denied.clone(), serde_json::json!({"status":"permission_denied"})),
        ]);
        let known = HashMap::new();
        let names = HashMap::new();
        let output = walk_saf("saf-test", tree, false, None, &known, &names, &prepared.task,
            |uri| { let response = directories[&uri].clone(); async move { Ok(serde_json::from_value(response).unwrap()) } }).await.unwrap();
        assert_eq!(output.files.len(), 3);
        assert_ne!(output.files[0].path, output.files[1].path);
        assert!(output.files.iter().any(|file| file.extension == "ass"));
        assert!(output.files.iter().filter(|file| file.media_type == "video").all(|file| file.parsed_anime.as_ref().unwrap().season == Some(2)));
        assert_eq!(output.failed_directories, vec![denied]);
        assert!(output.errors[0].contains("permission_denied"));
        assert!(walk_saf("saf-test", tree, false, Some(vec!["content://other/tree/test".into()]), &known, &names, &prepared.task,
            |_| async { unreachable!() }).await.is_err());
    }

    #[tokio::test]
    async fn saf_queued_cancellation_retains_index_and_personal_record() {
        let (pool, prepared) = saf_fixture().await;
        sqlx::raw_sql("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES('retained','saf-test','saf://saf-test/61','a.mkv','mkv','video',42,'t','t'); INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('retained',10000,40000,'t');").execute(&pool).await.unwrap();
        let id = prepared.id().to_owned();
        crate::scan_tasks::cancel(&pool, &id).await.unwrap();
        assert!(run_prepared(&pool, prepared).await.is_err());
        assert_eq!(sqlx::query_as::<_, (bool, i64)>("SELECT missing,position_ms FROM media_files JOIN playback_progress ON media_file_id=id").fetch_one(&pool).await.unwrap(), (false, 10000));
        assert_eq!(crate::scan_tasks::list(&pool).await.unwrap()[0].stage, "cancelled");
    }

    #[cfg(not(target_os = "android"))]
    #[tokio::test]
    async fn unavailable_saf_provider_never_marks_known_media_missing() {
        let (pool, prepared) = saf_fixture().await;
        sqlx::query("INSERT INTO media_files(id,library_root_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES('retained','saf-test','saf://saf-test/61','a.mkv','mkv','video',42,'t','t')").execute(&pool).await.unwrap();
        let result = run_prepared(&pool, prepared).await.unwrap();
        assert_eq!(result.job.status, "completed_with_errors");
        assert_eq!(result.job.missing_count, 0);
        assert!(!sqlx::query_scalar::<_, bool>("SELECT missing FROM media_files WHERE id='retained'").fetch_one(&pool).await.unwrap());
    }

    #[test]
    fn detects_unc_mounts_without_requiring_source_toggle() {
        assert!(is_network_location(Path::new(r"\\server\share\Anime")));
        assert!(is_network_location(Path::new(
            r"\\?\UNC\RaiDrive-Administrator\cloud\Anime"
        )));
        assert!(is_network_location(Path::new("//server/share/Anime")));
    }

    #[tokio::test]
    async fn directory_timeout_retains_files_and_pending_siblings() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("01.mkv"), b"fixture").unwrap();
        let file = collect_local_files(temp.path(), "video", false, true)
            .files
            .remove(0);
        let sibling = temp.path().join("sibling");
        fs::create_dir(&sibling).unwrap();
        fs::write(sibling.join("02.mkv"), b"fixture").unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        sender.send(WalkEvent::File(Box::new(file))).await.unwrap();
        sender
            .send(WalkEvent::Directory(sibling.clone()))
            .await
            .unwrap();
        let mut output = WalkOutput::default();
        let mut pending = std::collections::VecDeque::new();
        receive_directory(
            &mut receiver,
            temp.path(),
            &mut pending,
            &mut output,
            std::time::Duration::from_millis(20),
        )
        .await;
        assert_eq!(output.files.len(), 1);
        assert_eq!(output.errors.len(), 1);
        assert!(output.errors[0].contains(&temp.path().display().to_string()));
        assert_eq!(pending.pop_front(), Some(sibling.clone()));
        let recovered =
            collect_local_tree(sibling, "video".into(), false, true, HashMap::new()).await;
        assert_eq!(recovered.files.len(), 1);
        assert!(recovered.errors.is_empty());
        drop(receiver);
        assert!(sender.send(WalkEvent::Progress).await.is_err());
    }

    #[tokio::test]
    async fn ongoing_progress_has_no_total_scan_deadline() {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let producer = tokio::spawn(async move {
            for _ in 0..8 {
                sender.send(WalkEvent::Progress).await.unwrap();
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            }
            sender.send(WalkEvent::Finished).await.unwrap();
        });
        let mut output = WalkOutput::default();
        receive_directory(
            &mut receiver,
            Path::new("fixture"),
            &mut std::collections::VecDeque::new(),
            &mut output,
            std::time::Duration::from_millis(200),
        )
        .await;
        producer.await.unwrap();
        assert!(output.errors.is_empty());
    }

    #[test]
    fn unchanged_local_file_reuses_fingerprint_and_hidden_trees_are_skipped() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("01.mkv");
        fs::write(&path, b"fixture").unwrap();
        fs::create_dir(temp.path().join(".hidden")).unwrap();
        fs::write(temp.path().join(".hidden/02.mkv"), b"fixture").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let known = HashMap::from([(
            path.to_string_lossy().to_lowercase(),
            (
                metadata.len() as i64,
                metadata.modified().ok().and_then(system_time_to_string),
                Some("cached-fingerprint".into()),
            ),
        )]);
        let mut files = Vec::new();
        visit_directory(temp.path(), "video", false, false, &known, &mut |event| {
            match event {
                WalkEvent::File(file) => files.push(file),
                WalkEvent::Directory(_) => panic!("hidden directory must not be traversed"),
                _ => {}
            }
            true
        });
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].content_fingerprint.as_deref(),
            Some("cached-fingerprint")
        );
    }

    #[tokio::test]
    async fn scans_all_nested_work_directories() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..100 {
            let folder = temp.path().join(format!("Series {index}/Season 2"));
            fs::create_dir_all(&folder).unwrap();
            for episode in 1..=12 {
                fs::write(
                    folder.join(format!("Series S2 - {episode:02}.mkv")),
                    b"fixture",
                )
                .unwrap();
            }
        }
        let started = std::time::Instant::now();
        let output = collect_local_tree(
            temp.path().to_path_buf(),
            "video".into(),
            false,
            true,
            HashMap::new(),
        )
        .await;
        assert!(output.errors.is_empty(), "{:?}", output.errors);
        assert_eq!(output.files.len(), 1200);
        assert!(output
            .files
            .iter()
            .all(|file| file.content_fingerprint.is_none()));
        eprintln!(
            "enumerated 100 nested works / 1200 videos in {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn reversed_episode_range_does_not_abort_a_multi_work_folder_scan() {
        let pool = db::test_pool().await.unwrap();
        let directory = tempfile::tempdir().unwrap();
        for series in ["Example", "Another"] {
            let folder = directory.path().join(series);
            fs::create_dir(&folder).unwrap();
            for episode in 1..=24 {
                fs::write(
                    folder.join(format!("{series} - {episode:02}.mkv")),
                    b"fixture",
                )
                .unwrap();
            }
        }
        fs::write(
            directory.path().join("Example/Example - 24-01.mkv"),
            b"fixture",
        )
        .unwrap();
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES('range-test',?,'video',1,'now','now','mounted')")
            .bind(normalize_existing_path(directory.path()).unwrap()).execute(&pool).await.unwrap();
        for _ in 0..2 {
            scan_library_root(&pool, "range-test").await.unwrap();
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM media_files WHERE missing = 0")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 49);
            let range: (Option<i64>, Option<i64>) = sqlx::query_as("SELECT parsed_episode_start, parsed_episode_end FROM media_files WHERE file_name = 'Example - 24-01.mkv'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(range, (None, None));
        }
    }

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
        fs::write(directory.path().join("01.mkv"), b"changed fixture").unwrap();
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
#[cfg(test)]
#[path = "scanner/tests_incremental.rs"]
mod incremental_tests;
