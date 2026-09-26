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
}
static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    SESSIONS.get_or_init(Default::default)
}
fn status(id: &str, state: &str, message: &str) {
    if let Ok(mut entries) = sessions().lock() {
        entries.insert(
            id.into(),
            Session {
                media_file_id: id.into(),
                status: state.into(),
                message: message.into(),
            },
        );
    }
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
    matches!(name.as_str(), "potplayermini64.exe" | "potplayermini.exe")
}
pub fn same_resource(expected: &str, actual: &str) -> bool {
    if expected.starts_with("http://") || expected.starts_with("https://") {
        return expected == actual;
    }
    launcher::shell_compatible_path(expected)
        .replace('/', "\\")
        .to_lowercase()
        == launcher::shell_compatible_path(actual)
            .replace('/', "\\")
            .to_lowercase()
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
async fn save(
    pool: &SqlitePool,
    id: &str,
    tool: &str,
    position: i64,
    duration: i64,
) -> AppResult<()> {
    if !valid_sample(position, duration) {
        return Ok(());
    }
    let completed = duration - position <= (duration / 100).min(10_000);
    let (_permit, mut tx) = crate::db::begin_write(pool).await?;
    sqlx::query("INSERT INTO playback_progress (media_file_id,tool_id,position_ms,duration_ms,completed,updated_at) SELECT id,?,?,?,?,? FROM media_files WHERE id=? ON CONFLICT(media_file_id) DO UPDATE SET tool_id=excluded.tool_id,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,updated_at=excluded.updated_at")
        .bind(tool).bind(position).bind(duration).bind(completed).bind(chrono::Utc::now().to_rfc3339()).bind(id)
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
    // Reserve before spawning: repeated clicks must not race two writers for one file.
    {
        let mut entries = sessions()
            .lock()
            .map_err(|_| AppError::System("播放会话不可用".into()))?;
        if entries
            .get(&id)
            .is_some_and(|s| matches!(s.status.as_str(), "connecting" | "tracking"))
        {
            return Err(AppError::Validation(
                "该文件已在 PotPlayer 中播放，请先关闭该播放窗口".into(),
            ));
        }
        if entries.len() >= 128 {
            entries.retain(|_, s| matches!(s.status.as_str(), "connecting" | "tracking"));
        }
        entries.insert(
            id.clone(),
            Session {
                media_file_id: id.clone(),
                status: "connecting".into(),
                message: "正在连接 PotPlayer，等待文件和播放位置".into(),
            },
        );
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
            status(&id, "error", "PotPlayer 启动失败，原进度已保留");
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
                    "error",
                    "播放器已打开，但进度接口无法连接；原进度已保留",
                );
                return;
            }
        };
        let started = Instant::now();
        let mut last_write = Instant::now() - Duration::from_secs(5);
        let mut last_sample = None;
        let mut pending_sample = None;
        let mut failures = 0;
        let mut awaiting_seek = seek;
        let mut final_status = ("stopped", "播放窗口已关闭，保留最近一次保存的位置");
        loop {
            if !matches!(child.try_wait(), Ok(None)) {
                break;
            }
            if let Some(sample) = client.sample() {
                if !sample.path.is_empty() && !same_resource(&path, &sample.path) {
                    final_status = (
                        "changed",
                        "播放器已切换文件，已停止记录原文件；请从 Genzo 打开下一集",
                    );
                    break;
                }
                if same_resource(&path, &sample.path)
                    && matches!(sample.status, 1 | 2)
                    && valid_sample(sample.position, sample.duration)
                    && seek_reached(sample.position, awaiting_seek)
                {
                    awaiting_seek = None;
                    failures = 0;
                    let value = (sample.position, sample.duration);
                    pending_sample = Some(value);
                    if last_sample != Some(value) && last_write.elapsed() >= Duration::from_secs(5)
                    {
                        match tauri::async_runtime::block_on(save(
                            &pool, &id, &tool, value.0, value.1,
                        )) {
                            Ok(()) => {
                                last_sample = Some(value);
                                last_write = Instant::now();
                                status(&id, "tracking", "正在记录 PotPlayer 进度（约每 5 秒保存）");
                            }
                            Err(_) => {
                                status(&id, "tracking", "暂时无法保存进度，正在重试；旧记录已保留")
                            }
                        }
                    }
                } else {
                    failures += 1;
                }
            } else {
                failures += 1;
            }
            if started.elapsed() >= Duration::from_secs(60) && failures >= 15 {
                final_status = ("error", "无法读取有效播放位置或未成功跳转，已保留最后进度；请检查 PotPlayer 版本、权限和视频是否支持拖动");
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        if pending_sample != last_sample {
            if let Some((position, duration)) = pending_sample {
                if tauri::async_runtime::block_on(save(&pool, &id, &tool, position, duration))
                    .is_err()
                {
                    status(&id, "error", "最后一次进度保存失败，保留此前成功保存的位置");
                    return;
                }
            }
        }
        status(&id, final_status.0, final_status.1);
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
        for _ in 0..40 {
            if player
                .0
                .sample()
                .is_some_and(|s| s.position >= 15_000 && s.status == 2)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        player.0.pause();
        tokio::time::sleep(Duration::from_secs(6)).await;
        let saved = resume_position(&pool, &id, false)
            .await
            .unwrap()
            .expect("actual player checkpoint saved");
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
        for _ in 0..40 {
            if player.0.sample().is_some_and(|s| {
                same_resource(&path, &s.path) && s.position >= saved && s.position <= saved + 2000
            }) {
                resumed = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(
            resumed,
            "reopened player must resume from persisted checkpoint"
        );
        player.0.close();
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(resume_position(&pool, &id, false).await.unwrap().unwrap() >= saved);
        pool.close().await;
    }
}
