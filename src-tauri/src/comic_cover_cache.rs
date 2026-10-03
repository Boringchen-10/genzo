use crate::{db, error::{AppError, AppResult}, metadata_aggregator as artwork};
use serde::Serialize;
use std::{collections::HashMap, fs, future::Future, path::{Path, PathBuf}, sync::{Arc, OnceLock}, time::SystemTime};
use tauri::State;
use tokio::sync::{Mutex, Semaphore};

const DIRECTORY: &str = "comic-explore";
const BUDGET: u64 = 256 * 1024 * 1024;
static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
static DOWNLOADS: Semaphore = Semaphore::const_new(4);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCover {
    pub cover_path: String,
    pub thumbnail_path: Option<String>,
}

fn validate(id: &str, url: &str) -> AppResult<()> {
    if !crate::comic_explore::valid_id(id) || url.len() > 4096 || !reqwest::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            && url.host_str().is_some_and(|host| host.ends_with(".mangafunb.fun"))
    }) { return Err(AppError::Validation("漫画封面地址无效".into())); }
    Ok(())
}

fn path(directory: &Path, id: &str, url: &str) -> PathBuf {
    artwork::artwork_cache_path(directory, &format!("copymanga:{id}"), "cover", url)
}

fn file_exists(file: &Path) -> bool {
    fs::symlink_metadata(file).is_ok_and(|metadata| metadata.file_type().is_file() && metadata.len() > 0 && metadata.len() <= 20 * 1024 * 1024)
}

fn at(file: &Path) -> Option<CachedCover> {
    if !file_exists(file) { return None; }
    let thumbnail = artwork::thumbnail_path(file);
    Some(CachedCover { cover_path: file.to_string_lossy().into_owned(),
        thumbnail_path: file_exists(&thumbnail).then(|| thumbnail.to_string_lossy().into_owned()) })
}

pub fn peek(directory: &Path, id: &str, url: &str) -> Option<CachedCover> {
    validate(id, url).ok()?;
    at(&path(&directory.join(DIRECTORY), id, url)).or_else(|| at(&path(directory, id, url)))
}

fn touch(file: &Path) {
    let _ = fs::OpenOptions::new().write(true).open(file).and_then(|file| file.set_modified(SystemTime::now()));
}

// Only Genzo-generated cover pairs in the dedicated temporary directory can be evicted.
fn pair(file: &Path) -> Option<PathBuf> {
    let name = file.file_name()?.to_str()?;
    let hash = name.strip_suffix("-cover.jpg").or_else(|| name.strip_suffix("-cover-thumb.jpg"))?.strip_prefix("art-v2-")?;
    (hash.len() == 24 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| file.with_file_name(format!("art-v2-{hash}-cover.jpg")))
}

fn prune(directory: &Path, budget: u64, protected: &[PathBuf]) -> AppResult<()> {
    if fs::symlink_metadata(directory)?.file_type().is_symlink() { return Err(AppError::Validation("漫画封面缓存目录无效".into())); }
    let mut groups = HashMap::<PathBuf, (SystemTime, Vec<(PathBuf, u64)>)>::new();
    let mut total = 0;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() { continue; }
        let Some(base) = pair(&entry.path()) else { continue; };
        let metadata = entry.metadata()?;
        total += metadata.len();
        let group = groups.entry(base).or_insert((SystemTime::UNIX_EPOCH, vec![]));
        group.0 = group.0.max(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        group.1.push((entry.path(), metadata.len()));
    }
    let mut groups = groups.into_iter().collect::<Vec<_>>();
    groups.sort_by_key(|(_, (modified, _))| *modified);
    for (base, (_, files)) in groups {
        if total <= budget { break; }
        if protected.contains(&base) { continue; }
        for (file, size) in files {
            if fs::remove_file(file).is_ok() { total = total.saturating_sub(size); }
        }
    }
    Ok(())
}

async fn cached_with<F, Fut>(directory: &Path, id: &str, url: &str, refresh: bool, load: F) -> AppResult<CachedCover>
where F: FnOnce(String, PathBuf) -> Fut, Fut: Future<Output = AppResult<()>> {
    validate(id, url)?;
    let temporary = directory.join(DIRECTORY);
    if fs::symlink_metadata(&temporary).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(AppError::Validation("漫画封面缓存目录无效".into()));
    }
    let destination = path(&temporary, id, url);
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let lock = {
        let mut locks = locks.lock().await;
        locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        locks.entry(destination.clone()).or_default().clone()
    };
    let _guard = lock.lock().await;
    if !refresh {
        if let Some(cached) = peek(directory, id, url) {
            if Path::new(&cached.cover_path).parent() == Some(temporary.as_path()) { touch(Path::new(&cached.cover_path)); }
            return Ok(cached);
        }
    }
    let _permit = DOWNLOADS.acquire().await.map_err(|_| AppError::System("漫画封面缓存已关闭".into()))?;
    fs::create_dir_all(&temporary)?;
    load(url.to_string(), destination.clone()).await?;
    let cached = at(&destination).ok_or_else(|| AppError::System("漫画封面缓存未生成".into()))?;
    let protected = locks.lock().await.iter().filter(|(_, lock)| Arc::strong_count(lock) > 1).map(|(path, _)| path.clone()).collect::<Vec<_>>();
    // A locked/temporarily busy old file does not prevent displaying the new cover.
    let _ = tauri::async_runtime::spawn_blocking(move || prune(&temporary, BUDGET, &protected)).await;
    Ok(cached)
}

#[tauri::command]
pub async fn cache_comic_explore_cover(path_word: String, cover_url: String, refresh: bool, state: State<'_, db::AppState>, app: tauri::AppHandle) -> AppResult<CachedCover> {
    let cached = cached_with(&state.cover_cache_path, &path_word, &cover_url, refresh,
        |url, destination| async move { artwork::cache_cover(&url, &destination).await }).await?;
    db::allow_cover_file(&app, Path::new(&cached.cover_path))?;
    Ok(cached)
}

pub async fn promote(directory: &Path, id: &str, url: &str) -> AppResult<Option<String>> {
    let destination = path(directory, id, url);
    if file_exists(&destination) { return Ok(Some(destination.to_string_lossy().into_owned())); }
    let Some(cached) = peek(directory, id, url) else { return Ok(None); };
    let bytes = tokio::fs::read(&cached.cover_path).await?;
    artwork::write_artwork(&bytes, &destination)?;
    if let Some(thumbnail) = cached.thumbnail_path {
        if let Ok(bytes) = tokio::fs::read(thumbnail).await {
            let _ = artwork::write_artwork(&bytes, &artwork::thumbnail_path(&destination));
        }
    }
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    const URL: &str = "https://sm.mangafunb.fun/cover.jpg";

    async fn write_cover(_: String, file: PathBuf) -> AppResult<()> {
        fs::write(&file, b"cached original")?;
        fs::write(artwork::thumbnail_path(&file), b"cached thumbnail")?;
        Ok(())
    }

    #[tokio::test]
    async fn concurrent_reads_download_once_and_reuse_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let downloads = AtomicUsize::new(0);
        let load = |url, file| async {
            downloads.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            write_cover(url, file).await
        };
        let (a, b) = tokio::join!(cached_with(dir.path(), "comic", URL, false, load), cached_with(dir.path(), "comic", URL, false, load));
        assert_eq!(a.unwrap().cover_path, b.unwrap().cover_path);
        assert_eq!(downloads.load(Ordering::SeqCst), 1);
        let cached = cached_with(dir.path(), "comic", URL, false, |_, _| async { panic!("offline cache hit must not download") }).await.unwrap();
        assert!(cached.thumbnail_path.is_some());
        assert!(peek(dir.path(), "comic", "https://sm.mangafunb.fun/new.jpg").is_none());
    }

    #[tokio::test]
    async fn failed_refresh_keeps_previous_bytes_and_retries() {
        let dir = tempfile::tempdir().unwrap();
        let cached = cached_with(dir.path(), "comic", URL, false, write_cover).await.unwrap();
        assert!(cached_with(dir.path(), "comic", URL, true, |_, _| async { Err(AppError::Network("offline".into())) }).await.is_err());
        assert_eq!(fs::read(&cached.cover_path).unwrap(), b"cached original");
        fs::remove_file(&cached.cover_path).unwrap();
        assert!(peek(dir.path(), "comic", URL).is_none());
        cached_with(dir.path(), "comic", URL, false, write_cover).await.unwrap();
    }

    #[tokio::test]
    async fn promoted_cover_survives_temporary_eviction_without_redownload() {
        let dir = tempfile::tempdir().unwrap();
        let cached = cached_with(dir.path(), "comic", URL, false, write_cover).await.unwrap();
        let permanent = promote(dir.path(), "comic", URL).await.unwrap().unwrap();
        assert!(!permanent.contains(DIRECTORY));
        prune(&dir.path().join(DIRECTORY), 0, &[]).unwrap();
        assert!(!Path::new(&cached.cover_path).exists());
        assert_eq!(fs::read(&permanent).unwrap(), b"cached original");
        cached_with(dir.path(), "comic", URL, false, |_, _| async { panic!("saved cover must be reused") }).await.unwrap();
    }

    #[test]
    fn budget_evicts_old_pairs_and_preserves_other_files_and_active_cover() {
        let dir = tempfile::tempdir().unwrap();
        let old = path(dir.path(), "old", URL);
        let active = path(dir.path(), "active", URL);
        for file in [&old, &active] { fs::write(file, [0; 100]).unwrap(); fs::write(artwork::thumbnail_path(file), [0; 40]).unwrap(); }
        fs::File::options().write(true).open(&old).unwrap().set_modified(SystemTime::UNIX_EPOCH).unwrap();
        fs::File::options().write(true).open(artwork::thumbnail_path(&old)).unwrap().set_modified(SystemTime::UNIX_EPOCH).unwrap();
        let unrelated = dir.path().join("personal.jpg");
        fs::write(&unrelated, [0; 200]).unwrap();
        prune(dir.path(), 140, &[active.clone()]).unwrap();
        assert!(!old.exists()); assert!(!artwork::thumbnail_path(&old).exists());
        assert!(active.exists()); assert!(artwork::thumbnail_path(&active).exists()); assert!(unrelated.exists());
    }

    #[tokio::test]
    #[ignore = "explicit live public cover smoke; no account, chapter resources or user library"]
    async fn live_public_cover_download_reuse_and_promotion() {
        let value: serde_json::Value = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build().unwrap()
            .get("https://api.copy202601.com/api/v3/comics?free_type=1&limit=1&offset=0&ordering=-popular&platform=3")
            .header("Accept", "application/json").header("platform", "3").header("source", "copyApp")
            .header("version", "3.0.9").header("User-Agent", "COPY/3.0.9")
            .header("webp", "1").header("X-Requested-With", "com.manga2020.app")
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(value["code"], 200);
        let item = &value["results"]["list"][0];
        let id = item["path_word"].as_str().unwrap();
        let url = item["cover"].as_str().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let cached = cached_with(dir.path(), id, url, false,
            |url, destination| async move { artwork::cache_cover(&url, &destination).await }).await.unwrap();
        let original = fs::read(&cached.cover_path).unwrap();
        let image = image::load_from_memory(&original).unwrap();
        assert!(image.width() >= 80 && image.height() >= 80);
        let thumbnail = image::open(cached.thumbnail_path.as_ref().unwrap()).unwrap();
        assert!(thumbnail.width() <= 600 && thumbnail.height() <= 900);
        cached_with(dir.path(), id, url, false, |_, _| async { panic!("reuse must work without network") }).await.unwrap();
        let permanent = promote(dir.path(), id, url).await.unwrap().unwrap();
        assert_eq!(fs::read(permanent).unwrap(), original);
    }

    #[tokio::test]
    async fn rejects_invalid_identity_and_untrusted_url_before_io() {
        let dir = tempfile::tempdir().unwrap();
        for (id, url) in [("../escape", URL), ("comic", "https://example.org/cover.jpg"), ("comic", "http://sm.mangafunb.fun/a.jpg"), ("comic", "https://user@sm.mangafunb.fun/a.jpg")] {
            assert!(cached_with(dir.path(), id, url, false, |_, _| async { panic!("invalid input must not download") }).await.is_err());
        }
        assert!(!dir.path().join(DIRECTORY).exists());
    }
}
