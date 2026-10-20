//! 窗口状态记忆的移动端空实现。
//!
//! Android / iOS 上窗口由系统全屏托管，没有「尺寸 / 位置 / 最大化」这些概念，
//! 前端也不会有对应设置项。这里提供与桌面版同名同签名的函数，
//! 让 `lib.rs` / `commands/window.rs` 不必到处写 `#[cfg(desktop)]`：
//! - 读取一律返回「没有存档」；
//! - 写入、重置、同步开关都是空操作；
//! - 自定义协议 / 事件等副作用同样不存在。
//!
//! 桌面实现见 `window_state.rs`（含完整的还原、防抖落盘与多显示器兜底）。

use tauri::{AppHandle, Runtime};

/// 注册共享状态（移动端无需任何状态）
pub fn init(_app: &tauri::App) {}

/// 启动还原：移动端无窗口尺寸概念，直接跳过
pub fn restore<R: Runtime>(_app: &AppHandle<R>) {}

/// 窗口尺寸/位置变化：移动端不记录（保留与桌面版同名 API，见模块注释）
#[allow(dead_code)]
pub fn on_window_moved<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}

/// 退出前落盘：移动端无存档
pub fn save_before_exit<R: Runtime>(_app: &AppHandle<R>) {}

/// 立即落盘：移动端无存档（保留与桌面版同名 API，见模块注释）
#[allow(dead_code)]
pub fn save_now<R: Runtime>(_app: &AppHandle<R>) {}

/// 是否已有存档：移动端恒为 false（设置页不会出现该区块）
pub fn has_saved_state<R: Runtime>(_app: &AppHandle<R>) -> bool {
    false
}

/// 同步「记住窗口大小与位置」开关：移动端为空操作
pub fn set_enabled<R: Runtime>(_app: &AppHandle<R>, _enabled: bool) {}

/// 重置窗口：移动端为空操作
pub fn reset<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}
