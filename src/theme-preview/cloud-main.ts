/**
 * 「云端」布局视觉走查页（开发期用）。
 *
 * 入口：`npx vite` 后访问 `/.workbuddy/preview/cloud-preview.html`
 * （`.workbuddy/` 不进版本库，但 Vite 能直接服务根目录下的任意 html）。
 *
 * 挂的是**真实组件**：PlaylistView（渐变头部 + 白色面板）、LikedView（无封面时的
 * 强调色回落）、LayoutSection（设置页三张大卡片）。曲库数据在内存里 mock。
 *
 * 手机端判定读 UA，所以要用 CDP / Playwright 覆盖设备与 UA 后再截图，
 * 单纯改窗口宽度不算手机端。
 */
import { createApp, defineComponent, h, type VNodeChild } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/motion.css";
import "@/styles/global.css";
import "@/styles/mobile.css";
import "@/styles/theme.css";
import "@/styles/cloud-layout.css";
import "@/views/settings/settings.css";
import PlaylistView from "@/views/PlaylistView.vue";
import LikedView from "@/views/LikedView.vue";
import LayoutSection from "@/views/settings/appearance/LayoutSection.vue";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { installHarnessStubs } from "./harness";
import type { UnifiedTrack } from "@/types/plugin";

installHarnessStubs();
document.documentElement.dataset.theme = "light";
// 正常由 App.vue 写入，走查页没有 App，手动打开云端布局
document.documentElement.dataset.songLayout = "cloud";

const COVER = "/build-assets/app-icon.png";

const TRACKS: UnifiedTrack[] = [
  { id: "1", name: "散步道", artists: ["ヒバナ"], album: "散步道", cover: COVER, duration: 240000, sourceId: "demo" },
  { id: "2", name: "I Really Want to Stay at Your House", artists: ["Rosa Walton", "Hallie Coggins"], album: "Cyberpunk", cover: COVER, duration: 250000, vip: true, sourceId: "demo" },
  { id: "3", name: "Reborn", artists: ["Girls Archives."], album: "Reborn", cover: COVER, duration: 210000, vip: true, sourceId: "demo" },
  { id: "4", name: "In Bloom (盛放)", artists: ["Neck Deep"], album: "The Peace And The Panic", cover: COVER, duration: 200000, sourceId: "demo" },
  { id: "5", name: "天球（そら）のMúsica（TVアニメ）", artists: ["Ave Mujica"], album: "天球", cover: COVER, duration: 260000, sourceId: "demo" },
  { id: "6", name: "Melancholy Kaleidoscope", artists: ["All Time Low"], album: "Wake Up, Sunshine", cover: COVER, duration: 190000, sourceId: "demo" },
  { id: "7", name: "impulse", artists: ["AliA"], album: "impulse", cover: COVER, duration: 220000, sourceId: "demo" },
];

const Host = defineComponent({
  setup() {
    const library = useLibraryStore();
    const settings = useSettingsStore();
    settings.songListLayout = "cloud";

    // 走查页没有 SQLite：曲库数据全量内存 mock
    library.playlists = [
      {
        id: 1,
        name: "我喜欢的音乐",
        description: "",
        cover: COVER,
        trackCount: TRACKS.length,
        updatedAt: Date.now(),
      },
    ] as never;
    library.getPlaylistTracks = async () => TRACKS;
    library.liked = TRACKS.map((track, index) => ({
      track,
      likedAt: Date.now() - index * 1000,
    })) as never;

    const phone = (cls: string, child: VNodeChild) =>
      h("div", { class: cls, style: "width:390px;height:844px;overflow:auto;background:#fff" }, [child]);

    return () =>
      h(
        "div",
        {
          style:
            "background:#888;min-height:100vh;padding:16px 0;display:flex;gap:16px;flex-wrap:wrap;justify-content:center;align-items:flex-start",
        },
        [
          phone("phone-a", h(PlaylistView)),
          phone("phone-b", h(LikedView)),
          h("div", { class: "settings-page app-shell", style: "width:390px;padding:16px;background:#f3f3f3" }, [
            h(LayoutSection),
          ]),
        ],
      );
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/playlist/1" },
    { path: "/playlist/:id", name: "playlist", component: PlaylistView },
  ],
});

const app = createApp(Host);
app.use(createPinia());
app.use(router);
void router.isReady().then(() => app.mount("#app"));
