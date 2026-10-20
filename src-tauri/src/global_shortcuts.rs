//! 系统级全局快捷键（默认 Ctrl+Alt+Space / ← / →）。
//!
//! 与前端 `services/shortcuts.ts` 的应用内快捷键是两套东西：
//! - **应用内**：只在窗口聚焦时生效，由渲染进程的 keydown 处理，可自由改键；
//! - **全局**（这里）：由系统注册热键，窗口在后台、甚至隐藏到托盘时也能用。
//!
//! 为避免窗口在前台时同一次按键既触发系统热键、又被渲染进程再执行一遍，
//! Rust 侧命中后先向前端广播 `app://global-hotkey`（带方向 + 时间戳），
//! 前端据此在极短时间内屏蔽同一组合键的**应用内**处理；动作本身由 Rust
//! 通过 [`crate::player`] 直接驱动引擎（不依赖 WebView 是否就绪）。
//!
//! 注册失败（热键被别的程序占用）不会让应用崩掉，只记录并跳过该项，
//! 前端可通过 `global_shortcut_status` 查询哪些组合键真的注册成功。

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::player::PlayerEngine;

/// 全局热键命中事件名（前端用来屏蔽应用内同名快捷键）
pub const EVENT_GLOBAL_HOTKEY: &str = "app://global-hotkey";

/// 全局热键动作（与前端 ShortcutActionId 的子集对齐）
pub const ACTION_PLAY_PAUSE: &str = "playPause";
pub const ACTION_PREV: &str = "prev";
pub const ACTION_NEXT: &str = "next";

/// 默认注册的组合键（前端首次启动时也读这份，保持一致）
pub const DEFAULT_PLAY_PAUSE: &str = "Ctrl+Alt+Space";
pub const DEFAULT_PREV: &str = "Ctrl+Alt+ArrowLeft";
pub const DEFAULT_NEXT: &str = "Ctrl+Alt+ArrowRight";

/// 一次注册的结果（回给前端做「哪几个真的生效了」的展示）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredShortcut {
    /// 动作 ID（playPause / prev / next）
    pub action: String,
    /// 组合键文本（与前端 formatBinding 保持同一写法）
    pub accelerator: String,
    /// 是否注册成功（被占用时为 false）
    pub registered: bool,
    /// 失败原因（注册失败时给用户看）
    pub error: Option<String>,
}

/// 当前的注册表：组合键 → 动作（重建全局热键时整体替换）
static REGISTERED: std::sync::LazyLock<std::sync::Mutex<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// 把「Ctrl+Alt+Space」这类前端文本转成插件认识的 accelerator。
///
/// 前端用 `Win` 表示 Meta 键、用 `←` 等符号展示方向键，这里统一换成
/// 插件（以及系统）认的写法；无法识别的按键返回 None，由调用方跳过。
fn to_accelerator(text: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for raw in text.split('+').map(|item| item.trim()).filter(|item| !item.is_empty()) {
        let lower = raw.to_ascii_lowercase();
        let normalized = match lower.as_str() {
            "ctrl" | "control" => "Control".to_string(),
            "shift" => "Shift".to_string(),
            "alt" | "option" => "Alt".to_string(),
            "win" | "meta" | "super" | "cmd" | "command" => "Super".to_string(),
            "←" | "arrowleft" | "left" => "ArrowLeft".to_string(),
            "→" | "arrowright" | "right" => "ArrowRight".to_string(),
            "↑" | "arrowup" | "up" => "ArrowUp".to_string(),
            "↓" | "arrowdown" | "down" => "ArrowDown".to_string(),
            "space" => "Space".to_string(),
            "escape" | "esc" => "Escape".to_string(),
            "enter" | "return" => "Enter".to_string(),
            "tab" => "Tab".to_string(),
            "backspace" => "Backspace".to_string(),
            "delete" | "del" => "Delete".to_string(),
            "insert" => "Insert".to_string(),
            "home" => "Home".to_string(),
            "end" => "End".to_string(),
            "pageup" => "PageUp".to_string(),
            "pagedown" => "PageDown".to_string(),
            _ => {
                // 单个字母 / 数字 / F1-F24：直接大写
                if lower.len() == 1 {
                    lower.to_ascii_uppercase()
                } else if lower.starts_with('f') && lower[1..].parse::<u8>().is_ok() {
                    lower.to_ascii_uppercase()
                } else {
                    return None;
                }
            }
        };
        parts.push(normalized);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("+"))
    }
}

/// 执行全局热键对应的动作：直接驱动原生引擎（窗口隐藏时也有效）。
///
/// 切歌走前端逻辑（要解析直链、更新队列），因此只广播事件；播放 / 暂停
/// 与托盘菜单同源，直接操作引擎，避免 WebView 未就绪时点了没反应。
fn run_action(app: &AppHandle, action: &str) {
    match action {
        ACTION_PLAY_PAUSE => {
            let Some(engine) = app.try_state::<std::sync::Arc<PlayerEngine>>() else {
                return;
            };
            if engine.is_playing() {
                engine.pause();
            } else {
                engine.play();
            }
        }
        // 上一首 / 下一首需要解析直链，交给前端（与托盘菜单同一条路径）
        ACTION_PREV => {
            let _ = app.emit(crate::tray::EVENT_ACTION, "previous");
        }
        ACTION_NEXT => {
            let _ = app.emit(crate::tray::EVENT_ACTION, "next");
        }
        _ => return,
    }
    // 广播给前端：用于屏蔽窗口内同名快捷键的一次处理
    let _ = app.emit(
        EVENT_GLOBAL_HOTKEY,
        serde_json::json!({ "action": action, "at": now_millis() }),
    );
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 清空所有已注册的全局热键
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    if let Ok(mut map) = REGISTERED.lock() {
        map.clear();
    }
}

/// 按前端给的绑定重建全局热键。
///
/// `bindings` 是「动作 ID → 组合键文本」，文本为空的项表示该动作不注册全局键。
/// 返回每个动作的注册结果（被占用 / 格式不合法都会体现在这里，不会静默丢失）。
pub fn apply(app: &AppHandle, bindings: &HashMap<String, String>) -> Vec<RegisteredShortcut> {
    unregister_all(app);

    let mut results = Vec::new();
    for (action, text) in bindings {
        if text.trim().is_empty() {
            continue;
        }
        let Some(accelerator) = to_accelerator(text) else {
            results.push(RegisteredShortcut {
                action: action.clone(),
                accelerator: text.clone(),
                registered: false,
                error: Some("无法识别的组合键".to_string()),
            });
            continue;
        };

        let parsed: Result<Shortcut, _> = accelerator.parse();
        let shortcut = match parsed {
            Ok(shortcut) => shortcut,
            Err(error) => {
                results.push(RegisteredShortcut {
                    action: action.clone(),
                    accelerator,
                    registered: false,
                    error: Some(error.to_string()),
                });
                continue;
            }
        };

        let action_for_handler = action.clone();
        let registered = app
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                // 只在按下时触发，避免松开再执行一次
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                run_action(app, &action_for_handler);
            })
            .is_ok();

        if registered {
            if let Ok(mut map) = REGISTERED.lock() {
                map.insert(accelerator.clone(), action.clone());
            }
        }
        results.push(RegisteredShortcut {
            action: action.clone(),
            accelerator,
            registered,
            error: if registered {
                None
            } else {
                Some("组合键可能已被其他程序占用".to_string())
            },
        });
    }
    results
}

/// 按默认绑定注册（`setup` 阶段先跑一遍，前端读到设置后再用 [`apply`] 覆盖）。
///
/// 默认值与 `src/types/shortcut.ts` 里的 `GLOBAL_SHORTCUT_DEFAULTS` 保持一致。
pub fn apply_defaults(app: &AppHandle) {
    let mut bindings = HashMap::new();
    bindings.insert(ACTION_PLAY_PAUSE.to_string(), DEFAULT_PLAY_PAUSE.to_string());
    bindings.insert(ACTION_PREV.to_string(), DEFAULT_PREV.to_string());
    bindings.insert(ACTION_NEXT.to_string(), DEFAULT_NEXT.to_string());
    let results = apply(app, &bindings);
    for result in results.iter().filter(|item| !item.registered) {
        eprintln!(
            "[global-shortcut] {} 注册失败（{}）",
            result.accelerator,
            result.error.clone().unwrap_or_default()
        );
    }
}

/// 当前实际生效的组合键（动作 → 组合键文本）
pub fn current() -> Vec<RegisteredShortcut> {
    let map = REGISTERED.lock().expect("shortcut registry poisoned");
    map.iter()
        .map(|(accelerator, action)| RegisteredShortcut {
            action: action.clone(),
            accelerator: accelerator.clone(),
            registered: true,
            error: None,
        })
        .collect()
}
