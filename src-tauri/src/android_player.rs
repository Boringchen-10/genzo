use crate::{android_bridge, db::AppState, error::{AppError, AppResult}};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

// Native playback continues while the React WebView is backgrounded. SQLite is
// written here; native preferences retain the last sample across process death.
struct Session {
    id: String,
    initial: Value,
    stream: Option<crate::remote_transfer::AndroidStream>,
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn current_sample(mut raw: Value) -> Value {
    if let Ok(session) = SESSION.lock() {
        if let Some(session) = session.as_ref() {
            if raw["sessionId"].as_str() != Some(&session.id) { return session.initial.clone(); }
            if raw["status"] != "closed" {
                if let Some(error) = session.stream.as_ref().and_then(|stream| stream.failure.as_ref()).and_then(|failure| failure.lock().ok().and_then(|error| error.clone())) {
                    raw["status"] = json!("error"); raw["error"] = error;
                }
            }
        }
    }
    raw
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PlayerAction {
    Play {},
    Pause {},
    Close {},
    Seek { #[serde(rename = "positionMs")] position_ms: i64 },
    Rate { speed: f64 },
    Audio { #[serde(rename = "trackId")] track_id: String },
    Subtitle { #[serde(rename = "trackId")] track_id: String },
    SubtitleDelay { #[serde(rename = "offsetMs")] offset_ms: i64 },
    Orientation { orientation: String },
}

impl PlayerAction {
    fn native(&self, current: &Value) -> AppResult<Value> {
        let invalid = || AppError::Validation("播放控制参数无效或当前文件不支持此操作".into());
        Ok(match self {
            Self::Play {} => json!({"action":"play"}),
            Self::Pause {} => json!({"action":"pause"}),
            Self::Close {} => json!({"action":"close"}),
            Self::Seek { position_ms } => {
                if !current["seekable"].as_bool().unwrap_or(false) || *position_ms < 0
                    || current["durationMs"].as_i64().is_none_or(|duration| *position_ms > duration) { return Err(invalid()); }
                json!({"action":"seek","value":position_ms})
            }
            Self::Rate { speed } => {
                if !speed.is_finite() || !(0.5..=2.).contains(speed) { return Err(invalid()); }
                json!({"action":"rate","value":speed})
            }
            Self::Audio { track_id } | Self::Subtitle { track_id } => {
                let audio = matches!(self, Self::Audio { .. });
                let key = if audio { "audioTracks" } else { "subtitleTracks" };
                if !current[key].as_array().is_some_and(|tracks| tracks.iter().any(|track| track["id"] == *track_id && track["available"] != false)) { return Err(invalid()); }
                json!({"action":if audio { "audio" } else { "subtitle" },"trackId":track_id})
            }
            Self::SubtitleDelay { offset_ms } => {
                if !(-60000..=60000).contains(offset_ms) { return Err(invalid()); }
                json!({"action":"subtitleOffset","value":offset_ms})
            }
            Self::Orientation { orientation } => {
                if !["portrait", "landscape", "system"].contains(&orientation.as_str()) { return Err(invalid()); }
                json!({"action":orientation})
            }
        })
    }
}

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
    // Only indexed Android-accessible videos may contribute playback records.
    let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files m WHERE m.id=? AND m.media_type='video' AND (EXISTS(SELECT 1 FROM android_documents d WHERE d.media_file_id=m.id) OR EXISTS(SELECT 1 FROM remote_files f WHERE f.media_file_id=m.id)))")
        .bind(id).fetch_one(&mut *tx).await?;
    if valid {
        let completed = !matches!(sample["status"].as_str(), Some("error" | "permission_denied" | "playback_error"))
            && (sample["status"] == "ended" || position >= duration.saturating_sub(2000));
        sqlx::query("INSERT INTO playback_progress(media_file_id,tool_id,position_ms,duration_ms,completed,updated_at) VALUES(?,NULL,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET tool_id=NULL,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,updated_at=excluded.updated_at WHERE excluded.updated_at>playback_progress.updated_at")
            .bind(id).bind(position).bind(duration).bind(completed)
            .bind(updated.to_rfc3339()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

fn snapshot(raw: Value) -> Value {
    let state = raw["status"].as_str().unwrap_or("idle");
    let error = raw.get("error").filter(|error| !error.is_null()).cloned().or_else(|| match state {
        "permission_denied" => Some(json!({"code":"permission_denied","message":"目录授权已失效，请重新授权来源","retryable":true})),
        "playback_error" => Some(json!({"code":"unknown","message":"播放失败，请检查文件与来源，或换一个文件重试","retryable":true})),
        _ => None,
    });
    let tracks = |key: &str| raw[key].as_array().map(|items| items.iter().map(|track| json!({"id":track["id"].as_str().map(str::to_owned).unwrap_or_else(|| track["id"].to_string()),"label":track["name"],"kind":track["kind"].as_str().unwrap_or("embedded"),"available":true})).collect::<Vec<_>>()).unwrap_or_default();
    json!({"sessionId":raw["sessionId"],"mediaFileId":raw["mediaFileId"],"revision":raw["revision"].as_u64().unwrap_or(0),
        "status":if error.is_some() { "error" } else { state },"positionMs":raw["positionMs"].as_i64().unwrap_or(0).max(0),
        "durationMs":raw["durationMs"].as_i64().filter(|value| *value>0),"seekable":raw["seekable"].as_bool().unwrap_or(false),
        "rate":raw["rate"].as_f64().unwrap_or(1.),"audioTracks":tracks("audioTracks"),"subtitleTracks":tracks("subtitleTracks"),
        "audioTrackId":raw["audioTrack"].as_i64().map(|id| id.to_string()),"subtitleTrackId":raw["selectedSidecar"].as_str().map(str::to_owned).or_else(|| raw["subtitleTrack"].as_i64().map(|id| id.to_string())),
        "subtitleOffsetMs":raw["subtitleOffsetMs"].as_i64().unwrap_or_else(|| raw["subtitleDelayUs"].as_i64().unwrap_or(0)/1000),"error":error})
}

async fn sync_saved(pool: &SqlitePool) -> AppResult<()> {
    persist(pool, &current_sample(android_bridge::call("savedPlayerProgress", json!({})).await?)).await
}

#[tauri::command]
pub async fn get_internal_player_state(session_id: Option<String>, state: State<'_, AppState>) -> AppResult<Value> {
    sync_saved(&state.pool).await?;
    let current = snapshot(current_sample(android_bridge::call("playerState", json!({})).await?));
    if session_id.as_deref().is_some_and(|id| current["sessionId"].as_str() != Some(id)) {
        return Err(AppError::Validation("播放会话已过期".into()));
    }
    Ok(current)
}

fn active_session(current: &Value, session: &str) -> AppResult<()> {
    if current["sessionId"].as_str() != Some(session) || matches!(current["status"].as_str(), Some("idle" | "closed")) {
        return Err(AppError::Validation("播放会话已过期，请重新打开文件".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn control_internal_player(session_id: String, action: PlayerAction, state: State<'_, AppState>) -> AppResult<Value> {
    let current = snapshot(current_sample(android_bridge::call("playerState", json!({})).await?));
    active_session(&current, &session_id)?;
    let mut payload = action.native(&current)?;
    payload["sessionId"] = json!(session_id);
    let raw = current_sample(android_bridge::call("playerControl", payload).await?);
    persist(&state.pool, &raw).await?;
    let current = snapshot(raw);
    crate::android_events::player(current.clone());
    Ok(current)
}

#[tauri::command]
pub async fn pick_external_subtitle(session_id: String) -> AppResult<Value> {
    active_session(&snapshot(android_bridge::call("playerState", json!({})).await?), &session_id)?;
    android_bridge::call("pickSubtitle", json!({"sessionId":session_id})).await
}

async fn subtitle_candidates(pool: &SqlitePool, media_id: &str) -> AppResult<Vec<Value>> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files WHERE id=? AND media_type='video')")
        .bind(media_id).fetch_one(pool).await?;
    if !exists { return Err(AppError::NotFound("视频文件不存在".into())); }
    let rows: Vec<(String, String, bool)> = sqlx::query_as(
        "SELECT DISTINCT s.id,s.file_name,NOT s.missing AND COALESCE(r.enabled,0) AND (d.media_file_id IS NOT NULL OR f.media_file_id IS NOT NULL)
         FROM subtitle_links l JOIN media_files s ON s.id=l.subtitle_media_file_id
         JOIN media_files v ON v.id=l.video_media_file_id
         LEFT JOIN library_roots r ON r.id=s.library_root_id
         LEFT JOIN android_documents d ON d.media_file_id=s.id LEFT JOIN remote_files f ON f.media_file_id=s.id
         WHERE v.id=? AND s.extension IN ('srt','ass','ssa') ORDER BY s.file_name,s.id")
        .bind(media_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(id,label,available)| json!({"id":id,"label":label,"kind":"sidecar","available":available})).collect())
}

#[tauri::command]
pub async fn list_subtitle_candidates(media_file_id: String, state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    subtitle_candidates(&state.pool, &media_file_id).await
}

fn select_candidate(candidates: &[Value], requested: Option<String>) -> AppResult<Option<String>> {
    let selected = requested.or_else(|| (candidates.len() == 1 && candidates[0]["available"] == true)
        .then(|| candidates[0]["id"].as_str().unwrap().to_owned()));
    if selected.as_ref().is_some_and(|id| !candidates.iter().any(|track| track["id"] == *id && track["available"] == true)) {
        return Err(AppError::Validation("字幕不属于此视频的可用候选，请重新选择".into()));
    }
    Ok(selected)
}

#[tauri::command]
pub async fn open_internal_player(media_file_id: String, restart: bool, subtitle_id: Option<String>, state: State<'_, AppState>) -> AppResult<Value> {
    sync_saved(&state.pool).await?;
    let row: Option<(Option<String>, bool, bool, String, String)> = sqlx::query_as("SELECT d.uri,m.missing,r.enabled,r.source_type,r.id FROM media_files m JOIN library_roots r ON r.id=m.library_root_id LEFT JOIN android_documents d ON d.media_file_id=m.id WHERE m.id=? AND m.media_type='video' AND (d.uri IS NOT NULL OR EXISTS(SELECT 1 FROM remote_files f WHERE f.media_file_id=m.id))")
        .bind(&media_file_id).fetch_optional(&state.pool).await?;
    let (local_uri, missing, enabled, kind, source_id) = row.ok_or_else(|| AppError::Validation("请选择已索引的 SAF 或 WebDAV 视频".into()))?;
    if missing || !enabled { return Err(AppError::Validation("文件缺失或来源已停用，请检查来源后重试".into())); }
    let previous: Option<(i64, bool)> = sqlx::query_as("SELECT position_ms,completed FROM playback_progress WHERE media_file_id=?")
        .bind(&media_file_id).fetch_optional(&state.pool).await?;
    let resume = if restart { 0 } else { previous.filter(|(_, completed)| !completed).map(|(position, _)| position).unwrap_or(0) };
    let session = Uuid::new_v4().to_string();
    let mut remote_stream = None;
    let uri = if kind == "webdav" {
        match crate::remote_transfer::stream_only(&state, &media_file_id).await {
            Ok(stream) => {
                sqlx::query("UPDATE library_roots SET availability='online' WHERE id=?").bind(&source_id).execute(&state.pool).await?;
                crate::android_sources::notify(&state.pool, &source_id).await?;
                let uri = stream.uri.clone(); remote_stream = Some(stream); uri
            },
            Err(error) => {
                let failure = crate::android_sources::failure(&error.to_string());
                crate::android_sources::set_failure(&state.pool, &source_id, &failure).await?;
                let raw = json!({"sessionId":session,"mediaFileId":media_file_id,"status":"error","error":failure});
                let current = snapshot(raw.clone());
                *SESSION.lock().map_err(|_| AppError::System("播放会话不可用".into()))? = Some(Session { id:session.clone(), initial:raw, stream:None });
                crate::android_events::player(current.clone());
                return Ok(current);
            }
        }
    } else { local_uri.ok_or_else(|| AppError::Validation("本地目录定位信息缺失".into()))? };
    let candidates = subtitle_candidates(&state.pool, &media_file_id).await?;
    // A choice among multiple candidates belongs to the user, not list ordering.
    let selected = select_candidate(&candidates, subtitle_id)?;
    let mut subtitle_file = None;
    let mut subtitle_label = None;
    let subtitle_uri: Option<String> = if let Some(id) = selected.as_ref() {
        subtitle_label = candidates.iter().find(|track| track["id"] == *id).and_then(|track| track["label"].as_str()).map(str::to_owned);
        let uri: Option<String> = sqlx::query_scalar("SELECT uri FROM android_documents WHERE media_file_id=?")
            .bind(id).fetch_optional(&state.pool).await?;
        if uri.is_none() { subtitle_file = Some(crate::remote_transfer::subtitle_file(&state, id).await?); }
        uri
    } else { None };
    let opened = android_bridge::call("openPlayer", json!({"uri":uri,"restart":restart,"resumeMs":resume,"mediaFileId":media_file_id,"sessionId":session,"subtitleUri":subtitle_uri,"subtitleFile":subtitle_file,"subtitleLabel":subtitle_label,"subtitleId":selected})).await;
    if let Err(error) = opened {
        if let Some(path) = subtitle_file { let _ = tokio::fs::remove_file(path).await; }
        return Err(error);
    }
    let initial = json!({"sessionId":session,"mediaFileId":media_file_id,"status":"opening","positionMs":resume});
    *SESSION.lock().map_err(|_| AppError::System("播放会话不可用".into()))? = Some(Session { id:session.clone(), initial:initial.clone(), stream:remote_stream });
    let pool = state.pool.clone();
    let owned_session = session.clone();
    let owned_source = source_id;
    tauri::async_runtime::spawn(async move {
        let mut last_saved = tokio::time::Instant::now() - std::time::Duration::from_secs(5);
        let mut last_status = String::new();
        for attempt in 0.. {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if !SESSION.lock().ok().is_some_and(|value| value.as_ref().is_some_and(|session| session.id == owned_session)) { break; }
            let Ok(raw) = android_bridge::call("playerState", json!({})).await else { break; };
            let sample = current_sample(raw);
            if sample["sessionId"].as_str() != Some(&owned_session) {
                if attempt < 40 { continue; } else { break; }
            }
            crate::android_events::player(snapshot(sample.clone()));
            let status = sample["status"].as_str().unwrap_or("");
            if status != last_status || last_saved.elapsed().as_secs() >= 5 {
                if persist(&pool, &sample).await.is_ok() { last_saved = tokio::time::Instant::now(); last_status = status.into(); }
            }
            if sample["error"].is_object() {
                let _ = crate::android_sources::set_failure(&pool, &owned_source, &sample["error"]).await;
                if let Ok(session) = SESSION.lock() { if let Some(stream) = session.as_ref().and_then(|session| session.stream.as_ref()) { stream.abort.abort(); } }
                break;
            }
            if matches!(status, "closed" | "permission_denied" | "playback_error") {
                if let Ok(mut session) = SESSION.lock() { if session.as_ref().is_some_and(|session| session.id == owned_session) { *session = None; } }
                break;
            }
        }
        if let Some(path) = subtitle_file { let _ = tokio::fs::remove_file(path).await; }
    });
    let opening = snapshot(initial);
    crate::android_events::player(opening.clone());
    Ok(opening)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upstream_interruption_overrides_native_end_and_stops_the_proxy_on_close() {
        let task = tokio::spawn(std::future::pending::<()>());
        let failure = std::sync::Arc::new(Mutex::new(Some(crate::android_sources::failure("source_offline"))));
        let stream = crate::remote_transfer::AndroidStream { uri:"private-resource".into(), failure:Some(failure), abort:task.abort_handle() };
        *SESSION.lock().unwrap() = Some(Session { id:"network".into(),initial:json!({"sessionId":"network","status":"opening"}),stream:Some(stream) });
        let sample = current_sample(json!({"sessionId":"network","status":"ended","positionMs":10000,"durationMs":40000}));
        assert_eq!(sample["status"],"error");
        assert_eq!(sample["error"]["code"],"source_offline");
        assert_eq!(snapshot(current_sample(json!({"sessionId":"network","status":"closed"})))["status"],"closed");
        *SESSION.lock().unwrap() = None;
        assert!(task.await.unwrap_err().is_cancelled());
    }

    #[test]
    fn multiple_or_unavailable_subtitles_require_a_valid_explicit_choice() {
        let tracks = vec![json!({"id":"srt","available":true}), json!({"id":"ass","available":true})];
        assert_eq!(select_candidate(&tracks,None).unwrap(),None);
        assert_eq!(select_candidate(&tracks,Some("ass".into())).unwrap(),Some("ass".into()));
        assert!(select_candidate(&tracks,Some("another-video".into())).is_err());
        assert_eq!(select_candidate(&tracks[..1],None).unwrap(),Some("srt".into()));
        let unavailable = vec![json!({"id":"srt","available":false})];
        assert_eq!(select_candidate(&unavailable,None).unwrap(),None);
        assert!(select_candidate(&unavailable,Some("srt".into())).is_err());
    }

    #[test]
    fn controls_reject_unknown_tracks_invalid_seek_and_expired_sessions() {
        let current = json!({"sessionId":"new","status":"playing","seekable":true,"durationMs":40000,
            "audioTracks":[{"id":"7"}],"subtitleTracks":[{"id":"42","available":true}]});
        assert!(active_session(&current,"old").is_err());
        assert!(active_session(&json!({"sessionId":"new","status":"closed"}),"new").is_err());
        assert_eq!(PlayerAction::Audio { track_id:"7".into() }.native(&current).unwrap()["trackId"],"7");
        assert!(PlayerAction::Audio { track_id:"0".into() }.native(&current).is_err());
        for position_ms in [-1, 40001] { assert!(PlayerAction::Seek { position_ms }.native(&current).is_err()); }
        assert!(PlayerAction::Seek { position_ms:0 }.native(&json!({"seekable":true,"durationMs":null})).is_err());
        assert!(PlayerAction::Rate { speed:f64::NAN }.native(&current).is_err());
        assert!(PlayerAction::SubtitleDelay { offset_ms:60001 }.native(&current).is_err());
        assert!(PlayerAction::Orientation { orientation:"invalid".into() }.native(&current).is_err());
        assert!(serde_json::from_value::<PlayerAction>(json!({"type":"play","uri":"content://untrusted"})).is_err());
        let public = snapshot(json!({"sessionId":"new","durationMs":0,"uri":"secret","subtitleTracks":[{"id":"sidecar:1","name":"Test","kind":"sidecar"}],"selectedSidecar":"sidecar:1","subtitleDelayUs":-500000}));
        assert_eq!(public["durationMs"],Value::Null);
        assert_eq!(public["subtitleTrackId"],"sidecar:1");
        assert_eq!(public["subtitleOffsetMs"],-500);
        assert!(public.get("uri").is_none());
    }
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
        let interrupted = json!({"mediaFileId":"f","positionMs":39500,"durationMs":40000,"updatedAtMs":110000,"status":"error"});
        persist(&pool,&interrupted).await.unwrap();
        assert!(!sqlx::query_scalar::<_,bool>("SELECT completed FROM playback_progress WHERE media_file_id='f'").fetch_one(&pool).await.unwrap());
    }
}
