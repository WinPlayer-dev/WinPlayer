/**
 * 桌面「正在播放」沉浸页视觉走查页（开发期用）。
 *
 * 入口：`npx vite` 后访问 `/.workbuddy/preview/now-playing-preview.html`。
 *
 * 挂的是**真实的 `PlayerBarBase`**（底部播放条 + 新的 `NowPlayingPage`），
 * 播放器状态在内存里 mock（一首歌 + 八句带翻译的歌词），并直接把
 * `player.showLyrics` 置为 true 打开整页。
 *
 * 沉浸页整窗覆盖（含标题栏），所以这里不画假标题栏；页面自己的顶栏里
 * 带拖拽区与最小化 / 最大化 / 关闭，走查时看到的就是真窗口的样子。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/motion.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/styles/lyrics-style.css";
import PlayerBarBase from "@/components/layout/PlayerBarBase.vue";
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
  { time: 48000, text: "天亮的时候雨停了", translation: "By dawn the rain had stopped" },
  { time: 54000, text: "我把湿掉的鞋摆到窗台上" },
  { time: 60000, text: "路灯一盏接一盏熄了", translation: "The street lights went out one by one" },
  { time: 66000, text: "环卫车从街角拐过来" },
  { time: 72000, text: "我把耳机塞回口袋" },
  { time: 78000, text: "雨停之前我该走了", translation: "I should leave before the rain stops" },
  { time: 84000, text: "水洼里映着整条街", translation: "The whole street is mirrored in puddles" },
  { time: 90000, text: "像一场没结束的梦" },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const Host = defineComponent({
  setup() {
    return () =>
      h(
        "div",
        {
          class: "app-frame",
          style: "height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#111114",
        },
        [
          h("div", { style: "flex:1;min-height:0" }),
          h(PlayerBarBase, { style: "height:var(--playerbar-height)" }),
        ],
      );
  },
});

const app = createApp(Host);
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
      album: "雨停之前（Deluxe）",
      cover: "/build-assets/app-icon.png",
      duration: 240000,
      sourceId: "demo",
    },
  },
];
player.currentIndex = 0;
player.duration = 240;
player.currentTime = 48;
player.lyrics = LYRICS;
player.volume = 0.72;
// 初始不展开：截图脚本先点一次打开，才能看到入场动画
player.showLyrics = false;

// 让走查页能切几种外观组合、也能模拟「打开」动作（连入场动画一起看）
const settings = useSettingsStore();
const harnessWindow = window as unknown as { __settings?: unknown; __player?: unknown };
harnessWindow.__settings = settings;
harnessWindow.__player = player;

app.mount("#app");
