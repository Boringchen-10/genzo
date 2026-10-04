use crate::{android_bridge, db::AppState, error::{AppError, AppResult}};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

// Native playback continues while the React WebView is backgrounded. SQLite is
// written here; native preferences retain the last sample across process death.
static SESSION: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub async fn set_android_appearance(dark: bool) -> AppResult<()> {
    android_bridge::call("appearance", json!({"dark":dark})).await?;
    Ok(())
}

async fn persist(pool: &SqlitePool, sample: &Value) -> AppResult<()> {
    let Some(id) = sample["mediaFileId"].as_str() else { return Ok(()) };
    let (Some(position), Some(duration), Some(timestamp)) = (sample["positionMs"].as_i64(), sample["durationMs"].as_i64(), sample["updatedAtMs"].as_i64()) else { return Ok(()) };
    if position < 0 || duration <= 0 || position > duration { return Ok(()) }
    let Some(updated) = chrono::DateTime::from_timestamp_millis(timestamp) else { return Ok(()) };
    let (_guard, mut tx) = crate::db::begin_write(pool).await?;
    // Only indexed SAF videos may contribute Android playback records.
    let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM android_documents d JOIN media_files m ON m.id=d.media_file_id WHERE m.id=? AND m.media_type='video')")
        .bind(id).fetch_one(&mut *tx).await?;
    if valid {
        sqlx::query("INSERT INTO playback_progress(media_file_id,tool_id,position_ms,duration_ms,completed,updated_at) VALUES(?,NULL,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET tool_id=NULL,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,updated_at=excluded.updated_at WHERE excluded.updated_at>playback_progress.updated_at")
            .bind(id).bind(position).bind(duration).bind(sample["status"] == "ended" || position >= duration.saturating_sub(2000))
            .bind(updated.to_rfc3339()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

fn snapshot(raw: Value) -> Value {
    let state = raw["status"].as_str().unwrap_or("idle");
    let error = match state {
        "permission_denied" => Some(json!({"code":"permission_denied","message":"目录授权已失效，请重新授权来源","retryable":true})),
        "playback_error" => Some(json!({"code":"unknown","message":"播放失败，请检查文件与来源，或换一个文件重试","retryable":true})),
        _ => None,
    };
    let tracks = |key: &str| raw[key].as_array().map(|items| items.iter().map(|track| json!({"id":track["id"].to_string(),"label":track["name"],"kind":"embedded","available":true})).collect::<Vec<_>>()).unwrap_or_default();
    json!({"sessionId":raw["sessionId"],"mediaFileId":raw["mediaFileId"],"revision":raw["revision"].as_u64().unwrap_or(0),
        "status":if error.is_some() { "error" } else { state },"positionMs":raw["positionMs"].as_i64().unwrap_or(0).max(0),
        "durationMs":raw["durationMs"].as_i64().filter(|value| *value>0),"seekable":raw["seekable"].as_bool().unwrap_or(false),
        "rate":raw["rate"].as_f64().unwrap_or(1.),"audioTracks":tracks("audioTracks"),"subtitleTracks":tracks("subtitleTracks"),
        "audioTrackId":raw["audioTrack"].as_i64().map(|id| id.to_string()),"subtitleTrackId":raw["subtitleTrack"].as_i64().map(|id| id.to_string()),
        "subtitleOffsetMs":raw["subtitleDelayUs"].as_i64().unwrap_or(0)/1000,"error":error})
}

async fn sync_saved(pool: &SqlitePool) -> AppResult<()> {
    persist(pool, &android_bridge::call("savedPlayerProgress", json!({})).await?).await
}

#[tauri::command]
pub async fn get_internal_player_state(session_id: Option<String>, state: State<'_, AppState>) -> AppResult<Value> {
    sync_saved(&state.pool).await?;
    let current = snapshot(android_bridge::call("playerState", json!({})).await?);
    if session_id.as_deref().is_some_and(|id| current["sessionId"].as_str() != Some(id)) {
        return Err(AppError::Validation("播放会话已过期".into()));
    }
    Ok(current)
}

#[tauri::command]
pub async fn open_internal_player(media_file_id: String, restart: bool, state: State<'_, AppState>) -> AppResult<Value> {
    sync_saved(&state.pool).await?;
    let row: Option<(String, bool, bool)> = sqlx::query_as("SELECT d.uri,m.missing,r.enabled FROM android_documents d JOIN media_files m ON m.id=d.media_file_id JOIN library_roots r ON r.id=d.source_id WHERE m.id=? AND m.media_type='video'")
        .bind(&media_file_id).fetch_optional(&state.pool).await?;
    let (uri, missing, enabled) = row.ok_or_else(|| AppError::Validation("当前播放入口支持已索引的本地视频；WebDAV 播放正在接入".into()))?;
    if missing || !enabled { return Err(AppError::Validation("文件缺失或来源已停用，请检查来源后重试".into())); }
    let previous: Option<(i64, bool)> = sqlx::query_as("SELECT position_ms,completed FROM playback_progress WHERE media_file_id=?")
        .bind(&media_file_id).fetch_optional(&state.pool).await?;
    let resume = if restart { 0 } else { previous.filter(|(_, completed)| !completed).map(|(position, _)| position).unwrap_or(0) };
    let session = Uuid::new_v4().to_string();
    android_bridge::call("openPlayer", json!({"uri":uri,"restart":restart,"resumeMs":resume,"mediaFileId":media_file_id,"sessionId":session})).await?;
    *SESSION.lock().map_err(|_| AppError::System("播放会话不可用".into()))? = Some(session.clone());
    let pool = state.pool.clone();
    let owned_session = session.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_saved = tokio::time::Instant::now() - std::time::Duration::from_secs(5);
        let mut last_status = String::new();
        for attempt in 0.. {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if SESSION.lock().ok().and_then(|value| value.clone()).as_deref() != Some(&owned_session) { break; }
            let Ok(sample) = android_bridge::call("playerState", json!({})).await else { break; };
            if sample["sessionId"].as_str() != Some(&owned_session) {
                if attempt < 40 { continue; } else { break; }
            }
            let status = sample["status"].as_str().unwrap_or("");
            if status != last_status || last_saved.elapsed().as_secs() >= 5 {
                if persist(&pool, &sample).await.is_ok() { last_saved = tokio::time::Instant::now(); last_status = status.into(); }
            }
            if matches!(status, "closed" | "ended" | "permission_denied" | "playback_error") { break; }
        }
    });
    Ok(snapshot(json!({"sessionId":session,"mediaFileId":media_file_id,"status":"opening","positionMs":resume})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn progress_uses_stable_media_id_and_rejects_stale_invalid_or_unindexed_samples() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at) VALUES('s','saf://s','video',1,'t','t'); INSERT INTO android_saf_sources VALUES('s','content://p/tree/a','Test'); INSERT INTO works(id,title,type,favorite,notes,created_at,updated_at) VALUES('w','Work','video',1,'Keep','t','t'); INSERT INTO media_files(id,work_id,library_root_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES('f','w','s','saf://s/ab','a.mp4','mp4','video',1,'t','t'); INSERT INTO android_documents VALUES('f','s','ab','content://p/a','content://p/tree/a','a.mp4');").execute(&pool).await.unwrap();
        let sample = json!({"mediaFileId":"f","positionMs":12345,"durationMs":40000,"updatedAtMs":100000,"status":"paused"});
        persist(&pool,&sample).await.unwrap();
        for bad in [json!({"positionMs":1,"updatedAtMs":90000}), json!({"positionMs":-1}), json!({"positionMs":50000}), json!({"mediaFileId":"unknown"})] {
            let mut changed=sample.clone(); for (key,value) in bad.as_object().unwrap() { changed[key]=value.clone(); }
            persist(&pool,&changed).await.unwrap();
        }
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT position_ms FROM playback_progress WHERE media_file_id='f'").fetch_one(&pool).await.unwrap(),12345);
        assert_eq!(sqlx::query_as::<_,(bool,String)>("SELECT favorite,notes FROM works WHERE id='w'").fetch_one(&pool).await.unwrap(),(true,"Keep".into()));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM playback_progress").fetch_one(&pool).await.unwrap(),1);
    }
}
