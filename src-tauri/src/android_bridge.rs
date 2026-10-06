use crate::error::{AppError, AppResult};
use serde_json::Value;
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct AndroidBridge(tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
static NATIVE_HANDLE: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn credential_call(command: &str, payload: Value) -> AppResult<Value> {
    NATIVE_HANDLE
        .get()
        .ok_or_else(|| AppError::System("安卓安全存储尚未初始化".into()))?
        .run_mobile_plugin(command, payload)
        .map_err(|_| AppError::System("安卓凭据不可用，请重新保存连接凭据".into()))
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("genzo-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.genzo.android", "GenzoPlugin")?;
                let _ = NATIVE_HANDLE.set(handle.clone());
                _app.manage(AndroidBridge(handle));
            }
            Ok(())
        })
        .build()
}

pub async fn call(command: &str, payload: Value) -> AppResult<Value> {
    #[cfg(target_os = "android")]
    {
        let handle = NATIVE_HANDLE.get()
            .ok_or_else(|| AppError::System("安卓原生桥尚未初始化".into()))?.clone();
        let command = command.to_owned();
        tauri::async_runtime::spawn_blocking(move || handle.run_mobile_plugin(&command, payload)
            .map_err(|_| AppError::System("安卓原生操作失败，请检查授权或播放器状态".into())))
            .await.map_err(|error| AppError::System(error.to_string()))?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (command, payload);
        Err(AppError::System("此操作仅支持安卓".into()))
    }
}

#[tauri::command]
pub async fn android_native(
    app: tauri::AppHandle,
    command: String,
    mut payload: Value,
    state: tauri::State<'_, crate::db::AppState>,
) -> AppResult<Value> {
    if !matches!(
        command.as_str(),
        "pickTree" | "listTree" | "pickVideo" | "openPlayer" | "playerState" | "playerControl"
    ) {
        return Err(AppError::Validation("未知安卓原型命令".into()));
    }
    if command == "listTree" {
        if let Some(source_id) = payload["sourceId"].as_str() {
            let root: String = sqlx::query_scalar("SELECT tree_uri FROM android_saf_sources WHERE source_id=?")
                .bind(source_id).fetch_optional(&state.pool).await?
                .ok_or_else(|| AppError::NotFound("已授权本地来源不存在".into()))?;
            if payload["uri"].as_str().is_none() { payload["uri"] = serde_json::json!(root); }
            payload["rootUri"] = serde_json::json!(root);
            payload.as_object_mut().unwrap().remove("sourceId");
        }
    }
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<AndroidBridge>().0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            handle
                .run_mobile_plugin(&command, payload)
                .map_err(|_| AppError::System("安卓原生操作失败，请检查授权或播放器状态".into()))
        })
        .await
        .map_err(|error| AppError::System(error.to_string()))?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Err(AppError::System("此验证入口仅支持安卓".into()))
    }
}
