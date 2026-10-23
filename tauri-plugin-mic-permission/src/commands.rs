//! JS-invocable 命令封装：转发到 Android 原生侧。

use tauri::{AppHandle, Runtime};

use crate::MicPermissionExt;

#[tauri::command]
pub(crate) async fn request<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.mic_permission().request()
}
