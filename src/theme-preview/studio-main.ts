/**
 * 录音棚页面预览（仅开发期使用）。
 *
 * 真实挂载 StudioView，Tauri 命令用假数据桩掉，用来做视觉走查
 * （桌面 / 移动两种宽度）。走 dev server 的 `/studio-preview.html`。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import StudioView from "@/views/StudioView.vue";
import PageShellBase from "@/components/layout/PageShell.vue";
import { usePlayerStore } from "@/stores/player";
import { useRecorderStore } from "@/stores/recorder";
import { useIsMobile } from "@/composables/useIsMobile";
import { installHarnessStubs } from "./harness";

installHarnessStubs();

/** 假录音数据：覆盖「有伴奏 / 清唱」两种条目形态 */
const FAKE_ITEMS = [
  {
    id: "1729600000000",
    title: "晴天（录音）",
    artist: "周杰伦",
    cover: null,
    source: "demo",
    createdAt: Date.now() - 1000 * 60 * 26,
    durationMs: 269_000,
    offsetMs: 42,
    syncMs: 0,
    hasMix: true,
    hasSong: true,
    dir: "C:/recordings/1729600000000",
    mixPath: "local://C:/recordings/1729600000000/mix.wav",
    voicePath: "local://C:/recordings/1729600000000/voice.wav",
  },
  {
    id: "1729500000000",
    title: "清唱录音",
    artist: "",
    cover: null,
    source: null,
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
    durationMs: 58_000,
    offsetMs: 0,
    syncMs: 0,
    hasMix: true,
    hasSong: false,
    dir: "C:/recordings/1729500000000",
    mixPath: "local://C:/recordings/1729500000000/mix.wav",
    voicePath: "local://C:/recordings/1729500000000/voice.wav",
  },
];

const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> })
  .__TAURI_INTERNALS__;
const baseInvoke = internals.invoke as (cmd: string, args?: unknown) => Promise<unknown>;
internals.invoke = async (cmd: string, args?: unknown): Promise<unknown> => {
  if (cmd === "recorder_list_devices") {
    return ["麦克风阵列 (Realtek(R) Audio)", "USB Condenser Mic"];
  }
  if (cmd === "recorder_list") return FAKE_ITEMS;
  if (cmd === "recorder_status") return false;
  if (cmd === "recorder_level") return 0.18;
  if (cmd === "recorder_probe_mic") return { peak: 0.24, sampleRate: 48000 };
  if (cmd === "recorder_play_path") {
    const id = String((args as { id?: string } | undefined)?.id ?? "");
    return `local://C:/recordings/${id}/mix.wav`;
  }
  return baseInvoke(cmd, args);
};

/** 预览按真实骨架挂载：侧边栏 + 内容区，才能看出页面在壳里的实际观感 */
const Host = defineComponent({
  setup() {
    return () =>
      h("div", { class: "app-shell" }, [
        h(PageShellBase, { mobile: useIsMobile() }, { content: () => h(StudioView) }),
      ]);
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  // 侧边导航全部按 name 跳转：预览里补齐同名路由，否则 router-link 解析失败会
  // 把整段导航项吞掉（只剩没有路由名的项，看起来很像是「导航丢了」）
  routes: [
    ...[
      ["recommend", "/"],
      ["liked", "/liked"],
      ["history", "/history"],
      ["offline", "/offline"],
      ["studio", "/studio"],
      ["mine", "/mine"],
      ["search", "/search"],
      ["plugins", "/plugins"],
      ["settings", "/settings"],
    ].map(([name, path]) => ({
      path,
      name,
      component: { render: () => null },
    })),
    { path: "/:pathMatch(.*)*", component: { render: () => null } },
  ],
});

const pinia = createPinia();
const app = createApp(Host);
app.use(pinia);
app.use(router);
app.mount("#app");

// 注入一首「正在播放」的假歌与歌词，用来走查有伴奏时的录音台
const player = usePlayerStore(pinia);
player.queue = [
  {
    uid: "preview-1",
    track: {
      id: "preview-1",
      name: "晴天",
      artists: ["周杰伦"],
      album: "叶惠美",
      duration: 269_000,
      sourceId: "demo",
    },
  },
];
player.currentIndex = 0;
player.lyrics = [
  { time: 0, text: "故事的小黄花" },
  { time: 4_000, text: "从出生那年就飘着" },
  { time: 8_000, text: "童年的荡秋千" },
  { time: 12_000, text: "随记忆一直晃到现在" },
  { time: 16_000, text: "吹着前奏望着天空" },
  { time: 20_000, text: "我想起花瓣试着掉落" },
  { time: 24_000, text: "为你翘课的那一天" },
];

const recorder = useRecorderStore(pinia);
recorder.monitor = true;
recorder.monitorVolume = 68;
// 模拟「已经试过音、麦克风有信号」
recorder.probeReport = { peak: 0.24, sampleRate: 48_000 };
