/**
 * 主窗口入口（原来的 `main.ts`）。
 *
 * 应用现在有两个前端入口：主窗口与桌面歌词窗口。`main.ts` 只做一次分流，
 * 主窗口的逻辑收在这里，好处是**主窗口的全局样式（global.css 里 body 的
 * 不透明底色）不会污染透明歌词窗口**——歌词窗口只加载自己那点样式。
 */

import { createApp } from "vue";
import { createPinia } from "pinia";
import "@/styles/tokens.css";
import "@/styles/motion.css";
import "@/styles/global.css";
import "@/styles/mobile.css";
import "@/styles/theme.css";
import "@/styles/cover-natural.css";
import "@/styles/cloud-layout.css";
import "@/styles/lyrics-style.css";
import App from "./App.vue";
import router from "./router";
import { installScrollMemory } from "@/services/scrollMemory";
import { installKeyboardInset } from "@/services/keyboard";
import { useIsMobile } from "@/composables/useIsMobile";

const app = createApp(App);

app.use(createPinia());
app.use(router);

/**
 * Windows 上必须关掉 Tauri 自带的拖放处理器（`tauri.conf.json` 的
 * `dragDropEnabled: false`），页面里的 HTML5 拖拽才会生效——Tauri 会替换
 * WebView2 的拖放实现，开着它时 dragover / drop 根本到不了前端。
 *
 * 代价是外部文件拖进窗口时会走 WebView 的默认行为（直接导航到该文件），
 * 这里统一吞掉「文件拖放」，避免把应用当前页面顶掉。应用本身不接收文件拖放。
 */
function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

window.addEventListener("dragover", (event) => {
  if (isFileDrag(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (isFileDrag(event)) event.preventDefault();
});

if (useIsMobile()) {
  // 全局移动端钩子：对话框 / 菜单等弹层渲染在 .app-shell 之外（直接挂 body），
  // 用 <html>.is-mobile 才能命中它们。
  document.documentElement.classList.add("is-mobile");
  // 返回时恢复滚动位置
  installScrollMemory(router);
  // 软键盘：给 <html> 挂 keyboard-open 并写入 --keyboard-inset
  installKeyboardInset();
}

app.mount("#app");
