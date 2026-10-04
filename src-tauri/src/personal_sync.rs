use crate::{
    credentials::{self, Credentials},
    db::AppState,
    error::{AppError, AppResult},
};
use genzo_sync::{store, transport::DavTransport};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use tauri::{Emitter, State};
use tokio::sync::{Mutex, Notify};

struct Runtime {
    gate: Mutex<()>,
    running: AtomicBool,
    requested: AtomicBool,
    notify: Notify,
}
fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| Runtime {
        gate: Mutex::new(()),
        running: AtomicBool::new(false),
        requested: AtomicBool::new(false),
        notify: Notify::new(),
    })
}
fn error(value: genzo_sync::Error) -> AppError {
    let code = value.to_string();
    AppError::Validation(format!("{code}：{}", store::error_message(&code)))
}
pub fn request() {
    runtime().requested.store(true, Ordering::Relaxed);
    runtime().notify.notify_one();
}
async fn emit(app: &tauri::AppHandle, pool: &sqlx::SqlitePool) {
    if let Ok(status) = store::status(pool, runtime().running.load(Ordering::Relaxed)).await {
        let _ = app.emit("sync-status", status);
    }
}
async fn transport(pool: &sqlx::SqlitePool) -> AppResult<DavTransport> {
    let (endpoint, id, loopback) = store::configuration(pool)
        .await
        .map_err(error)?
        .ok_or_else(|| error(genzo_sync::Error::NotFound))?;
    let credentials = credentials::read(&id).map_err(|_| error(genzo_sync::Error::Auth))?;
    DavTransport::new(
        &endpoint,
        credentials.username,
        credentials.password,
        loopback,
    )
    .map_err(error)
}
struct Running;
impl Drop for Running {
    fn drop(&mut self) {
        runtime().running.store(false, Ordering::Relaxed);
    }
}
async fn run(app: &tauri::AppHandle, pool: &sqlx::SqlitePool) -> AppResult<()> {
    let Ok(_gate) = runtime().gate.try_lock() else {
        return Ok(());
    };
    runtime().running.store(true, Ordering::Relaxed);
    let running = Running;
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_operations")
        .fetch_one(pool)
        .await?;
    emit(app, pool).await;
    let result = async {
        let dav = transport(pool).await?;
        store::synchronize(pool, &dav).await.map_err(error)
    }
    .await;
    if result.is_err() {
        // No detailed response or credentials enter this status record.
        if let Err(AppError::Validation(message)) = &result {
            let code = message.split('：').next().unwrap_or("OFFLINE");
            sqlx::query("UPDATE sync_runtime SET error_code=? WHERE id=1")
                .bind(code)
                .execute(pool)
                .await?;
        }
    }
    drop(running);
    if result.is_ok() {
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_operations")
            .fetch_one(pool)
            .await?;
        if after != before {
            let _ = app.emit("sync-library-updated", ());
        }
    }
    emit(app, pool).await;
    result
}
pub fn start(app: tauri::AppHandle, pool: sqlx::SqlitePool) {
    tauri::async_runtime::spawn(async move {
        if store::initialize(&pool).await.is_err() {
            return;
        }
        request();
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(5));
        let mut next_retry = tokio::time::Instant::now();
        let mut failures = 0u32;
        loop {
            tokio::select! { _ = tick.tick() => {}, _ = runtime().notify.notified() => {} }
            let enabled: bool = sqlx::query_scalar(
                "SELECT enabled=1 AND library_id IS NOT NULL FROM sync_runtime WHERE id=1",
            )
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
            if !enabled {
                continue;
            }
            let requested = runtime().requested.swap(false, Ordering::Relaxed);
            let pending: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM sync_journal)+(SELECT COUNT(*) FROM sync_operations WHERE pending=1)").fetch_one(&pool).await.unwrap_or(0);
            if !requested && (pending == 0 || tokio::time::Instant::now() < next_retry) {
                continue;
            }
            if run(&app, &pool).await.is_ok() {
                failures = 0;
                next_retry = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
            } else {
                failures = (failures + 1).min(6);
                next_retry = tokio::time::Instant::now()
                    + std::time::Duration::from_secs((5u64 << failures).min(300));
            }
        }
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    endpoint: String,
    username: String,
    password: String,
    #[serde(default)]
    device_name: String,
    #[serde(default)]
    allow_loopback_http: bool,
}
#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> AppResult<store::Status> {
    store::initialize(&state.pool).await.map_err(error)?;
    store::status(&state.pool, runtime().running.load(Ordering::Relaxed))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn sync_test_connection(input: ConnectionInput) -> AppResult<()> {
    let dav = DavTransport::new(
        &input.endpoint,
        input.username,
        input.password,
        input.allow_loopback_http,
    )
    .map_err(error)?;
    dav.probe().await.map_err(error)
}
#[tauri::command]
pub async fn sync_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ConnectionInput,
    mode: String,
) -> AppResult<store::Status> {
    if !matches!(mode.as_str(), "create" | "join") {
        return Err(AppError::Validation("请选择创建或加入同步空间".into()));
    }
    let _gate = runtime().gate.lock().await;
    store::initialize(&state.pool).await.map_err(error)?;
    let address = genzo_sync::transport::endpoint(&input.endpoint, input.allow_loopback_http)
        .map_err(error)?
        .to_string();
    let dav = DavTransport::new(
        &address,
        input.username.clone(),
        input.password.clone(),
        input.allow_loopback_http,
    )
    .map_err(error)?;
    dav.probe().await.map_err(error)?;
    let credential_id = format!("sync-{}", uuid::Uuid::new_v4());
    credentials::save(
        &credential_id,
        &Credentials {
            username: input.username,
            password: input.password,
        },
    )?;
    runtime().running.store(true, Ordering::Relaxed);
    let running = Running;
    emit(&app, &state.pool).await;
    let result = store::connect(
        &state.pool,
        &dav,
        &address,
        &credential_id,
        &input.device_name,
        mode == "create",
        input.allow_loopback_http,
    )
    .await;
    if result.is_err()
        && store::configuration(&state.pool)
            .await
            .map_err(error)?
            .is_none()
    {
        credentials::delete(&credential_id);
    }
    drop(running);
    emit(&app, &state.pool).await;
    result.map_err(error)?;
    store::status(&state.pool, false).await.map_err(error)
}
#[tauri::command]
pub async fn sync_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<store::Status> {
    run(&app, &state.pool).await?;
    store::status(&state.pool, runtime().running.load(Ordering::Relaxed))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn sync_set_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<store::Status> {
    store::set_enabled(&state.pool, enabled)
        .await
        .map_err(error)?;
    if enabled {
        request();
    }
    emit(&app, &state.pool).await;
    store::status(&state.pool, runtime().running.load(Ordering::Relaxed))
        .await
        .map_err(error)
}
#[tauri::command]
pub async fn sync_update_credentials(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> AppResult<()> {
    let (_, id, _) = store::configuration(&state.pool)
        .await
        .map_err(error)?
        .ok_or_else(|| error(genzo_sync::Error::NotFound))?;
    credentials::save(&id, &Credentials { username, password })?;
    request();
    Ok(())
}
#[tauri::command]
pub async fn sync_conflicts(
    state: State<'_, AppState>,
) -> AppResult<Vec<genzo_sync::protocol::Conflict>> {
    store::conflicts(&state.pool).await.map_err(error)
}
#[tauri::command]
pub async fn sync_resolve(
    state: State<'_, AppState>,
    entity: String,
    field: String,
    value: serde_json::Value,
) -> AppResult<()> {
    store::resolve(&state.pool, &entity, &field, value)
        .await
        .map_err(error)?;
    request();
    Ok(())
}
#[tauri::command]
pub async fn sync_bind_media(
    state: State<'_, AppState>,
    media_file_id: String,
) -> AppResult<String> {
    let version = store::bind_media(&state.pool, &media_file_id)
        .await
        .map_err(error)?;
    request();
    Ok(version)
}
