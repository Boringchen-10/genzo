//! Transactional undo for recognition. Only application records are restored.
//! Filesystem paths, sizes, availability and thumbnail caches are never rolled back.
use crate::{db, error::{AppError, AppResult}};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::collections::BTreeMap;

// Dependency order matters when restoring foreign keys. Table names are internal constants.
const TABLES: &[&str] = &[
    "works", "media_files", "work_external_ids",
    "work_field_sources", "work_field_locks", "work_tags", "metadata_provider_records",
    "anime_episodes", "media_episode_links", "subtitle_links", "match_candidates",
];
type Snapshot = BTreeMap<String, Vec<Value>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct Scope {
    works: Vec<String>,
    files: Vec<String>,
}

pub struct Pending {
    scope: Scope,
    before: Snapshot,
    selected_count: usize,
}

fn filter(table: &str) -> &'static str {
    match table {
        "works" => "id IN (SELECT value FROM json_each(?1))",
        "media_files" => "work_id IN (SELECT value FROM json_each(?1)) OR id IN (SELECT value FROM json_each(?2))",
        "remote_files" | "remote_cache" => "media_file_id IN (SELECT id FROM media_files WHERE work_id IN (SELECT value FROM json_each(?1)) OR id IN (SELECT value FROM json_each(?2)))",
        "match_candidates" => "media_file_id IN (SELECT value FROM json_each(?2)) AND ?1 IS NOT NULL",
        _ => "work_id IN (SELECT value FROM json_each(?1)) AND ?2 IS NOT NULL",
    }
}

async fn fields(tx: &mut Transaction<'_, Sqlite>, table: &str) -> AppResult<Vec<String>> {
    Ok(sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(&mut **tx).await?.iter().map(|r| r.get("name")).collect())
}

async fn capture(tx: &mut Transaction<'_, Sqlite>, scope: &Scope) -> AppResult<Snapshot> {
    let works = serde_json::to_string(&scope.works)?;
    let files = serde_json::to_string(&scope.files)?;
    let mut snapshot = BTreeMap::new();
    for table in TABLES {
        let columns = fields(tx, table).await?;
        let pairs = columns.iter().map(|c| format!("'{c}',\"{c}\"")).collect::<Vec<_>>().join(",");
        let sql = format!("SELECT json_object({pairs}) AS data FROM {table} WHERE {} ORDER BY data", filter(table));
        // works only uses ?1; all other filters deliberately bind both parameters.
        let query = sqlx::query_scalar::<_, String>(&sql).bind(&works);
        let rows = if *table == "works" { query.fetch_all(&mut **tx).await? }
            else { query.bind(&files).fetch_all(&mut **tx).await? };
        snapshot.insert(table.to_string(), rows.into_iter()
            .map(|json| serde_json::from_str(&json)).collect::<Result<Vec<_>, _>>()?);
    }
    Ok(snapshot)
}

pub async fn begin(tx: &mut Transaction<'_, Sqlite>, target: &str, ids: &[String]) -> AppResult<Pending> {
    let mut works: Vec<String> = sqlx::query_scalar("SELECT DISTINCT work_id FROM media_files WHERE id IN (SELECT value FROM json_each(?)) AND work_id IS NOT NULL")
        .bind(serde_json::to_string(ids)?).fetch_all(&mut **tx).await?;
    works.push(target.to_string());
    works.sort();
    works.dedup();
    let mut files: Vec<String> = sqlx::query_scalar("SELECT id FROM media_files WHERE work_id IN (SELECT value FROM json_each(?))")
        .bind(serde_json::to_string(&works)?).fetch_all(&mut **tx).await?;
    files.extend(ids.iter().cloned());
    files.sort();
    files.dedup();
    let scope = Scope { works, files };
    let before = capture(tx, &scope).await?;
    Ok(Pending { scope, before, selected_count: ids.iter().collect::<std::collections::HashSet<_>>().len() })
}

pub async fn finish(tx: &mut Transaction<'_, Sqlite>, pending: Pending, target: &str, title: &str) -> AppResult<()> {
    let after = capture(tx, &pending.scope).await?;
    if pending.before == after { return Ok(()); }
    sqlx::query("INSERT INTO recognition_history(id,target_work_id,target_title,file_count,scope_json,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(target).bind(title).bind(pending.selected_count as i64)
        .bind(serde_json::to_string(&pending.scope)?).bind(serde_json::to_string(&pending.before)?)
        .bind(serde_json::to_string(&after)?).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut **tx).await?;
    sqlx::query("DELETE FROM recognition_history WHERE id NOT IN (SELECT id FROM recognition_history ORDER BY created_at DESC, id DESC LIMIT 50)")
        .execute(&mut **tx).await?;
    Ok(())
}

/// Explicit refresh is a new user action; only background enrichment is cancelled by undo.
pub async fn background_operation(pool: &SqlitePool, work: &str, fresh: bool) -> AppResult<Option<String>> {
    if fresh { return Ok(None); }
    Ok(sqlx::query_scalar("SELECT id FROM recognition_history WHERE target_work_id=? ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(work).fetch_optional(pool).await?)
}

/// Enrichment may finish after confirmation. Extend the expected state only if
/// no user operation has changed it in the meantime. Undo still rejects edits.
pub async fn before_enrichment(tx: &mut Transaction<'_, Sqlite>, work: &str) -> AppResult<Vec<(String, Scope)>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as("SELECT id,scope_json,after_json FROM recognition_history WHERE undone_at IS NULL AND target_work_id=?")
        .bind(work).fetch_all(&mut **tx).await?;
    let mut valid = Vec::new();
    for (id, scope, expected) in rows {
        let scope: Scope = serde_json::from_str(&scope)?;
        let expected: Snapshot = serde_json::from_str(&expected)?;
        if capture(tx, &scope).await? == expected { valid.push((id, scope)); }
    }
    Ok(valid)
}

pub async fn after_enrichment(tx: &mut Transaction<'_, Sqlite>, valid: Vec<(String, Scope)>) -> AppResult<()> {
    for (id, scope) in valid {
        let after = capture(tx, &scope).await?;
        sqlx::query("UPDATE recognition_history SET after_json=? WHERE id=? AND undone_at IS NULL")
            .bind(serde_json::to_string(&after)?).bind(id).execute(&mut **tx).await?;
    }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    id: String,
    target_work_id: String,
    target_title: String,
    file_count: i64,
    created_at: String,
    undone_at: Option<String>,
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<HistoryEntry>> {
    Ok(sqlx::query_as("SELECT id,target_work_id,target_title,file_count,created_at,undone_at FROM recognition_history ORDER BY created_at DESC,id DESC LIMIT 50")
        .fetch_all(pool).await?)
}

pub async fn undo(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let (_guard, mut tx) = db::begin_write(pool).await?;
    let row: Option<(String, String, String)> = sqlx::query_as("SELECT scope_json,before_json,after_json FROM recognition_history WHERE id=? AND undone_at IS NULL")
        .bind(id).fetch_optional(&mut *tx).await?;
    let (scope, before, after) = row.ok_or_else(|| AppError::Validation("该记录已撤销或不再保留".into()))?;
    let scope: Scope = serde_json::from_str(&scope)?;
    let before: Snapshot = serde_json::from_str(&before)?;
    let after: Snapshot = serde_json::from_str(&after)?;
    if capture(&mut tx, &scope).await? != after {
        return Err(AppError::Validation("相关作品、文件或分集在识别后已有其他修改，无法直接撤销。请手动调整归属。".into()));
    }
    let works = serde_json::to_string(&scope.works)?;
    let files = serde_json::to_string(&scope.files)?;
    // Remove dependent rows first; media records and existing works stay in place.
    for table in TABLES.iter().rev().filter(|t| **t != "works" && **t != "media_files") {
        let sql = format!("DELETE FROM {table} WHERE {}", filter(table));
        let query = sqlx::query(&sql).bind(&works);
        query.bind(&files).execute(&mut *tx).await?;
    }
    for table in TABLES {
        let columns = fields(&mut tx, table).await?;
        for row in &before[*table] {
            let assignments = columns.iter().filter(|c| c.as_str() != "id")
                .map(|c| format!("\"{c}\"=json_extract(?1,'$.{c}')")).collect::<Vec<_>>().join(",");
            let names = columns.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(",");
            let values = columns.iter().map(|c| format!("json_extract(?1,'$.{c}')")).collect::<Vec<_>>().join(",");
            let conflict = if *table == "works" || *table == "media_files" {
                format!(" ON CONFLICT(id) DO UPDATE SET {assignments}")
            } else { String::new() };
            let sql = format!("INSERT INTO {table} ({names}) VALUES ({values}){conflict}");
            sqlx::query(&sql).bind(serde_json::to_string(row)?).execute(&mut *tx).await?;
        }
    }
    for work in &scope.works {
        if !before["works"].iter().any(|row| row["id"].as_str() == Some(work)) {
            // The full guarded snapshot ensures no subsequent edits or new files are removed.
            sqlx::query("DELETE FROM works WHERE id=? AND NOT EXISTS(SELECT 1 FROM media_files WHERE work_id=?)")
                .bind(work).bind(work).execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE recognition_history SET undone_at=? WHERE id=?")
        .bind(chrono::Utc::now().to_rfc3339()).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn undo_restores_file_work_and_metadata_and_removes_empty_created_work() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('s1','第一季','video','私人笔记','now','now')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at,recognition_status) VALUES('ep','s1','C:\\media\\13.mkv','13.mkv','mkv','video','now','now','matched')")
            .execute(&pool).await.unwrap();
        let mut tx = db::begin_write(&pool).await.unwrap().1;
        let pending = begin(&mut tx, "s2", &["ep".into()]).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('s2','第二季','video','now','now')")
            .execute(&mut *tx).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id='s2' WHERE id='ep'")
            .execute(&mut *tx).await.unwrap();
        finish(&mut tx, pending, "s2", "第二季").await.unwrap();
        tx.commit().await.unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM recognition_history WHERE undone_at IS NULL")
            .fetch_one(&pool).await.unwrap();
        undo(&pool, &id).await.unwrap();
        let owner: String = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='ep'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(owner, "s1");
        let title: String = sqlx::query_scalar("SELECT title FROM works WHERE id='s1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(title, "第一季");
        let target_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM works WHERE id='s2')")
            .fetch_one(&pool).await.unwrap();
        assert!(!target_exists);
    }

    #[tokio::test]
    async fn undo_refuses_to_overwrite_edits_made_after_recognition() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','旧标题','video','now','now')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,created_at,updated_at) VALUES('ep','C:\\media\\01.mkv','01.mkv','mkv','video','now','now')")
            .execute(&pool).await.unwrap();
        let mut tx = db::begin_write(&pool).await.unwrap().1;
        let pending = begin(&mut tx, "w", &["ep".into()]).await.unwrap();
        sqlx::query("UPDATE works SET title='已识别标题' WHERE id='w'")
            .execute(&mut *tx).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id='w' WHERE id='ep'")
            .execute(&mut *tx).await.unwrap();
        finish(&mut tx, pending, "w", "已识别标题").await.unwrap();
        tx.commit().await.unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM recognition_history WHERE undone_at IS NULL")
            .fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE works SET notes='用户后来新增的笔记' WHERE id='w'")
            .execute(&pool).await.unwrap();
        assert!(undo(&pool, &id).await.is_err());
        let (title, notes): (String, String) = sqlx::query_as("SELECT title,notes FROM works WHERE id='w'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(title, "已识别标题");
        assert_eq!(notes, "用户后来新增的笔记");
    }
    #[tokio::test]
    async fn enrichment_extends_undo_but_keeps_playback_and_manual_links() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('w','作品','video','保留笔记','now','now')").execute(&pool).await.unwrap();
        for id in ["old", "new"] {
            sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES(?,? ,?,'01.mkv','mkv','video','now','now')")
                .bind(id).bind((id == "old").then_some("w")).bind(format!("C:/media/{id}.mkv")).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,fetched_at) VALUES('w','bangumi','ep',1,1,'now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES('old','w','bangumi','ep','manual',1,'now')").execute(&pool).await.unwrap();
        let (_guard, mut tx) = db::begin_write(&pool).await.unwrap();
        let pending = begin(&mut tx, "w", &["new".into(), "new".into()]).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id='w' WHERE id='new'").execute(&mut *tx).await.unwrap();
        finish(&mut tx, pending, "w", "作品").await.unwrap();
        tx.commit().await.unwrap();
        drop(_guard);
        assert_eq!(list(&pool).await.unwrap()[0].file_count, 1, "counts selected files, not all existing work files");
        let (_guard, mut tx) = db::begin_write(&pool).await.unwrap();
        let valid = before_enrichment(&mut tx, "w").await.unwrap();
        assert_eq!(valid.len(), 1);
        sqlx::query("UPDATE works SET cover_path='cache/cover.jpg' WHERE id='w'").execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,fetched_at) VALUES('w','bangumi','ep2',2,2,'now')").execute(&mut *tx).await.unwrap();
        after_enrichment(&mut tx, valid).await.unwrap();
        tx.commit().await.unwrap();
        drop(_guard);
        // Playback belongs to the stable file identity and is outside recognition snapshots.
        sqlx::query("INSERT INTO playback_progress(media_file_id,position_ms,duration_ms,updated_at) VALUES('new',12000,24000,'later')").execute(&pool).await.unwrap();
        let id = list(&pool).await.unwrap()[0].id.clone();
        undo(&pool, &id).await.unwrap();
        let owner: Option<String> = sqlx::query_scalar("SELECT work_id FROM media_files WHERE id='new'").fetch_one(&pool).await.unwrap();
        assert_eq!(owner, None);
        let manual: String = sqlx::query_scalar("SELECT match_method FROM media_episode_links WHERE media_file_id='old'").fetch_one(&pool).await.unwrap();
        assert_eq!(manual, "manual");
        let position: i64 = sqlx::query_scalar("SELECT position_ms FROM playback_progress WHERE media_file_id='new'").fetch_one(&pool).await.unwrap();
        assert_eq!(position, 12000);
        assert!(undo(&pool, &id).await.is_err(), "cannot undo twice");
    }

    #[tokio::test]
    async fn later_scan_or_new_work_file_blocks_destructive_restore() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES('w','作品','video','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_files(id,path,file_name,extension,media_type,created_at,updated_at) VALUES('ep','C:/old.mkv','old.mkv','mkv','video','now','now')").execute(&pool).await.unwrap();
        let (_guard, mut tx) = db::begin_write(&pool).await.unwrap();
        let pending = begin(&mut tx, "w", &["ep".into()]).await.unwrap();
        sqlx::query("UPDATE media_files SET work_id='w' WHERE id='ep'").execute(&mut *tx).await.unwrap();
        finish(&mut tx, pending, "w", "作品").await.unwrap();
        tx.commit().await.unwrap();
        drop(_guard);
        let id = list(&pool).await.unwrap()[0].id.clone();
        sqlx::query("UPDATE media_files SET path='C:/moved.mkv',size=42 WHERE id='ep'").execute(&pool).await.unwrap();
        assert!(undo(&pool, &id).await.is_err());
        let path: String = sqlx::query_scalar("SELECT path FROM media_files WHERE id='ep'").fetch_one(&pool).await.unwrap();
        assert_eq!(path, "C:/moved.mkv");
    }

    #[tokio::test]
    async fn adds_history_to_database_already_using_playback_migration() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("DROP TABLE recognition_history").execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version=13").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES('existing','已有作品','video','私人笔记','now','now')").execute(&pool).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
        let note: String = sqlx::query_scalar("SELECT notes FROM works WHERE id='existing'").fetch_one(&pool).await.unwrap();
        assert_eq!(note, "私人笔记");
        let versions: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE version IN (13,14) ORDER BY version").fetch_all(&pool).await.unwrap();
        assert_eq!(versions, vec![13, 14]);
    }

    #[tokio::test]
    async fn explicit_refresh_is_not_cancelled_by_previously_undone_recognition() {
        let pool = db::test_pool().await.unwrap();
        sqlx::query("INSERT INTO recognition_history(id,target_work_id,target_title,file_count,scope_json,before_json,after_json,created_at,undone_at) VALUES('old','w','作品',1,'{}','{}','{}','now','later')").execute(&pool).await.unwrap();
        assert_eq!(background_operation(&pool, "w", false).await.unwrap(), Some("old".into()));
        assert_eq!(background_operation(&pool, "w", true).await.unwrap(), None);
    }

}
