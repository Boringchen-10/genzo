use crate::error::{AppError, AppResult};
use serde_json::Value;
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct AndroidBridge(tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
static CREDENTIAL_HANDLE: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn credential_call(command: &str, payload: Value) -> AppResult<Value> {
    CREDENTIAL_HANDLE
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
                let _ = CREDENTIAL_HANDLE.set(handle.clone());
                _app.manage(AndroidBridge(handle));
            }
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn android_native(
    app: tauri::AppHandle,
    command: String,
    payload: Value,
) -> AppResult<Value> {
    if !matches!(
        command.as_str(),
        "pickTree" | "listTree" | "pickVideo" | "openPlayer" | "playerState" | "playerControl"
    ) {
        return Err(AppError::Validation("未知安卓原型命令".into()));
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
