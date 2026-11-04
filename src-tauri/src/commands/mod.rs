pub mod cache;
pub mod cloud;
pub mod download;
pub mod http;
pub mod localmusic;
// 桌面歌词：独立置顶透明窗口的创建 / 穿透 / 位置记忆。
//
// 建窗用到的 `decorations` / `always_on_top` / `set_always_on_top` /
// `set_ignore_cursor_events` 全是桌面端 API（只在 Tauri 的 `#[cfg(desktop)]`
// impl 上存在），移动端整份换成占位实现，命令名保持不变，
// 这样 `invoke_handler` 的注册列表不用按平台拆两份。
#[cfg(winplayer_desktop)]
pub mod lyrics_window;
#[cfg(not(winplayer_desktop))]
#[path = "lyrics_window_mobile.rs"]
pub mod lyrics_window;
pub mod plugins;
pub mod smtc;
pub mod themes;
pub mod trackmeta;
pub mod tray;
pub mod webdav;
pub mod window;
