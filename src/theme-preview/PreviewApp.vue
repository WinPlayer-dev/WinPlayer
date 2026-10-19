<script setup lang="ts">
/**
 * 主题渲染预览：在浏览器里真实挂载主题组件，便于排查渲染与交互问题。
 *
 * 左侧是主题的 PageShell（含 SideNav / PlayerBar），右侧是控制面板：
 * 可切换深浅色、重新编译主题、重新挂载，用来复现「点几次就失效」这类问题。
 * 主题的装载逻辑统一走 ./harness（与生产同一套编译管线）。
 */
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePlayerStore } from "@/stores/player";
import PageShellBase from "@/components/layout/PageShell.vue";
import ThemeBackgroundBase from "@/components/theme/ThemeBackgroundBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";
import ControlProbe from "./ControlProbe.vue";
import { mountBuiltinTheme } from "./harness";

const route = useRoute();
const router = useRouter();

const errors = ref<string[]>([]);
const loading = ref(true);
const remountKey = ref(0);
const log = ref<string[]>([]);

function note(message: string): void {
  log.value = [`${new Date().toLocaleTimeString()} ${message}`, ...log.value].slice(0, 40);
}

/** 实际使用的骨架 / 背景：与 App.vue 同一套 themeSlot（含错误边界） */
const ThemedShell = themeSlot("PageShell", PageShellBase);
const ThemedBackground = themeSlot("Background", ThemeBackgroundBase);

async function mountTheme(): Promise<void> {
  loading.value = true;
  errors.value = [];
  try {
    errors.value = await mountBuiltinTheme();
    for (const line of errors.value) note(line);
    if (!errors.value.length) note("主题装载完成");
    remountKey.value += 1;
  } catch (error) {
    errors.value.push(String(error));
    note(`初始化失败：${error}`);
  } finally {
    loading.value = false;
  }
}

function toggleThemeMode(): void {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
}

function navigate(path: string): void {
  void router.push(path);
}

onMounted(() => {
  seedPlayerState();
  void mountTheme();
});

/**
 * 造一条假曲目 + 歌词，让播放条与「队列 / 歌词」面板有真实内容可渲染
 * （预览页不连后端，播放引擎不会真的启动）。
 */
function seedPlayerState(): void {
  const player = usePlayerStore();
  player.queue = [
    {
      uid: "preview-1",
      track: {
        id: "preview",
        name: "Theme Preview Track",
        artists: ["WinPlayer"],
        album: "Preview",
        duration: 213000,
        cover: "",
      },
    },
  ];
  player.currentIndex = 0;
  player.currentTime = 42;
  player.duration = 213;
  player.lyrics = [
    { time: 0, text: "预览歌词第一行" },
    { time: 5000, text: "预览歌词第二行" },
    { time: 12000, text: "预览歌词第三行" },
  ];
}

// 运行时错误也要进日志，便于定位
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => note(`error: ${event.message}`));
  window.addEventListener("unhandledrejection", (event) =>
    note(`unhandled: ${String(event.reason)}`),
  );
}
</script>

<template>
  <div class="preview-root">
    <div class="stage app-shell">
      <ThemedBackground />
      <ThemedShell :key="remountKey" :mobile="false">
        <template #content>
          <div class="placeholder">
            <h2>当前路由：{{ route.name }}</h2>
            <p>点击左侧导航多次，检查是否仍然可点。</p>
          </div>
        </template>
      </ThemedShell>
    </div>

    <aside class="panel">
      <h3>主题预览控制</h3>
      <p v-if="loading">加载中…</p>
      <p v-if="errors.length" class="errors">
        <strong>编译错误：</strong>
        <span v-for="(error, index) in errors" :key="index">{{ error }}</span>
      </p>

      <div class="actions">
        <button @click="toggleThemeMode">切换深浅</button>
        <button @click="remountKey += 1">重新挂载</button>
        <button @click="mountTheme">重新编译</button>
      </div>

      <div class="navs">
        <button
          v-for="path in ['/', '/liked', '/mine', '/search', '/offline', '/plugins', '/settings']"
          :key="path"
          @click="navigate(path)"
        >
          {{ path }}
        </button>
      </div>

      <h4>控件可用性探针</h4>
      <ControlProbe />

      <h4>日志</h4>
      <ul class="log">
        <li v-for="(line, index) in log" :key="index">{{ line }}</li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.preview-root {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* 与 App.vue 的 .app-shell 对齐：提供背景层所需的层叠上下文与定位 */
.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  isolation: isolate;
  background: var(--wp-base);
}

.placeholder {
  padding: 32px;
}

.panel {
  width: 340px;
  flex: none;
  padding: 16px;
  overflow-y: auto;
  border-left: 1px solid var(--wp-divider);
  background: var(--wp-layer-solid);
  font-size: 12px;
}

.panel h3 {
  margin: 0 0 12px;
  font-size: 14px;
}

.panel h4 {
  margin: 16px 0 8px;
  font-size: 12px;
}

.actions,
.navs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.actions button,
.navs button {
  padding: 4px 8px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: 4px;
  background: var(--wp-control-fill);
  color: var(--wp-text-primary);
  cursor: pointer;
  font-size: 11px;
}

.errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--wp-danger);
  word-break: break-word;
}

.log {
  margin: 0;
  padding-left: 16px;
  color: var(--wp-text-secondary);
  word-break: break-word;
}
</style>
