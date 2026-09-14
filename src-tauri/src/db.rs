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

    Ok(AppState {
        pool,
        database_path,
        data_directory,
        cover_cache_path,
    })
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
