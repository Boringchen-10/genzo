use crate::error::{AppError, AppResult};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub database_path: PathBuf,
    pub data_directory: PathBuf,
    pub cover_cache_path: PathBuf,
}

pub async fn initialize(app: &tauri::AppHandle) -> AppResult<AppState> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::System(format!("无法确定应用数据目录：{error}")))?;
    let cover_cache_path = data_directory.join("covers");
    tokio::fs::create_dir_all(&cover_cache_path).await?;

    let database_path = data_directory.join("genzo.db");
    let database_url = format!(
        "sqlite://{}",
        database_path.to_string_lossy().replace('\\', "/")
    );
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
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
    })
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

pub fn allow_cached_covers(app: &AppHandle, directory: &Path) -> AppResult<()> {
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
