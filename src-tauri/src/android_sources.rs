use crate::{android_bridge, db::AppState, error::{AppError, AppResult}, scanner};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VideoSource {
    id: String,
    kind: String,
    label: String,
    enabled: bool,
    state: String,
    last_scanned_at: Option<String>,
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEntry {
    pub document_id: String,
    pub name: String,
    pub mime_type: String,
    pub size: Option<i64>,
    pub modified_ms: Option<i64>,
    pub uri: String,
}

#[derive(Deserialize)]
pub struct Directory {
    pub status: String,
    pub label: Option<String>,
    #[serde(default)]
    pub files: Vec<DocumentEntry>,
}

#[derive(Debug)]
pub struct DocumentLocator {
    pub path: String,
    pub document_id: String,
    pub uri: String,
    pub parent_uri: String,
    pub relative_path: String,
}

// Document IDs are opaque and case-sensitive, even on providers with file-like IDs.
// A stable locator does not depend on a display name or a Windows path.
pub fn virtual_path(source_id: &str, document_id: &str) -> String {
    let id: String = document_id.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect();
    format!("saf://{source_id}/{id}")
}

pub async fn directory(uri: &str) -> AppResult<Directory> {
    let response = tokio::time::timeout(std::time::Duration::from_secs(20),
        android_bridge::call("listTree", json!({"uri": uri}))).await
        .map_err(|_| AppError::System("source_offline：目录查询超时，请重试".into()))??;
    Ok(serde_json::from_value(response)?)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<VideoSource>> {
    let mut sources: Vec<VideoSource> = sqlx::query_as("SELECT r.id,CASE WHEN s.source_id IS NOT NULL THEN 'saf' ELSE 'webdav' END kind,COALESCE(s.label,w.name) label,r.enabled,CASE r.availability WHEN 'online' THEN 'available' WHEN 'unknown' THEN 'checking' WHEN 'permission_denied' THEN 'permission_denied' WHEN 'credential_invalid' THEN 'credential_invalid' WHEN 'connection_failed' THEN 'connection_failed' WHEN 'not_authorized' THEN 'not_authorized' ELSE 'offline' END state,r.last_scanned_at FROM library_roots r LEFT JOIN android_saf_sources s ON s.source_id=r.id LEFT JOIN remote_sources w ON w.id=r.id WHERE r.kind='video' AND (s.source_id IS NOT NULL OR w.id IS NOT NULL) ORDER BY label")
        .fetch_all(pool).await?;
    for source in &mut sources {
        source.error = match source.state.as_str() {
            "permission_denied" | "not_authorized" => Some(failure("permission_denied")),
            "credential_invalid" => Some(failure("credential_invalid")),
            "offline" => Some(failure("source_offline")),
            "connection_failed" => Some(failure("connection_failed")),
            _ => None,
        };
    }
    Ok(sources)
}

pub fn failure(message: &str) -> Value {
    let (code,text) = if message.contains("credential_invalid") { ("credential_invalid","来源认证失败，请更新账号和密码") }
        else if message.contains("permission_denied") { ("permission_denied","读取权限已失效，请重新授权或检查服务权限") }
        else if message.contains("range_unsupported") { ("range_unsupported","服务器未提供有效的 Range 支持，请检查 WebDAV 服务") }
        else if message.contains("network_timeout") { ("network_timeout","连接超时，请检查网络后重试") }
        else if message.contains("source_offline") { ("source_offline","来源暂时离线，索引和个人记录已保留") }
        else { ("unknown","无法连接来源，请检查地址、网络和服务状态后重试") };
    json!({"code":code,"message":text,"retryable":true})
}

pub async fn set_failure(pool: &SqlitePool, source_id: &str, error: &Value) -> AppResult<()> {
    let state = match error["code"].as_str() {
        Some("credential_invalid") => "credential_invalid",
        Some("permission_denied") => "permission_denied",
        Some("source_offline") => "offline",
        Some("range_unsupported") => "online",
        _ => "connection_failed",
    };
    sqlx::query("UPDATE library_roots SET availability=? WHERE id=?").bind(state).bind(source_id).execute(pool).await?;
    notify(pool, source_id).await?;
    Ok(())
}

pub async fn notify(pool: &SqlitePool, source_id: &str) -> AppResult<()> {
    if let Some(source) = list(pool).await?.into_iter().find(|source| source.id == source_id) {
        crate::android_events::source(&source);
    }
    Ok(())
}

async fn save_source(pool: &SqlitePool, uri: &str, label: &str, source_id: Option<&str>) -> AppResult<String> {
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 128 || !uri.starts_with("content://") {
        return Err(AppError::Validation("请提供有效的安卓目录和不超过 128 字的来源名称".into()));
    }
    let (_guard, mut tx) = crate::db::begin_write(pool).await?;
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT source_id,tree_uri FROM android_saf_sources WHERE tree_uri=? OR source_id=?")
        .bind(uri).bind(source_id).fetch_optional(&mut *tx).await?;
    if source_id.is_some_and(|id| existing.as_ref().is_none_or(|(old_id, old_uri)| id != old_id || old_uri != uri)) {
        return Err(AppError::Validation("重新授权须选择原目录；其他目录请添加为新来源".into()));
    }
    let id = existing.map(|(id, _)| id).unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type,availability,destination) VALUES(?,?,'video',1,?,?,'local','online','media') ON CONFLICT(id) DO UPDATE SET availability='online',updated_at=excluded.updated_at")
        .bind(&id).bind(format!("saf://{id}")).bind(&now).bind(&now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO android_saf_sources(source_id,tree_uri,label) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET label=excluded.label")
        .bind(&id).bind(uri).bind(label).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn authorize_video_source(label: Option<String>, source_id: Option<String>, reuse_authorized: Option<bool>, state: State<'_, AppState>) -> AppResult<Value> {
    // Import only the most recently selected tree, after validating its persisted grant.
    // This lets the already-authorized first-stage directory become a business source.
    let picked = android_bridge::call(if reuse_authorized == Some(true) { "listTree" } else { "pickTree" }, json!({})).await?;
    let status = picked["status"].as_str().unwrap_or("permission_denied");
    if !matches!(status, "authorized" | "available") {
        return Ok(json!({"status": if status == "cancelled" { "cancelled" } else { "permission_denied" }}));
    }
    let uri = picked["uri"].as_str().ok_or_else(|| AppError::Validation("系统未返回授权目录".into()))?;
    let checked = directory(uri).await?;
    if checked.status != "available" { return Ok(json!({"status":"permission_denied"})); }
    let label = label.or(checked.label).unwrap_or_else(|| "本地视频".into());
    let id = save_source(&state.pool, uri, &label, source_id.as_deref()).await?;
    let source = list(&state.pool).await?.into_iter().find(|source| source.id == id);
    if let Some(source) = &source { crate::android_events::source(source); }
    Ok(json!({"status":"authorized", "source":source}))
}

#[tauri::command]
pub async fn get_video_source_states(state: State<'_, AppState>) -> AppResult<Vec<VideoSource>> { list(&state.pool).await }

#[tauri::command]
pub async fn scan_video_source(source_id: String, state: State<'_, AppState>) -> AppResult<Value> {
    if !list(&state.pool).await?.iter().any(|source| source.id == source_id && source.enabled) {
        return Err(AppError::Validation("请选择启用的 SAF 或 WebDAV 视频来源".into()));
    }
    let prepared = scanner::prepare_scan(&state.pool, &source_id, None).await?;
    sqlx::query("UPDATE library_roots SET availability='unknown' WHERE id=?").bind(&source_id).execute(&state.pool).await?;
    notify(&state.pool, &source_id).await?;
    let task_id = prepared.id().to_owned();
    let pool = state.pool.clone();
    tauri::async_runtime::spawn(async move { let _ = scanner::run_prepared(&pool, prepared).await; });
    Ok(json!({"taskId":task_id}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_identity_is_case_sensitive_and_not_a_filesystem_path() {
        assert_ne!(virtual_path("source", "A.mkv"), virtual_path("source", "a.mkv"));
        assert_ne!(virtual_path("source", "A.mkv"), virtual_path("other", "A.mkv"));
        assert!(!virtual_path("source", "x/../a.mkv").contains(".."));
    }

    #[tokio::test]
    async fn migration_preserves_baseline_personal_records_and_reauthorization_identity() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut baseline = sqlx::migrate!("./migrations");
        baseline.migrations = std::borrow::Cow::Owned(baseline.migrations.into_owned().into_iter().filter(|m| m.version <= 24).collect());
        baseline.run(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO works(id,title,type,favorite,notes,created_at,updated_at) VALUES('w','保留记录','video',1,'私人备注','t','t'); INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,size,created_at,updated_at) VALUES('f','w','C:/test.mkv','test.mkv','mkv','video',42,'t','t'); INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('f',12345,40000,'t');").execute(&pool).await.unwrap();
        let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        crate::migration_compat::run(&pool).await.unwrap();
        assert_eq!(sqlx::query_as::<_, (i64, Vec<u8>)>("SELECT version,checksum FROM _sqlx_migrations WHERE version<=24 ORDER BY version").fetch_all(&pool).await.unwrap(), checksums);
        assert_eq!(sqlx::query_as::<_, (bool, String, i64)>("SELECT w.favorite,w.notes,p.position_ms FROM works w JOIN media_files m ON m.work_id=w.id JOIN playback_progress p ON p.media_file_id=m.id").fetch_one(&pool).await.unwrap(), (true,"私人备注".into(),12345));
        let id = save_source(&pool, "content://provider/tree/test", "测试", None).await.unwrap();
        assert_eq!(save_source(&pool, "content://provider/tree/test", "改名", Some(&id)).await.unwrap(), id);
        assert!(save_source(&pool, "content://provider/tree/other", "错误目录", Some(&id)).await.is_err());
        assert_eq!(list(&pool).await.unwrap().len(), 1);
        assert_eq!(sqlx::query_scalar::<_, String>("PRAGMA integrity_check").fetch_one(&pool).await.unwrap(), "ok");
        assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&pool).await.unwrap().is_empty());
    }
}
