import { createRouter, createWebHashHistory } from "vue-router";

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
      meta: { title: "推荐" },
    },
    {
      // 「我的」页：头像 + 所有歌单（移动端底部导航入口，桌面端可达但不入侧边栏）
      path: "/mine",
      name: "mine",
      component: () => import("@/views/MineView.vue"),
      meta: { title: "我的" },
    },
    {
      path: "/search",
      name: "search",
      component: () => import("@/views/SearchView.vue"),
      meta: { title: "搜索" },
    },
    {
      path: "/liked",
      name: "liked",
      component: () => import("@/views/LikedView.vue"),
      meta: { title: "我喜欢的音乐" },
    },
    {
      path: "/offline",
      name: "offline",
      component: () => import("@/views/OfflineView.vue"),
      meta: { title: "离线音乐" },
    },
    {
      path: "/history",
      name: "history",
      component: () => import("@/views/HistoryView.vue"),
      meta: { title: "最近播放" },
    },
    {
      path: "/playlist/:id",
      name: "playlist",
      component: () => import("@/views/PlaylistView.vue"),
      meta: { title: "歌单" },
    },
    {
      // 插件来源的歌单（多一段 source），与上面的本地歌单路由区分开
      path: "/playlist/:source/:id",
      name: "sourcePlaylist",
      component: () => import("@/views/PlaylistView.vue"),
      meta: { title: "歌单" },
    },
    {
      path: "/album/:source/:id",
      name: "album",
      component: () => import("@/views/AlbumView.vue"),
      meta: { title: "专辑" },
    },
    {
      path: "/artist/:source/:id",
      name: "artist",
      component: () => import("@/views/ArtistView.vue"),
      meta: { title: "歌手" },
    },
    {
      // 内置播放源的曲库浏览（`/library/builtin.local`、`/library/builtin.webdav`）。
      // `/local` 是本地音乐的旧入口，保留以免旧链接失效。
      path: "/local",
      name: "local",
      component: () => import("@/views/LibraryView.vue"),
      meta: { title: "本地音乐" },
    },
    {
      path: "/library/:source",
      name: "library",
      component: () => import("@/views/LibraryView.vue"),
      meta: { title: "曲库" },
    },
    {
      path: "/plugins",
      name: "plugins",
      component: () => import("@/views/PluginsView.vue"),
      meta: { title: "播放源管理" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { title: "设置" },
    },
    {
      // 首次引导 / 设置里「重新查看」：全屏裸页，不渲染侧边栏与播放条
      // （meta.bare 由 App.vue 读取，决定是否套 PageShell 骨架）
      path: "/welcome",
      name: "welcome",
      component: () => import("@/views/WelcomeView.vue"),
      meta: { title: "欢迎", bare: true },
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} - WinPlayer` : "WinPlayer";
});

export default router;
