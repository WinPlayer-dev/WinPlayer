mod commands;
mod player;
mod smtc;
mod updater;

use tauri_plugin_sql::{Migration, MigrationKind};

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
    ]
}

// 移动端通过动态库入口启动，需要导出 tauri 的 mobile entry point 符号
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = commands::cache::register(
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_opener::init())
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
                commands::smtc::smtc_sync,
                commands::window::window_set_material,
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
                Ok(())
            }),
    );
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}