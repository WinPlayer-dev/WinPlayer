/**
 * 关于页预览（仅开发期使用，走查 / 截图用）。
 *
 * 真实挂载 `AboutSettings.vue`，只把两处宿主依赖换成桩：
 * - 版本号与平台信息（浏览器里没有 Rust 侧的 updater_platform）；
 * - 设置库里的更新相关标记（浏览器里没有 SQLite）。
 *
 * 参数：
 * - `?theme=dark` 切暗色令牌；
 * - `?mobile=1` 套上 `.settings-page.mobile` 外壳，验证窄屏样式
 *   （`useIsMobile()` 走 UA 判定，浏览器里拿不到，所以在这里直接给外壳加类）。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/views/settings/settings.css";
import AboutSettings from "@/views/settings/AboutSettings.vue";
import { useSettingsStore } from "@/stores/settings";
import { useUpdaterStore } from "@/stores/updater";
import { installHarnessStubs } from "./harness";

installHarnessStubs();

const params = new URLSearchParams(window.location.search);

const pinia = createPinia();

/** 桩：模拟 Rust 侧上报的版本与平台，让 Hero 的 chip 有真实内容 */
const updater = useUpdaterStore(pinia);
updater.currentVersion = "1.10.0";
updater.platform = {
  platform: "windows",
  arch: "x86_64",
  installer: "windows-nsis",
  installerLabel: "Windows 安装程序",
  releasesUrl: "https://github.com/WinPlayer-dev/WinPlayer/releases",
};

const settings = useSettingsStore(pinia);
settings.lastUpdateCheckAt = Date.now() - 1000 * 60 * 30;

const mobile = params.get("mobile") === "1";

const Host = defineComponent({
  name: "AboutPreviewHost",
  setup: () => () =>
    h(
      "div",
      {
        class: ["settings-page", "app-shell", mobile ? "mobile" : ""],
        // 移动端不写死 padding：让 settings.css 里 `.settings-page.mobile` 的真实内边距生效
        style: mobile
          ? "box-sizing:border-box;width:100%;max-width:420px;margin:0 auto;overflow:auto;color:var(--wp-text-primary);background:var(--wp-base)"
          : "padding:24px;overflow:auto;color:var(--wp-text-primary);background:var(--wp-base)",
      },
      [h(AboutSettings)],
    ),
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const app = createApp(Host);
app.use(pinia);
app.use(router);
app.mount("#app");

// 必须放在 stores 初始化之后：settings store 装载时会按持久化配置重写 data-theme
if (params.get("theme") === "dark") document.documentElement.dataset.theme = "dark";
