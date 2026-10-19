//! 托盘相关 Tauri 命令。
//!
//! 之所以单独放在恒编译的 `commands/` 下而不是放进 `crate::tray`：
//! `tauri::generate_handler!` 不支持在条目上加 `#[cfg(windows)]`，
//! 而这些命令需在 Android / macOS（无托盘能力）下也保持可注册。
//! 因此：命令签名恒编译，实现体用 `#[cfg(windows)]` 包住，
//! 仅 Windows 才真正操作托盘，其余平台为无操作。

/// 前端把「关闭行为」设置推给 Rust。
///
/// 放在前端而非 Rust 读库：设置已由前端统一持久化在
/// `settings.closeBehavior`，双写会引入 sqlite 并发与一致性问题。
#[tauri::command]
pub fn tray_set_close_behavior(app: tauri::AppHandle, behavior: String) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if let Some(state) = app.try_state::<crate::tray::TrayState>() {
            *state.close_behavior.lock().unwrap() = crate::tray::CloseBehavior::parse(&behavior);
            state.settings_ready.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}

/// 显示/隐藏主窗口（例如「最小化到托盘」按钮）
#[tauri::command]
pub fn tray_toggle_window(app: tauri::AppHandle) {
    #[cfg(windows)]
    crate::tray::toggle_main_window(&app);
}

/// 隐藏主窗口到托盘
#[tauri::command]
pub fn tray_hide_window(app: tauri::AppHandle) {
    #[cfg(windows)]
    crate::tray::hide_main_window(&app);
}

/// 真正退出应用（托盘菜单「退出」的前端等价物）
#[tauri::command]
pub fn tray_quit(app: tauri::AppHandle) {
    #[cfg(windows)]
    crate::tray::quit_app(&app);
}

/// 更新托盘 tooltip（前端在切歌时推送「歌名 - 歌手」）
#[tauri::command]
pub fn tray_set_tooltip(app: tauri::AppHandle, text: String) {
    #[cfg(windows)]
    {
        if let Some(tray) = app.tray_by_id("main") {
            // 空串回落到应用名，避免托盘出现空白 tooltip
            let label = if text.trim().is_empty() {
                "WinPlayer".to_string()
            } else {
                text
            };
            let _ = tray.set_tooltip(Some(label));
        }
    }
}