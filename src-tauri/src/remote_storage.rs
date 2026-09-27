use crate::{
    credentials::{self, Credentials},
    db::AppState,
    error::{AppError, AppResult},
    webdav::{DavClient, DavEntry},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSource {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub directory: String,
    #[serde(skip_serializing)]
    pub credential_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub endpoint: String,
    pub directory: String,
    pub username: String,
    pub password: String,
    pub kind: String,
}

pub async fn source(pool: &SqlitePool, id: &str) -> AppResult<RemoteSource> {
    sqlx::query_as("SELECT * FROM remote_sources WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("WebDAV 来源不存在".into()))
}

pub fn client(source: &RemoteSource) -> AppResult<DavClient> {
    DavClient::new(&source.endpoint, credentials::read(&source.credential_id)?)
}

#[tauri::command]
pub async fn list_remote_sources(state: State<'_, AppState>) -> AppResult<Vec<RemoteSource>> {
    Ok(sqlx::query_as("SELECT * FROM remote_sources ORDER BY name")
        .fetch_all(&state.pool)
        .await?)
}

#[tauri::command]
pub async fn browse_webdav(input: ConnectionInput) -> AppResult<Vec<DavEntry>> {
    let client = DavClient::new(
        &input.endpoint,
        Credentials {
            username: input.username,
            password: input.password,
        },
    )?;
    client
        .list(client.directory_url(&input.directory)?.path())
        .await
}

#[tauri::command]
pub async fn add_webdav_source(
    input: ConnectionInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    if input.name.trim().is_empty()
        || !["auto", "video", "comic", "novel", "mixed"].contains(&input.kind.as_str())
    {
        return Err(AppError::Validation(
            "请填写名称并选择有效的媒体类型".into(),
        ));
    }
    let credential = Credentials {
        username: input.username,
        password: input.password,
    };
    let client = DavClient::new(&input.endpoint, credential.clone())?;
    let directory = input.directory.trim_matches('/').to_string();
    client
        .list(client.directory_url(&directory)?.path())
        .await?;
    let id = Uuid::new_v4().to_string();
    credentials::save(&id, &credential)?;
    let result: AppResult<()> = async {
        let (_write_guard, mut tx) = crate::db::begin_write(&state.pool).await?;
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO library_roots(id,path,kind,enabled,created_at,updated_at,source_type,availability) VALUES(?,?,?,1,?,?,'webdav','online')")
            .bind(&id).bind(format!("webdav://{id}")).bind(&input.kind).bind(&now).bind(&now).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO remote_sources(id,name,endpoint,directory,credential_id) VALUES(?,?,?,?,?)")
            .bind(&id).bind(input.name.trim()).bind(client.base.as_str()).bind(directory).bind(&id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }.await;
    if result.is_err() {
        credentials::delete(&id);
    }
    result?;
    Ok(id)
}

#[tauri::command]
pub async fn update_webdav_credentials(
    id: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let source = source(&state.pool, &id).await?;
    let credential = Credentials { username, password };
    let client = DavClient::new(&source.endpoint, credential.clone())?;
    client
        .list(client.directory_url(&source.directory)?.path())
        .await?;
    credentials::save(&source.credential_id, &credential)
}

// Encoding every byte makes the virtual path safe with the legacy NOCASE path index.
// Case-sensitive WebDAV names such as A.mkv and a.mkv remain different resources.
pub fn virtual_path(id: &str, relative: &str) -> String {
    let segments: Vec<String> = relative
        .split('/')
        .filter(|p| !p.is_empty())
        .map(|p| p.as_bytes().iter().map(|b| format!("{b:02x}")).collect())
        .collect();
    format!("webdav://{id}/{}", segments.join("/"))
}

pub fn display_path(path: &str) -> String {
    if !path.starts_with("webdav://") {
        return path.into();
    }
    let mut parts = path[9..].split('/');
    let id = parts.next().unwrap_or_default();
    let decoded: Vec<String> = parts
        .map(|part| {
            let bytes: Option<Vec<u8>> = (0..part.len())
                .step_by(2)
                .map(|i| {
                    part.get(i..i + 2)
                        .and_then(|s| u8::from_str_radix(s, 16).ok())
                })
                .collect();
            bytes
                .and_then(|v| String::from_utf8(v).ok())
                .unwrap_or_else(|| part.into())
        })
        .collect();
    format!("webdav://{id}/{}", decoded.join("/"))
}

pub fn serialize_display_path<S: serde::Serializer>(
    path: &str,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&display_path(path))
}

#[tauri::command]
pub async fn set_root_source_type(
    id: String,
    source_type: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if !["local", "mounted"].contains(&source_type.as_str()) {
        return Err(AppError::Validation("无效的来源类型".into()));
    }
    let result = sqlx::query(
        "UPDATE library_roots SET source_type = ? WHERE id = ? AND source_type != 'webdav'",
    )
    .bind(source_type)
    .bind(id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("本地或挂载来源不存在".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn virtual_paths_roundtrip_without_case_collisions() {
        let a = virtual_path("source", "动漫/A.mkv");
        let b = virtual_path("source", "动漫/a.mkv");
        assert_ne!(a.to_lowercase(), b.to_lowercase());
        assert_eq!(display_path(&a), "webdav://source/动漫/A.mkv");
    }
}
