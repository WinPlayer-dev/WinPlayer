/**
 * 设置页卡片预览（仅开发期使用）。
 *
 * 真实挂载 StyleSettings 组件 + MD3 主题，用来验证「设置里的卡片是否走 MDUI」。
 * 与 theme-preview 共用同一套 Tauri 桩与主题装载逻辑。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/views/settings/settings.css";
import StyleSettings from "@/views/settings/StyleSettings.vue";
import { installHarnessStubs, mountBuiltinTheme } from "./harness";

installHarnessStubs();

const Host = defineComponent({
  setup() {
    return () =>
      h("div", { class: "settings-page app-shell", style: "padding:24px;overflow:auto" }, [
        h(StyleSettings),
      ]);
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const app = createApp(Host);
app.use(createPinia());
app.use(router);
app.mount("#app");

// 真实装载内置 MD3 主题（走与生产一致的编译管线）
void mountBuiltinTheme();
