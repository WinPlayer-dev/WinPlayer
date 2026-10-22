/**
 * 首次引导页预览（仅开发期使用）。
 *
 * 真实挂载 `WelcomeView.vue`，只把三处宿主依赖换成桩：
 * - 插件市场索引（避免在浏览器里走 Tauri 的 http_fetch）；
 * - 安装动作（直接返回成功，便于检查「已就绪」态与跳转）；
 * - 引导完成标记写库（浏览器里没有 SQLite）。
 *
 * 访问 `/welcome-preview.html`，跳过引导后会进入「主界面」占位页。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory, RouterView, type RouteRecordRaw } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import WelcomeView from "@/views/WelcomeView.vue";
import { usePluginsStore } from "@/stores/plugins";
import { useSettingsStore } from "@/stores/settings";
import { installHarnessStubs } from "./harness";
import type { MarketEntry } from "@/types/plugin";

installHarnessStubs();

/** 占位页：引导结束后落到的真实页面在这里只做标识 */
function placeholder(label: string) {
  return defineComponent({
    name: `PreviewPlaceholder_${label}`,
    setup: () => () =>
      h(
        "div",
        { style: "padding:40px;font-size:14px;color:var(--wp-text-secondary)" },
        `${label}（预览占位页）`,
      ),
  });
}

/** 预览用的假市场数据，字段与真实 MarketEntry 一致 */
const MARKET: MarketEntry[] = [
  {
    id: "netease",
    name: "网易云音乐",
    version: "1.4.2",
    author: "WinPlayer",
    description: "网易云音乐音源，支持搜索 / 歌单 / 扫码登录 / 无损音质",
    url: "https://github.com/WinPlayer-dev/plugin-netease",
    homepage: "https://github.com/WinPlayer-dev/plugin-netease",
  },
  {
    id: "bilibili",
    name: "哔哩哔哩",
    version: "0.9.0",
    author: "WinPlayer",
    description: "B 站音源，支持收藏夹、分 P 与视频音轨",
    url: "https://github.com/WinPlayer-dev/plugin-bilibili",
  },
  {
    id: "local",
    name: "本地音乐",
    description: "播放本地文件夹中的无损音频（演示行：无版本、无封面）",
    url: "https://example.com/local.zip",
  },
];

const routes: RouteRecordRaw[] = [
  { path: "/", component: placeholder("主界面") },
  { path: "/plugins", name: "plugins", component: placeholder("插件市场") },
  { path: "/settings", name: "settings", component: placeholder("设置") },
  { path: "/welcome", name: "welcome", component: WelcomeView },
];

const pinia = createPinia();
const router = createRouter({ history: createWebHashHistory(), routes });

/** 引导页依赖的宿主能力：用桩替换（其余交互走真实组件逻辑） */
const plugins = usePluginsStore(pinia);
plugins.fetchMarketEntries = async () => MARKET;
plugins.installFromUrl = async () => true;

const settings = useSettingsStore(pinia);
settings.setOnboardingDone = async () => {};

/** 外壳：WelcomeView 的根节点靠 flex:1 撑满，这里补上与 App.vue 等价的 flex 列布局 */
const Host = defineComponent({
  name: "WelcomePreviewHost",
  setup: () => () =>
    h(
      "div",
      {
        style:
          "display:flex;flex-direction:column;height:100vh;background:var(--wp-base);color:var(--wp-text-primary)",
      },
      [h(RouterView)],
    ),
});

const app = createApp(Host);
app.use(pinia);
app.use(router);

// 直接停在欢迎页；点「跳过」会 replace 到「/」，即主界面占位页
await router.replace("/welcome");
await router.isReady();
app.mount("#app");

/**
 * 走查 / 截图辅助（仅预览页）：
 * - `?step=2` 自动进入第 2 步（市场列表默认展示，无需再点）；
 * - `?theme=dark` 切到暗色令牌。
 */
const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "dark") document.documentElement.dataset.theme = "dark";

if (params.get("step") === "2") {
  window.setTimeout(() => {
    (document.querySelector(".stage-inner.intro .primary-action") as HTMLButtonElement | null)?.click();
  }, 300);
}
