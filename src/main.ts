/**
 * 前端入口分流。
 *
 * - 普通启动 → 主窗口应用（`appMain.ts`，带完整全局样式 / 路由 / Pinia）
 * - `?window=lyrics` → 桌面歌词窗口（`desktopLyricsMain.ts`，极简显示层）
 *
 * 桌面歌词窗口由 Rust 侧 `commands::lyrics_window` 创建，加载的就是同一份
 * `index.html`，靠这个 query 参数区分。必须在这里分流（而不是在 App.vue 里
 * 判断）：主窗口的全局样式会把 `<body>` 涂成不透明的，透明窗口就废了。
 */

const LYRIC_WINDOW_QUERY = "window";
const LYRIC_WINDOW_VALUE = "lyrics";

const isLyricsWindow =
  new URLSearchParams(window.location.search).get(LYRIC_WINDOW_QUERY) === LYRIC_WINDOW_VALUE;

if (isLyricsWindow) {
  void import("./desktopLyricsMain");
} else {
  void import("./appMain");
}
