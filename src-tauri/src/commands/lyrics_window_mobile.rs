//! 桌面歌词（移动端占位实现）。
//!
//! 桌面歌词是一个**独立的无边框透明置顶窗口**，Android / iOS 上没有多窗口概念，
//! 也没有「鼠标穿透」这件事：`decorations` / `set_always_on_top` /
//! `set_ignore_cursor_events` 这些方法只存在于 Tauri 的 `#[cfg(desktop)]` impl 上，
//! 移动端根本编不过（这正是 CI 上 `error[E0599]` 的来源）。
//!
//! 这里给同名命令留一份占位实现，好处是 `lib.rs` 的 `invoke_handler` 注册列表
//! 可以保持一份、不用按平台拆两套宏调用；前端在移动端也不会展示入口，
//! 真被调用时返回一句明确的错误。

/// 窗口标签（与桌面端保持一致，前端判断入口显隐时会读它）
pub const LYRICS_WINDOW: &str = "desktop-lyrics";

const NOT_SUPPORTED: &str = "桌面歌词仅支持桌面端";

#[tauri::command]
pub async fn lyrics_window_open(
    _app: tauri::AppHandle,
    _style: Option<String>,
) -> Result<(), String> {
    Err(NOT_SUPPORTED.into())
}

#[tauri::command]
pub async fn lyrics_window_set_style(
    _app: tauri::AppHandle,
    _style: Option<String>,
) -> Result<(), String> {
    Err(NOT_SUPPORTED.into())
}

/// 关闭：移动端本来就没开过，当成幂等成功，免得前端在卸载流程里抛错
#[tauri::command]
pub async fn lyrics_window_close(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn lyrics_window_exists(_app: tauri::AppHandle) -> bool {
    false
}

#[tauri::command]
pub async fn lyrics_window_set_ignore_cursor(
    _app: tauri::AppHandle,
    _ignore: bool,
) -> Result<(), String> {
    Err(NOT_SUPPORTED.into())
}
