//! Index-only relocation. Never opens, writes, moves or removes real media.
use crate::{
    db,
    error::{AppError, AppResult},
    remote_storage,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use tauri::State;

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: String,
    pub work_id: Option<String>,
    pub title: Option<String>,
    pub library_root_id: Option<String>,
    pub path: String,
    pub file_name: String,
    pub media_type: String,
    pub extension: String,
    pub size: i64,
    pub modified_at: Option<String>,
    pub missing: bool,
    pub updated_at: String,
    pub content_fingerprint: Option<String>,
    pub availability: Option<String>,
    pub source_type: Option<String>,
    pub root_path: Option<String>,
    pub last_scanned_at: Option<String>,
    pub href: Option<String>,
    pub etag: Option<String>,
}
const LOCATIONS: &str = "SELECT m.id,m.work_id,w.title,m.library_root_id,m.path,m.file_name,m.media_type,m.extension,m.size,m.modified_at,m.missing,m.updated_at,m.content_fingerprint,r.availability,r.source_type,r.path AS root_path,r.last_scanned_at,f.href,f.etag FROM media_files m LEFT JOIN works w ON w.id=m.work_id LEFT JOIN library_roots r ON r.id=m.library_root_id LEFT JOIN remote_files f ON f.media_file_id=m.id";

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub path: String,
    pub work_id: Option<String>,
    pub root_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueGroup {
    pub kind: String,
    pub total: i64,
    pub items: Vec<Issue>,
}

pub async fn inspect(pool: &SqlitePool) -> AppResult<Vec<IssueGroup>> {
    // Stored scan results only: no potentially blocking network filesystem probing.
    let queries = [
        ("offline", "SELECT 'offline' AS kind,r.id,COALESCE(s.name,r.path) AS title,r.path,NULL AS work_id,r.id AS root_id FROM library_roots r LEFT JOIN remote_sources s ON s.id=r.id WHERE r.availability='unavailable'"),
        ("missing", "SELECT 'missing' AS kind,m.id,COALESCE(w.title,m.file_name) AS title,m.path,m.work_id,m.library_root_id AS root_id FROM media_files m LEFT JOIN works w ON w.id=m.work_id LEFT JOIN library_roots r ON r.id=m.library_root_id WHERE m.missing=1 AND COALESCE(r.availability,'unknown')!='unavailable'"),
        ("duplicate", "SELECT 'duplicate' AS kind,m.id,COALESCE(w.title,m.file_name) AS title,m.path,m.work_id,m.library_root_id AS root_id FROM media_files m LEFT JOIN works w ON w.id=m.work_id WHERE m.missing=0 AND (m.file_name COLLATE NOCASE,m.size,m.media_type) IN (SELECT file_name COLLATE NOCASE,size,media_type FROM media_files WHERE missing=0 GROUP BY file_name COLLATE NOCASE,size,media_type HAVING COUNT(*)>1)"),
        ("unlinked", "SELECT 'unlinked' AS kind,m.id,w.title,m.path,m.work_id,m.library_root_id AS root_id FROM media_files m JOIN works w ON w.id=m.work_id WHERE m.media_type='video' AND m.missing=0 AND EXISTS(SELECT 1 FROM anime_episodes e WHERE e.work_id=m.work_id) AND NOT EXISTS(SELECT 1 FROM media_episode_links l WHERE l.media_file_id=m.id)"),
        ("mixed", "SELECT 'mixed' AS kind,w.id,w.title,'' AS path,w.id AS work_id,NULL AS root_id FROM works w WHERE w.id IN (SELECT work_id FROM media_files WHERE media_type='video' AND missing=0 AND parsed_season IS NOT NULL AND parsed_special_type IS NULL GROUP BY work_id HAVING COUNT(DISTINCT parsed_season)>1)"),
    ];
    let mut tx = pool.begin().await?;
    let mut result = Vec::new();
    for (kind, sql) in queries {
        let total = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM ({sql})"))
            .fetch_one(&mut *tx)
            .await?;
        let mut items: Vec<Issue> = sqlx::query_as(&format!(
            "SELECT * FROM ({sql}) ORDER BY title,id LIMIT 200"
        ))
        .fetch_all(&mut *tx)
        .await?;
        for item in &mut items {
            item.path = remote_storage::display_path(&item.path);
        }
        result.push(IssueGroup {
            kind: kind.into(),
            total,
            items,
        });
    }
    tx.commit().await?;
    Ok(result)
}

#[tauri::command]
pub async fn inspect_library(state: State<'_, db::AppState>) -> AppResult<Vec<IssueGroup>> {
    inspect(&state.pool).await
}

#[tauri::command]
pub async fn list_relocation_files(
    root_id: String,
    state: State<'_, db::AppState>,
) -> AppResult<Vec<Location>> {
    let mut items: Vec<Location> = sqlx::query_as(&format!(
        "{LOCATIONS} WHERE m.library_root_id=? ORDER BY m.path LIMIT 10001"
    ))
    .bind(root_id)
    .fetch_all(&state.pool)
    .await?;
    if items.len() > 10000 {
        return Err(AppError::Validation(
            "该来源超过 10000 个文件，请缩小扫描来源后再定位".into(),
        ));
    }
    for item in &mut items {
        item.path = remote_storage::display_path(&item.path);
    }
    Ok(items)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub old_id: String,
    pub new_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub pair: Pair,
    pub old_path: String,
    pub new_path: String,
    pub title: String,
    pub size: i64,
    pub token: String,
}
#[derive(Serialize)]
pub struct Preview {
    pub token: String,
    pub rows: Vec<PreviewRow>,
}

async fn location(tx: &mut Transaction<'_, Sqlite>, id: &str) -> AppResult<Location> {
    sqlx::query_as(&format!("{LOCATIONS} WHERE m.id=?"))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("文件记录已变化，请重新预览".into()))
}

async fn build(
    tx: &mut Transaction<'_, Sqlite>,
    pairs: &[Pair],
) -> AppResult<(Preview, Vec<(Location, Location)>)> {
    if pairs.is_empty() || pairs.len() > 1000 {
        return Err(AppError::Validation("每次请选择 1–1000 个文件迁移".into()));
    }
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    let mut locations = Vec::new();
    let mut digest = Sha256::new();
    for pair in pairs {
        if !seen.insert(pair.old_id.clone()) || !seen.insert(pair.new_id.clone()) {
            return Err(AppError::Validation("文件重复或迁移范围相互重叠".into()));
        }
        let old = location(tx, &pair.old_id).await?;
        let new = location(tx, &pair.new_id).await?;
        if old.size <= 0 || old.size != new.size || old.media_type != new.media_type {
            return Err(AppError::Validation(format!(
                "{} 的类型或大小不一致，不能迁移",
                old.file_name
            )));
        }
        if old
            .content_fingerprint
            .as_ref()
            .zip(new.content_fingerprint.as_ref())
            .is_some_and(|(a, b)| a != b)
        {
            return Err(AppError::Validation("文件指纹不一致，不能迁移".into()));
        }
        if new.missing
            || new.availability.as_deref() != Some("online")
            || new.last_scanned_at.is_none()
        {
            return Err(AppError::Validation(
                "目标来源需成功扫描且当前在线，请先扫描 / 重连".into(),
            ));
        }
        if (new.source_type.as_deref() == Some("webdav")) != new.href.is_some() {
            return Err(AppError::Validation(
                "目标资源定位信息不完整，请重新扫描来源".into(),
            ));
        }
        // Never overwrite the target's ownership, progress, mapping, subtitles or cache.
        let protected: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_files WHERE id=? AND work_id IS NOT NULL) OR EXISTS(SELECT 1 FROM playback_progress WHERE media_file_id=?) OR EXISTS(SELECT 1 FROM media_episode_links WHERE media_file_id=?) OR EXISTS(SELECT 1 FROM subtitle_links WHERE subtitle_media_file_id=? OR video_media_file_id=?) OR EXISTS(SELECT 1 FROM match_candidates WHERE media_file_id=?) OR EXISTS(SELECT 1 FROM remote_cache WHERE media_file_id IN (?,?))")
            .bind(&new.id).bind(&new.id).bind(&new.id).bind(&new.id).bind(&new.id).bind(&new.id).bind(&new.id).bind(&old.id)
            .fetch_one(&mut **tx).await?;
        if protected {
            return Err(AppError::Validation(format!(
                "目标已有整理记录，或源 / 目标已有远程缓存：{}；本次不覆盖",
                new.file_name
            )));
        }
        if crate::playback::relocation_busy(&old.id)
            || crate::playback::relocation_busy(&new.id)
            || crate::remote_transfer::relocation_leased(&old.id)
            || crate::remote_transfer::relocation_leased(&new.id)
        {
            return Err(AppError::Validation("文件正在播放或仍受远程播放保护；结束使用后重试。如已停止远程播放，请关闭播放器并重启 Genzo 后重试".into()));
        }
        let running: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM scan_jobs WHERE status='running' AND library_root_id IN (?,?))")
            .bind(&old.library_root_id).bind(&new.library_root_id).fetch_one(&mut **tx).await?;
        if running {
            return Err(AppError::Validation(
                "相关来源正在扫描，请等待完成后重新预览".into(),
            ));
        }
        let bytes = serde_json::to_vec(&(&old, &new))?;
        digest.update(&bytes);
        rows.push(PreviewRow {
            pair: pair.clone(),
            old_path: remote_storage::display_path(&old.path),
            new_path: remote_storage::display_path(&new.path),
            title: old.title.clone().unwrap_or_else(|| old.file_name.clone()),
            size: old.size,
            token: format!("{:x}", Sha256::digest(bytes)),
        });
        locations.push((old, new));
    }
    Ok((
        Preview {
            token: format!("{:x}", digest.finalize()),
            rows,
        },
        locations,
    ))
}

pub async fn preview(pool: &SqlitePool, pairs: &[Pair]) -> AppResult<Preview> {
    let mut tx = pool.begin().await?;
    let (preview, _) = build(&mut tx, pairs).await?;
    tx.commit().await?;
    Ok(preview)
}

pub async fn apply(pool: &SqlitePool, pairs: &[Pair], token: &str) -> AppResult<usize> {
    // Cache downloads and relocation must not race between validation and commit.
    let _transfer = crate::remote_transfer::relocation_lock().await?;
    let (_writer, mut tx) = db::begin_write(pool).await?;
    let (preview, locations) = build(&mut tx, pairs).await?;
    if preview.token != token {
        return Err(AppError::Validation(
            "预览后文件或来源已变化，请重新预览；未执行迁移".into(),
        ));
    }
    for (old, new) in locations {
        // All target dependent records were checked above. Keep the original ID:
        // manual links, subtitle links and playback progress remain untouched.
        sqlx::query("DELETE FROM media_files WHERE id=?")
            .bind(&new.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM remote_files WHERE media_file_id=?")
            .bind(&old.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE media_files SET library_root_id=?,path=?,file_name=?,extension=?,size=?,modified_at=?,missing=0,content_fingerprint=COALESCE(?,content_fingerprint),updated_at=? WHERE id=?")
            .bind(&new.library_root_id).bind(&new.path).bind(&new.file_name)
            .bind(&new.extension).bind(new.size).bind(&new.modified_at)
            .bind(&new.content_fingerprint).bind(chrono::Utc::now().to_rfc3339()).bind(&old.id).execute(&mut *tx).await?;
        if let Some(href) = new.href {
            sqlx::query(
                "INSERT INTO remote_files(media_file_id,source_id,href,etag) VALUES(?,?,?,?)",
            )
            .bind(&old.id)
            .bind(&new.library_root_id)
            .bind(href)
            .bind(new.etag)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(pairs.len())
}

#[tauri::command]
pub async fn preview_media_relocation(
    pairs: Vec<Pair>,
    state: State<'_, db::AppState>,
) -> AppResult<Preview> {
    preview(&state.pool, &pairs).await
}
#[tauri::command]
pub async fn apply_media_relocation(
    pairs: Vec<Pair>,
    token: String,
    state: State<'_, db::AppState>,
) -> AppResult<usize> {
    apply(&state.pool, &pairs, &token).await
}

#[cfg(test)]
mod tests;
