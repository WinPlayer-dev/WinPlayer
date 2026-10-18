//! JS-invocable 命令封装：转发到 Android 原生侧。

use tauri::{AppHandle, Runtime};

use crate::HapticsExt;

#[tauri::command]
pub(crate) async fn vibrate<R: Runtime>(
    app: AppHandle<R>,
    pattern: Vec<u64>,
) -> Result<(), String> {
    app.haptics().vibrate(pattern)
}
