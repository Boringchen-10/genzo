use crate::{
    db::AppState,
    error::{AppError, AppResult},
    launcher,
};
use serde::Serialize;
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub media_file_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip)]
    owner: String,
}
static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    SESSIONS.get_or_init(Default::default)
}
pub fn relocation_busy(id: &str) -> bool {
    sessions().lock().map(|s| s.get(id).is_some_and(|entry| matches!(entry.status.as_str(), "connecting" | "tracking"))).unwrap_or(true)
}
fn status(id: &str, owner: &str, state: &str, message: &str) {
    if let Ok(mut entries) = sessions().lock() {
        if let Some(entry) = entries.get_mut(id).filter(|entry| entry.owner == owner) {
            entry.status = state.into();
            entry.message = message.into();
        }
    }
}
fn claim(id: &str, owner: &str) -> bool {
    let Ok(mut entries) = sessions().lock() else {
        return false;
    };
    if entries.get(id).is_some_and(|entry| {
        entry.owner != owner && matches!(entry.status.as_str(), "connecting" | "tracking")
    }) {
        return false;
    }
    if entries.len() >= 128 {
        entries.retain(|_, entry| matches!(entry.status.as_str(), "connecting" | "tracking"));
    }
    entries.insert(
        id.into(),
        Session {
            media_file_id: id.into(),
            status: "connecting".into(),
            message: "正在确认当前播放文件".into(),
            owner: owner.into(),
        },
    );
    true
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub media_file_id: String,
    pub work_id: Option<String>,
    pub file_name: String,
    pub title: String,
    pub tool_id: Option<String>,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub completed: bool,
    pub updated_at: String,
    pub missing: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub items: Vec<Progress>,
    pub sessions: Vec<Session>,
}

#[tauri::command]
pub async fn get_playback_progress(
    work_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> AppResult<Overview> {
    overview(&state.pool, work_id.as_deref()).await
}
pub async fn overview(pool: &SqlitePool, work_id: Option<&str>) -> AppResult<Overview> {
    let items = sqlx::query_as::<_, Progress>(
        "SELECT p.*, m.work_id, m.file_name, COALESCE(w.title, m.file_name) AS title, m.missing FROM playback_progress p JOIN media_files m ON m.id=p.media_file_id LEFT JOIN works w ON w.id=m.work_id WHERE (? IS NULL OR m.work_id=?) ORDER BY p.updated_at DESC LIMIT 100")
        .bind(work_id).bind(work_id).fetch_all(pool).await?;
    let sessions = sessions()
        .lock()
        .map(|s| s.values().cloned().collect())
        .unwrap_or_default();
    Ok(Overview { items, sessions })
}

#[tauri::command]
pub async fn resume_playback(
    media_file_id: String,
    restart: bool,
    state: tauri::State<'_, AppState>,
) -> AppResult<()> {
    let tool: Option<String> =
        sqlx::query_scalar("SELECT tool_id FROM playback_progress WHERE media_file_id=?")
            .bind(&media_file_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();
    let tool = tool.ok_or_else(|| {
        AppError::Validation("原播放工具已删除，请在详情页重新选择 PotPlayer 打开".into())
    })?;
    let executable: Option<String> =
        sqlx::query_scalar("SELECT executable_path FROM external_tools WHERE id=?")
            .bind(&tool)
            .fetch_optional(&state.pool)
            .await?;
    if !executable.as_deref().is_some_and(is_potplayer) {
        return Err(AppError::Validation(
            "原播放工具已更改，请在详情页重新选择 PotPlayer 打开".into(),
        ));
    }
    crate::commands::launch_media(media_file_id, Some(tool), false, Some(restart), state).await
}

pub fn is_potplayer(executable: &str) -> bool {
    let name = executable
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "potplayermini64.exe" | "potplayermini.exe" | "potplayer64.exe" | "potplayer.exe"
    )
}
fn resource_key(path: &str) -> String {
    let path = path.trim_end_matches('\0').trim_matches('"');
    if path.starts_with("http://") || path.starts_with("https://") || path.starts_with("webdav://")
    {
        return path.to_string(); // URLs and query tokens are case sensitive.
    }
    let decoded = reqwest::Url::parse(path)
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok());
    let value = decoded
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    let mut value = value.replace('/', "\\").to_lowercase();
    if let Some(rest) = value.strip_prefix(r"\\?\unc\") {
        value = format!(r"\\{rest}");
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        value = rest.to_string();
    }
    #[cfg(windows)]
    if value.as_bytes().get(1) == Some(&b':') {
        use windows::{
            core::{HSTRING, PWSTR},
            Win32::NetworkManagement::WNet::WNetGetConnectionW,
        };
        let mut buffer = [0u16; 4096];
        let mut length = buffer.len() as u32;
        let drive = HSTRING::from(&value[..2]);
        if unsafe { WNetGetConnectionW(&drive, Some(PWSTR(buffer.as_mut_ptr())), &mut length) }.0
            == 0
        {
            let end = buffer
                .iter()
                .position(|ch| *ch == 0)
                .unwrap_or(buffer.len());
            value = format!(
                "{}{}",
                String::from_utf16_lossy(&buffer[..end]).to_lowercase(),
                &value[2..]
            );
        }
    }
    value
}
pub fn same_resource(expected: &str, actual: &str) -> bool {
    resource_key(expected) == resource_key(actual)
}

async fn resolve_media(pool: &SqlitePool, path: &str) -> AppResult<Option<String>> {
    let key = resource_key(path);
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id,path FROM media_files WHERE media_type='video'")
            .fetch_all(pool)
            .await?;
    let mut matches = rows
        .into_iter()
        .filter(|(_, path)| resource_key(path) == key);
    let first = matches.next().map(|(id, _)| id);
    Ok(if matches.next().is_none() {
        first
    } else {
        None
    })
}

#[derive(Clone)]
struct Checkpoint {
    position: i64,
    duration: i64,
    at: String,
}
struct Tracking {
    id: String,
    path: String,
    owner: String,
    bound: bool,
    candidate: String,
    candidate_count: u8,
    resolve_after: Instant,
    seek: Option<i64>,
    pending: HashMap<String, Checkpoint>,
}
impl Tracking {
    fn new(id: String, path: String, owner: String, seek: Option<i64>) -> Self {
        Self {
            id,
            path,
            owner,
            bound: false,
            candidate: String::new(),
            candidate_count: 0,
            resolve_after: Instant::now(),
            seek,
            pending: HashMap::new(),
        }
    }
    async fn sample(
        &mut self,
        pool: &SqlitePool,
        path: &str,
        position: i64,
        duration: i64,
        playing: bool,
    ) -> AppResult<bool> {
        if path.is_empty() || !playing || !valid_sample(position, duration) {
            self.candidate_count = 0;
            return Ok(false);
        }
        if !same_resource(&self.path, path) {
            let key = resource_key(path);
            if self.candidate == key {
                self.candidate_count = self.candidate_count.saturating_add(1);
            } else {
                self.candidate = key;
                self.candidate_count = 1;
                self.resolve_after = Instant::now();
            }
            // Initial stale replies must not attach to another episode before the requested file opens.
            if !self.bound || self.candidate_count < 2 {
                return Ok(false);
            }
            if Instant::now() < self.resolve_after {
                return Ok(false);
            }
            self.resolve_after = Instant::now() + Duration::from_secs(5);
            if let Some(next) = resolve_media(pool, path).await? {
                if next != self.id {
                    if !claim(&next, &self.owner) {
                        status(
                            &self.id,
                            &self.owner,
                            "connecting",
                            "当前文件由另一播放窗口记录，等待切换；原进度已保留",
                        );
                        return Ok(false);
                    }
                    status(
                        &self.id,
                        &self.owner,
                        "stopped",
                        "已切换下一文件，上一集进度已保留",
                    );
                    self.id = next;
                }
                self.path = path.into();
                self.seek = None;
            } else {
                status(
                    &self.id,
                    &self.owner,
                    "connecting",
                    "当前文件尚未唯一匹配媒体库，正在等待；原进度已保留",
                );
                return Ok(false);
            }
        }
        if !seek_reached(position, self.seek) {
            return Ok(false);
        }
        self.bound = true;
        self.candidate.clear();
        self.candidate_count = 0;
        self.seek = None;
        self.pending.insert(
            self.id.clone(),
            Checkpoint {
                position,
                duration,
                at: chrono::Utc::now().to_rfc3339(),
            },
        );
        Ok(true)
    }
    async fn flush(&mut self, pool: &SqlitePool, tool: &str) -> AppResult<()> {
        // Old samples retain their observation time even if a failed write is retried after switching.
        let mut error = None;
        for (id, value) in self.pending.clone() {
            match save_at(pool, &id, tool, value.position, value.duration, &value.at).await {
                Ok(()) => {
                    self.pending.remove(&id);
                }
                Err(err) => error = Some(err),
            }
        }
        match error {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }
}
pub fn seek_argument(ms: i64) -> String {
    let ms = ms.max(0);
    format!(
        "/seek={:02}:{:02}:{:02}.{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
pub async fn resume_position(pool: &SqlitePool, id: &str, restart: bool) -> AppResult<Option<i64>> {
    if restart {
        return Ok(Some(0));
    }
    let row: Option<(i64, bool)> = sqlx::query_as(
        "SELECT position_ms, completed FROM playback_progress WHERE media_file_id=?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(position, complete)| if complete { 0 } else { position }))
}
fn valid_sample(position: i64, duration: i64) -> bool {
    duration > 0 && position > 0 && position <= duration
}
fn seek_reached(position: i64, target: Option<i64>) -> bool {
    target.is_none_or(|target| position >= target.saturating_sub(2_000))
}
#[cfg(test)]
async fn save(
    pool: &SqlitePool,
    id: &str,
    tool: &str,
    position: i64,
    duration: i64,
) -> AppResult<()> {
    save_at(
        pool,
        id,
        tool,
        position,
        duration,
        &chrono::Utc::now().to_rfc3339(),
    )
    .await
}
async fn save_at(
    pool: &SqlitePool,
    id: &str,
    tool: &str,
    position: i64,
    duration: i64,
    at: &str,
) -> AppResult<()> {
    if !valid_sample(position, duration) {
        return Ok(());
    }
    let completed = duration - position <= (duration / 100).min(10_000);
    let (_permit, mut tx) = crate::db::begin_write(pool).await?;
    sqlx::query("INSERT INTO playback_progress (media_file_id,tool_id,position_ms,duration_ms,completed,updated_at) SELECT id,?,?,?,?,? FROM media_files WHERE id=? ON CONFLICT(media_file_id) DO UPDATE SET tool_id=excluded.tool_id,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,updated_at=excluded.updated_at WHERE excluded.updated_at >= playback_progress.updated_at")
        .bind(tool).bind(position).bind(duration).bind(completed).bind(at).bind(id)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(windows)]
pub fn launch(
    pool: SqlitePool,
    id: String,
    tool: String,
    executable: &str,
    mut arguments: Vec<String>,
    directory: Option<&str>,
    path: String,
    seek: Option<i64>,
) -> AppResult<u32> {
    let owner = uuid::Uuid::new_v4().to_string();
    if !claim(&id, &owner) {
        return Err(AppError::Validation(
            "该文件已在 PotPlayer 中播放，请先关闭该播放窗口".into(),
        ));
    }
    // The configured template remains useful (subtitles/fullscreen), but session ownership
    // and the single requested media take precedence over instance/playlist switches.
    arguments.retain(|arg| {
        !matches!(
            arg.to_ascii_lowercase().as_str(),
            "/current" | "/new" | "/add" | "/insert"
        ) && !(seek.is_some() && arg.to_ascii_lowercase().starts_with("/seek="))
    });
    arguments.push("/new".into());
    if let Some(position) = seek {
        arguments.push(seek_argument(position));
    }
    let mut child = match launcher::spawn_executable(executable, &arguments, directory) {
        Ok(child) => child,
        Err(error) => {
            status(&id, &owner, "error", "PotPlayer 启动失败，原进度已保留");
            return Err(error);
        }
    };
    let pid = child.id();
    std::thread::spawn(move || {
        let mut client = match crate::potplayer::Client::connect(child.id()) {
            Ok(client) => client,
            Err(_) => {
                status(
                    &id,
                    &owner,
                    "error",
                    "播放器已打开，但进度接口无法连接；原进度已保留",
                );
                return;
            }
        };
        let mut tracker = Tracking::new(id, path, owner, seek);
        let mut last_write = Instant::now() - Duration::from_secs(5);
        let mut last_valid = Instant::now();
        loop {
            if !matches!(child.try_wait(), Ok(None)) {
                break;
            }
            if let Some(sample) = client.sample() {
                let result = tauri::async_runtime::block_on(tracker.sample(
                    &pool,
                    &sample.path,
                    sample.position,
                    sample.duration,
                    matches!(sample.status, 1 | 2),
                ));
                if result.is_err() {
                    status(
                        &tracker.id,
                        &tracker.owner,
                        "connecting",
                        "暂时无法核对播放文件，正在重试；旧记录已保留",
                    );
                }
                if matches!(result, Ok(true)) {
                    last_valid = Instant::now();
                }
            }
            if last_write.elapsed() >= Duration::from_secs(5) {
                let has_current = tracker.pending.contains_key(&tracker.id)
                    && last_valid.elapsed() < Duration::from_secs(2);
                match tauri::async_runtime::block_on(tracker.flush(&pool, &tool)) {
                    Ok(()) if has_current => status(
                        &tracker.id,
                        &tracker.owner,
                        "tracking",
                        "正在记录 PotPlayer 进度（约每 5 秒保存）",
                    ),
                    Err(_) => status(
                        &tracker.id,
                        &tracker.owner,
                        "tracking",
                        "暂时无法保存进度，正在重试；旧记录已保留",
                    ),
                    _ => {}
                }
                last_write = Instant::now();
            }
            if last_valid.elapsed() >= Duration::from_secs(30) {
                status(
                    &tracker.id,
                    &tracker.owner,
                    "connecting",
                    "等待确认当前文件与有效播放位置，旧记录已保留",
                );
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        let result = tauri::async_runtime::block_on(tracker.flush(&pool, &tool));
        status(
            &tracker.id,
            &tracker.owner,
            if result.is_ok() { "stopped" } else { "error" },
            if result.is_ok() {
                "播放窗口已关闭，保留最近一次保存的位置"
            } else {
                "最后一次进度保存失败，保留此前成功保存的位置"
            },
        );
    });
    Ok(pid)
}

#[cfg(not(windows))]
pub fn launch(
    _pool: SqlitePool,
    _id: String,
    _tool: String,
    executable: &str,
    arguments: Vec<String>,
    directory: Option<&str>,
    _path: String,
    _seek: Option<i64>,
) -> AppResult<u32> {
    launcher::launch_executable(executable, &arguments, directory).map(|_| 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn tracker_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO external_tools(id,name,executable_path,created_at,updated_at) VALUES('t','PotPlayer','test.exe','','')").execute(&pool).await.unwrap();
        for (id, path) in [
            ("a", r"\\server\share\第 01 集.mkv"),
            ("b", r"\\server\share\第 02 集.mkv"),
            ("c", r"D:\other\第 02 集.mkv"),
        ] {
            sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,created_at,updated_at) VALUES(?,?,'episode','mkv','video','','')").bind(id).bind(path).execute(&pool).await.unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn startup_noise_switch_unknown_and_return_keep_file_identity() {
        let pool = tracker_pool().await;
        let owner = uuid::Uuid::new_v4().to_string();
        let mut tracker = Tracking::new(
            "a".into(),
            r"\\?\UNC\server\share\第 01 集.mkv".into(),
            owner,
            Some(10_000),
        );
        // A stale startup response must neither end tracking nor overwrite another file.
        for _ in 0..3 {
            tracker
                .sample(&pool, r"D:\other\第 02 集.mkv", 1000, 100_000, true)
                .await
                .unwrap();
        }
        assert!(tracker.pending.is_empty());
        tracker
            .sample(
                &pool,
                "file://server/share/%E7%AC%AC%2001%20%E9%9B%86.mkv",
                1000,
                100_000,
                true,
            )
            .await
            .unwrap();
        assert!(tracker.pending.is_empty(), "initial seek not reached");
        tracker
            .sample(&pool, r"\\server\share\第 01 集.mkv", 90_000, 100_000, true)
            .await
            .unwrap();
        tracker
            .sample(&pool, r"\\server\share\第 02 集.mkv", 2000, 100_000, true)
            .await
            .unwrap();
        assert_eq!(
            tracker.id, "a",
            "one transient reply cannot switch identity"
        );
        tracker
            .sample(&pool, r"\\server\share\第 02 集.mkv", 3000, 100_000, true)
            .await
            .unwrap();
        assert_eq!(tracker.id, "b");
        tracker.flush(&pool, "t").await.unwrap();
        assert_eq!(
            resume_position(&pool, "a", false).await.unwrap(),
            Some(90_000)
        );
        assert_eq!(
            resume_position(&pool, "b", false).await.unwrap(),
            Some(3000)
        );
        assert_eq!(
            overview(&pool, None).await.unwrap().items[0].media_file_id,
            "b"
        );
        for _ in 0..3 {
            tracker
                .sample(&pool, r"D:\unknown\第 02 集.mkv", 8000, 100_000, true)
                .await
                .unwrap();
        }
        assert!(
            tracker.pending.is_empty(),
            "same basename is not a library match"
        );
        tracker
            .sample(&pool, r"\\server\share\第 02 集.mkv", 4000, 100_000, true)
            .await
            .unwrap();
        tracker.flush(&pool, "t").await.unwrap();
        assert_eq!(
            resume_position(&pool, "b", false).await.unwrap(),
            Some(4000)
        );
        status("b", &tracker.owner, "stopped", "test complete");
    }

    #[tokio::test]
    async fn ambiguous_paths_and_old_retry_cannot_overwrite_newer_progress() {
        let pool = tracker_pool().await;
        sqlx::query("UPDATE media_files SET path='//SERVER/share/第 02 集.mkv' WHERE id='c'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(resolve_media(&pool, r"\\server\share\第 02 集.mkv")
            .await
            .unwrap()
            .is_none());
        save_at(&pool, "a", "t", 50_000, 100_000, "2026-09-26T12:00:00Z")
            .await
            .unwrap();
        save_at(&pool, "a", "t", 20_000, 100_000, "2026-09-26T11:00:00Z")
            .await
            .unwrap();
        assert_eq!(
            resume_position(&pool, "a", false).await.unwrap(),
            Some(50_000)
        );
    }

    #[test]
    fn session_owner_prevents_competing_writers() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(claim(&id, "first"));
        assert!(!claim(&id, "second"));
        status(&id, "first", "stopped", "done");
        assert!(claim(&id, "second"));
        status(&id, "first", "stopped", "late reply");
        assert_eq!(sessions().lock().unwrap()[&id].status, "connecting");
        status(&id, "second", "stopped", "done");
    }
    #[test]
    fn path_identity_and_sample_validation() {
        assert!(same_resource(
            r"\\?\UNC\server\share\EP 01.mkv",
            r"\\server\share\EP 01.mkv"
        ));
        assert!(same_resource(r"\\?\D:\Anime\01.mkv", "d:/anime/01.mkv"));
        assert!(!same_resource(
            "http://localhost/A?token=a",
            "http://localhost/a?token=a"
        ));
        assert!(!same_resource(r"D:\S1\01.mkv", r"D:\S2\01.mkv"));
        assert!(!valid_sample(0, 100));
        assert!(!valid_sample(101, 100));
        assert!(!seek_reached(1_000, Some(600_000)));
        assert!(seek_reached(599_000, Some(600_000)));
        assert!(seek_reached(1_000, None));
        assert_eq!(seek_argument(3_723_456), "/seek=01:02:03.456");
        assert!(is_potplayer(r"D:\播放器\PotPlayerMini64.exe"));
        assert!(is_potplayer(r"D:\potplayer\PotPlayer64.exe"));
        assert!(same_resource(
            r"\\?\unc\SERVER\share\01.mkv",
            r"\\server\share\01.mkv"
        ));
        assert!(!is_potplayer("potplayer-helper.exe"));
    }
    #[tokio::test]
    async fn progress_survives_rematch_and_invalid_samples() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','Work','video','',''),('w2','New','video','','')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO external_tools(id,name,executable_path,created_at,updated_at) VALUES('t','PotPlayer','test.exe','','')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES('m','w','fixture','fixture','mkv','video','','')").execute(&pool).await.unwrap();
        save(&pool, "m", "t", 20_000, 100_000).await.unwrap();
        save(&pool, "m", "t", 0, 100_000).await.unwrap();
        save(&pool, "m", "t", 101_000, 100_000).await.unwrap();
        assert_eq!(
            resume_position(&pool, "m", false).await.unwrap(),
            Some(20_000)
        );
        assert_eq!(resume_position(&pool, "m", true).await.unwrap(), Some(0));
        sqlx::query("UPDATE media_files SET path='moved',work_id='w2' WHERE id='m'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(overview(&pool, Some("w")).await.unwrap().items.is_empty());
        assert_eq!(
            overview(&pool, Some("w2")).await.unwrap().items[0].position_ms,
            20_000
        );
        save(&pool, "m", "t", 99_500, 100_000).await.unwrap();
        assert_eq!(resume_position(&pool, "m", false).await.unwrap(), Some(0));
        sqlx::query("DELETE FROM external_tools WHERE id='t'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(overview(&pool, None).await.unwrap().items[0]
            .tool_id
            .is_none());
        sqlx::query("DELETE FROM media_files WHERE id='m'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(overview(&pool, None).await.unwrap().items.is_empty());
    }

    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "Requires generated fixture and GENZO_POTPLAYER; switches only a dedicated test playlist"]
    async fn installed_player_tracks_next_episode() {
        let exe = std::env::var("GENZO_POTPLAYER").unwrap();
        let source = std::env::var("GENZO_PLAYBACK_FIXTURE").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let one = dir.path().join("第 01 集.avi");
        let two = dir.path().join("第 02 集.avi");
        std::fs::copy(&source, &one).unwrap();
        std::fs::copy(&source, &two).unwrap();
        let playlist = dir.path().join("test.dpl");
        std::fs::write(
            &playlist,
            format!(
                "DAUMPLAYLIST\n1*file*{}\n2*file*{}\n",
                one.display(),
                two.display()
            ),
        )
        .unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        for (id, path) in [(&a, &one), (&b, &two)] {
            sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,created_at,updated_at) VALUES(?,?,'test','avi','video','','')")
                .bind(id).bind(path.to_string_lossy().as_ref()).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO external_tools(id,name,executable_path,created_at,updated_at) VALUES('t','PotPlayer',?,'','')").bind(&exe).execute(&pool).await.unwrap();
        let pid = launch(
            pool.clone(),
            a.clone(),
            "t".into(),
            &exe,
            vec![playlist.to_string_lossy().into_owned()],
            None,
            one.to_string_lossy().into_owned(),
            Some(10_000),
        )
        .unwrap();
        struct Cleanup(crate::potplayer::Client);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.0.close();
            }
        }
        let mut player = Cleanup(crate::potplayer::Client::connect(pid).unwrap());
        for _ in 0..60 {
            if resume_position(&pool, &a, false).await.unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(
            resume_position(&pool, &a, false).await.unwrap().is_some(),
            "first Unicode-named episode must record"
        );
        let first_saved = resume_position(&pool, &a, false).await.unwrap().unwrap();
        assert!(
            (8000..25_000).contains(&first_saved),
            "first checkpoint {first_saved}"
        );
        player.0.next();
        for _ in 0..80 {
            if resume_position(&pool, &b, false).await.unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let second = resume_position(&pool, &b, false)
            .await
            .unwrap()
            .expect("next episode must record without relaunch");
        assert!((1..20_000).contains(&second));
        assert_eq!(
            overview(&pool, None).await.unwrap().items[0].media_file_id,
            b
        );
        player.0.close();
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(resume_position(&pool, &a, false).await.unwrap().unwrap() >= first_saved);
        pool.close().await;
    }

    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "Requires GENZO_POTPLAYER and generated GENZO_PLAYBACK_FIXTURE; opens test players"]
    async fn installed_player_saves_paused_progress_and_resumes() {
        let exe = std::env::var("GENZO_POTPLAYER").unwrap();
        let path = std::env::var("GENZO_PLAYBACK_FIXTURE").unwrap();
        let directory = tempfile::tempdir().unwrap();
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(directory.path().join("playback.db"))
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,created_at,updated_at) VALUES(?,?,'generated fixture','avi','video','','')").bind(&id).bind(&path).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO external_tools(id,name,executable_path,created_at,updated_at) VALUES('test','PotPlayer',?,'','')").bind(&exe).execute(&pool).await.unwrap();
        struct TestPlayer(crate::potplayer::Client);
        impl Drop for TestPlayer {
            fn drop(&mut self) {
                self.0.close();
            }
        }
        let first = launch(
            pool.clone(),
            id.clone(),
            "test".into(),
            &exe,
            vec![path.clone()],
            None,
            path.clone(),
            Some(15_000),
        )
        .unwrap();
        let mut player = TestPlayer(crate::potplayer::Client::connect(first).unwrap());
        let mut ready = false;
        let mut last_observation = None;
        for _ in 0..120 {
            if let Some(sample) = player.0.sample() {
                let identity = same_resource(&path, &sample.path);
                last_observation =
                    Some((sample.position, sample.duration, sample.status, identity));
                if identity && sample.position >= 15_000 && sample.status == 2 {
                    ready = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(
            ready,
            "test player did not reach requested seek: {last_observation:?}"
        );
        player.0.pause();
        tokio::time::sleep(Duration::from_secs(6)).await;
        let saved = resume_position(&pool, &id, false)
            .await
            .unwrap()
            .unwrap_or_else(|| {
                panic!(
                    "actual player checkpoint not saved; session={:?}",
                    sessions()
                        .lock()
                        .unwrap()
                        .get(&id)
                        .map(|s| (&s.status, &s.message))
                )
            });
        assert!((15_000..25_000).contains(&saved), "saved {saved}");
        assert!(
            launch(
                pool.clone(),
                id.clone(),
                "test".into(),
                &exe,
                vec![path.clone()],
                None,
                path.clone(),
                Some(saved)
            )
            .is_err(),
            "duplicate session rejected"
        );
        player.0.close();
        drop(player);
        for _ in 0..30 {
            if sessions()
                .lock()
                .unwrap()
                .get(&id)
                .is_some_and(|s| s.status == "stopped")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let seek = resume_position(&pool, &id, false).await.unwrap();
        let second = launch(
            pool.clone(),
            id.clone(),
            "test".into(),
            &exe,
            vec![path.clone()],
            None,
            path.clone(),
            seek,
        )
        .unwrap();
        let mut player = TestPlayer(crate::potplayer::Client::connect(second).unwrap());
        let mut resumed = false;
        let mut last_observation = None;
        for _ in 0..120 {
            if let Some(sample) = player.0.sample() {
                let identity = same_resource(&path, &sample.path);
                last_observation =
                    Some((sample.position, sample.duration, sample.status, identity));
                if identity
                    && seek_reached(sample.position, Some(saved))
                    && sample.position <= saved + 2000
                {
                    resumed = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(
            resumed,
            "reopened checkpoint {saved}; last sample {last_observation:?}"
        );
        player.0.close();
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(seek_reached(
            resume_position(&pool, &id, false).await.unwrap().unwrap(),
            Some(saved)
        ));
        pool.close().await;
    }
}
