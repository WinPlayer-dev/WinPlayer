//! 系统托盘 + 「关闭到托盘」：仅 Windows 桌面端。
//!
//! 职责边界：
//! - **托盘图标**（左键单击 = 显示/隐藏主窗口，右键 = 菜单）；
//! - **关闭拦截**：主窗口的 `CloseRequested` 按用户设置决定隐藏还是退出；
//! - **播放控制**：菜单项直接驱动原生播放引擎（见 [`crate::player`]），
//!   不依赖 WebView —— 窗口隐藏后前端仍在运行，但这条路径能更快响应；
//! - **后台省电信号**：窗口隐藏/恢复时向前端广播 `app://visibility`，
//!   前端据此进入/退出「后台优化模式」（停响应式进度、暂停动画等）。
//!
//! 非 Windows 平台不注册托盘：调用方用 `#[cfg(windows)]` 包住 [`init`]，
//! 且本模块整体只在 windows 目标参与编译。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::player::PlayerEngine;

/// 托盘菜单项 ID
const MENU_TOGGLE: &str = "tray_toggle";
const MENU_PLAY_PAUSE: &str = "tray_play_pause";
const MENU_PREV: &str = "tray_prev";
const MENU_NEXT: &str = "tray_next";
const MENU_QUIT: &str = "tray_quit";

/// 主窗口标签（与 tauri.conf.json 一致）
const MAIN_WINDOW: &str = "main";

/// 窗口可见性变化事件：前端「后台优化模式」的触发源。
///
/// 只靠 `document.visibilitychange` 不可靠 —— WebView2 在窗口被 `hide()`
/// 时是否置为 hidden 依版本而异，因此由 Rust 侧主动广播。
pub const EVENT_VISIBILITY: &str = "app://visibility";

/// 托盘菜单「上一首 / 下一首」事件：前端订阅后走自己的切歌逻辑。
/// 全局快捷键（`crate::global_shortcuts`）复用同一条通道。
pub const EVENT_ACTION: &str = "app://tray-action";

/// 关闭行为
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CloseBehavior {
    /// 关闭按钮 → 隐藏到托盘（默认）
    Tray,
    /// 关闭按钮 → 最小化到任务栏
    Minimize,
    /// 关闭按钮 → 真正退出进程
    Quit,
}

impl CloseBehavior {
    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "minimize" => Self::Minimize,
            "quit" => Self::Quit,
            _ => Self::Tray,
        }
    }
}

/// 托盘相关的共享状态
pub struct TrayState {
    /// 关闭行为（由前端设置项推送，见 [`tray_set_close_behavior`]）
    pub close_behavior: std::sync::Mutex<CloseBehavior>,
    /// 前端是否已推送过真实设置。
    ///
    /// 「直接退出」在用户心里可能等于「关个窗口而已」；若在设置读取完成前
    /// 就按默认值退出，会把窗口连同常驻播放一起关掉。因此设置未就绪前
    /// 一律按「关闭到托盘」处理（可恢复），就绪后才尊重 `quit`。
    pub settings_ready: AtomicBool,
    /// 是否真的要退出（托盘「退出」或关闭行为为退出时置位）
    quitting: AtomicBool,
}

impl TrayState {
    fn new() -> Self {
        Self {
            close_behavior: std::sync::Mutex::new(CloseBehavior::Tray),
            settings_ready: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        }
    }

    fn behavior(&self) -> CloseBehavior {
        *self.close_behavior.lock().unwrap()
    }

    /// 是否允许真正关闭窗口
    fn should_quit(&self) -> bool {
        self.quitting.load(Ordering::Acquire)
    }
}

/* ------------------------------ 窗口显隐 ------------------------------ */

/// 显示并聚焦主窗口（从托盘恢复）
pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // 最小化状态下仅 show() 不会恢复显示，需要先取消最小化
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    emit_visibility(app, true);
}

/// 隐藏主窗口到托盘
pub fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.hide();
    emit_visibility(app, false);
}

/// 切换主窗口显示状态（托盘左键单击）
pub fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    // 可见但已最小化，同样视为「需要恢复到前台」
    if visible && !minimized {
        hide_main_window(app);
    } else {
        show_main_window(app);
    }
}

/// 广播窗口可见性给前端（前后端「后台优化模式」的唯一真相源）
pub fn emit_visibility(app: &AppHandle, visible: bool) {
    let _ = app.emit(EVENT_VISIBILITY, visible);
}

/// 结束进程：置位退出标记（让关闭拦截放行）后退出
pub fn quit_app(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayState>() {
        state.quitting.store(true, Ordering::Release);
    }
    // 退出前同步落盘窗口尺寸/位置：app.exit 不触发窗口事件，这里兜底
    crate::window_state::save_before_exit(app);
    // 先销毁托盘图标，避免任务栏残留幽灵图标
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_visible(false);
    }
    app.exit(0);
}

/* ------------------------------ 托盘注册 ------------------------------ */

/// setup 阶段创建托盘图标与菜单。
///
/// 必须在主线程调用（tauri 的 `setup` 回调满足此条件）。
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    app.manage(TrayState::new());

    // 图标复用应用自身图标：由 tauri-build 在编译期嵌入，
    // 运行时零文件 IO、零解码，也不会因打包路径变化而丢失。
    let icon = app.default_window_icon().cloned();

    let toggle = MenuItem::with_id(app, MENU_TOGGLE, "显示 / 隐藏主窗口", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, MENU_PLAY_PAUSE, "播放 / 暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, MENU_PREV, "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, MENU_NEXT, "下一首", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出 WinPlayer", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &sep_a,
            &play_pause,
            &prev,
            &next,
            &sep_b,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("WinPlayer")
        // 左键单击切换窗口显隐，因此左键不再弹出菜单（右键仍然弹）
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_TOGGLE => toggle_main_window(app),
            MENU_PLAY_PAUSE => toggle_playback(app),
            MENU_PREV | MENU_NEXT => {
                // 与界面按钮同源：通知前端走它自己的切歌逻辑
                // （队列推进、元数据、歌词都在前端，Rust 侧只知道播放链）
                let action = if event.id().as_ref() == MENU_NEXT {
                    "next"
                } else {
                    "previous"
                };
                let _ = app.emit(EVENT_ACTION, action);
            }
            MENU_QUIT => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// 播放/暂停切换：直接驱动原生引擎，不经过 WebView
fn toggle_playback(app: &AppHandle) {
    let Some(engine) = app.try_state::<std::sync::Arc<PlayerEngine>>() else {
        return;
    };
    if engine.is_playing() {
        engine.pause();
    } else {
        engine.play();
    }
}

/* ------------------------------ 供 lib.rs 调用 ------------------------------ */

/// 关闭请求决策：窗口即将关闭时应否拦截。
///
/// 返回 `true` = 应拦截（隐藏 / 最小化，而非真正关闭），此时调用方应
/// `api.prevent_close()`；返回 `false` = 放行（真正关闭进程）。
///
/// 拦截条件：设置未就绪时按「关闭到托盘」处理安全默认；托盘「退出」
/// 或关闭行为为「直接退出」时放行。
pub fn should_intercept_close(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<TrayState>() else {
        return false;
    };
    // 真的想退出（托盘「退出」已置位）→ 放行关闭
    if state.should_quit() {
        return false;
    }

    let behavior = if state.settings_ready.load(Ordering::Acquire) {
        state.behavior()
    } else {
        // 设置未就绪：按最不易误伤的「隐藏到托盘」处理
        CloseBehavior::Tray
    };

    match behavior {
        // 直接退出：标记后放行（app 会在最后一个窗口关闭后退出）
        CloseBehavior::Quit => {
            state.quitting.store(true, Ordering::Release);
            false
        }
        // 最小化到任务栏：拦截关闭并最小化，窗口仍保留在任务栏
        CloseBehavior::Minimize => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let _ = window.minimize();
            }
            // 最小化到任务栏：窗口内容不可见，同样进入后台优化模式
            emit_visibility(app, false);
            true
        }
        // 关闭到托盘：拦截关闭并隐藏窗口
        CloseBehavior::Tray => {
            hide_main_window(app);
            true
        }
    }
}

/* ------------------------------ Tauri commands（见 commands/tray.rs） ------------------------------ */
