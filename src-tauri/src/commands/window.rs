//! 桌面窗口材质（Mica / Acrylic）：仅 Windows 桌面端有意义。
//!
//! 通过 window-vibrancy 调 DWM 接口给主窗口加系统级云母/亚克力材质；
//! 前端在材质生效时把主背景（--wp-base）换成半透明色让材质透出，
//! 并以 `<html data-material>` 同步实际生效的材质供 CSS 选择。
//!
//! 非 Windows 平台没有 DWM，命令保留但恒返回 "none"。

#[cfg(windows)]
use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};

/// 应用窗口材质（kind: "mica" | "acrylic" | "none"）。
///
/// Mica 仅 Windows 11 支持：请求 Mica 失败时自动回退 Acrylic，再失败回退
/// 不透明纯色背景。dark 传 None 时材质跟随系统亮暗偏好。
/// 返回实际生效的材质（"mica" / "acrylic" / "none"），前端据此切换 CSS。
#[cfg(windows)]
#[tauri::command]
pub fn window_set_material(
    window: tauri::Window,
    kind: String,
    dark: Option<bool>,
) -> Result<String, String> {
    // 换材质前先清掉旧效果，避免 Mica（DWM 系统背板）与 Acrylic（合成属性）叠加
    let _ = clear_mica(&window);
    let _ = clear_acrylic(&window);

    let applied = match kind.as_str() {
        "mica" => apply_mica(&window, dark)
            .map(|_| "mica")
            // window-vibrancy 0.6 的 apply_acrylic 第二参数是 RGBA 色调；传 None 用默认底色
            .or_else(|_| apply_acrylic(&window, None::<(u8, u8, u8, u8)>).map(|_| "acrylic"))
            .unwrap_or("none"),
        "acrylic" => apply_acrylic(&window, None::<(u8, u8, u8, u8)>)
            .map(|_| "acrylic")
            .unwrap_or("none"),
        _ => "none",
    };
    Ok(applied.to_string())
}

/// 非 Windows 平台：无 DWM 材质，恒返回 "none"。
#[cfg(not(windows))]
#[tauri::command]
pub fn window_set_material(
    _window: tauri::Window,
    _kind: String,
    _dark: Option<bool>,
) -> Result<String, String> {
    Ok("none".to_string())
}

/* ------------------------------ 窗口状态记忆 ------------------------------ */

/// 前端设置项「记住窗口大小与位置」：关闭后不再写盘（已有存档保留，
/// 下次开启时仍按最后一次记录的尺寸还原）。
#[tauri::command]
pub fn window_state_set_enabled(app: tauri::AppHandle, enabled: bool) {
    crate::window_state::set_enabled(&app, enabled);
}

/// 是否已有窗口状态存档（设置页据此提示「已记住」/「暂无记录」）
#[tauri::command]
pub fn window_state_saved(app: tauri::AppHandle) -> bool {
    crate::window_state::has_saved_state(&app)
}

/// 清空存档并把窗口恢复成默认尺寸且居中
#[tauri::command]
pub fn window_state_reset(app: tauri::AppHandle) -> Result<(), String> {
    crate::window_state::reset(&app)
}

/* ------------------------------ 全局快捷键 ------------------------------ */

/// 按前端的绑定重建全局热键（`bindings` 为「动作 ID → 组合键文本」，空串表示不注册）。
/// 返回每个动作的注册结果，前端据此标注「已生效 / 被占用 / 格式不支持」。
#[cfg(winplayer_desktop)]
#[tauri::command]
pub fn global_shortcut_apply(
    app: tauri::AppHandle,
    bindings: std::collections::HashMap<String, String>,
) -> Vec<crate::global_shortcuts::RegisteredShortcut> {
    crate::global_shortcuts::apply(&app, &bindings)
}

/// 移动端没有全局热键概念，返回空列表让前端保持「不可用」状态。
#[cfg(not(winplayer_desktop))]
#[tauri::command]
pub fn global_shortcut_apply(
    _app: tauri::AppHandle,
    _bindings: std::collections::HashMap<String, String>,
) -> Vec<serde_json::Value> {
    Vec::new()
}

/// 当前实际注册成功的全局热键
#[cfg(winplayer_desktop)]
#[tauri::command]
pub fn global_shortcut_status(
    app: tauri::AppHandle,
) -> Vec<crate::global_shortcuts::RegisteredShortcut> {
    let _ = &app;
    crate::global_shortcuts::current()
}

#[cfg(not(winplayer_desktop))]
#[tauri::command]
pub fn global_shortcut_status(_app: tauri::AppHandle) -> Vec<serde_json::Value> {
    Vec::new()
}
