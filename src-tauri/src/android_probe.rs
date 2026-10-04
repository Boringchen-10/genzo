use crate::{db::AppState, error::AppResult};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    platform: &'static str,
    database_path: String,
    migrations: i64,
    integrity: String,
    database_marker: Option<String>,
    cache_marker: Option<String>,
    credential_marker_matches: bool,
}

// Only touches an app-private test marker, never the user's media or library rows.
#[tauri::command]
pub async fn android_probe(write: bool, state: State<'_, AppState>) -> AppResult<Probe> {
    let marker_path = state
        .thumbnail_cache_path
        .join("android-prototype-marker.txt");
    if write {
        let marker = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO app_settings (key, value, updated_at) VALUES ('android.prototype.marker', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
            .bind(&marker)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.pool)
            .await?;
        tokio::fs::write(&marker_path, &marker).await?;
        #[cfg(target_os = "android")]
        crate::credentials::save(
            "android-prototype-marker",
            &crate::credentials::Credentials {
                username: "prototype".into(),
                password: marker,
            },
        )?;
    }
    let database_marker =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'android.prototype.marker'")
            .fetch_optional(&state.pool)
            .await?;
    let cache_marker = match tokio::fs::read_to_string(&marker_path).await {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    #[cfg(target_os = "android")]
    let credential_marker_matches = crate::credentials::read("android-prototype-marker")
        .is_ok_and(|value| database_marker.as_deref() == Some(value.password.as_str()));
    #[cfg(not(target_os = "android"))]
    let credential_marker_matches = false;
    Ok(Probe {
        platform: std::env::consts::OS,
        database_path: state.database_path.to_string_lossy().into_owned(),
        migrations: sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(&state.pool)
            .await?,
        integrity: sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&state.pool)
            .await?,
        database_marker,
        cache_marker,
        credential_marker_matches,
    })
}
