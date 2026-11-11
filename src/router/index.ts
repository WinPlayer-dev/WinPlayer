import { createRouter, createWebHashHistory } from "vue-router";
import { t, type I18nKey } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";

/**
 * 使用 hash 路由：Tauri 自定义协议下避免刷新时路径 404
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "recommend",
      component: () => import("@/views/RecommendView.vue"),
      meta: { title: "nav.page.recommend" },
    },
    {
      // 「我的」页：头像 + 所有歌单（移动端底部导航入口，桌面端可达但不入侧边栏）
      path: "/mine",
      name: "mine",
      component: () => import("@/views/MineView.vue"),
      meta: { title: "nav.page.mine" },
    },
    {
      path: "/search",
      name: "search",
      component: () => import("@/views/SearchView.vue"),
      meta: { title: "nav.page.search" },
    },
    {
      path: "/liked",
      name: "liked",
      component: () => import("@/views/LikedView.vue"),
      meta: { title: "nav.page.liked" },
    },
    {
      path: "/offline",
      name: "offline",
      component: () => import("@/views/OfflineView.vue"),
      meta: { title: "nav.page.offline" },
    },
    {
      // 录音棚（唱歌模式）：拿当前播放的歌曲当伴奏，录完直接混音
      path: "/studio",
      name: "studio",
      component: () => import("@/views/StudioView.vue"),
      meta: { title: "nav.page.studio" },
      /**
       * 实验性功能：设置里关掉入口后，历史记录里的旧链接 / 手输地址也不该能进，
       * 直接送回推荐页（录音作品仍留在本地，重新打开开关即可看到）。
       */
      beforeEnter: () =>
        useSettingsStore().studioEnabled ? true : { name: "recommend" },
    },
    {
      path: "/history",
      name: "history",
      component: () => import("@/views/HistoryView.vue"),
      meta: { title: "nav.page.history" },
    },
    {
      path: "/playlist/:id",
      name: "playlist",
      component: () => import("@/views/PlaylistView.vue"),
      meta: { title: "nav.page.playlist" },
    },
    {
      // 插件来源的歌单（多一段 source），与上面的本地歌单路由区分开
      path: "/playlist/:source/:id",
      name: "sourcePlaylist",
      component: () => import("@/views/PlaylistView.vue"),
      meta: { title: "nav.page.playlist" },
    },
    {
      path: "/album/:source/:id",
      name: "album",
      component: () => import("@/views/AlbumView.vue"),
      meta: { title: "nav.page.album" },
    },
    {
      path: "/artist/:source/:id",
      name: "artist",
      component: () => import("@/views/ArtistView.vue"),
      meta: { title: "nav.page.artist" },
    },
    {
      // 内置播放源的曲库浏览（`/library/builtin.local`、`/library/builtin.webdav`）。
      // `/local` 是本地音乐的旧入口，保留以免旧链接失效。
      path: "/local",
      name: "local",
      component: () => import("@/views/LibraryView.vue"),
      meta: { title: "nav.page.local" },
    },
    {
      path: "/library/:source",
      name: "library",
      component: () => import("@/views/LibraryView.vue"),
      meta: { title: "nav.page.library" },
    },
    {
      path: "/plugins",
      name: "plugins",
      component: () => import("@/views/PluginsView.vue"),
      meta: { title: "nav.page.plugins" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { title: "nav.page.settings" },
    },
    {
      // 首次引导 / 设置里「重新查看」：全屏裸页，不渲染侧边栏与播放条
      // （meta.bare 由 App.vue 读取，决定是否套 PageShell 骨架）
      path: "/welcome",
      name: "welcome",
      component: () => import("@/views/WelcomeView.vue"),
      meta: { title: "nav.page.welcome", bare: true },
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

/**
 * `meta.title` 存的是词条 key（`nav.page.*`），这里在消费点翻译。
 *
 * 注意：切语种时不会自动重跑 afterEach，`document.title` 要等下一次导航才更新；
 * 当前只有 zh-CN 一个语种，等接入第二语言时在 `setLocale` 之后补一次刷新即可。
 */
router.afterEach((to) => {
  const titleKey = to.meta.title as I18nKey | undefined;
  document.title = titleKey ? `${t(titleKey)} - WinPlayer` : "WinPlayer";
});

export default router;
