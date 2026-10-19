/**
 * 主题渲染预览（仅开发期使用）。
 *
 * 用真实浏览器渲染内置主题，便于在不启动 Tauri 的情况下检查：
 * - 组件是否能通过运行时 SFC 编译并挂载；
 * - MDUI 组件与 Material Icons 字体是否正常；
 * - 导航、播放条等交互是否持续可用。
 *
 * 访问 `/theme-preview.html`。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import Preview from "./PreviewApp.vue";
import { installHarnessStubs } from "./harness";

/** 安装 Tauri 宿主桩（含事件插件内部计数器） */
installHarnessStubs();

/**
 * 预览用路由：用真实组件占位，避免依赖运行时的 template 编译器
 * （生产构建下 `vue` 是 runtime-only，模板字符串无法编译）。
 */
const Placeholder = defineComponent({
  props: { label: { type: String, default: "" } },
  setup(props: { label: string }) {
    return () => h("div", { style: "padding:32px" }, `占位页面：${props.label}`);
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "recommend", component: Placeholder, props: { label: "推荐" } },
    { path: "/liked", name: "liked", component: Placeholder, props: { label: "喜欢" } },
    { path: "/mine", name: "mine", component: Placeholder, props: { label: "我的" } },
    { path: "/search", name: "search", component: Placeholder, props: { label: "搜索" } },
    { path: "/offline", name: "offline", component: Placeholder, props: { label: "离线" } },
    { path: "/plugins", name: "plugins", component: Placeholder, props: { label: "插件" } },
    { path: "/settings", name: "settings", component: Placeholder, props: { label: "设置" } },
    { path: "/playlist/:id", name: "playlist", component: Placeholder, props: { label: "歌单" } },
    {
      path: "/playlist/:source/:id",
      name: "sourcePlaylist",
      component: Placeholder,
      props: { label: "平台歌单" },
    },
    { path: "/album/:source/:id", name: "album", component: Placeholder, props: { label: "专辑" } },
    {
      path: "/artist/:source/:id",
      name: "artist",
      component: Placeholder,
      props: { label: "歌手" },
    },
  ],
});

const app = createApp(Preview);
app.use(createPinia());
app.use(router);
app.mount("#app");
