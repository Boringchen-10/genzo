use crate::protocol::{
    valid_anchor, validate_value, Change, Clock, Conflict, Document, Episode, Origin,
    ViewingSession, WorkView,
};
use crate::transport::DavTransport;
use crate::{Error, Result};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Sqlite>;
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| Error::Invalid)
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|_| Error::Invalid)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub enabled: bool,
    pub running: bool,
    pub endpoint: Option<String>,
    pub library_id: Option<String>,
    pub device_id: String,
    pub last_success: Option<String>,
    pub pending: i64,
    pub conflicts: usize,
    pub error_code: Option<String>,
    pub message: Option<String>,
}
pub async fn initialize(pool: &SqlitePool) -> Result<()> {
    sqlx::query("UPDATE sync_runtime SET device_id=? WHERE id=1 AND device_id IS NULL")
        .bind(Uuid::new_v4().to_string())
        .execute(pool)
        .await?;
    Ok(())
}
pub async fn status(pool: &SqlitePool, running: bool) -> Result<Status> {
    let (device, library, endpoint, enabled, success, error): (String, Option<String>, Option<String>, bool, Option<String>, Option<String>) =
        sqlx::query_as("SELECT device_id,library_id,endpoint,enabled,last_success,error_code FROM sync_runtime WHERE id=1").fetch_one(pool).await?;
    let pending: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM sync_operations WHERE pending=1)+(SELECT COUNT(*) FROM sync_journal)").fetch_one(pool).await?;
    let conflicts = if let Some(id) = &library {
        load(pool, id)
            .await?
            .views()?
            .iter()
            .map(|v| v.conflicts.len())
            .sum()
    } else {
        0
    };
    Ok(Status {
        connected: library.is_some(),
        enabled,
        running,
        endpoint,
        library_id: library,
        device_id: device,
        last_success: success,
        pending,
        conflicts,
        message: error.as_deref().map(error_message).map(str::to_string),
        error_code: error,
    })
}
pub fn error_message(code: &str) -> &'static str {
    match code {
        "AUTH_REQUIRED" => "认证失败，请更新账号和密码后重试",
        "CONDITION_UNSUPPORTED" => "服务不支持安全条件写入，不能启用同步",
        "PROTOCOL_UNSUPPORTED" => "同步空间使用不兼容的协议，请更新客户端",
        "IDENTITY_CONFLICT" => "资料库或作品身份冲突，待上传记录已保留",
        "LIMIT_EXCEEDED" => "同步资料超过首版容量限制，记录已保留",
        "INVALID_DOCUMENT" => "同步资料格式无效，未覆盖远端",
        "SPACE_NOT_FOUND" => "同步空间不存在，请核对目录；加入不能创建空空间",
        "ALREADY_CONNECTED" => "本设备已连接资料库，不能直接切换到另一空间",
        "PRECONDITION_FAILED" => "远端持续变化，请稍后重试，待上传记录已保留",
        _ => "同步未完成，请检查网络后重试，待上传记录已保留",
    }
}
pub async fn set_enabled(pool: &SqlitePool, enabled: bool) -> Result<()> {
    sqlx::query("UPDATE sync_runtime SET enabled=? WHERE id=1")
        .bind(enabled)
        .execute(pool)
        .await?;
    Ok(())
}
pub async fn configuration(pool: &SqlitePool) -> Result<Option<(String, String, bool)>> {
    let row: (Option<String>, Option<String>, bool) = sqlx::query_as(
        "SELECT endpoint,credential_id,allow_loopback_http FROM sync_runtime WHERE id=1",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.0.zip(row.1).map(|(e, c)| (e, c, row.2)))
}
async fn load(pool: &SqlitePool, library: &str) -> Result<Document> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT change_json FROM sync_operations ORDER BY id")
            .fetch_all(pool)
            .await?;
    let mut d = Document::empty(library.into());
    for row in rows {
        let op: Change = decode(&row)?;
        d.operations.insert(op.id.clone(), op);
    }
    d.validate()?;
    Ok(d)
}
async fn drain(tx: &mut Tx<'_>) -> Result<()> {
    let (device, mut counter): (String, i64) =
        sqlx::query_as("SELECT device_id,counter FROM sync_runtime WHERE id=1")
            .fetch_one(&mut **tx)
            .await?;
    let entries: Vec<(i64, String, String, String, String, String)> = sqlx::query_as("SELECT id,local_work_id,entity_key,context_json,snapshot_json,observed_at FROM sync_journal ORDER BY id").fetch_all(&mut **tx).await?;
    for (id, local, entity, context_json, snapshot_json, observed) in entries {
        let shadow: String =
            sqlx::query_scalar("SELECT shadow_json FROM sync_bindings WHERE local_work_id=?")
                .bind(&local)
                .fetch_one(&mut **tx)
                .await?;
        let mut before: BTreeMap<String, Value> = decode(&shadow)?;
        let mut after: BTreeMap<String, Value> = decode(&snapshot_json)?;
        // A private manually imported image is absent rather than a path payload.
        after.retain(|key, value| {
            !matches!(key.as_str(), "coverUrl" | "bannerUrl")
                || value.is_null()
                || value.as_str().is_some_and(crate::protocol::public_url)
        });
        if !after.contains_key("deleted") {
            for key in before.keys() {
                if !after.contains_key(key) {
                    if key.starts_with("tag.") || key.starts_with("lock.") {
                        after.insert(key.clone(), false.into());
                    } else if key.starts_with("id.") {
                        after.insert(key.clone(), Value::Null);
                    }
                }
            }
        } else {
            before.clear();
        }
        let mut context: Clock = decode(&context_json)?;
        if let Some(anchor) = after.get("anchor").and_then(Value::as_str) {
            let (provider, external) = anchor.split_once('/').ok_or(Error::Identity)?;
            if after
                .get(&format!("id.{provider}"))
                .and_then(Value::as_str)
                .is_some_and(|id| id != external)
            {
                return Err(Error::Identity);
            }
        }
        for (field, value) in &after {
            validate_value(field, value)?;
            if before.get(field) == Some(value) {
                continue;
            }
            if field == "anchor" && before.get(field).is_some_and(|v| v != value) {
                return Err(Error::Identity);
            }
            counter = counter.checked_add(1).ok_or(Error::Limit)?;
            context.insert(device.clone(), (counter - 1) as u64);
            let origin = if after
                .get(&format!("source.{field}"))
                .and_then(Value::as_str)
                .is_some_and(|v| v != "manual" && v != "sync")
            {
                Origin::Metadata
            } else {
                Origin::Manual
            };
            let op = Change {
                id: format!("{device}:{counter}"),
                device_id: device.clone(),
                counter: counter as u64,
                context: context.clone(),
                entity: entity.clone(),
                field: field.clone(),
                value: value.clone(),
                observed_at: observed.clone(),
                origin,
            };
            op.validate()?;
            sqlx::query("INSERT INTO sync_operations(id,change_json,pending) VALUES(?,?,1)")
                .bind(&op.id)
                .bind(encode(&op)?)
                .execute(&mut **tx)
                .await?;
        }
        sqlx::query("UPDATE sync_bindings SET shadow_json=? WHERE local_work_id=?")
            .bind(encode(&after)?)
            .bind(local)
            .execute(&mut **tx)
            .await?;
        sqlx::query("DELETE FROM sync_journal WHERE id=?")
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    sqlx::query("UPDATE sync_runtime SET counter=?,clock_json=json_set(clock_json,?,?) WHERE id=1")
        .bind(counter)
        .bind(format!("$.\"{device}\""))
        .bind(counter)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub async fn freeze(pool: &SqlitePool) -> Result<Document> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    drain(&mut tx).await?;
    let library: Option<String> =
        sqlx::query_scalar("SELECT library_id FROM sync_runtime WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    load(pool, &library.ok_or(Error::NotFound)?).await
}
pub async fn connect(
    pool: &SqlitePool,
    dav: &DavTransport,
    endpoint: &str,
    credential: &str,
    device_name: &str,
    create: bool,
    loopback: bool,
) -> Result<()> {
    if configuration(pool).await?.is_some() {
        return Err(Error::AlreadyConnected);
    }
    dav.probe().await?;
    // Read before any persistent binding or PUT; an empty joining device is never authoritative.
    let remote = dav.read().await?;
    if remote.is_none() && !create {
        return Err(Error::NotFound);
    }
    let library = remote
        .as_ref()
        .map(|v| v.document.library_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("UPDATE sync_runtime SET library_id=?,endpoint=?,credential_id=?,device_name=?,tracking=1,enabled=1,allow_loopback_http=?,creating=? WHERE id=1")
        .bind(&library).bind(endpoint).bind(credential).bind(device_name).bind(loopback).bind(remote.is_none()).execute(&mut *tx).await?;
    let works: Vec<String> = sqlx::query_scalar("SELECT id FROM works WHERE type='video'")
        .fetch_all(&mut *tx)
        .await?;
    for id in works {
        let anchor: Option<String> = sqlx::query_scalar("SELECT CASE provider WHEN 'bangumi' THEN 'bangumi/'||external_id WHEN 'tmdb' THEN 'tmdb/'||external_id END FROM work_external_ids WHERE work_id=? AND provider IN ('bangumi','tmdb') ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1")
            .bind(&id).fetch_optional(&mut *tx).await?.flatten();
        if anchor.as_deref().is_some_and(|v| !valid_anchor(v)) {
            return Err(Error::Identity);
        }
        sqlx::query("INSERT INTO sync_bindings(local_work_id,entity_key,anchor) VALUES(?,?,?) ON CONFLICT(local_work_id) DO NOTHING")
            .bind(&id).bind(format!("work/{}", Uuid::new_v4())).bind(anchor).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sync_journal(local_work_id,entity_key,context_json,snapshot_json,observed_at) SELECT local_work_id,entity_key,(SELECT clock_json FROM sync_runtime WHERE id=1),snapshot_json,? FROM sync_work_snapshot WHERE local_work_id=?")
            .bind(now()).bind(&id).execute(&mut *tx).await?;
    }
    drain(&mut tx).await?;
    tx.commit().await?;
    synchronize(pool, dav).await
}
pub async fn synchronize(pool: &SqlitePool, dav: &DavTransport) -> Result<()> {
    let result = async {
        dav.probe().await?;
        synchronize_inner(pool, dav).await
    }
    .await;
    if let Err(error) = &result {
        sqlx::query("UPDATE sync_runtime SET error_code=? WHERE id=1")
            .bind(error.to_string())
            .execute(pool)
            .await?;
    }
    result
}
async fn synchronize_inner(pool: &SqlitePool, dav: &DavTransport) -> Result<()> {
    for _ in 0..4 {
        let mut local = freeze(pool).await?;
        let creating: bool = sqlx::query_scalar("SELECT creating FROM sync_runtime WHERE id=1")
            .fetch_one(pool)
            .await?;
        let remote = match dav.read().await? {
            Some(remote) => remote,
            None if creating => {
                local.revision = 1;
                match dav.write(&local, None).await {
                    Ok(()) | Err(Error::Precondition) => continue,
                    other => other?,
                }
                unreachable!();
            }
            None => return Err(Error::NotFound),
        };
        if creating && local.library_id != remote.document.library_id {
            // A competing first creator won. No acknowledged local upload exists yet.
            sqlx::query("UPDATE sync_runtime SET library_id=? WHERE id=1 AND creating=1 AND last_success IS NULL")
                .bind(&remote.document.library_id).execute(pool).await?;
            local.library_id = remote.document.library_id.clone();
        }
        let mut merged = remote.document.clone();
        merged.merge(&local)?;
        apply(pool, &merged, false).await?;
        if merged.operations != remote.document.operations {
            merged.revision = remote
                .document
                .revision
                .checked_add(1)
                .ok_or(Error::Limit)?;
            match dav.write(&merged, Some(&remote.etag)).await {
                Err(Error::Precondition) => continue,
                other => other?,
            }
        }
        let verified = dav.read().await?.ok_or(Error::NotFound)?;
        if verified.document.library_id != local.library_id {
            return Err(Error::Identity);
        }
        if merged
            .operations
            .iter()
            .any(|(id, op)| verified.document.operations.get(id) != Some(op))
        {
            continue;
        }
        apply(pool, &verified.document, true).await?;
        return Ok(());
    }
    Err(Error::Precondition)
}
pub async fn apply(pool: &SqlitePool, remote: &Document, acknowledged: bool) -> Result<()> {
    remote.validate()?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    drain(&mut tx).await?;
    let library: String = sqlx::query_scalar("SELECT library_id FROM sync_runtime WHERE id=1")
        .fetch_one(&mut *tx)
        .await?;
    if library != remote.library_id {
        return Err(Error::Identity);
    }
    let rows: Vec<String> = sqlx::query_scalar("SELECT change_json FROM sync_operations")
        .fetch_all(&mut *tx)
        .await?;
    let mut merged = remote.clone();
    for row in rows {
        let op: Change = decode(&row)?;
        if merged.operations.get(&op.id).is_some_and(|v| v != &op) {
            return Err(Error::Invalid);
        }
        merged.operations.insert(op.id.clone(), op);
    }
    merged.validate()?;
    sqlx::query("UPDATE sync_runtime SET applying=1 WHERE id=1")
        .execute(&mut *tx)
        .await?;
    for op in remote.operations.values() {
        sqlx::query("INSERT INTO sync_operations(id,change_json,pending) VALUES(?,?,0) ON CONFLICT(id) DO NOTHING")
            .bind(&op.id).bind(encode(op)?).execute(&mut *tx).await?;
        if acknowledged {
            sqlx::query("UPDATE sync_operations SET pending=0 WHERE id=?")
                .bind(&op.id)
                .execute(&mut *tx)
                .await?;
        }
    }
    for view in merged.views()? {
        project(&mut tx, &view).await?;
    }
    // Shadow records the actual local projection, including device-local image choices.
    sqlx::query("UPDATE sync_bindings SET shadow_json=COALESCE((SELECT snapshot_json FROM sync_work_snapshot WHERE local_work_id=sync_bindings.local_work_id),shadow_json)").execute(&mut *tx).await?;
    sqlx::query("UPDATE sync_runtime SET applying=0,clock_json=?,error_code=NULL,last_success=CASE WHEN ? THEN ? ELSE last_success END,creating=CASE WHEN ? THEN 0 ELSE creating END WHERE id=1")
        .bind(encode(&merged.clock())?).bind(acknowledged).bind(now()).bind(acknowledged).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
fn db_field(field: &str) -> &str {
    match field {
        "originalTitle" => "original_title",
        "coverUrl" => "cover_path",
        "bannerUrl" => "banner_path",
        "year" => "year",
        other => other,
    }
}
async fn project(tx: &mut Tx<'_>, view: &WorkView) -> Result<()> {
    let f = &view.fields;
    let mut local_ids = Vec::new();
    for alias in &view.aliases {
        let id: Option<String> =
            sqlx::query_scalar("SELECT local_work_id FROM sync_bindings WHERE entity_key=?")
                .bind(alias)
                .fetch_optional(&mut **tx)
                .await?;
        if let Some(id) = id {
            if !local_ids.contains(&id) {
                local_ids.push(id);
            }
        }
    }
    if local_ids.len() > 1 {
        return Err(Error::Identity);
    }
    let id = local_ids
        .pop()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query("INSERT INTO sync_bindings(local_work_id,entity_key,anchor) VALUES(?,?,?) ON CONFLICT(local_work_id) DO NOTHING")
        .bind(&id).bind(&view.entity).bind(f.get("anchor").and_then(Value::as_str)).execute(&mut **tx).await?;
    if f.get("deleted") == Some(&Value::Bool(true)) {
        // Foreign-key SET NULL releases files; disk contents and directory grants remain untouched.
        sqlx::query("DELETE FROM works WHERE id=? AND type='video'")
            .bind(&id)
            .execute(&mut **tx)
            .await?;
        return Ok(());
    }
    sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES(?,?,'video',?,?) ON CONFLICT(id) DO NOTHING")
        .bind(&id).bind(f.get("title").and_then(Value::as_str).unwrap_or("未命名作品")).bind(now()).bind(now()).execute(&mut **tx).await?;
    for (field, column) in [
        ("title", "title"),
        ("originalTitle", "original_title"),
        ("description", "description"),
        ("year", "metadata_year"),
        ("coverUrl", "cover_path"),
        ("bannerUrl", "banner_path"),
        ("status", "status"),
        ("favorite", "favorite"),
        ("rating", "rating"),
        ("notes", "notes"),
    ] {
        if let Some(value) = f.get(field) {
            if matches!(field, "coverUrl" | "bannerUrl") {
                let current: Option<String> =
                    sqlx::query_scalar(&format!("SELECT {column} FROM works WHERE id=?"))
                        .bind(&id)
                        .fetch_one(&mut **tx)
                        .await?;
                let locked = f.get(&format!("lock.{field}")) == Some(&Value::Bool(true));
                if locked
                    && current
                        .as_deref()
                        .is_some_and(|p| !crate::protocol::public_url(p))
                {
                    continue;
                }
                let cached_source: Option<String> = sqlx::query_scalar("SELECT json_extract(response_json,?) FROM metadata_provider_records WHERE work_id=? AND json_valid(response_json) AND json_extract(response_json,?) IS NOT NULL ORDER BY CASE provider WHEN 'bangumi' THEN 0 ELSE 1 END LIMIT 1")
                    .bind(format!("$.{field}")).bind(&id).bind(format!("$.{field}")).fetch_optional(&mut **tx).await?.flatten();
                if current
                    .as_deref()
                    .is_some_and(|p| !crate::protocol::public_url(p))
                    && cached_source.as_deref() == value.as_str()
                {
                    continue;
                }
            }
            let query = format!(
                "UPDATE works SET {column}=?,updated_at=? WHERE id=? AND {column} IS NOT ?"
            );
            let q = sqlx::query(&query);
            let q = if matches!(field, "favorite") {
                q.bind(value.as_bool().unwrap_or(false))
            } else if field == "rating" {
                q.bind(value.as_f64())
            } else if field == "year" {
                q.bind(value.as_i64())
            } else {
                q.bind(value.as_str())
            };
            let q = q.bind(now()).bind(&id);
            let q = if field == "favorite" {
                q.bind(value.as_bool().unwrap_or(false))
            } else if field == "rating" {
                q.bind(value.as_f64())
            } else if field == "year" {
                q.bind(value.as_i64())
            } else {
                q.bind(value.as_str())
            };
            q.execute(&mut **tx).await?;
        }
    }
    for (field, value) in f {
        if let Some(provider) = field.strip_prefix("id.") {
            if let Some(external) = value.as_str() {
                let other: Option<String> = sqlx::query_scalar("SELECT work_id FROM work_external_ids WHERE provider=? AND external_id=? AND work_id<>?").bind(provider).bind(external).bind(&id).fetch_optional(&mut **tx).await?;
                if other.is_some() {
                    return Err(Error::Identity);
                }
                sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(work_id,provider) DO UPDATE SET external_id=excluded.external_id,updated_at=excluded.updated_at")
                    .bind(&id).bind(provider).bind(external).bind(now()).bind(now()).execute(&mut **tx).await?;
            } else {
                sqlx::query("DELETE FROM work_external_ids WHERE work_id=? AND provider=?")
                    .bind(&id)
                    .bind(provider)
                    .execute(&mut **tx)
                    .await?;
            }
        } else if let Some(name) = field.strip_prefix("tag.") {
            if value == &Value::Bool(true) {
                sqlx::query("INSERT INTO tags(id,name,created_at) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING").bind(Uuid::new_v4().to_string()).bind(name).bind(now()).execute(&mut **tx).await?;
                sqlx::query("INSERT INTO work_tags(work_id,tag_id,source) SELECT ?,id,'manual' FROM tags WHERE name=? COLLATE NOCASE ON CONFLICT(work_id,tag_id) DO NOTHING").bind(&id).bind(name).execute(&mut **tx).await?;
            } else {
                sqlx::query("DELETE FROM work_tags WHERE work_id=? AND tag_id IN (SELECT id FROM tags WHERE name=? COLLATE NOCASE)").bind(&id).bind(name).execute(&mut **tx).await?;
            }
        } else if let Some(field) = field.strip_prefix("lock.") {
            sqlx::query("INSERT INTO work_field_locks(work_id,field_name,locked,updated_at) VALUES(?,?,?,?) ON CONFLICT(work_id,field_name) DO UPDATE SET locked=excluded.locked,updated_at=excluded.updated_at")
                .bind(&id).bind(db_field(field)).bind(value.as_bool().unwrap_or(false)).bind(now()).execute(&mut **tx).await?;
        } else if let Some(field) = field.strip_prefix("source.") {
            sqlx::query("INSERT INTO work_field_sources(work_id,field_name,provider,updated_at) VALUES(?,?,?,?) ON CONFLICT(work_id,field_name) DO UPDATE SET provider=excluded.provider,updated_at=excluded.updated_at")
                .bind(&id).bind(db_field(field)).bind(value.as_str()).bind(now()).execute(&mut **tx).await?;
        } else if let Some(key) = field.strip_prefix("episode.") {
            let (provider, external) = key.split_once('/').ok_or(Error::Invalid)?;
            let e: Episode = serde_json::from_value(value.clone()).map_err(|_| Error::Invalid)?;
            sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,episode_type,title,original_title,description,air_date,duration,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(work_id,provider,external_id) DO UPDATE SET episode_number=excluded.episode_number,sort_number=excluded.sort_number,episode_type=excluded.episode_type,title=excluded.title,original_title=excluded.original_title,description=excluded.description,air_date=excluded.air_date,duration=excluded.duration,fetched_at=excluded.fetched_at")
                .bind(&id).bind(provider).bind(external).bind(e.number).bind(e.sort).bind(e.episode_type).bind(e.title).bind(e.original_title).bind(e.description).bind(e.air_date).bind(e.duration).bind(now()).execute(&mut **tx).await?;
        } else if let Some(key) = field.strip_prefix("watched.") {
            sqlx::query("INSERT INTO sync_watched(local_work_id,episode_key,watched) VALUES(?,?,?) ON CONFLICT(local_work_id,episode_key) DO UPDATE SET watched=excluded.watched")
                .bind(&id).bind(key).bind(value.as_bool()).execute(&mut **tx).await?;
        } else if let Some(session_id) = field.strip_prefix("session.") {
            let s: ViewingSession =
                serde_json::from_value(value.clone()).map_err(|_| Error::Invalid)?;
            sqlx::query("INSERT INTO sync_viewing_sessions(id,local_work_id,episode_key,version_key,started_at,observed_at,position_ms,duration_ms,completed,ended) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,ended=excluded.ended")
                .bind(session_id).bind(&id).bind(&s.episode_key).bind(&s.version_key).bind(&s.started_at).bind(&s.observed_at).bind(s.position_ms).bind(s.duration_ms).bind(s.completed).bind(s.ended).execute(&mut **tx).await?;
        }
    }
    sqlx::query("UPDATE works SET metadata_status='matched' WHERE id=? AND EXISTS(SELECT 1 FROM work_external_ids WHERE work_id=?) AND metadata_status<>'matched'")
        .bind(&id).bind(&id).execute(&mut **tx).await?;
    project_progress(tx, &id).await?;
    Ok(())
}
async fn project_progress(tx: &mut Tx<'_>, work: &str) -> Result<()> {
    let versions: Vec<(String, String, String)> = sqlx::query_as("SELECT v.media_file_id,v.episode_key,v.version_key FROM sync_media_versions v JOIN media_files m ON m.id=v.media_file_id WHERE m.work_id=? AND m.size=v.size AND m.modified_at IS v.modified_at AND m.missing=0")
        .bind(work).fetch_all(&mut **tx).await?;
    for (media, episode, version) in versions {
        let sessions: Vec<(i64, i64, bool, String)> = sqlx::query_as("SELECT position_ms,duration_ms,completed,observed_at FROM sync_viewing_sessions WHERE local_work_id=? AND episode_key=? AND version_key=?")
            .bind(work).bind(&episode).bind(&version).fetch_all(&mut **tx).await?;
        let Some(s) = sessions
            .into_iter()
            .max_by_key(|v| chrono::DateTime::parse_from_rfc3339(&v.3).ok())
        else {
            continue;
        };
        let old: Option<(i64, String)> = sqlx::query_as(
            "SELECT duration_ms,updated_at FROM playback_progress WHERE media_file_id=?",
        )
        .bind(&media)
        .fetch_optional(&mut **tx)
        .await?;
        if old.as_ref().is_some_and(|(duration, at)| {
            (duration - s.1).abs() > 2000
                || chrono::DateTime::parse_from_rfc3339(at).ok()
                    > chrono::DateTime::parse_from_rfc3339(&s.3).ok()
        }) {
            continue;
        }
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,completed,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed,updated_at=excluded.updated_at")
            .bind(media).bind(s.0).bind(s.1).bind(s.2).bind(s.3).execute(&mut **tx).await?;
    }
    Ok(())
}
pub async fn conflicts(pool: &SqlitePool) -> Result<Vec<Conflict>> {
    let document = freeze(pool).await?;
    Ok(document
        .views()?
        .into_iter()
        .flat_map(|v| v.conflicts)
        .collect())
}
pub async fn resolve(pool: &SqlitePool, entity: &str, field: &str, value: Value) -> Result<()> {
    validate_value(field, &value)?;
    if matches!(field, "deleted" | "anchor") {
        return Err(Error::Identity);
    }
    let document = freeze(pool).await?;
    if !document
        .views()?
        .iter()
        .any(|v| v.entity == entity && v.conflicts.iter().any(|c| c.field == field))
    {
        return Err(Error::Invalid);
    }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    drain(&mut tx).await?;
    let (device, counter, clock): (String, i64, String) =
        sqlx::query_as("SELECT device_id,counter,clock_json FROM sync_runtime WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
    let n = counter.checked_add(1).ok_or(Error::Limit)?;
    let op = Change {
        id: format!("{device}:{n}"),
        device_id: device.clone(),
        counter: n as u64,
        context: decode(&clock)?,
        entity: entity.into(),
        field: field.into(),
        value,
        observed_at: now(),
        origin: Origin::Manual,
    };
    sqlx::query("INSERT INTO sync_operations(id,change_json,pending) VALUES(?,?,1)")
        .bind(&op.id)
        .bind(encode(&op)?)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sync_runtime SET counter=?,clock_json=json_set(clock_json,?,?) WHERE id=1")
        .bind(n)
        .bind(format!("$.\"{device}\""))
        .bind(n)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let local = freeze(pool).await?;
    apply(pool, &local, false).await
}
/// Called by the host inside the same transaction as its real player checkpoint.
pub async fn record_session(
    tx: &mut Tx<'_>,
    media: &str,
    session_id: &str,
    started_at: &str,
    observed_at: &str,
    position: i64,
    duration: i64,
    completed: bool,
) -> Result<()> {
    if position <= 0 || duration <= 0 || position > duration {
        return Ok(());
    }
    let work: Option<String> =
        sqlx::query_scalar("SELECT work_id FROM media_files WHERE id=? AND media_type='video'")
            .bind(media)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    let Some(work) = work else {
        return Ok(());
    };
    let episode = media_episode(tx, media).await?;
    let Some(episode) = episode else {
        return Ok(());
    };
    let version: Option<String> = sqlx::query_scalar("SELECT v.version_key FROM sync_media_versions v JOIN media_files m ON m.id=v.media_file_id WHERE v.media_file_id=? AND v.episode_key=? AND v.size=m.size AND v.modified_at IS m.modified_at").bind(media).bind(&episode).fetch_optional(&mut **tx).await?;
    sqlx::query("INSERT INTO sync_viewing_sessions(id,media_file_id,local_work_id,episode_key,version_key,started_at,observed_at,position_ms,duration_ms,completed) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,completed=excluded.completed WHERE excluded.observed_at>=sync_viewing_sessions.observed_at")
        .bind(session_id).bind(media).bind(&work).bind(&episode).bind(version).bind(started_at).bind(observed_at).bind(position).bind(duration).bind(completed).execute(&mut **tx).await?;
    if completed {
        sqlx::query("INSERT INTO sync_watched(local_work_id,episode_key,watched) VALUES(?,?,1) ON CONFLICT(local_work_id,episode_key) DO UPDATE SET watched=1").bind(work).bind(episode).execute(&mut **tx).await?;
    }
    Ok(())
}
pub async fn finish_sessions(pool: &SqlitePool, sessions: &[String]) -> Result<()> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    for id in sessions {
        sqlx::query("UPDATE sync_viewing_sessions SET ended=1 WHERE id=? AND ended=0")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
async fn media_episode(tx: &mut Tx<'_>, media: &str) -> Result<Option<String>> {
    let movie: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files m JOIN work_external_ids e ON e.work_id=m.work_id WHERE m.id=? AND e.provider='tmdb' AND e.external_id LIKE 'movie/%')").bind(media).fetch_one(&mut **tx).await?;
    if movie {
        return Ok(Some("movie".into()));
    }
    Ok(sqlx::query_scalar(
        "SELECT provider||'/'||episode_external_id FROM media_episode_links WHERE media_file_id=?",
    )
    .bind(media)
    .fetch_optional(&mut **tx)
    .await?)
}
pub async fn bind_media(pool: &SqlitePool, media: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;
    let (path, size, modified): (String, i64, Option<String>) = sqlx::query_as("SELECT path,size,modified_at FROM media_files WHERE id=? AND media_type='video' AND missing=0 AND NOT EXISTS(SELECT 1 FROM remote_files WHERE media_file_id=media_files.id)").bind(media).fetch_optional(pool).await?.ok_or(Error::NotFound)?;
    let mut file = tokio::fs::File::open(&path).await?;
    let before = file.metadata().await?;
    if before.len() != size as u64 || size <= 0 {
        return Err(Error::Identity);
    }
    let mut digest = Sha256::new();
    let mut buf = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        digest.update(&buf[..n]);
    }
    let after = file.metadata().await?;
    if before.len() != after.len() || before.modified()? != after.modified()? {
        return Err(Error::Identity);
    }
    let version = format!("sha256:{:x}:{size}", digest.finalize());
    bind_verified_media(pool, media, &path, size, modified, &version).await
}
/// The platform host verifies authorized document bytes before passing a version here.
pub async fn bind_verified_media(pool: &SqlitePool, media: &str, path: &str, size: i64, modified: Option<String>, version: &str) -> Result<String> {
    if !crate::protocol::valid_version(version) || !version.starts_with("sha256:") || !version.ends_with(&format!(":{size}")) || size <= 0 { return Err(Error::Identity); }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let current: Option<(String, i64, Option<String>)> =
        sqlx::query_as("SELECT path,size,modified_at FROM media_files WHERE id=? AND media_type='video' AND missing=0 AND NOT EXISTS(SELECT 1 FROM remote_files WHERE media_file_id=media_files.id)")
            .bind(media)
            .fetch_optional(&mut *tx)
            .await?;
    if current != Some((path.to_owned(), size, modified.clone())) {
        return Err(Error::Identity);
    }
    let episode = media_episode(&mut tx, media)
        .await?
        .ok_or(Error::Identity)?;
    sqlx::query("INSERT INTO sync_media_versions(media_file_id,episode_key,version_key,size,modified_at) VALUES(?,?,?,?,?) ON CONFLICT(media_file_id) DO UPDATE SET episode_key=excluded.episode_key,version_key=excluded.version_key,size=excluded.size,modified_at=excluded.modified_at")
        .bind(media).bind(&episode).bind(&version).bind(size).bind(modified).execute(&mut *tx).await?;
    // Historical unbound sessions cannot prove which former bytes they observed.
    let work: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id=?")
        .bind(media)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(work) = work {
        project_progress(&mut tx, &work).await?;
    }
    tx.commit().await?;
    Ok(version.to_owned())
}
