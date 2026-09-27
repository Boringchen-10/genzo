use crate::{
    db::AppState,
    error::{AppError, AppResult},
    remote_storage,
    webdav::{self, DavClient},
};
use chrono::Utc;
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use std::{path::PathBuf, sync::OnceLock, time::Duration};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};
use uuid::Uuid;

static TRANSFER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static LEASES: OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>> =
    OnceLock::new();
fn lease(id: &str) {
    LEASES.get_or_init(Default::default).lock().unwrap().insert(
        id.into(),
        std::time::Instant::now() + Duration::from_secs(12 * 3600),
    );
}
fn leased(id: &str) -> bool {
    LEASES
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .get(id)
        .is_some_and(|t| *t > std::time::Instant::now())
}
pub fn relocation_leased(id: &str) -> bool { leased(id) }
pub async fn relocation_lock() -> AppResult<tokio::sync::MutexGuard<'static, ()>> {
    tokio::time::timeout(Duration::from_secs(5), TRANSFER_LOCK.get_or_init(|| Mutex::new(())).lock())
        .await.map_err(|_| AppError::Validation("正在处理远程传输，请稍后重试迁移".into()))
}

#[derive(Clone, FromRow)]
struct Resource {
    source_id: String,
    href: String,
    etag: Option<String>,
    size: i64,
    modified_at: Option<String>,
    extension: String,
}
impl Resource {
    fn revision(&self) -> String {
        format!(
            "{}|{}|{}",
            self.etag.as_deref().unwrap_or_default(),
            self.size,
            self.modified_at.as_deref().unwrap_or_default()
        )
    }
    fn validator(&self) -> Option<&str> {
        self.etag
            .as_deref()
            .filter(|s| !s.starts_with("W/"))
            .or(self.modified_at.as_deref())
    }
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub media_file_id: String,
    pub file_name: String,
    pub size: i64,
    pub completed: bool,
    pub pinned: bool,
    pub accessed_at: String,
}

async fn resource(pool: &SqlitePool, id: &str) -> AppResult<Resource> {
    sqlx::query_as("SELECT r.source_id,r.href,r.etag,m.size,m.modified_at,m.extension FROM remote_files r JOIN media_files m ON m.id=r.media_file_id WHERE m.id=?")
        .bind(id).fetch_optional(pool).await?.ok_or_else(|| AppError::NotFound("远程文件不存在".into()))
}

fn cache_path(state: &AppState, id: &str, extension: &str, partial: bool) -> AppResult<PathBuf> {
    Uuid::parse_str(id).map_err(|_| AppError::Validation("文件标识无效".into()))?;
    if extension.len() > 16 || !extension.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(AppError::Validation("文件扩展名无效".into()));
    }
    Ok(state
        .data_directory
        .join("remote-cache")
        .join(format!("{id}.{}", if partial { "part" } else { extension })))
}

pub async fn cached_path(state: &AppState, id: &str) -> AppResult<Option<PathBuf>> {
    let r = resource(&state.pool, id).await?;
    let row: Option<(String, i64, bool)> =
        sqlx::query_as("SELECT revision,size,completed FROM remote_cache WHERE media_file_id=?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    if let Some((revision, size, true)) = row {
        let path = cache_path(state, id, &r.extension, false)?;
        if revision == r.revision()
            && tokio::fs::metadata(&path)
                .await
                .is_ok_and(|m| m.is_file() && m.len() == size as u64)
        {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn list_remote_cache(state: State<'_, AppState>) -> AppResult<Vec<CacheEntry>> {
    Ok(sqlx::query_as("SELECT c.media_file_id,m.file_name,c.size,c.completed,c.pinned,c.accessed_at FROM remote_cache c JOIN media_files m ON m.id=c.media_file_id ORDER BY c.accessed_at DESC").fetch_all(&state.pool).await?)
}

async fn limit(pool: &SqlitePool) -> AppResult<u64> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='storage.cache_limit_gib'")
            .fetch_optional(pool)
            .await?;
    Ok(value
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(20)
        .clamp(1, 1024)
        * 1024
        * 1024
        * 1024)
}
#[tauri::command]
pub async fn set_cache_limit(gib: u32, state: State<'_, AppState>) -> AppResult<()> {
    if !(1..=1024).contains(&gib) {
        return Err(AppError::Validation("缓存上限应为 1–1024 GiB".into()));
    }
    let _guard = TRANSFER_LOCK
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| AppError::Validation("请等待当前传输完成".into()))?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('storage.cache_limit_gib',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(gib.to_string()).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    Ok(())
}

async fn remove(state: &AppState, id: &str) -> AppResult<()> {
    if leased(id) {
        return Err(AppError::Validation(
            "该缓存最近已交给播放器使用，请稍后清理或重启应用后重试".into(),
        ));
    }
    let r = resource(&state.pool, id).await?;
    for partial in [false, true] {
        let path = cache_path(state, id, &r.extension, partial)?;
        match tokio::fs::remove_file(path).await {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    sqlx::query("DELETE FROM remote_cache WHERE media_file_id=?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(())
}
#[tauri::command]
pub async fn remove_remote_cache(
    media_file_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _guard = TRANSFER_LOCK
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| AppError::Validation("请等待当前传输完成".into()))?;
    remove(&state, &media_file_id).await
}

async fn make_room(state: &AppState, id: &str, needed: u64, capacity: u64) -> AppResult<u64> {
    let rows: Vec<(String,i64,bool)> = sqlx::query_as("SELECT media_file_id,size,pinned FROM remote_cache WHERE media_file_id != ? ORDER BY accessed_at")
        .bind(id).fetch_all(&state.pool).await?;
    let mut measured = Vec::new();
    for (other, _, pinned) in rows {
        let resource = resource(&state.pool, &other).await?;
        let mut size = 0_u64;
        for partial in [false, true] {
            size += tokio::fs::metadata(cache_path(state, &other, &resource.extension, partial)?)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
        }
        measured.push((other, size, pinned));
    }
    let mut used: u64 = measured.iter().map(|r| r.1).sum();
    for (other, size, pinned) in measured {
        if used.saturating_add(needed) <= capacity {
            break;
        }
        if !pinned && !leased(&other) {
            remove(state, &other).await?;
            used = used.saturating_sub(size);
        }
    }
    if used.saturating_add(needed) > capacity {
        return Err(AppError::Validation(
            "缓存空间不足，请提高上限或清理已保留的下载".into(),
        ));
    }
    Ok(used)
}

pub async fn download(state: &AppState, id: &str, pinned: bool) -> AppResult<PathBuf> {
    let _guard = TRANSFER_LOCK
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| AppError::Validation("已有文件正在缓存，请等待完成后重试".into()))?;
    if let Some(path) = cached_path(state, id).await? {
        sqlx::query(
            "UPDATE remote_cache SET pinned=MAX(pinned,?),accessed_at=? WHERE media_file_id=?",
        )
        .bind(pinned)
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(&state.pool)
        .await?;
        return Ok(path);
    }
    let r = resource(&state.pool, id).await?;
    let source = remote_storage::source(&state.pool, &r.source_id).await?;
    let client = remote_storage::client(&source)?;
    let target = cache_path(state, id, &r.extension, false)?;
    let partial = cache_path(state, id, &r.extension, true)?;
    tokio::fs::create_dir_all(target.parent().unwrap()).await?;
    let previous: Option<(String, bool)> =
        sqlx::query_as("SELECT revision,pinned FROM remote_cache WHERE media_file_id=?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    let same = previous.as_ref().is_some_and(|v| v.0 == r.revision());
    let pinned = pinned || previous.as_ref().is_some_and(|v| v.1);
    let mut offset = if same && r.validator().is_some() {
        tokio::fs::metadata(&partial)
            .await
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };
    let range = format!("bytes={offset}-");
    let mut response = client
        .get(
            &r.href,
            (offset > 0).then_some(range.as_str()),
            false,
            r.validator(),
        )
        .await?;
    if response.status().as_u16() == 416 && offset > 0 {
        offset = 0;
        response = client.get(&r.href, None, false, None).await?;
    }
    let status = response.status().as_u16();
    if ![200, 206].contains(&status) {
        return Err(webdav::status_error(status));
    }
    if status == 200 {
        offset = 0;
    } else {
        let interval = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(complete_range);
        if !interval.is_some_and(|(start, end, total)| {
            start == offset
                && end.checked_add(1) == Some(total)
                && response
                    .content_length()
                    .is_none_or(|length| length == end - start + 1)
        }) {
            return Err(AppError::Network("下载续传范围无效，未写入缓存".into()));
        }
    }
    let total = response
        .content_length()
        .map(|n| n.saturating_add(offset))
        .unwrap_or(r.size.max(0) as u64);
    let capacity = limit(&state.pool).await?;
    let used = make_room(state, id, total, capacity).await?;
    if !same && target.exists() {
        if leased(id) {
            return Err(AppError::Validation("旧版本缓存仍在使用".into()));
        }
        tokio::fs::remove_file(&target).await?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(&partial)
        .await?;
    use tokio::io::AsyncSeekExt;
    file.seek(std::io::SeekFrom::Start(offset)).await?;
    sqlx::query("INSERT INTO remote_cache(media_file_id,revision,size,completed,pinned,accessed_at) VALUES(?,?,?,0,?,?) ON CONFLICT(media_file_id) DO UPDATE SET revision=excluded.revision,size=excluded.size,completed=0,pinned=excluded.pinned,accessed_at=excluded.accessed_at")
        .bind(id).bind(r.revision()).bind(offset as i64).bind(pinned).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    let mut written = offset;
    let result: AppResult<()> = async {
        let mut last_update = std::time::Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::Network("下载中断，可重试继续缓存".into()))?
        {
            if used
                .saturating_add(written)
                .saturating_add(chunk.len() as u64)
                > capacity
            {
                return Err(AppError::Validation(
                    "已达到缓存上限，请调整容量后重试".into(),
                ));
            }
            file.write_all(&chunk).await?;
            written += chunk.len() as u64;
            if last_update.elapsed() > Duration::from_millis(500) {
                sqlx::query("UPDATE remote_cache SET size=? WHERE media_file_id=?")
                    .bind(written as i64)
                    .bind(id)
                    .execute(&state.pool)
                    .await?;
                last_update = std::time::Instant::now();
            }
        }
        file.flush().await?;
        if total > 0 && total != written {
            return Err(AppError::Network("下载长度不完整，请重试".into()));
        }
        Ok(())
    }
    .await;
    drop(file);
    sqlx::query("UPDATE remote_cache SET size=? WHERE media_file_id=?")
        .bind(written as i64)
        .bind(id)
        .execute(&state.pool)
        .await?;
    result?;
    if target.exists() {
        tokio::fs::remove_file(&target).await?;
    }
    tokio::fs::rename(&partial, &target).await?;
    sqlx::query("UPDATE remote_cache SET completed=1 WHERE media_file_id=?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(target)
}

fn range_start(value: &str) -> Option<u64> {
    value
        .strip_prefix("bytes ")?
        .split_once('-')?
        .0
        .parse()
        .ok()
}

fn complete_range(value: &str) -> Option<(u64, u64, u64)> {
    let (interval, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = interval.split_once('-')?;
    let (start, end, total) = (
        start.parse::<u64>().ok()?,
        end.parse::<u64>().ok()?,
        total.parse::<u64>().ok()?,
    );
    (start <= end && end < total).then_some((start, end, total))
}

#[tauri::command]
pub async fn cache_remote_media(
    media_file_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    download(&state, &media_file_id, pinned).await.map(|_| ())
}

pub async fn open_path(state: &AppState, id: &str, streaming: bool) -> AppResult<String> {
    if let Some(path) = cached_path(state, id).await? {
        sqlx::query("UPDATE remote_cache SET accessed_at=? WHERE media_file_id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&state.pool)
            .await?;
        lease(id);
        return Ok(path.to_string_lossy().into());
    }
    if streaming {
        let r = resource(&state.pool, id).await?;
        let source = remote_storage::source(&state.pool, &r.source_id).await?;
        let client = remote_storage::client(&source)?;
        if let Ok(response) = client.get(&r.href, Some("bytes=0-0"), false, None).await {
            if response.status().as_u16() == 206
                && response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    .and_then(range_start)
                    == Some(0)
            {
                return proxy(client, r.href, &r.extension).await;
            }
        }
    }
    let path = download(state, id, false).await?;
    lease(id);
    Ok(path.to_string_lossy().into())
}

async fn proxy(client: DavClient, href: String, extension: &str) -> AppResult<String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let token = format!("/{}.{}", Uuid::new_v4(), extension);
    let url = format!("http://{address}{token}");
    tokio::spawn(async move {
        let end = tokio::time::Instant::now() + Duration::from_secs(12 * 3600);
        let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
        while let Ok(Ok((stream, _))) = tokio::time::timeout_at(end, listener.accept()).await {
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let (client, href, token) = (client.clone(), href.clone(), token.clone());
            tokio::spawn(async move {
                let _permit = permit;
                let _ = serve(stream, &client, &href, &token).await;
            });
        }
    });
    Ok(url)
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    client: &DavClient,
    href: &str,
    token: &str,
) -> AppResult<()> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = [0];
        tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut byte))
            .await
            .map_err(|_| AppError::Network("播放请求超时".into()))??;
        bytes.push(byte[0]);
        if bytes.ends_with(b"\r\n\r\n") {
            break;
        }
        if bytes.len() > 8192 {
            return Ok(());
        }
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = text.lines();
    let request: Vec<_> = lines
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    if request.len() != 3 || !["GET", "HEAD"].contains(&request[0]) || request[1] != token {
        stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }
    let range = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim());
    if range.is_some_and(|v| !valid_range(v)) {
        stream.write_all(b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
        return Ok(());
    }
    let mut response = match client.get(href, range, request[0] == "HEAD", None).await {
        Ok(r) => r,
        Err(_) => {
            stream
                .write_all(
                    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await?;
            return Ok(());
        }
    };
    let status = response.status();
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Response")
    );
    // Never forward upstream cookies, redirects, authentication headers or error bodies.
    for name in [
        "content-length",
        "content-range",
        "accept-ranges",
        "content-type",
    ] {
        if let Some(value) = response.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await?;
    if request[0] == "GET" && status.is_success() {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::Network("远程播放连接中断".into()))?
        {
            tokio::time::timeout(Duration::from_secs(60), stream.write_all(&chunk))
                .await
                .map_err(|_| AppError::Network("播放器读取超时".into()))??;
        }
    }
    Ok(())
}

fn valid_range(value: &str) -> bool {
    value
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .is_some_and(|(a, b)| {
            !(a.is_empty() && b.is_empty())
                && [a, b]
                    .iter()
                    .all(|s| s.is_empty() || s.parse::<u64>().is_ok())
                && (a.is_empty()
                    || b.is_empty()
                    || a.parse::<u64>().unwrap() <= b.parse::<u64>().unwrap())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_single_well_formed_ranges() {
        for range in ["bytes=0-0", "bytes=100-", "bytes=-100"] {
            assert!(valid_range(range));
        }
        for range in [
            "bytes=-",
            "bytes=5-2",
            "bytes=0-1,3-4",
            "bytes=0-\r\nAuthorization:x",
        ] {
            assert!(!valid_range(range));
        }
    }

    #[test]
    fn validates_server_range_totals_before_resuming() {
        assert_eq!(complete_range("bytes 4-9/10"), Some((4, 9, 10)));
        for value in [
            "bytes 9-4/10",
            "bytes 4-10/10",
            "bytes 4-9/*",
            "bytes 0-18446744073709551615/10",
        ] {
            assert_eq!(complete_range(value), None);
        }
    }

    #[tokio::test]
    async fn quota_evicts_only_unpinned_app_cache_and_preserves_media_index() {
        let directory = tempfile::tempdir().unwrap();
        let pool = crate::db::test_pool().await.unwrap();
        let state = AppState {
            pool,
            database_path: directory.path().join("test.db"),
            data_directory: directory.path().into(),
            cover_cache_path: directory.path().join("covers"),
            thumbnail_cache_path: directory.path().join("thumbnails"),
        };
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type) VALUES('r','webdav://r','video',1,'now','now','webdav')").execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES('r','fixture','http://localhost/dav/','','unused')").execute(&state.pool).await.unwrap();
        let ids = [Uuid::new_v4().to_string(), Uuid::new_v4().to_string()];
        for (index, id) in ids.iter().enumerate() {
            sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES(?,?,'video.mkv','mkv','video',10,'now','now')").bind(id).bind(format!("webdav://r/{id}")).execute(&state.pool).await.unwrap();
            sqlx::query("INSERT INTO remote_files(media_file_id,source_id,href) VALUES(?,'r',?)")
                .bind(id)
                .bind(format!("/dav/{id}"))
                .execute(&state.pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO remote_cache(media_file_id,revision,size,completed,pinned,accessed_at) VALUES(?,'v1',10,1,?,'now')").bind(id).bind(index==1).execute(&state.pool).await.unwrap();
            let path = cache_path(&state, id, "mkv", false).unwrap();
            tokio::fs::create_dir_all(path.parent().unwrap())
                .await
                .unwrap();
            tokio::fs::write(path, b"0123456789").await.unwrap();
        }
        assert_eq!(make_room(&state, "incoming", 5, 15).await.unwrap(), 10);
        assert!(!cache_path(&state, &ids[0], "mkv", false).unwrap().exists());
        assert!(cache_path(&state, &ids[1], "mkv", false).unwrap().exists());
        assert!(make_room(&state, "incoming", 10, 15).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_files")
                .fetch_one(&state.pool)
                .await
                .unwrap(),
            2
        );
    }
}
