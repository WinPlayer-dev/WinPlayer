<script setup lang="ts">
/**
 * 桌面歌词窗口的根组件。
 *
 * 独立窗口 + 独立入口（`desktopLyricsMain.ts`），不接 Pinia / 路由：
 * 所有状态都由主窗口通过 `desktop-lyrics:state` 事件推过来，这里只做渲染。
 *
 * 两种外观（设置里可切）：
 * - `plain`：无底色，白字 + 多层投影描边，压在任意壁纸/窗口上都看得清；
 * - `glass`（界面上叫「歌曲卡片」）：固定宽度的卡片，顶部是歌曲信息，
 *   底色是当前封面的模糊放大图，歌词左对齐。
 *
 * 注意：这是 `transparent: true` 的窗口，**不要用 box-shadow**——投影会撞到
 * 窗口边界被硬裁，在桌面上看起来就是「歌词周围一圈奇怪的阴影方框」。
 */

import { computed, onMounted, onUnmounted, ref } from "vue";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 与 `startResizeDragging` 入参一致（该类型没有从包里导出，本地声明一份） */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

/** 与 `services/desktopLyrics.ts` 的 DesktopLyricsState 对应（跨窗口不共享类型，故本地声明） */
interface DesktopLyricsState {
  prev: string;
  prevTranslation: string;
  text: string;
  translation: string;
  next: string;
  nextTranslation: string;
  seq: number;
  playing: boolean;
  hasLyrics: boolean;
  style: "plain" | "glass";
  fontSize: number;
  locked: boolean;
  /** 歌曲信息：给「歌曲卡片」外观用（plain 不显示） */
  title: string;
  artist: string;
  cover: string;
}

const EMPTY_STATE: DesktopLyricsState = {
  prev: "",
  prevTranslation: "",
  text: "WinPlayer",
  translation: "",
  next: "",
  nextTranslation: "",
  seq: 0,
  playing: false,
  hasLyrics: false,
  style: "plain",
  fontSize: 30,
  locked: false,
  title: "",
  artist: "",
  cover: "",
};

const state = ref<DesktopLyricsState>({ ...EMPTY_STATE });
let unlisten: UnlistenFn | null = null;
let unlistenPointer: UnlistenFn | null = null;

/**
 * 锁定后窗口是鼠标穿透的，收不到 hover 事件——游标位置由 Rust 侧轮询后推过来，
 * 这里只负责「显示工具栏」。
 */
const pointerInside = ref(false);

/** 空行用不换行空格占位：有/无上下句时整块歌词不会上下跳动 */
const NBSP = "\u00A0";
const prevText = computed(() => state.value.prev || NBSP);
const nextText = computed(() => state.value.next || NBSP);
const rootStyle = computed(() => ({ "--lrc-size": `${state.value.fontSize}px` }));

/** 卡片外观且有曲目信息时才渲染头部（本地文件也可能没有封面，只用文字） */
const isCard = computed(() => state.value.style === "glass");
const hasSong = computed(() => Boolean(state.value.title));
const cover = computed(() => state.value.cover || "");

/** 把工具栏操作回传给主窗口（播放控制 / 解锁 / 关闭都在那边执行） */
function send(command: string): void {
  void emitTo("main", "desktop-lyrics:command", command).catch(() => {});
}

/**
 * 无边框窗口没有系统缩放边框，靠铺在四周的透明手柄调
 * `startResizeDragging`——由系统接管缩放，跟拖标题栏一样跟手。
 */
const RESIZE_HANDLES: { dir: ResizeDirection; cls: string }[] = [
  { dir: "North", cls: "n" },
  { dir: "South", cls: "s" },
  { dir: "West", cls: "w" },
  { dir: "East", cls: "e" },
  { dir: "NorthWest", cls: "nw" },
  { dir: "NorthEast", cls: "ne" },
  { dir: "SouthWest", cls: "sw" },
  { dir: "SouthEast", cls: "se" },
];

function startResize(dir: ResizeDirection): void {
  void getCurrentWindow()
    .startResizeDragging(dir)
    .catch(() => {});
}

onMounted(async () => {
  // 浏览器里（主题预览 / 视觉走查）没有 Tauri 事件通道：用注入的假状态渲染
  if (!("__TAURI_INTERNALS__" in window)) {
    const preview = (window as { __WP_LYRICS_PREVIEW__?: Partial<DesktopLyricsState> })
      .__WP_LYRICS_PREVIEW__;
    if (preview) {
      state.value = { ...EMPTY_STATE, ...preview };
      pointerInside.value = Boolean(
        (preview as { pointerInside?: boolean }).pointerInside,
      );
    }
    return;
  }
  unlisten = await listen<DesktopLyricsState>("desktop-lyrics:state", (event) => {
    state.value = event.payload;
    // 解锁后轮询就停了，别把上一轮的悬浮态留着（否则方框一直亮着）
    if (!event.payload.locked) pointerInside.value = false;
  });
  // 锁定状态下的悬浮检测（窗口本身收不到 hover，位置由 Rust 轮询后推上来）
  unlistenPointer = await listen<{ inside: boolean }>("desktop-lyrics:pointer", (event) => {
    pointerInside.value = Boolean(event.payload?.inside);
  });
  // 主窗口收到 ready 才会推首帧：窗口加载完成前推送的事件会被丢掉
  void emitTo("main", "desktop-lyrics:ready").catch(() => {});
});

onUnmounted(() => {
  unlisten?.();
  unlistenPointer?.();
});
</script>

<template>
  <div
    class="lyrics-root"
    :class="[state.style, { locked: state.locked, pointer: pointerInside }]"
    :style="rootStyle"
    data-tauri-drag-region
  >
    <!-- 四边 + 四角的透明缩放手柄：无边框窗口没有系统边框可拖 -->
    <template v-if="!state.locked">
      <div
        v-for="handle in RESIZE_HANDLES"
        :key="handle.dir"
        class="resize-handle"
        :class="handle.cls"
        @pointerdown.stop.prevent="startResize(handle.dir)"
      ></div>
    </template>

    <div class="panel" :class="{ 'with-song': isCard && hasSong }" data-tauri-drag-region>
      <!-- 卡片底：当前封面的模糊放大图 + 压暗遮罩（没有封面时退化为半透明深底） -->
      <template v-if="isCard">
        <div class="panel-bg" data-tauri-drag-region>
          <img v-if="cover" class="cover-blur" :src="cover" alt="" />
          <div class="cover-veil"></div>
        </div>

        <header v-if="hasSong" class="song" data-tauri-drag-region>
          <img v-if="cover" class="song-cover" :src="cover" alt="" />
          <div class="song-meta">
            <p class="song-title" :title="state.title" data-tauri-drag-region>
              {{ state.title }}
            </p>
            <p class="song-artist" :title="state.artist" data-tauri-drag-region>
              {{ state.artist }}
            </p>
          </div>
        </header>
      </template>

      <div class="lines" data-tauri-drag-region>
        <div class="context" data-tauri-drag-region>
          <p class="line prev" data-tauri-drag-region>{{ prevText }}</p>
          <p v-if="state.prevTranslation" class="line sub" data-tauri-drag-region>
            {{ state.prevTranslation }}
          </p>
        </div>

        <div class="current" data-tauri-drag-region>
          <transition name="swap">
            <p class="line main" :key="state.seq" data-tauri-drag-region>{{ state.text }}</p>
          </transition>
          <p v-if="state.translation" class="line translation" data-tauri-drag-region>
            {{ state.translation }}
          </p>
        </div>

        <div class="context" data-tauri-drag-region>
          <p class="line next" data-tauri-drag-region>{{ nextText }}</p>
          <p v-if="state.nextTranslation" class="line sub" data-tauri-drag-region>
            {{ state.nextTranslation }}
          </p>
        </div>
      </div>
    </div>

    <!-- 悬浮工具栏：顶部居中。锁定时窗口是鼠标穿透的，收不到 hover，
         只有游标进入窗口（Rust 轮询后推上来）才显示，并且只留一个解锁按钮 -->
    <div
      v-if="!state.locked || pointerInside"
      class="toolbar"
      :class="{ pinned: pointerInside }"
    >
      <button
        v-if="state.locked"
        class="tool tool-unlock"
        title="解锁（恢复鼠标操作）"
        aria-label="解锁"
        @click="send('unlock')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect
            x="5"
            y="10.4"
            width="14"
            height="9.6"
            rx="2.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M8.6 10.4V8.1a3.4 3.4 0 0 1 6.8-.9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <template v-else>
        <button
          class="tool"
          :title="state.playing ? '暂停' : '播放'"
          :aria-label="state.playing ? '暂停' : '播放'"
          @click="send('toggle-play')"
        >
          <svg v-if="state.playing" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <rect x="7" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" />
            <rect x="13.4" y="5" width="3.6" height="14" rx="1.1" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M8 5.4v13.2L19 12z" fill="currentColor" />
          </svg>
        </button>

        <button class="tool" title="锁定：鼠标穿透到下层窗口（在主窗口解锁）" aria-label="锁定" @click="send('lock')">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <rect
              x="5"
              y="10.4"
              width="14"
              height="9.6"
              rx="2.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
            />
            <path
              d="M8.6 10.4V8.1a3.4 3.4 0 0 1 6.8 0v2.3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <button class="tool tool-close" title="关闭桌面歌词" aria-label="关闭" @click="send('close')">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lyrics-root {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  /* 顶部留出工具栏的位置，其余留一点呼吸空间 */
  padding: 32px 20px 10px;
  /* 整个窗口可拖动（子元素也带 data-tauri-drag-region，按钮除外） */
  cursor: default;
}

/* 歌词区外壳：固定占满窗口内容宽度，卡片/悬浮框都长在它身上。
   内部用 flex 纵向排布，歌词超长时只压歌词，不挤压头部信息。 */
.panel {
  position: relative;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 22px;
  border-radius: 16px;
  border: 1px solid transparent;
  /* 禁止阴影：透明窗口里投影会被窗口边界硬裁成方框 */
  box-shadow: none;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.panel.with-song {
  align-items: stretch;
  justify-content: flex-start;
  padding: 14px 20px 16px;
}

/* 悬浮提示框：未锁定时鼠标进来，用半透明方框标出歌词窗的实际范围 */
.panel::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px dashed transparent;
  background: transparent;
  pointer-events: none;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.lyrics-root:hover:not(.locked) .panel::after,
.lyrics-root.pointer .panel::after {
  border-color: rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.045);
}

/* ---------------- 卡片底：封面模糊 ---------------- */

.panel-bg {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  background: rgba(16, 16, 18, 0.6);
  pointer-events: none;
}

.cover-blur {
  position: absolute;
  /* 放大后模糊，避免边缘被掏空出现暗角 */
  inset: -14%;
  width: 128%;
  height: 128%;
  object-fit: cover;
  filter: blur(26px) saturate(150%) brightness(0.72);
  transform: scale(1.06);
}

.cover-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    112deg,
    rgba(10, 10, 12, 0.66) 0%,
    rgba(10, 10, 12, 0.52) 55%,
    rgba(10, 10, 12, 0.62) 100%
  );
}

/* ---------------- 歌曲信息 ---------------- */

.song {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin-bottom: 8px;
}

.song-cover {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.song-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.song-title,
.song-artist {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-title {
  font-size: 14px;
  font-weight: 650;
  color: #ffffff;
  letter-spacing: 0.2px;
  /* 同样避开模糊投影：透明窗口里会被光栅化成灰块 */
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
}

.song-artist {
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.68);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
}

/* ---------------- 歌词 ---------------- */

.lines {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 卡片里歌词左对齐：换行时整块文字不左右跳动 */
.lyrics-root.glass .lines {
  align-items: stretch;
  /* 卡片里歌曲信息固定在顶部，歌词占满剩余空间并垂直居中 */
  flex: 1 1 auto;
}

.line {
  margin: 0;
  text-align: center;
  max-width: 100%;
  word-break: break-word;
  /* 歌词一律不可选中，避免拖动时选中出一片蓝 */
  user-select: none;
}

/* ---------------- 当前行 ---------------- */

.current {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-height: calc(var(--lrc-size) * 1.3);
}

.lyrics-root.glass .current {
  align-items: stretch;
}

.line.main {
  font-size: var(--lrc-size);
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #ffffff;
  /* 超长歌词最多两行，再多就裁掉（窗口高度固定） */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line.translation {
  margin-top: 4px;
  font-size: calc(var(--lrc-size) * 0.56);
  line-height: 1.35;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.88);
}

/* 上下文（上 / 下一句 + 它们的翻译）：整体弱化，给当前位置做参照 */
.context {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.lyrics-root.glass .context {
  align-items: stretch;
}

.line.prev,
.line.next {
  font-size: calc(var(--lrc-size) * 0.56);
  line-height: 1.4;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 上下句的翻译：比当前行的翻译更淡更小，只作上下文提示 */
.line.sub {
  margin-top: 1px;
  font-size: calc(var(--lrc-size) * 0.42);
  line-height: 1.3;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.34);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyrics-root.glass .line {
  text-align: left;
}

/* ---------------- 外观一：纯文字 + 实心描边 ---------------- */

/**
 * 描边**只能用 0 模糊的实心投影**。
 * 这个窗口是 transparent 的，WebView2 在透明表面上把带模糊半径的 text-shadow
 * 光栅化成一块实心灰矩形（看起来就是「歌词背后有个方框阴影」），
 * 所以这里用 8 个方向的硬偏移叠出描边，视觉上等于细描边，且渲染稳定。
 */
.lyrics-root.plain .line.main {
  text-shadow:
    1px 0 0 rgba(0, 0, 0, 0.9),
    -1px 0 0 rgba(0, 0, 0, 0.9),
    0 1px 0 rgba(0, 0, 0, 0.9),
    0 -1px 0 rgba(0, 0, 0, 0.9),
    1.3px 1.3px 0 rgba(0, 0, 0, 0.9),
    -1.3px 1.3px 0 rgba(0, 0, 0, 0.9),
    1.3px -1.3px 0 rgba(0, 0, 0, 0.9),
    -1.3px -1.3px 0 rgba(0, 0, 0, 0.9);
}

.lyrics-root.plain .line.translation,
.lyrics-root.plain .line.prev,
.lyrics-root.plain .line.next {
  text-shadow:
    0.8px 0 0 rgba(0, 0, 0, 0.82),
    -0.8px 0 0 rgba(0, 0, 0, 0.82),
    0 0.8px 0 rgba(0, 0, 0, 0.82),
    0 -0.8px 0 rgba(0, 0, 0, 0.82),
    0.6px 0.6px 0 rgba(0, 0, 0, 0.82),
    -0.6px 0.6px 0 rgba(0, 0, 0, 0.82),
    0.6px -0.6px 0 rgba(0, 0, 0, 0.82),
    -0.6px -0.6px 0 rgba(0, 0, 0, 0.82);
}

/* ---------------- 外观二：歌曲卡片 ---------------- */

.lyrics-root.glass .panel {
  /* 卡片占满窗口内容区：默认窗口 680×402 减去四周留白正好是 640×360，
     用户拖边框放大 / 缩小时卡片跟着变，不会留一圈空。 */
  width: 100%;
  height: 100%;
  border-color: rgba(255, 255, 255, 0.13);
  overflow: hidden;
}

.lyrics-root.glass .line.prev,
.lyrics-root.glass .line.next {
  color: rgba(255, 255, 255, 0.52);
}

/* ---------------- 换行动画 ---------------- */

/* 离场元素脱离文档流，避免和入场元素叠加把高度撑开 */
.swap-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  transition: opacity 140ms ease;
}

.swap-enter-active {
  transition:
    opacity 260ms ease,
    transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1);
}

.swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.swap-leave-to {
  opacity: 0;
}

/* ---------------- 缩放手柄 ---------------- */

/* 无边框窗口没有系统缩放边框：四周铺 6px 的透明带，按住就交给系统缩放。
   角落略大一点，便于斜向拉伸；都在歌词内容之外，不挡任何文字。 */
.resize-handle {
  position: absolute;
  z-index: 5;
  /* 手柄不能触发拖动窗口 */
  -webkit-app-region: no-drag;
}

.resize-handle.n,
.resize-handle.s {
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}

.resize-handle.w,
.resize-handle.e {
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}

.resize-handle.n {
  top: 0;
}

.resize-handle.s {
  bottom: 0;
}

.resize-handle.w {
  left: 0;
}

.resize-handle.e {
  right: 0;
}

.resize-handle.nw,
.resize-handle.ne,
.resize-handle.sw,
.resize-handle.se {
  width: 12px;
  height: 12px;
}

.resize-handle.nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.resize-handle.ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-handle.sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}

.resize-handle.se {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

/* ---------------- 悬浮工具栏（顶部居中，纯图标） ---------------- */

.toolbar {
  position: absolute;
  top: 1px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(22, 22, 24, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.12);
  opacity: 0;
  transition: opacity 160ms ease;
  /* 高于缩放手柄：工具栏压在窗口顶边的缩放带上，别让点击被当成拖边框 */
  z-index: 6;
}

.lyrics-root:hover .toolbar,
.toolbar.pinned,
.toolbar:focus-within {
  opacity: 1;
}

.tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease;
}

.tool:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

.tool:active {
  background: rgba(255, 255, 255, 0.26);
}

.tool-close:hover {
  background: #c42b1c;
  color: #ffffff;
}
</style>
