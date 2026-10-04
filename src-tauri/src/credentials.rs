use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[cfg(windows)]
pub fn save(id: &str, value: &Credentials) -> AppResult<()> {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Security::Credentials::*;
    let target = HSTRING::from(format!("Genzo/WebDAV/{id}"));
    let mut blob = serde_json::to_vec(value)?;
    if blob.len() > 2560 {
        return Err(AppError::Validation("凭据过长".into()));
    }
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_ptr() as *mut _),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    let result = unsafe { CredWriteW(&credential, 0) }
        .map_err(|_| AppError::System("无法保存 Windows 凭据".into()));
    blob.fill(0);
    result
}

#[cfg(windows)]
pub fn read(id: &str) -> AppResult<Credentials> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::*;
    let target = HSTRING::from(format!("Genzo/WebDAV/{id}"));
    let mut ptr = std::ptr::null_mut();
    unsafe {
        CredReadW(&target, CRED_TYPE_GENERIC, None, &mut ptr)
            .map_err(|_| AppError::System("无法读取 WebDAV 凭据，请重新保存连接凭据".into()))?;
        let credential = &*ptr;
        let bytes = std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        );
        let value = serde_json::from_slice(bytes);
        CredFree(ptr as *const _);
        value.map_err(|_| AppError::System("WebDAV 凭据格式无效，请重新保存".into()))
    }
}

#[cfg(windows)]
pub fn delete(id: &str) {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::*;
    let target = HSTRING::from(format!("Genzo/WebDAV/{id}"));
    let _ = unsafe { CredDeleteW(&target, CRED_TYPE_GENERIC, None) };
}

#[cfg(target_os = "android")]
pub fn save(id: &str, value: &Credentials) -> AppResult<()> {
    crate::android_bridge::credential_call("saveCredentials", serde_json::json!({"id": id, "username": value.username, "password": value.password}))?;
    Ok(())
}
#[cfg(target_os = "android")]
pub fn read(id: &str) -> AppResult<Credentials> {
    Ok(serde_json::from_value(crate::android_bridge::credential_call("readCredentials", serde_json::json!({"id": id}))?)?)
}
#[cfg(target_os = "android")]
pub fn delete(id: &str) {
    let _ = crate::android_bridge::credential_call("deleteCredentials", serde_json::json!({"id": id}));
}

#[cfg(not(any(windows, target_os = "android")))]
pub fn save(_: &str, _: &Credentials) -> AppResult<()> {
    Err(AppError::System("当前凭据存储仅支持 Windows".into()))
}
#[cfg(not(any(windows, target_os = "android")))]
pub fn read(_: &str) -> AppResult<Credentials> {
    Err(AppError::System("当前凭据存储仅支持 Windows".into()))
}
#[cfg(not(any(windows, target_os = "android")))]
pub fn delete(_: &str) {}
