import { createApp } from "vue";
import { createPinia } from "pinia";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/mobile.css";
import "@/styles/theme.css";
import App from "./App.vue";
import router from "./router";
import { installScrollMemory } from "@/services/scrollMemory";
import { useIsMobile } from "@/composables/useIsMobile";

const app = createApp(App);

app.use(createPinia());
app.use(router);

if (useIsMobile()) {
  // 全局移动端钩子：对话框 / 菜单等弹层渲染在 .app-shell 之外（直接挂 body），
  // 用 <html>.is-mobile 才能命中它们。
  document.documentElement.classList.add("is-mobile");
  // 返回时恢复滚动位置
  installScrollMemory(router);
}

app.mount("#app");
