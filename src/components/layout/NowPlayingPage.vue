<script setup lang="ts">
/**
 * 桌面端「正在播放」沉浸页（全窗口覆盖层）。
 *
 * 由播放条左侧的封面 / 曲名点击进入（`player.showLyrics = true`），也可以从
 * 「歌词」按钮进入；Esc 或左上角箭头收起。
 *
 * 版式：左侧大封面 + 曲名歌手 + 进度 + 传输控制，右侧大字号歌词滚动。
 * 配色刻意不跟随主题：始终深底浅字，模糊封面作背景，保证歌词可读性
 * （与手机全屏页同一套观感）。
 *
 * 歌词外观由设置里的「歌词样式」驱动，与手机端共用一份配置；
 * 配置里的字号是手机基准值，这里按 `DESKTOP_FONT_SCALE` 等比放大。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CachedImage from "@/components/common/CachedImage.vue";
import WpIconButton from "@/components/theme/WpIconButton.vue";
import { useLyricLines } from "@/composables/useLyricLines";
import { DESKTOP_LYRIC_FONT_SCALE } from "@/services/lyricStyle";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import {
  PLAY_MODE_LABEL,
  formatTime,
  playModeIcon,
  playModeIconFilled,
  trackArtist,
  trackTitle,
} from "@/types/player";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const player = usePlayerStore();
const library = useLibraryStore();
const settings = useSettingsStore();
const router = useRouter();

/**
 * 桌面字号基准：配置里的 12–30px 是手机基准（412px 宽屏下的观感），
 * 直接拿到 1600px 宽的窗口里会又小又稀，所以整体放大一档。
 * 设置页的实时预览用同一个系数，保证「预览 = 实际」。
 */
const listRef = ref<HTMLElement | null>(null);

const { lyricRows, coverOnly, lineLevel, lyricVars, lyricClasses, seekToLine } = useLyricLines({
  container: listRef,
  isActive: () => true,
  // 桌面歌词视口更高，模糊层级跨度同步放大，避免外侧行「没模糊却已很淡」
  focusSpan: 12,
  fontScale: DESKTOP_LYRIC_FONT_SCALE,
});

/* ------------------------------ 曲目信息 ------------------------------ */

const track = computed(() => player.displayTrack);

const title = computed(() => (track.value ? trackTitle(track.value) : t("layout.playerBar.notPlaying")));
const artistText = computed(() => (track.value ? trackArtist(track.value) : ""));
const albumText = computed(() => track.value?.album ?? "");

/** 歌手：插件回传 artistIds 时可点进歌手详情页，否则退化为纯文本 */
interface ArtistLink {
  name: string;
  target: RouteLocationRaw | null;
}

const artistLinks = computed<ArtistLink[]>(() => {
  const current = track.value;
  if (!current) return [];
  const names = current.artists ?? [];
  const ids = current.artistIds ?? [];
  const sourceId = current.artistSourceId ?? current.sourceId;
  return names.map((name, index) => ({
    name,
    target:
      sourceId && ids[index] ? { name: "artist", params: { source: sourceId, id: ids[index] } } : null,
  }));
});

const liked = computed(() => (player.currentTrack ? library.isLiked(player.currentTrack) : false));

async function toggleLike(): Promise<void> {
  if (player.currentTrack) await library.toggleLike(player.currentTrack);
}

/* ------------------------------ 进度条 ------------------------------ */

const progressPercent = computed(() =>
  player.duration > 0 ? Math.min(100, (player.currentTime / player.duration) * 100) : 0,
);

const seekRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragPercent = ref(0);

const shownPercent = computed(() => (dragging.value ? dragPercent.value : progressPercent.value));
const shownTime = computed(() =>
  dragging.value
    ? formatTime((player.duration * dragPercent.value) / 100)
    : formatTime(player.currentTime),
);

function percentOf(el: HTMLElement | null, event: PointerEvent): number {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
}

function onSeekDown(event: PointerEvent): void {
  if (player.duration <= 0) return;
  dragging.value = true;
  dragPercent.value = percentOf(seekRef.value, event);
  try {
    seekRef.value?.setPointerCapture(event.pointerId);
  } catch {
    /* 合成事件没有有效 pointerId，忽略即可，仍可在轨道内拖动 */
  }
}

function onSeekMove(event: PointerEvent): void {
  if (!dragging.value) return;
  dragPercent.value = percentOf(seekRef.value, event);
}

function onSeekUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  player.seek((player.duration * percentOf(seekRef.value, event)) / 100);
}

/* ------------------------------ 音量 ------------------------------ */

const volumeRef = ref<HTMLElement | null>(null);
const draggingVolume = ref(false);
const dragVolume = ref(0);

const shownVolume = computed(() =>
  draggingVolume.value ? dragVolume.value : player.muted ? 0 : player.volume * 100,
);

function onVolumeDown(event: PointerEvent): void {
  draggingVolume.value = true;
  dragVolume.value = percentOf(volumeRef.value, event);
  try {
    volumeRef.value?.setPointerCapture(event.pointerId);
  } catch {
    /* 同上 */
  }
}

function onVolumeMove(event: PointerEvent): void {
  if (!draggingVolume.value) return;
  dragVolume.value = percentOf(volumeRef.value, event);
}

function onVolumeUp(event: PointerEvent): void {
  if (!draggingVolume.value) return;
  draggingVolume.value = false;
  player.setVolume(percentOf(volumeRef.value, event) / 100);
}

const volumeIcon = computed(() => (player.muted || player.volume === 0 ? "\uEB4B" : "\uEB43"));

/* ------------------------------ 模式 / 关闭 ------------------------------ */

const modeIcon = computed(() => playModeIcon(player.mode));
// F610 在 Regular 字重撞码为电源键，顺序播放时需切到 Filled 字重
const modeIconFilled = computed(() => playModeIconFilled(player.mode));
const modeLabel = computed(() => PLAY_MODE_LABEL[player.mode]);

function close(): void {
  player.showLyrics = false;
}

/** 队列面板挂在播放条上，这里先收起页面再打开它 */
function openQueue(): void {
  player.showLyrics = false;
  player.showQueue = true;
}

/**
 * 歌词样式：跳到设置页对应分组。先收起本页 —— 否则从设置返回时
 * 沉浸页会盖在设置页上方，看着像没跳过去。
 */
function openLyricStyle(): void {
  player.showLyrics = false;
  void router.push({
    name: "settings",
    query: { tab: "appearance", focus: "appearance.lyrics.fontSize" },
  });
}

function toggleDesktopLyrics(): void {
  void settings.setDesktopLyricsEnabled(!settings.desktopLyricsEnabled);
}

function go(target: RouteLocationRaw): void {
  player.showLyrics = false;
  void router.push(target);
}

/* ------------------------------ 窗口控制 ------------------------------ */

/**
 * 本页盖住了自绘标题栏，所以得自己提供拖拽区与最小化 / 最大化 / 关闭。
 * 非 Tauri 环境（预览页）下 `getCurrentWindow()` 会抛错，吞掉即可。
 */
const appWindow = (() => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
})();

const maximized = ref(false);
let unlistenResize: (() => void) | null = null;

async function toggleMaximize(): Promise<void> {
  try {
    await appWindow?.toggleMaximize();
  } catch {
    /* 预览环境无窗口，忽略 */
  }
}

/* ------------------------------ 键盘 ------------------------------ */

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  if (!appWindow) return;
  try {
    maximized.value = await appWindow.isMaximized();
    unlistenResize = await appWindow.onResized(() => {
      void appWindow.isMaximized().then((value) => (maximized.value = value));
    });
  } catch {
    /* 同上 */
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  unlistenResize?.();
});
</script>

<template>
  <div class="np" :class="{ 'is-cover-only': coverOnly }">
    <!-- 背景：封面高斯模糊铺满 + 暗色遮罩（与手机全屏页同一套观感） -->
    <div class="np-bg" aria-hidden="true">
      <CachedImage v-if="track?.cover" :src="track.cover" class="np-bg-img" />
    </div>
    <div class="np-scrim" aria-hidden="true" />

    <header class="np-header">
      <!-- 本页盖住了应用标题栏，这里自己提供拖拽区（在底层，不挡按钮）；
           双击顶栏切换最大化，与系统标题栏习惯一致 -->
      <div class="np-drag" data-tauri-drag-region @dblclick="toggleMaximize" />

      <div class="np-head-left">
        <button class="np-icon" :title="t('layout.nowPlaying.collapseWithEsc')" @click="close">
          <span class="wp-icon">&#xF2AB;</span>
        </button>
        <span class="np-header-title">{{ t("layout.nowPlaying.title") }}</span>
      </div>

      <div class="np-tools">
        <button
          class="np-icon"
          :class="{ on: settings.desktopLyricsEnabled }"
          :title="settings.desktopLyricsEnabled ? t('layout.playerBar.desktopLyricsDisable') : t('layout.playerBar.desktopLyrics')"
          @click="toggleDesktopLyrics"
        >
          <span class="wp-icon">&#xEE5E;</span>
        </button>
        <button class="np-icon" :title="t('layout.playerBar.lyricsStyle')" @click="openLyricStyle">
          <span class="wp-icon np-icon-glyph">Aa</span>
        </button>
        <button class="np-icon" :title="t('layout.playerBar.queue')" @click="openQueue">
          <span class="wp-icon">&#xF4EE;</span>
        </button>

        <span class="np-tools-divider" aria-hidden="true" />

        <button class="np-caption" :title="t('layout.titleBar.minimize')" @click="appWindow?.minimize()">
          <span class="wp-icon">&#xEBCF;</span>
        </button>
        <button
          class="np-caption"
          :title="maximized ? t('layout.titleBar.restore') : t('layout.titleBar.maximize')"
          @click="toggleMaximize"
        >
          <span class="wp-icon">{{ maximized ? "&#xEB95;" : "&#xF533;" }}</span>
        </button>
        <button class="np-caption close" :title="t('common.action.close')" @click="appWindow?.close()">
          <span class="wp-icon">&#xF368;</span>
        </button>
      </div>
    </header>

    <div class="np-body">
      <!-- 左：封面与控制 -->
      <section class="np-left">
        <div class="np-cover">
          <CachedImage v-if="track?.cover" :src="track.cover" class="np-cover-img" />
          <span v-else class="wp-icon np-cover-placeholder">&#xE852;</span>
        </div>

        <div class="np-meta">
          <!-- 曲名与「喜欢」同行：单独占一行的孤零零一个心形按钮太突兀 -->
          <div class="np-title-row">
            <h1 class="np-name" :title="title">{{ title }}</h1>
            <WpIconButton
              class="np-like"
              :active="liked"
              :disabled="!player.currentTrack"
              :title="liked ? t('layout.playerBar.unlike') : t('layout.playerBar.like')"
              @click="toggleLike"
            >
              <span class="wp-icon" :class="{ filled: liked }">{{ liked ? "&#xF47E;" : "&#xF47A;" }}</span>
            </WpIconButton>
          </div>
          <div class="np-artists">
            <template v-if="!artistLinks.length">{{ artistText }}</template>
            <template v-else>
              <template v-for="(artist, index) in artistLinks" :key="`${artist.name}-${index}`">
                <span v-if="index" class="np-artist-sep"> / </span>
                <button
                  v-if="artist.target"
                  class="np-artist-link"
                  :title="t('layout.playerBar.viewArtist', { name: artist.name })"
                  @click="go(artist.target!)"
                >
                  {{ artist.name }}
                </button>
                <span v-else>{{ artist.name }}</span>
              </template>
            </template>
          </div>
          <div v-if="albumText" class="np-album" :title="albumText">{{ albumText }}</div>
        </div>

        <!-- 进度：时间放在轨道下方两端，轨道本身撑满整宽，左右边界与封面严格对齐 -->
        <div class="np-progress">
          <div
            ref="seekRef"
            class="np-track"
            @pointerdown="onSeekDown"
            @pointermove="onSeekMove"
            @pointerup="onSeekUp"
            @pointercancel="onSeekUp"
          >
            <div class="np-track-fill" :style="{ transform: `scaleX(${shownPercent / 100})` }" />
            <div class="np-track-thumb" :class="{ dragging }" :style="{ left: `${shownPercent}%` }" />
          </div>
          <div class="np-times">
            <span class="np-time">{{ shownTime }}</span>
            <span class="np-time">{{ formatTime(player.duration) }}</span>
          </div>
        </div>

        <!-- 传输控制 -->
        <div class="np-transport">
          <WpIconButton :title="modeLabel" class="np-transport-button" @click="player.cycleMode">
            <span class="wp-icon" :class="{ filled: modeIconFilled }" v-html="modeIcon" />
          </WpIconButton>
          <WpIconButton
            class="np-transport-button"
            :title="t('common.action.previous')"
            :disabled="!player.queue.length"
            @click="player.prev"
          >
            <span class="wp-icon filled">&#xF633;</span>
          </WpIconButton>
          <button
            class="np-play"
            :title="player.playing ? t('common.action.pause') : t('common.action.play')"
            :disabled="!player.queue.length && !player.currentTrack"
            @click="player.togglePlay"
          >
            <span v-if="player.loading" class="wp-icon">&#xF709;</span>
            <span v-else-if="player.playing" class="wp-icon filled">&#xF5AC;</span>
            <span v-else class="wp-icon filled">&#xF610;</span>
          </button>
          <WpIconButton
            class="np-transport-button"
            :title="t('common.action.next')"
            :disabled="!player.queue.length"
            @click="player.next()"
          >
            <span class="wp-icon filled">&#xF574;</span>
          </WpIconButton>
        </div>

        <!-- 音量 -->
        <div class="np-volume">
          <button class="np-icon np-mute" :title="player.muted ? t('layout.playerBar.unmute') : t('layout.playerBar.mute')" @click="player.toggleMute">
            <span class="wp-icon">{{ volumeIcon }}</span>
          </button>
          <div
            ref="volumeRef"
            class="np-track np-volume-track"
            @pointerdown="onVolumeDown"
            @pointermove="onVolumeMove"
            @pointerup="onVolumeUp"
            @pointercancel="onVolumeUp"
          >
            <div class="np-track-fill" :style="{ transform: `scaleX(${shownVolume / 100})` }" />
            <div
              class="np-track-thumb"
              :class="{ dragging: draggingVolume }"
              :style="{ left: `${shownVolume}%` }"
            />
          </div>
        </div>
      </section>

      <!-- 右：歌词（样式来自设置 → 外观 → 歌词样式） -->
      <section class="np-right">
        <div ref="listRef" class="np-lyrics wp-lrc" :class="lyricClasses" :style="lyricVars">
          <div v-if="player.lyricsLoading" class="np-lyrics-empty">{{ t("player.lyrics.loading") }}</div>
          <div v-else-if="!lyricRows.length" class="np-lyrics-empty">{{ t("player.lyrics.empty") }}</div>
          <template v-else>
            <p
              v-for="(line, index) in lyricRows"
              :key="index"
              class="wp-lrc-line"
              :class="`level-${lineLevel(index)}`"
              @click="seekToLine(index)"
            >
              <span class="wp-lrc-text">{{ line.text }}</span>
              <span
                v-if="line.translation && settings.lyricsStyle.showTranslation"
                class="wp-lrc-translation"
              >{{ line.translation }}</span>
            </p>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.np {
  position: fixed;
  /* 整窗覆盖：连自绘标题栏一起盖掉（本页自带拖拽区与窗口按钮）。
     层级要高于标题栏（40）与播放条（30）；本组件额外 Teleport 到 body，
     否则会被播放条自身的层叠上下文锁在 30 层。 */
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 沉浸式配色不随主题变化：始终深底浅字，保证模糊背景上的可读性 */
  background: #0b0b10;
  color: #fff;

  /**
   * 左栏宽度 = 封面边长。取 min(30vw, 42vh)：横屏时由宽度决定，
   * 矮窗口由高度决定，保证「封面 + 信息 + 控制」整块永远塞得下，
   * 且封面正好撑满左栏（不会出现左对齐、右侧留一条缝）。
   */
  --np-cover-size: clamp(200px, min(30vw, 44vh), 460px);
}

/* ---------------- 背景 ---------------- */

.np-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.np-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 放大后模糊，避免边缘透出底色 */
  transform: scale(1.35);
  filter: blur(48px) saturate(1.6) brightness(0.55);
  /* 打开页面时背景从更糊、更暗的状态「化开」，和整页淡入同步 */
  animation: np-bg-in 720ms cubic-bezier(0.33, 0, 0.15, 1) both;
}

@keyframes np-bg-in {
  from {
    transform: scale(1.55);
    filter: blur(96px) saturate(1.5) brightness(0.4);
  }
}

.np-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.5) 70%),
    linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.35) 0%,
      rgba(0, 0, 0, 0.6) 55%,
      rgba(0, 0, 0, 0.78) 100%
    );
}

/* ---------------- 顶部 ---------------- */

.np-header {
  position: relative;
  z-index: 2;
  flex: none;
  height: var(--titlebar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 0 var(--space-sm) 0 var(--space-lg);
}

/* 拖拽层铺满整条顶栏，压在按钮下面（按钮位于更高层） */
.np-drag {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.np-head-left {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.np-header-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
}

.np-tools {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.np-tools-divider {
  width: 1px;
  height: 16px;
  margin: 0 var(--space-xs);
  background: rgba(255, 255, 255, 0.16);
}

.np-icon {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 15px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.np-icon:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.np-icon.on {
  color: var(--wp-accent);
}

/* 窗口控制：比功能按钮更收敛，悬停关闭按钮才用系统的红 */
.np-caption {
  flex: none;
  width: 34px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgba(255, 255, 255, 0.58);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.np-caption:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.np-caption.close:hover {
  background: #c42b1c;
  color: #fff;
}

/* 字体图标字体里没有「Aa」，用界面字体画出来 */
.np-icon-glyph {
  font-family: var(--wp-font, inherit);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* ---------------- 主体 ---------------- */

.np-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  /* 左栏整块在剩余高度里垂直居中：上下留白对称，不会出现「封面贴顶、
     控制贴底、中间一大片空」的断层。上下内边距必须相等，否则居中点
     会比歌词区中心偏上。 */
  align-items: center;
  gap: clamp(32px, 4vw, 72px);
  padding: clamp(12px, 2vh, 30px) clamp(32px, 4vw, 72px);
}

/* ---------------- 左栏 ---------------- */

.np-left {
  flex: none;
  width: var(--np-cover-size);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  /* 各段间距由下面的 margin 精确控制（gap 会让「块间」与「组内」无法区分） */
  gap: 0;
  /* 入场：从左栏底部托上来，比右栏早 60ms */
  animation: np-rise 500ms cubic-bezier(0.33, 0, 0.15, 1) 60ms both;
}

@keyframes np-rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}

.np-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-cover-placeholder {
  font-size: 64px;
  color: rgba(255, 255, 255, 0.24);
}

.np-meta {
  width: 100%;
  min-width: 0;
  margin-top: 20px;
}

.np-name {
  /* 与「喜欢」同行：曲名按内容宽度，长曲名时收缩省略，心形紧贴在曲名后面
     （不让它被 space-between 推到右边缘、在空白里显得孤零零） */
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-title-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.np-artists,
.np-album {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-artist-link {
  border: none;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.np-artist-link:hover {
  color: #fff;
  text-decoration: underline;
}

.np-like {
  flex: none;
  --wp-icon-button-size: 32px;
  /* 按钮定宽、图标居中，往左推回一点让心形贴着曲名 */
  margin-left: -3px;
}

/* ---------------- 进度 / 音量 ---------------- */

.np-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 18px;
}

/* 时间在轨道下方两端：轨道不再被左右文字挤窄，能与封面同宽 */
.np-times {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.np-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.58);
  flex: none;
}

.np-track {
  position: relative;
  /* 高度写死：进度轨道在纵向 flex 里被拉伸会塌成 0，宽度由容器 stretch 撑满 */
  height: 20px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}

/* 轨道本体用伪元素画，命中区仍是 20px 高（好点） */
.np-track::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.22);
}

.np-track-fill {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 2px;
  background: #fff;
  transform-origin: left center;
  pointer-events: none;
}

.np-track-thumb {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: #fff;
  transform: translateY(-50%) scale(0);
  transition: transform var(--duration-fast) var(--ease-standard);
  pointer-events: none;
}

.np-track:hover .np-track-thumb,
.np-track-thumb.dragging {
  transform: translateY(-50%) scale(1);
}

.np-volume {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: 10px;
}

.np-mute {
  width: 28px;
  height: 28px;
  font-size: 14px;
}

.np-volume-track {
  /* 与进度条同宽：两条轨道左右边界一致，整块看起来才是对齐的 */
  flex: 1;
  max-width: none;
}

/* ---------------- 传输控制 ---------------- */

.np-transport {
  width: 100%;
  display: flex;
  align-items: center;
  /* 控制组以封面中线居中，与上下两条满宽轨道形成轴对称 */
  justify-content: center;
  gap: var(--space-md);
  margin-top: 14px;
}

.np-transport-button {
  color: rgba(255, 255, 255, 0.82);
}

.np-play {
  width: 52px;
  height: 52px;
  flex: none;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: #101014;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.np-play:hover:not(:disabled) {
  transform: scale(1.06);
}

.np-play:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---------------- 右栏：歌词 ---------------- */

.np-right {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  /* 左栏用 align-items: center 居中，右栏要自己拉满高度才能滚动 */
  align-self: stretch;
  /* 入场比左栏晚一拍，形成层次 */
  animation: np-rise 620ms cubic-bezier(0.33, 0, 0.15, 1) 140ms both;
}

.np-lyrics {
  position: relative;
  flex: 1;
  /* 首尾留白要够大，当前行才能被滚到「靠上 30%」或「靠下 72%」；
     只留 24vh 的话靠下模式会顶到最后一个可滚位置、差出一截。
     左右不设内边距：横向留白统一由 `.np-body` 的 padding / gap 控制，
     否则和歌词自己的 padding 叠在一起，右侧会比左侧多出一截看起来不对称。 */
  padding: 40vh 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.np-lyrics::-webkit-scrollbar {
  display: none;
}

.np-lyrics-empty {
  /* 空状态居中：容器有 40vh 内边距，跟着内容排会跑到画面下部 */
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
}

/**
 * 桌面歌词行左右留白更宽，避免长句贴边；靠左对齐时由下面的规则覆盖。
 *
 * 所有层级必须同宽，包括当前行 —— `lyrics-style.css` 里给非当前行留的
 * 折行宽度是「本级宽度的 1 / 放大倍数」（口径见 `.wp-lrc-text` 的 max-width），
 * 一旦当前行单独放宽（以前写过 94%），等比关系就破了：临界长度的长句会
 * 出现「没播放时折三行、播放时折两行」，切换当前行时整页歌词被上下顶开。
 */
.np-lyrics .wp-lrc-line {
  max-width: 88%;
}

/**
 * 靠左对齐时长句要能顶到容器的左右边缘（否则右端会多出一截 12% 的空白，
 * 和左边的留白明显不对称）。
 *
 * 必须写完整的三段选择器：`lyrics-style.css` 里的 `.wp-lrc.align-left .wp-lrc-line`
 * 与 scoped 的 `.np-lyrics .wp-lrc-line[data-v]` 特异性都是 (0,3,0)，谁后加载谁赢，
 * 靠 `.align-left` 单独那条并不可靠。
 */
.np-lyrics.align-left .wp-lrc-line,
.np-lyrics.align-left .wp-lrc-line.level-0 {
  max-width: 100%;
}

/* ---------------- 无歌词：封面居中 ---------------- */
/**
 * 纯音乐 / 没有歌词的曲目不再保留「左封面 + 右空栏」的半边空荡版式，
 * 而是整块居中：歌词区与右栏一起让位，封面成为唯一主角。
 * 判定（含切歌空窗期不抖动）在 `useLyricLines` 的 `coverOnly` 里，与手机端共用。
 */
.np.is-cover-only .np-body {
  justify-content: center;
  gap: 0;
}

.np.is-cover-only .np-right {
  display: none;
}

.np.is-cover-only .np-left {
  /* 没有歌词时封面可以吃得更大：宽高双向自适应，矮窗自动收 */
  width: clamp(220px, min(40vw, 52vh), 500px);
  align-items: center;
  /* 从「有歌词」切到纯封面时换一段入场，避免左栏瞬间从左边跳到中间 */
  animation: np-cover-in 380ms cubic-bezier(0.33, 0, 0.15, 1) both;
}

@keyframes np-cover-in {
  from {
    opacity: 0.4;
    transform: scale(0.97);
  }
}

.np.is-cover-only .np-meta {
  text-align: center;
}

/* 曲名与心形作为一个整体居中（不是把心形推到右边缘） */
.np.is-cover-only .np-title-row {
  justify-content: center;
}

.np.is-cover-only .np-name {
  flex: 0 1 auto;
}

/* ---------------- 窄窗口 ---------------- */

@media (max-width: 980px) {
  .np {
    --np-cover-size: clamp(180px, min(30vw, 38vh), 300px);
  }

  .np-body {
    gap: var(--space-xl);
    padding: 0 var(--space-xl) var(--space-lg);
  }

  .np-name {
    font-size: 20px;
  }

  .np-lyrics {
    padding: 40vh 0;
  }
}

/* ---------------- 矮窗口 ---------------- */
/* 窗口压到 720 高以下时，左栏「封面 + 信息 + 控制」会顶到边，收一收封面并砍掉专辑行 */
@media (max-height: 720px) {
  .np {
    --np-cover-size: clamp(160px, min(28vw, 34vh), 280px);
  }

  .np-left {
    gap: var(--space-sm);
  }

  .np-album {
    display: none;
  }

  .np-name {
    font-size: 20px;
  }
}
</style>
