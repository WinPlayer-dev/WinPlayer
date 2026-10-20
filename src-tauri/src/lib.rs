mod commands;
// 全局快捷键依赖的 crate 在移动端整体不编译（其源码头部有 #![cfg(not(android, ios))]），
// 因此整个模块只在桌面端参与编译。
#[cfg(winplayer_desktop)]
mod global_shortcuts;
mod player;
mod smtc;
#[cfg(windows)]
mod tray;
mod updater;
// 窗口状态记忆只对桌面端有意义：移动端窗口由系统全屏托管，
// 且 center / maximize / available_monitors 等都是 #[cfg(desktop)] 的 API。
#[cfg(winplayer_desktop)]
#[path = "window_state.rs"]
mod window_state;
#[cfg(not(winplayer_desktop))]
#[path = "window_state_mobile.rs"]
mod window_state;

use tauri_plugin_sql::{Migration, MigrationKind};
// 关闭拦截（Windows 托盘）与窗口状态事件都用到 `Manager`
// 提供的 `app_handle` / `get_webview_window`，移动端用不到。
#[cfg(any(windows, winplayer_desktop))]
use tauri::Manager;

fn db_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "offline songs",
            sql: include_str!("../migrations/002_offline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "play history",
            sql: include_str!("../migrations/003_history.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// 移动端通过动态库入口启动，需要导出 tauri 的 mobile entry point 符号
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 主题资源协议（壁纸 / 字体 / 图片）与图片缓存协议同样是自定义异步协议
    // `mut` 只在桌面端用得上（按平台补注册插件），移动端会提示多余。
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // 系统级全局快捷键：crate 源码对整个移动端 `#![cfg(...)]` 掉，移动端连类型
    // 都不存在，因此不能写在链式调用里，只能按平台补注册。
    #[cfg(winplayer_desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    let builder = commands::themes::register(commands::cache::register(
        builder
            // 安卓媒体控件（媒体通知/锁屏/线控），桌面端自动 no-op
            .plugin(tauri_plugin_media_session::init())
            // 安卓 APK 安装（自动更新），桌面端自动 no-op
            .plugin(tauri_plugin_apk_installer::init())
            // 安卓触感反馈（WebView 无 navigator.vibrate，走原生 Vibrator），桌面端自动 no-op
            .plugin(tauri_plugin_haptics::init())
            .plugin(
                tauri_plugin_sql::Builder::default()
                    .add_migrations("sqlite:winplayer.db", db_migrations())
                    .build(),
            )
            // invoke_handler 只能调用一次（再次调用会整体替换命令表），
            // 所有命令必须集中在此列出
            .invoke_handler(tauri::generate_handler![
                commands::cache::cache_stats,
                commands::cache::cache_clear,
                commands::cache::cover_cache_path,
                commands::cache::cover_dominant_color,
                commands::cache::image_cache_prefetch,
                commands::http::http_fetch,
                commands::download::download_default_dir,
                commands::download::download_song,
                commands::download::download_cancel,
                commands::download::download_delete,
                commands::download::download_write_text,
                commands::download::download_read_text,
                commands::download::download_copy,
                commands::download::download_reveal,
                commands::download::download_check,
                commands::plugins::plugin_list,
                commands::plugins::plugin_read_code,
                commands::plugins::plugin_install_from_path,
                commands::plugins::plugin_install_from_url,
                commands::plugins::plugin_remove,
                commands::plugins::plugin_storage_get,
                commands::plugins::plugin_storage_set,
                commands::themes::theme_list,
                commands::themes::theme_read_text,
                commands::themes::theme_install_from_path,
                commands::themes::theme_install_from_url,
                commands::themes::theme_remove,
                commands::smtc::smtc_sync,
                commands::window::window_set_material,
                commands::window::window_state_set_enabled,
                commands::window::window_state_saved,
                commands::window::window_state_reset,
                commands::window::global_shortcut_apply,
                commands::window::global_shortcut_status,
                commands::tray::tray_set_close_behavior,
                commands::tray::tray_toggle_window,
                commands::tray::tray_hide_window,
                commands::tray::tray_quit,
                commands::tray::tray_set_tooltip,
                updater::updater_platform,
                updater::updater_check,
                updater::updater_download,
                updater::updater_download_cancel,
                updater::updater_install,
                player::player_load,
                player::player_preload,
                player::player_cancel_preload,
                player::player_current_url,
                player::player_set_play_chain,
                player::player_set_crossfade,
                player::player_play,
                player::player_pause,
                player::player_stop,
                player::player_seek,
                player::player_set_volume,
                player::player_set_eq,
                player::player_set_rate,
                player::player_list_output_devices,
                player::player_set_output_device,
            ])
            .setup(|app| {
                // 主窗口此时已创建，可在其上挂接系统媒体传输控件（SMTC）
                smtc::init(app.handle());
                // 原生音频播放引擎（命令 + 事件见 src-tauri/src/player/）
                player::init(app);
                // 系统托盘 + 关闭到托盘（仅 Windows 桌面）
                #[cfg(windows)]
                if let Err(e) = tray::init(app) {
                    eprintln!("[tray] 托盘初始化失败: {e}");
                }
                // 窗口状态记忆：读上次的尺寸/位置/最大化并套回主窗口
                window_state::init(app);
                window_state::restore(app.handle());
                // 全局快捷键：先按默认值注册，前端读到设置后再覆盖
                // （默认值与应用内快捷键不冲突，前端加载完成前也能用）
                #[cfg(winplayer_desktop)]
                crate::global_shortcuts::apply_defaults(app.handle());
                Ok(())
            })
            .on_window_event(|window, event| {
                // 拦截主窗口关闭请求：按「关闭行为」隐藏 / 最小化 / 退出。
                // 仅 Windows 有托盘；其他平台维持默认「关闭即退出」。
                #[cfg(windows)]
                if window.label() == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if tray::should_intercept_close(window.app_handle()) {
                            api.prevent_close();
                        }
                    }
                }
                // 窗口状态记忆：拖动/缩放/最大化切换都会触发 Resized / Moved，
                // 这里统一走防抖落盘；真正关闭前再同步写一次。
                // 移动端窗口由系统托管，不需要记状态。
                #[cfg(winplayer_desktop)]
                if window.label() == "main" {
                    match event {
                        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                            if let Some(webview) = window.app_handle().get_webview_window("main") {
                                window_state::on_window_moved(&webview);
                            }
                        }
                        tauri::WindowEvent::CloseRequested { .. } => {
                            window_state::save_now(window.app_handle());
                        }
                        _ => {}
                    }
                }
            }),
    ));
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}