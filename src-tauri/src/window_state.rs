//! 窗口状态记忆（尺寸 / 位置 / 最大化）。
//!
//! 启动时（`setup` 末尾）读一次 `%APPDATA%/<identifier>/window-state.json`，
//! 把上次退出时的外框尺寸、位置与最大化状态套回主窗口；运行期在窗口
//! 尺寸/位置变化后防抖落盘，最大化 / 还原时只更新最大化标记（最大化状态
//! 下的 outer_size 是屏幕尺寸，存下来会在下次以「未最大化」还原时变成整屏）。
//!
//! 不引入 `tauri-plugin-window-state`：本应用只需要主窗口这一个窗口，
//! 自己存一份 JSON 更省依赖，也便于把「是否记住窗口状态」做成设置项。
//!
//! 边界情况：
//! - 位置若已不在任何显示器的工作区内（拔掉外接屏、分辨率变化）则回退居中；
//! - 尺寸按当前显示器缩放系数夹到工作区内，且不小于配置文件里的最小尺寸；
//! - 文件损坏/缺失时静默回退到 tauri.conf.json 里的默认值。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime};

/// 主窗口标签（与 tauri.conf.json 一致）
const MAIN_WINDOW: &str = "main";

/// 存档文件名（位于应用数据目录）
const STATE_FILE: &str = "window-state.json";

/// 尺寸/位置变化后的落盘防抖：拖动窗口时事件密集，等停手再写
const SAVE_DEBOUNCE: Duration = Duration::from_millis(400);

/// 窗口尺寸下限（逻辑像素，与 tauri.conf.json 的 minWidth / minHeight 对齐）
const MIN_WIDTH: u32 = 960;
const MIN_HEIGHT: u32 = 640;

/// 落盘内容（尺寸与位置都用物理像素，避免多显示器 DPI 混用时被二次换算）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedWindowState {
    /// 外框宽度（物理像素）
    width: u32,
    /// 外框高度（物理像素）
    height: u32,
    /// 外框左上角 X（物理像素，相对整个虚拟桌面）
    x: i32,
    /// 外框左上角 Y（物理像素，相对整个虚拟桌面）
    y: i32,
    /// 上次退出时是否最大化
    #[serde(default)]
    maximized: bool,
}

/// 是否启用窗口状态记忆（由前端设置项推送，默认开启）
pub struct WindowStateStore {
    enabled: AtomicBool,
    /// 防抖线程代数：每次新事件 +1，旧线程发现代数变了就直接退出
    generation: Mutex<u64>,
}

impl WindowStateStore {
    fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            generation: Mutex::new(0),
        }
    }

    fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }
}

/// 恢复「记住窗口状态」的默认值：取主显示器工作区的一部分，居中且留出边距，
/// 并把尺寸限制在最小尺寸之上——用于用户点了「重置窗口大小与位置」之后立刻回到
/// 一个好看的默认窗口，而不是继续沿用旧存档的怪尺寸。
fn default_size<R: Runtime>(window: &tauri::WebviewWindow<R>) -> (u32, u32) {
    let scale = window.scale_factor().unwrap_or(1.0).max(0.5);
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return ((MIN_WIDTH as f64 * scale) as u32, (MIN_HEIGHT as f64 * scale) as u32);
    };
    let area = monitor.size();
    // 占工作区的 60%，但不超过设计基准 1200×800 的 1.5 倍，也不低于最小尺寸
    let width = ((area.width as f64 * 0.6) as u32).clamp(
        (MIN_WIDTH as f64 * scale) as u32,
        (1200.0 * 1.5 * scale) as u32,
    );
    let height = ((area.height as f64 * 0.6) as u32).clamp(
        (MIN_HEIGHT as f64 * scale) as u32,
        (800.0 * 1.5 * scale) as u32,
    );
    (width, height)
}

/* ------------------------------ 文件位置 ------------------------------ */

/// 存档路径：优先应用数据目录，取不到时退回配置目录（保证总能落盘）
fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .or_else(|| app.path().app_config_dir().ok())
        .map(|dir| dir.join(STATE_FILE))
}

/* ------------------------------ 还原 ------------------------------ */

/// 启动时调用：按存档还原主窗口尺寸 / 位置 / 最大化状态。
///
/// 在 `setup` 里窗口刚创建、尚未显示时调用最稳（此时改尺寸不会有可见抖动）。
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let Some(saved) = read_state(app) else {
        return;
    };
    apply(&window, &saved);
}

/// 把存档套到窗口上：先算尺寸与位置的合法值，再设置，最后处理最大化。
fn apply<R: Runtime>(window: &tauri::WebviewWindow<R>, saved: &SavedWindowState) {
    let scale = window.scale_factor().unwrap_or(1.0).max(0.5);

    // 显示器枚举：优先取存档中心点所在的那块，其次主显示器
    let monitors = window.available_monitors().unwrap_or_default();
    let target_monitor = monitors
        .iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            saved.x >= pos.x
                && saved.y >= pos.y
                && saved.x < pos.x + size.width as i32
                && saved.y < pos.y + size.height as i32
        })
        .or_else(|| monitors.first());

    // 尺寸：不低于最小尺寸，也不超过目标显示器的可用区域（留 8px 余量给边框）
    let (mut width, mut height) = (saved.width, saved.height);
    if let Some(monitor) = target_monitor {
        let size = monitor.size();
        width = width.clamp(
            (MIN_WIDTH as f64 * scale) as u32,
            size.width.saturating_sub(8).max(MIN_WIDTH),
        );
        height = height.clamp(
            (MIN_HEIGHT as f64 * scale) as u32,
            size.height.saturating_sub(8).max(MIN_HEIGHT),
        );
    }
    let _ = window.set_size(PhysicalSize::new(width, height));

    // 位置：存档中心点必须落在某块显示器内，否则（外接屏已拔 / 分辨率变了）保持居中
    let center_x = saved.x + saved.width as i32 / 2;
    let center_y = saved.y + saved.height as i32 / 2;
    let on_screen = monitors.iter().any(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        center_x >= pos.x
            && center_y >= pos.y
            && center_x < pos.x + size.width as i32
            && center_y < pos.y + size.height as i32
    });
    if on_screen {
        let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
    } else {
        let _ = window.center();
    }

    // 最大化：放在尺寸/位置之后，否则 Win32 会先按最大化铺满、再被 set_size 打回
    if saved.maximized {
        let _ = window.maximize();
    }
}

/* ------------------------------ 采集与落盘 ------------------------------ */

/// 读取当前窗口状态（最大化时尺寸/位置沿用存档，避免存成整屏尺寸）
fn snapshot<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    previous: Option<&SavedWindowState>,
) -> Option<SavedWindowState> {
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        // 最大化状态下 outer_size 等于工作区尺寸：保留进入最大化前的普通尺寸
        return Some(match previous {
            Some(prev) => SavedWindowState {
                maximized: true,
                ..prev.clone()
            },
            None => SavedWindowState {
                width: window.outer_size().ok()?.width,
                height: window.outer_size().ok()?.height,
                x: window.outer_position().ok()?.x,
                y: window.outer_position().ok()?.y,
                maximized: true,
            },
        });
    }

    // 最小化时同样污染尺寸（Windows 会把窗口挪到 -32000），直接跳过本次采集
    if window.is_minimized().unwrap_or(false) {
        return None;
    }

    let size = window.outer_size().ok()?;
    let position = window.outer_position().ok()?;
    Some(SavedWindowState {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized: false,
    })
}

/// 立即把当前窗口状态写盘（退出前调用，绕过防抖）
pub fn save_now<R: Runtime>(app: &AppHandle<R>) {
    let Some(store) = app.try_state::<WindowStateStore>() else {
        return;
    };
    if !store.is_enabled() {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let previous = read_state(app);
    if let Some(state) = snapshot(&window, previous.as_ref()) {
        write_state(app, &state);
    }
}

/// 窗口尺寸/位置变化回调（防抖落盘）。
///
/// 拖动/缩放是高频事件，只让最后一次生效：每次事件取一个递增的「代数」，
/// 睡醒时发现代数已变说明后面还有新事件，直接放弃本次写入。
pub fn on_window_moved<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let Some(store) = window.try_state::<WindowStateStore>() else {
        return;
    };
    if !store.is_enabled() {
        return;
    }
    let token = {
        let mut generation = store.generation.lock().unwrap();
        *generation += 1;
        *generation
    };

    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DEBOUNCE);
        if let Some(store) = app.try_state::<WindowStateStore>() {
            if *store.generation.lock().unwrap() != token {
                return;
            }
        }
        save_now(&app);
    });
}

/// 应用退出前同步落盘（`app.exit` 不会触发窗口事件，托盘「退出」走这里兜底）
pub fn save_before_exit<R: Runtime>(app: &AppHandle<R>) {
    save_now(app);
}

/* ------------------------------ 读写 ------------------------------ */

fn read_state<R: Runtime>(app: &AppHandle<R>) -> Option<SavedWindowState> {
    let path = state_path(app)?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedWindowState>(&text)
        .ok()
        .filter(|state| state.width > 0 && state.height > 0)
}

/// 是否已有可用的窗口状态存档（设置页据此决定「重置」按钮是否可点）
pub fn has_saved_state<R: Runtime>(app: &AppHandle<R>) -> bool {
    read_state(app).is_some()
}

fn write_state<R: Runtime>(app: &AppHandle<R>, state: &SavedWindowState) {
    let Some(path) = state_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(text) = serde_json::to_string_pretty(state) else {
        return;
    };
    // 先写临时文件再改名：避免写入过程中关窗留下半截 JSON
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, text).is_ok() {
        let _ = fs::rename(&tmp, &path);
    }
}

/* ------------------------------ 对外命令支撑 ------------------------------ */

/// 注册共享状态（`setup` 里调用）
pub fn init(app: &tauri::App) {
    app.manage(WindowStateStore::new());
}

/// 前端设置项「记住窗口大小与位置」：关掉后不再写盘（已有存档保留）
pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if let Some(store) = app.try_state::<WindowStateStore>() {
        store.enabled.store(enabled, Ordering::Release);
    }
}

/// 清空窗口状态存档并把窗口恢复成默认尺寸（设置页「重置窗口大小与位置」）。
pub fn reset<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // 先重新打开写入开关：否则关掉记忆后又点重置，会把刚恢复的默认尺寸留在旧状态里
    set_enabled(app, true);
    let path = state_path(app).ok_or_else(|| "无法定位窗口状态文件".to_string())?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        // 本来就没有存档也算成功
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Ok(());
    };
    let _ = window.unmaximize();
    let (width, height) = default_size(&window);
    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.center();
    Ok(())
}
