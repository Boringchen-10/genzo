use crate::anime_parser::parse_media_path;
use crate::error::AppResult;
use sqlx::{FromRow, Sqlite, Transaction};
use std::collections::HashMap;
use std::path::Path;

#[derive(FromRow)]
struct Relocation {
    old_id: String,
    current_id: String,
    old_path: String,
    current_path: String,
    old_name: String,
    current_name: String,
    size: i64,
}

/// Reconciles database records only. Never deletes, renames or writes media.
pub async fn reconcile(
    transaction: &mut Transaction<'_, Sqlite>,
    work_id: Option<&str>,
) -> AppResult<u64> {
    let pairs = sqlx::query_as::<_, Relocation>("SELECT * FROM media_relocation_candidates WHERE (? IS NULL OR old_id IN (SELECT id FROM media_files WHERE work_id = ?))")
        .bind(work_id).bind(work_id)
        .fetch_all(&mut **transaction)
        .await?;
    let mut old_counts = HashMap::new();
    let mut current_counts = HashMap::new();
    for pair in &pairs {
        *old_counts.entry(&pair.old_id).or_insert(0) += 1;
        *current_counts.entry(&pair.current_id).or_insert(0) += 1;
    }
    let mut removed = 0;
    for pair in &pairs {
        // Multiple copies are ambiguous, even if their sampled fingerprints match.
        if old_counts[&pair.old_id] != 1 || current_counts[&pair.current_id] != 1 {
            continue;
        }
        let old = parse_media_path(&pair.old_name, Path::new(&pair.old_path), None);
        let current = parse_media_path(&pair.current_name, Path::new(&pair.current_path), None);
        if old.season.unwrap_or(1) != current.season.unwrap_or(1)
            || old.special_type != current.special_type
            || (old.episode_start.is_some()
                && current.episode_start.is_some()
                && (old.episode_start, old.episode_end)
                    != (current.episode_start, current.episode_end))
        {
            continue;
        }
        // A missing flag can be stale (e.g. disconnected disk). Verify the actual
        // old path is absent and the new path is still a file of the expected size.
        if !matches!(Path::new(&pair.old_path).try_exists(), Ok(false)) {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&pair.current_path) else {
            continue;
        };
        if !metadata.is_file() || i64::try_from(metadata.len()).ok() != Some(pair.size) {
            continue;
        }
        let conflicting: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM media_episode_links old JOIN media_episode_links current ON current.media_file_id = ? WHERE old.media_file_id = ? AND (old.work_id != current.work_id OR old.provider != current.provider OR old.episode_external_id != current.episode_external_id)) OR EXISTS(SELECT 1 FROM match_candidates WHERE media_file_id = ?)",
        ).bind(&pair.current_id).bind(&pair.old_id).bind(&pair.old_id)
            .fetch_one(&mut **transaction).await?;
        if conflicting {
            continue;
        }
        sqlx::query(
            "INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) SELECT ?, work_id, provider, episode_external_id, match_method, confidence, updated_at FROM media_episode_links WHERE media_file_id = ? ON CONFLICT(media_file_id) DO UPDATE SET match_method = CASE WHEN excluded.match_method = 'manual' THEN 'manual' ELSE media_episode_links.match_method END",
        ).bind(&pair.current_id).bind(&pair.old_id).execute(&mut **transaction).await?;
        sqlx::query(
            "UPDATE subtitle_links SET video_media_file_id = ? WHERE video_media_file_id = ?",
        )
        .bind(&pair.current_id)
        .bind(&pair.old_id)
        .execute(&mut **transaction)
        .await?;
        removed += sqlx::query("DELETE FROM media_files WHERE id = ? AND missing = 1")
            .bind(&pair.old_id)
            .execute(&mut **transaction)
            .await?
            .rows_affected();
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Utc;
    use sqlx::SqlitePool;

    async fn fixture() -> (SqlitePool, tempfile::TempDir) {
        let pool = db::test_pool().await.unwrap();
        let directory = tempfile::tempdir().unwrap();
        let now = Utc::now().to_rfc3339();
        for work in ["work", "other"] {
            sqlx::query("INSERT INTO works (id, title, type, notes, created_at, updated_at) VALUES (?, '动画', 'video', '保留笔记', ?, ?)")
                .bind(work).bind(&now).bind(&now).execute(&pool).await.unwrap();
        }
        (pool, directory)
    }

    async fn pair(pool: &SqlitePool, directory: &Path, index: i32) -> (String, String) {
        let name = format!("[Zdm] Show [{index:02}][2160p].mkv");
        let current = directory.join("new").join(&name);
        std::fs::create_dir_all(current.parent().unwrap()).unwrap();
        std::fs::write(&current, b"video").unwrap();
        let old = directory.join("old").join(&name);
        let now = Utc::now().to_rfc3339();
        for (id, path, missing, episode) in [
            (format!("old{index}"), &old, true, None),
            (format!("new{index}"), &current, false, Some(index)),
        ] {
            sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, modified_at, missing, parsed_episode_start, created_at, updated_at) VALUES (?, 'work', ?, ?, 'mkv', 'video', 5, 'same-modified-time', ?, ?, ?, ?)")
                .bind(id).bind(path.to_string_lossy().as_ref()).bind(&name).bind(missing).bind(episode).bind(&now).bind(&now).execute(pool).await.unwrap();
        }
        (
            old.to_string_lossy().into(),
            current.to_string_lossy().into(),
        )
    }

    #[tokio::test]
    async fn reconciles_legacy_unowned_rows_and_preserves_links() {
        let (pool, directory) = fixture().await;
        for episode in 1..=12 {
            pair(&pool, directory.path(), episode).await;
        }
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, episode_number, sort_number, fetched_at) VALUES ('work', 'bangumi', 'ep1', 1, 1, ?), ('work', 'bangumi', 'ep2', 2, 2, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        for (media, episode, method) in [("new1", "ep1", "parsed"), ("old2", "ep2", "manual")] {
            sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, 'work', 'bangumi', ?, ?, 1, ?)")
                .bind(media).bind(episode).bind(method).bind(&now).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, created_at, updated_at) VALUES ('sub', 'work', 'C:\\fixture.ass', 'fixture.ass', 'ass', 'other', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO subtitle_links (subtitle_media_file_id, video_media_file_id, work_id, match_method, created_at, updated_at) VALUES ('sub', 'old2', 'work', 'episode', ?, ?)")
            .bind(&now).bind(&now).execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(reconcile(&mut tx, Some("work")).await.unwrap(), 12);
        tx.commit().await.unwrap();
        let links: Vec<(String, String)> = sqlx::query_as(
            "SELECT media_file_id, match_method FROM media_episode_links ORDER BY media_file_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            links,
            vec![
                ("new1".into(), "parsed".into()),
                ("new2".into(), "manual".into())
            ]
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT video_media_file_id FROM subtitle_links")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "new2"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM media_files WHERE media_type = 'video'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            12
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT notes FROM works WHERE id = 'work'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "保留笔记"
        );
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(reconcile(&mut tx, None).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn preserves_different_copies_offline_files_and_uncertain_matches() {
        let (pool, directory) = fixture().await;
        for index in 1..=7 {
            let (old, current) = pair(&pool, directory.path(), index).await;
            match index {
                1 => {
                    // The "missing" flag was wrong; both copies are present.
                    std::fs::create_dir_all(Path::new(&old).parent().unwrap()).unwrap();
                    std::fs::write(old, b"video").unwrap();
                }
                2 => {
                    std::fs::remove_file(current).unwrap();
                }
                3 => {
                    sqlx::query("UPDATE media_files SET content_fingerprint = id WHERE id IN ('old3', 'new3')").execute(&pool).await.unwrap();
                }
                4 => {
                    sqlx::query("UPDATE media_files SET work_id = 'other' WHERE id = 'new4'")
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                5 => {
                    sqlx::query("UPDATE media_files SET path = REPLACE(path, 'old', 'Season 2') WHERE id = 'old5'").execute(&pool).await.unwrap();
                }
                6 => {
                    sqlx::query("UPDATE media_files SET path = REPLACE(path, 'old', 'OAD') WHERE id = 'old6'").execute(&pool).await.unwrap();
                }
                7 => {
                    sqlx::query(
                        "UPDATE media_files SET modified_at = 'different' WHERE id = 'new7'",
                    )
                    .execute(&pool)
                    .await
                    .unwrap();
                }
                _ => unreachable!(),
            }
        }
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(reconcile(&mut tx, None).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn preserves_ambiguous_duplicates_and_conflicting_manual_episodes() {
        let (pool, directory) = fixture().await;
        let (_, current) = pair(&pool, directory.path(), 1).await;
        let second = directory.path().join("copy.mkv");
        std::fs::copy(current, &second).unwrap();
        sqlx::query("INSERT INTO media_files (id, work_id, path, file_name, extension, media_type, size, modified_at, created_at, updated_at) SELECT 'copy', work_id, ?, file_name, extension, media_type, size, modified_at, created_at, updated_at FROM media_files WHERE id = 'new1'")
            .bind(second.to_string_lossy().as_ref()).execute(&pool).await.unwrap();
        pair(&pool, directory.path(), 2).await;
        let now = Utc::now().to_rfc3339();
        for (file, episode) in [("old2", "ep1"), ("new2", "ep2")] {
            sqlx::query("INSERT INTO anime_episodes (work_id, provider, external_id, sort_number, fetched_at) VALUES ('work', 'bangumi', ?, 1, ?)")
                .bind(episode).bind(&now).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO media_episode_links (media_file_id, work_id, provider, episode_external_id, match_method, confidence, updated_at) VALUES (?, 'work', 'bangumi', ?, 'manual', 1, ?)")
                .bind(file).bind(episode).bind(&now).execute(&pool).await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(reconcile(&mut tx, None).await.unwrap(), 0);
    }

    #[tokio::test]
    #[ignore = "requires a backed-up library copy; never runs on the live database"]
    async fn verifies_saved_library_copy() {
        let path = std::env::var("GENZO_RECONCILE_COPY_DB").expect("backup path");
        let name = Path::new(&path).file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("genzo-readable-backup-") && name.ends_with(".db"));
        let work = std::env::var("GENZO_RECONCILE_WORK_ID").expect("work id");
        let pool = SqlitePool::connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .foreign_keys(true),
        )
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../migrations/0008_media_relocation_candidates.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let before: Vec<(String, String)> = sqlx::query_as("SELECT m.id, l.episode_external_id FROM media_files m JOIN media_episode_links l ON l.media_file_id = m.id WHERE m.work_id = ? AND m.missing = 0 ORDER BY m.id")
            .bind(&work).fetch_all(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let removed = reconcile(&mut tx, Some(&work)).await.unwrap();
        assert!(removed > 0);
        tx.commit().await.unwrap();
        let after: Vec<(String, String)> = sqlx::query_as("SELECT m.id, l.episode_external_id FROM media_files m JOIN media_episode_links l ON l.media_file_id = m.id WHERE m.work_id = ? AND m.missing = 0 ORDER BY m.id")
            .bind(&work).fetch_all(&pool).await.unwrap();
        assert_eq!(before, after);
        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM media_files WHERE work_id = ? AND missing = 1",
        )
        .bind(&work)
        .fetch_one(&pool)
        .await
        .unwrap();
        println!("Reconciled {removed} stale records; {remaining} missing remain; {} active episode links preserved", after.len());
        assert_eq!(remaining, 0);
    }
}
