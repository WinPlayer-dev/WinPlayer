//! 桌面歌词窗口（独立置顶透明窗口）。
//!
//! 桌面歌词不能画在主窗口里——主窗口是普通大小、不置顶的，浮层出不去。
//! 因此这里创建一个**独立的无边框透明窗口**（label = `desktop-lyrics`），
//! 加载同一份前端资源但带 `?window=lyrics` 参数，由 `src/desktopLyricsMain.ts`
//! 挂载一个极简的歌词组件（不初始化数据库 / 插件，只是一个显示层）。
//!
//! 歌词数据不走双向共享状态：主窗口用 `emitTo("desktop-lyrics", ...)` 单向推送，
//! 歌词窗口只用事件回传「我准备好了」和「用户点了播放/锁定/关闭」这三类指令。
//!
//! 位置与尺寸单独存一份 `lyrics-window.json`（与主窗口的 window-state.json 分开，
//! 因为两者生命周期不同：主窗口可以隐藏到托盘，歌词窗口可以一直挂在桌面上）。
//!
//! **锁定（鼠标穿透）时的悬浮提示**：窗口一旦 `set_ignore_cursor_events(true)` 就
//! 收不到任何鼠标事件，也就没法「悬浮显示解锁按钮」。这里用轮询游标位置绕过去：
//! 锁定时起一个 10Hz 的线程，算出游标是否在窗口内，把结果推给前端显示工具栏；
//! 只有游标落在顶部工具栏热区时才临时放开穿透（否则按钮点不到）。

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};

/// 窗口标签（前端 `emitTo` 与 capability 都靠它定位）
pub const LYRICS_WINDOW: &str = "desktop-lyrics";

/// 存档文件名（位于应用配置目录）
const STATE_FILE: &str = "lyrics-window.json";

/// 锁定状态下游标轮询事件（主 → 歌词窗口）
const POINTER_EVENT: &str = "desktop-lyrics:pointer";

/// 各外观的默认窗口尺寸（逻辑像素）。
/// 「歌曲卡片」里放一张 640×360 的卡片，四周留出工具栏与边距；
/// 「纯文字」容得下「上一句 + 翻译 / 当前句 + 翻译 / 下一句 + 翻译」。
/// 用户拖过尺寸后以存档为准。
const CARD_SIZE: (f64, f64) = (680.0, 402.0);
const PLAIN_SIZE: (f64, f64) = (900.0, 250.0);

/// 缩放窗口时的最小尺寸，避免被拖成一条缝之后点不到
const MIN_SIZE: (f64, f64) = (320.0, 120.0);

/// 游标轮询间隔：只有在锁定状态才跑，10Hz 足够跟手
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// 拖动 / 缩放后落盘的防抖时长：过程中事件很密集，等手停下再写
const SAVE_DEBOUNCE: Duration = Duration::from_millis(400);

/// 外观标识：`"glass"` 是界面上的「歌曲卡片」，其余按纯文字处理
fn is_card(style: Option<&str>) -> bool {
    style == Some("glass")
}

fn default_size(style: Option<&str>) -> (f64, f64) {
    if is_card(style) {
        CARD_SIZE
    } else {
        PLAIN_SIZE
    }
}

/* ------------------------------ 存档 ------------------------------ */

/// 落盘内容：位置 + 各外观下用户拖出来的尺寸
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SavedState {
    #[serde(default)]
    x: i32,
    #[serde(default)]
    y: i32,
    /// 按外观记尺寸（逻辑像素）；key 为 `plain` / `glass`
    #[serde(default)]
    sizes: BTreeMap<String, (f64, f64)>,
}

fn style_key(style: Option<&str>) -> String {
    if is_card(style) { "glass".into() } else { "plain".into() }
}

/// 最新一次拖动位置 + 代数（用于丢弃过期的延时写盘任务）
static POSITION: Mutex<(u64, i32, i32)> = Mutex::new((0, 0, 0));
/// 最新一次缩放尺寸 + 代数
static SIZE: Mutex<(u64, f64, f64)> = Mutex::new((0, 0.0, 0.0));
/// 当前外观（决定尺寸写进哪个 key）
static CURRENT_STYLE: Mutex<Option<String>> = Mutex::new(None);
/// 上次起延时写盘任务的时刻（节流「起线程」本身）
static LAST_SPAWN: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// 当前是否处于锁定（鼠标穿透）状态
static LOCKED: AtomicBool = AtomicBool::new(false);
/// 游标轮询线程是否在跑
static POLLING: AtomicBool = AtomicBool::new(false);

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(STATE_FILE))
}

fn load_state(app: &AppHandle) -> Option<SavedState> {
    let path = state_path(app)?;
    let text = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<SavedState>(&text).ok()
}

/// 读-改-写：位置和尺寸来自不同事件，必须合并而不是互相覆盖
fn update_state(app: &AppHandle, apply: impl FnOnce(&mut SavedState)) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut state = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<SavedState>(&text).ok())
        .unwrap_or_default();
    apply(&mut state);
    if let Ok(text) = serde_json::to_string(&state) {
        // 写失败（只读目录 / 磁盘满）不影响使用，下次拖动会再试
        let _ = fs::write(path, text);
    }
}

/// 该外观下上次的尺寸（没有则给默认值）
fn saved_size(app: &AppHandle, style: Option<&str>) -> (f64, f64) {
    load_state(app)
        .and_then(|state| state.sizes.get(&style_key(style)).copied())
        .filter(|(w, h)| *w >= MIN_SIZE.0 && *h >= MIN_SIZE.1)
        .unwrap_or_else(|| default_size(style))
}

/* ------------------------------ 事件入口 ------------------------------ */

/// 位置变化入口（由 `lib.rs` 的全局窗口事件转发）。
///
/// 采用「记录最新值 + 延时写盘」而不是节流写：拖动时每次事件都会重置计时器
/// 的思路容易在快速拖动下写出中间位置，这里让最后一个静默期负责落盘。
pub fn on_moved(app: &AppHandle, x: i32, y: i32) {
    let generation = {
        let mut guard = POSITION.lock().unwrap();
        guard.0 = guard.0.wrapping_add(1);
        guard.1 = x;
        guard.2 = y;
        guard.0
    };
    {
        // 节流「起线程」本身：位置已经在 POSITION 里更新，最后一个线程会读到最新值
        let now = std::time::Instant::now();
        let mut last = LAST_SPAWN.lock().unwrap();
        if let Some(previous) = *last {
            if now.duration_since(previous) < SAVE_DEBOUNCE / 3 {
                return;
            }
        }
        *last = Some(now);
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DEBOUNCE);
        let (current_gen, cx, cy) = *POSITION.lock().unwrap();
        // 期间又动过：交给更新的那个线程写
        if current_gen != generation {
            return;
        }
        update_state(&handle, |state| {
            state.x = cx;
            state.y = cy;
        });
    });
}

/// 尺寸变化入口（用户拖边框缩放后落盘，按当前外观分开记）
pub fn on_resized(app: &AppHandle, width: u32, height: u32) {
    let scale = app
        .get_webview_window(LYRICS_WINDOW)
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    if scale <= 0.0 {
        return;
    }
    let w = (width as f64 / scale).round();
    let h = (height as f64 / scale).round();
    let key = style_key(CURRENT_STYLE.lock().unwrap().as_deref());

    let generation = {
        let mut guard = SIZE.lock().unwrap();
        guard.0 = guard.0.wrapping_add(1);
        guard.1 = w;
        guard.2 = h;
        guard.0
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DEBOUNCE);
        let (current_gen, cw, ch) = *SIZE.lock().unwrap();
        if current_gen != generation {
            return;
        }
        update_state(&handle, |state| {
            state.sizes.insert(key, (cw, ch));
        });
    });
}

/* ------------------------------ 窗口操作 ------------------------------ */

/// 首次打开时的默认位置：水平居中、垂直落在屏幕下方 5/6 处（不遮挡画面主体）。
///
/// 窗口刚建出来时可能还没"落到"某个显示器上，`current_monitor()` 会返回 None——
/// 这时退到主显示器，否则位置算不出来，窗口会被系统随便放（常见的后果是压在
/// 主窗口标题栏上，用户点都点不动）。
fn default_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Option<PhysicalPosition<i32>> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let screen = monitor.size();
    let origin = monitor.position();
    let size = window.outer_size().ok()?;
    let x = origin.x + (screen.width.saturating_sub(size.width) / 2) as i32;
    let y = origin.y + (screen.height.saturating_sub(size.height) as u64 * 5 / 6) as i32;
    Some(PhysicalPosition::new(x, y))
}

/// 打开（或重新显示）桌面歌词窗口。已存在时只做 show + 置顶 + 套用该外观的尺寸。
///
/// **必须是 async 命令**：`WebviewWindowBuilder::build()` 内部要把任务投递给主线程
/// 并等待它完成。同步命令本身就跑在主线程上，于是它等的是自己 —— 窗口对象建出来了，
/// 但 webview 的导航永远提交不了（表现为一个 `about:blank` 的全透明窗口），
/// 而且这个 invoke 永远不会 resolve。async 命令会被派到异步运行时上执行，主线程
/// 才空出来处理建窗请求。
#[tauri::command]
pub async fn lyrics_window_open(app: AppHandle, style: Option<String>) -> Result<(), String> {
    *CURRENT_STYLE.lock().unwrap() = Some(style_key(style.as_deref()));
    let (width, height) = saved_size(&app, style.as_deref());

    if let Some(window) = app.get_webview_window(LYRICS_WINDOW) {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.set_size(LogicalSize::new(width, height));
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        LYRICS_WINDOW,
        // dev 模式下 Tauri 会把它拼到 devUrl 后面，生产环境走 tauri://localhost
        WebviewUrl::App("index.html?window=lyrics".into()),
    )
    .title("桌面歌词")
    .inner_size(width, height)
    .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
    // 可拖边框缩放：前端给窗口四周铺了透明的缩放手柄（无边框窗口要靠它们）
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    // 打开时不抢焦点：用户可能正在别的窗口打字
    .focused(false)
    .zoom_hotkeys_enabled(false)
    // 先不可见：定位好再显示，避免先在系统默认位置闪一下（那个位置常常
    // 正好压在主窗口标题栏上）
    .visible(false)
    .build()
    .map_err(|error| format!("创建桌面歌词窗口失败: {error}"))?;

    match load_state(&app) {
        Some(state) => {
            let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
        }
        None => {
            if let Some(position) = default_position(&window) {
                let _ = window.set_position(position);
            }
        }
    }
    let _ = window.show();
    Ok(())
}

/// 切换外观时套用该外观上次的尺寸（纯文字比卡片小得多，避免透明区域白吞鼠标）。
///
/// 与建窗同理必须是 async：`set_size` 同样要回主线程执行。
#[tauri::command]
pub async fn lyrics_window_set_style(app: AppHandle, style: Option<String>) -> Result<(), String> {
    *CURRENT_STYLE.lock().unwrap() = Some(style_key(style.as_deref()));
    let Some(window) = app.get_webview_window(LYRICS_WINDOW) else {
        return Ok(());
    };
    let (width, height) = saved_size(&app, style.as_deref());
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| format!("调整桌面歌词窗口尺寸失败: {error}"))
}

/// 关闭桌面歌词窗口（销毁，而不是隐藏：下次打开会重新加载前端，状态自然同步）。
///
/// 与 `lyrics_window_open` 同理：`close()` 也要回到主线程执行，必须 async。
#[tauri::command]
pub async fn lyrics_window_close(app: AppHandle) -> Result<(), String> {
    LOCKED.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LYRICS_WINDOW) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 窗口是否存在（主窗口启动时用来对齐「上次开着」的开关状态）
#[tauri::command]
pub fn lyrics_window_exists(app: AppHandle) -> bool {
    app.get_webview_window(LYRICS_WINDOW).is_some()
}

/* ------------------------------ 锁定 / 穿透 ------------------------------ */

#[derive(Clone, Serialize)]
struct PointerInfo {
    /// 游标是否在窗口矩形内
    inside: bool,
    /// 游标是否在顶部工具栏热区（此区域内会临时放开鼠标，否则按钮点不到）
    on_toolbar: bool,
}

/// 锁定（鼠标穿透）开关。
///
/// 锁定后窗口不再接收鼠标：拖动、hover 全部失效，点击直接落到下层窗口。
/// 但为了能「悬浮显示解锁按钮」，锁定期间会轮询游标位置：
/// - 游标进入窗口 → 通知前端把工具栏亮出来（此时窗口仍是穿透的，不挡下层）；
/// - 游标进入顶部工具栏热区 → 临时放开穿透，让解锁按钮可以点。
#[tauri::command]
pub async fn lyrics_window_set_ignore_cursor(app: AppHandle, ignore: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LYRICS_WINDOW) else {
        return Ok(());
    };
    LOCKED.store(ignore, Ordering::SeqCst);
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())?;
    if ignore {
        start_pointer_poll(app);
    }
    Ok(())
}

/// 工具栏热区尺寸（逻辑像素）：以窗口顶部中点为中心的一块矩形
const TOOLBAR_ZONE: (f64, f64) = (150.0, 48.0);

fn probe_pointer<R: tauri::Runtime>(app: &AppHandle, window: &tauri::WebviewWindow<R>) -> (bool, bool) {
    let Ok(cursor) = app.cursor_position() else {
        return (false, false);
    };
    let Ok(origin) = window.outer_position() else {
        return (false, false);
    };
    let Ok(size) = window.outer_size() else {
        return (false, false);
    };
    let scale = window.scale_factor().unwrap_or(1.0);

    let left = origin.x as f64;
    let top = origin.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;
    let inside = cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;
    if !inside {
        return (false, false);
    }

    let center_x = (left + right) / 2.0;
    let half_w = TOOLBAR_ZONE.0 * scale / 2.0;
    let zone_h = TOOLBAR_ZONE.1 * scale;
    let on_toolbar = (cursor.x - center_x).abs() <= half_w && cursor.y <= top + zone_h;
    (true, on_toolbar)
}

/// 锁定期间轮询游标：推悬浮状态给前端，并在工具栏热区临时放开穿透。
fn start_pointer_poll(app: AppHandle) {
    if POLLING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut last = PointerInfo {
            inside: false,
            on_toolbar: false,
        };
        // 当前是否已经放开鼠标（默认穿透）
        let mut armed = false;

        while LOCKED.load(Ordering::SeqCst) {
            let Some(window) = app.get_webview_window(LYRICS_WINDOW) else {
                break;
            };
            let (inside, on_toolbar) = probe_pointer(&app, &window);
            if inside != last.inside || on_toolbar != last.on_toolbar {
                last = PointerInfo { inside, on_toolbar };
                let _ = app.emit_to(LYRICS_WINDOW, POINTER_EVENT, last.clone());
            }
            // 只有工具栏热区才放开鼠标：歌词主体依旧穿透，不挡下层点击
            if on_toolbar != armed {
                armed = on_toolbar;
                let _ = window.set_ignore_cursor_events(!armed);
            }
            std::thread::sleep(POLL_INTERVAL);
        }

        // 退出轮询：如果窗口还在且仍处于锁定，确保恢复穿透
        if LOCKED.load(Ordering::SeqCst) {
            if let Some(window) = app.get_webview_window(LYRICS_WINDOW) {
                let _ = window.set_ignore_cursor_events(true);
            }
        }
        POLLING.store(false, Ordering::SeqCst);
    });
}
