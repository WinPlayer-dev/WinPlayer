/**
 * 手机全屏播放页（歌词那一屏）视觉走查页（开发期用）。
 *
 * 入口：`npx vite` 后访问 `/.workbuddy/preview/lyric-full-player.html`。
 * 挂的是**真实的 MobilePlayerBar**，播放器状态在内存里 mock（一首歌 + 八句带翻译的歌词），
 * 用来确认「设置 → 外观 → 歌词样式」在真实组件里的表现（类名、自动居中、边缘渐隐）。
 *
 * 打开后需要点一下迷你播放条才会展开全屏页：截图脚本里点 `.mini-bar` 即可。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/motion.css";
import "@/styles/global.css";
import "@/styles/mobile.css";
import "@/styles/theme.css";
import "@/styles/lyrics-style.css";
import MobilePlayerBar from "@/components/layout/MobilePlayerBar.vue";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { installHarnessStubs } from "./harness";
import type { LyricLine } from "@/types/player";

installHarnessStubs();
document.documentElement.dataset.theme = "dark";

const LYRICS: LyricLine[] = [
  { time: 0, text: "雨落下的声音" },
  { time: 6000, text: "把整座城市泡成一片模糊的蓝", translation: "The rain dissolves the city into blue" },
  { time: 12000, text: "我在便利店门口站了很久", translation: "I waited outside the store" },
  { time: 18000, text: "等一句不会再来的晚安" },
  { time: 24000, text: "雨停之前", translation: "Before the rain stops" },
  { time: 30000, text: "路灯把水面照成碎掉的银河", translation: "Street lights break the water into galaxies" },
  { time: 36000, text: "我把伞收起来走进雨里" },
  { time: 42000, text: "反正早已经湿透了" },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const app = createApp(MobilePlayerBar);
app.use(createPinia());
app.use(router);

const player = usePlayerStore();
// currentTrack 是 computed（由 queue + currentIndex 派生），所以只能塞队列
player.queue = [
  {
    uid: "demo-1",
    track: {
      id: "demo-1",
      name: "雨停之前",
      artists: ["夜航西飞"],
      album: "雨停之前",
      cover: "/build-assets/app-icon.png",
      duration: 240000,
      sourceId: "demo",
    },
  },
];
player.currentIndex = 0;
player.duration = 240;
player.currentTime = 20;
player.lyrics = LYRICS;

// 让走查页能切几种外观组合再看效果（截图脚本里直接改 store 即可；
// `__player` 用来喂「超长歌词」「切到某一句」这类极端数据做回归）
const settings = useSettingsStore();
const harnessWindow = window as unknown as { __settings?: unknown; __player?: unknown };
harnessWindow.__settings = settings;
harnessWindow.__player = player;

app.mount("#app");
