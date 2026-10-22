/**
 * 播放源管理 · 内置播放源预览（仅开发期使用）。
 *
 * 真实挂载 `BuiltinSourcesTab`（卡片列表 + 两个配置弹窗），
 * 用来在没有 Tauri 的情况下检查按钮布局、图标与弹窗表单。
 * 访问 `/plugins-preview.html`。
 *
 * 注意：预览环境里 SQLite 不可用，两个 store 的 `load()` 会失败并降级为空曲库，
 * 卡片状态显示「未添加文件夹」/「未配置」——这正是需要看的默认形态。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import BuiltinSourcesTab from "@/views/plugins/BuiltinSourcesTab.vue";
import { installHarnessStubs, mountBuiltinTheme } from "./harness";

installHarnessStubs();

const Host = defineComponent({
  setup() {
    return () =>
      h(
        "div",
        {
          class: "wp-page plugins-page app-shell",
          style: "padding:24px;overflow:auto;min-height:100vh",
        },
        [h(BuiltinSourcesTab)],
      );
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

void mountBuiltinTheme();
