use crate::error::{AppError, AppResult};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub database_path: PathBuf,
    pub data_directory: PathBuf,
    pub cover_cache_path: PathBuf,
    pub thumbnail_cache_path: PathBuf,
}

pub async fn initialize(app: &tauri::AppHandle) -> AppResult<AppState> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::System(format!("无法确定应用数据目录：{error}")))?;
    let cover_cache_path = data_directory.join("covers");
    let thumbnail_cache_path = data_directory.join("thumbnails");
    tokio::fs::create_dir_all(&cover_cache_path).await?;
    tokio::fs::create_dir_all(&thumbnail_cache_path).await?;

    let database_path = data_directory.join("genzo.db");
    let database_url = format!(
        "sqlite://{}",
        database_path.to_string_lossy().replace('\\', "/")
    );
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    backfill_cached_banner_paths(&pool, &cover_cache_path).await?;

    Ok(AppState {
        pool,
        database_path,
        data_directory,
        cover_cache_path,
        thumbnail_cache_path,
    })
}

/// Queue multi-statement writes before acquiring a pool connection, leaving
/// connections available for readers. SQLite also arbitrates other processes.
/// Acquire the write reservation before any SELECT to avoid BUSY_SNAPSHOT.
pub async fn begin_write(
    pool: &SqlitePool,
) -> AppResult<(
    tokio::sync::OwnedSemaphorePermit,
    sqlx::Transaction<'static, sqlx::Sqlite>,
)> {
    static WRITER: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = tokio::time::timeout(
        Duration::from_secs(15),
        WRITER
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1)))
            .clone()
            .acquire_owned(),
    )
    .await
    .map_err(|_| AppError::DatabaseBusy)?
    .map_err(|_| AppError::DatabaseBusy)?;
    for attempt in 0..3 {
        match pool.begin_with("BEGIN IMMEDIATE").await {
            Ok(transaction) => return Ok((permit, transaction)),
            Err(error) if is_busy(&error) && attempt < 2 => {
                // Only retry acquisition: no statements or external effects have run.
                tokio::time::sleep(Duration::from_millis(100 << attempt)).await;
            }
            Err(error) => return Err(error.into()),
        }
    }
    unreachable!()
}

pub fn is_busy(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .and_then(|code| code.parse::<i32>().ok())
        .is_some_and(|code| matches!(code & 0xff, 5 | 6))
}

async fn backfill_cached_banner_paths(pool: &SqlitePool, cache_directory: &Path) -> AppResult<()> {
    let works: Vec<(String, String)> = sqlx::query_as(
        "SELECT w.id, e.external_id FROM works w JOIN work_external_ids e ON e.work_id = w.id AND e.provider = 'bangumi' WHERE w.banner_path IS NULL",
    )
    .fetch_all(pool)
    .await?;
    for (work_id, external_id) in works {
        let candidates = [
            cache_directory.join(format!("bangumi-{external_id}-banner.jpg")),
            cache_directory.join(format!("explore-bangumi-{external_id}-banner.jpg")),
        ];
        if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
            sqlx::query("UPDATE works SET banner_path = ? WHERE id = ? AND banner_path IS NULL")
                .bind(path.to_string_lossy().to_string())
                .bind(work_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

pub fn allow_cover_file(app: &AppHandle, path: &Path) -> AppResult<()> {
    let scope = app.asset_protocol_scope();
    scope
        .allow_file(path)
        .map_err(|error| AppError::System(format!("无法授权封面文件：{error}")))?;
    if let Ok(canonical_path) = std::fs::canonicalize(path) {
        scope
            .allow_file(canonical_path)
            .map_err(|error| AppError::System(format!("无法授权封面文件：{error}")))?;
    }
    Ok(())
}

pub fn allow_cached_images(app: &AppHandle, directory: &Path) -> AppResult<()> {
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_file() {
            allow_cover_file(app, &path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub async fn test_pool() -> AppResult<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    async fn disk_pool() -> (SqlitePool, tempfile::TempDir) {
        let directory = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(directory.path().join("concurrency.db"))
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .busy_timeout(Duration::from_millis(20)),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE counter(value INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO counter VALUES(0)")
            .execute(&pool)
            .await
            .unwrap();
        (pool, directory)
    }

    #[tokio::test]
    async fn reproduces_517_and_serializes_read_modify_write_without_blocking_readers() {
        let (pool, _directory) = disk_pool().await;
        let mut stale = pool.begin().await.unwrap();
        let _: i64 = sqlx::query_scalar("SELECT value FROM counter")
            .fetch_one(&mut *stale)
            .await
            .unwrap();
        sqlx::query("UPDATE counter SET value=1")
            .execute(&pool)
            .await
            .unwrap();
        let error = sqlx::query("UPDATE counter SET value=2")
            .execute(&mut *stale)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("517")
        );
        stale.rollback().await.unwrap();

        let (guard, mut first) = begin_write(&pool).await.unwrap();
        sqlx::query("UPDATE counter SET value=value+1")
            .execute(&mut *first)
            .await
            .unwrap();
        let next_pool = pool.clone();
        let mut next = tokio::spawn(async move {
            let (_guard, mut tx) = begin_write(&next_pool).await.unwrap();
            let value: i64 = sqlx::query_scalar("SELECT value FROM counter")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
            sqlx::query("UPDATE counter SET value=?")
                .bind(value + 1)
                .execute(&mut *tx)
                .await
                .unwrap();
            tx.commit().await.unwrap();
        });
        assert!(tokio::time::timeout(Duration::from_millis(50), &mut next)
            .await
            .is_err());
        let read: i64 = tokio::time::timeout(
            Duration::from_secs(1),
            sqlx::query_scalar("SELECT value FROM counter").fetch_one(&pool),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(read, 1, "reader sees committed data while writer is active");
        first.commit().await.unwrap();
        drop(guard);
        next.await.unwrap();
        let value: i64 = sqlx::query_scalar("SELECT value FROM counter")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(value, 3);
        pool.close().await;
    }

    #[tokio::test]
    async fn retries_external_writer_and_reports_bounded_contention_without_partial_writes() {
        let (pool, _directory) = disk_pool().await;
        let external = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let next_pool = pool.clone();
        let mut pending = tokio::spawn(async move {
            let (_guard, mut tx) = begin_write(&next_pool).await?;
            sqlx::query("UPDATE counter SET value=1")
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            AppResult::Ok(())
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(80), &mut pending)
                .await
                .is_err()
        );
        external.rollback().await.unwrap();
        pending.await.unwrap().unwrap();

        let external = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let failed = tokio::time::timeout(Duration::from_secs(5), begin_write(&pool))
            .await
            .unwrap();
        assert!(matches!(failed, Err(AppError::DatabaseBusy)));
        let value: i64 = sqlx::query_scalar("SELECT value FROM counter")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(value, 1);
        external.rollback().await.unwrap();
        let (guard, tx) = begin_write(&pool).await.unwrap();
        tx.rollback().await.unwrap();
        drop(guard);
        pool.close().await;
    }

    #[tokio::test]
    async fn placeholder_migration_removes_only_unlinked_official_duplicates() {
        let pool = test_pool().await.unwrap();
        sqlx::query("INSERT INTO works(id,title,type,created_at,updated_at) VALUES ('w','OAD','video','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES ('w','bangumi','1','now','now')").execute(&pool).await.unwrap();
        for number in 0..12 {
            for (provider, id) in [
                ("bangumi", format!("official-{number}")),
                ("local", format!("local/unverified:s1:OAD:{number}")),
            ] {
                sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,description,fetched_at) VALUES ('w',?,?,?,?, 'local/unverified','now')")
                    .bind(provider).bind(id).bind(number).bind(number).execute(&pool).await.unwrap();
            }
        }
        sqlx::query("INSERT INTO media_files(id,work_id,path,file_name,extension,media_type,created_at,updated_at) VALUES ('m','w','R:\\OAD\\01.mkv','OAD 01.mkv','mkv','video','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO media_episode_links(media_file_id,work_id,provider,episode_external_id,match_method,confidence,updated_at) VALUES ('m','w','local','local/unverified:s1:OAD:1','manual',1,'now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,description,fetched_at) VALUES ('w','local','local/unverified:s1:OAD:99',99,99,'local/unverified','now')").execute(&pool).await.unwrap();
        let migration = include_str!("../migrations/0011_remove_unlinked_episode_placeholders.sql");
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        sqlx::raw_sql(migration).execute(&pool).await.unwrap(); // idempotent repair
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM anime_episodes WHERE work_id='w'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 14); // 12 official + linked local + unmatched local
        let structure = crate::anime_details::work_structure(&pool, "w")
            .await
            .unwrap();
        assert!(structure
            .episodes
            .iter()
            .any(|ep| ep.episode.provider == "local"
                && ep.local_files.iter().any(|file| file.id == "m")));
        assert_eq!(
            structure
                .episodes
                .iter()
                .filter(|ep| ep.episode.provider == "bangumi")
                .count(),
            12
        );
    }

    #[tokio::test]
    async fn backfills_existing_work_from_explore_banner_cache() {
        let pool = test_pool().await.expect("test pool");
        let directory = tempfile::tempdir().expect("cache directory");
        let banner = directory.path().join("explore-bangumi-42-banner.jpg");
        std::fs::write(&banner, b"cached image").expect("cached banner file");
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO works (id, title, type, created_at, updated_at) VALUES ('work', '作品', 'video', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("work");
        sqlx::query("INSERT INTO work_external_ids (work_id, provider, external_id, created_at, updated_at) VALUES ('work', 'bangumi', '42', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .expect("external id");

        backfill_cached_banner_paths(&pool, directory.path())
            .await
            .expect("backfill");

        let stored: Option<String> =
            sqlx::query_scalar("SELECT banner_path FROM works WHERE id = 'work'")
                .fetch_one(&pool)
                .await
                .expect("stored banner path");
        assert_eq!(stored.as_deref(), Some(banner.to_string_lossy().as_ref()));
    }
}
