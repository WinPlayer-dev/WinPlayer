<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { Slider } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { getAudioEngine } from "@/services/audio";
import {
  PLAYBACK_RATES,
  PLAY_MODE_LABEL,
  formatRate,
  formatTime,
  playModeIcon,
  playModeIconFilled,
  trackArtist,
  trackTitle,
} from "@/types/player";
import QueuePanel from "./QueuePanel.vue";
import LyricsPanel from "./LyricsPanel.vue";

const player = usePlayerStore();
const library = useLibraryStore();
const settings = useSettingsStore();
const router = useRouter();

/** 拖动进度滑块时的本地预览值（拖动结束才 seek，期间屏蔽 timeupdate 覆盖） */
const draggingSeek = ref(false);
const seekLocal = ref(0);
/** 本次指针交互是否产生过 update:Value（防止空区域按下用陈旧值 seek） */
const seekTouched = ref(false);

const seekValue = computed(() => (draggingSeek.value ? seekLocal.value : player.currentTime));
const seekTime = computed(() => formatTime(seekValue.value));
const progressMax = computed(() => (player.duration > 0 ? player.duration : 1));
const liked = computed(() => (player.currentTrack ? library.isLiked(player.currentTrack) : false));

/** 当前曲目的歌手：插件回传 artistIds 时可跳转歌手详情页，缺失则退化为纯文本 */
interface ArtistLink {
  name: string;
  target: RouteLocationRaw | null;
}

const artistCells = computed<ArtistLink[]>(() => {
  const track = player.currentTrack;
  if (!track) return [];
  const names = track.artists ?? [];
  const ids = track.artistIds ?? [];
  return names.map((name, index) => ({
    name,
    target:
      track.sourceId && ids[index]
        ? { name: "artist", params: { source: track.sourceId, id: ids[index] } }
        : null,
  }));
});

function go(target: RouteLocationRaw): void {
  void router.push(target);
}

const modeIcon = computed(() => playModeIcon(player.mode));
// F610 在 Regular 字重撞码为电源键，顺序播放时需切到 Filled 字重
const modeIconFilled = computed(() => playModeIconFilled(player.mode));

function onSeekInput(value: number): void {
  const v = Number(value);
  if (draggingSeek.value) {
    seekTouched.value = true;
    seekLocal.value = v;
  } else {
    player.seek(v); // 键盘等非指针变更：立即跳转
  }
}

/** capture 阶段先于滑块内部处理置位，拖动中的 update:Value 全部进本地预览 */
function onSeekPointerDown(): void {
  if (player.duration <= 0) return;
  draggingSeek.value = true;
  seekTouched.value = false;
}

/** 指针抬起：提交最终预览值（含点击直接跳转） */
function onSeekPointerUp(): void {
  if (!draggingSeek.value) return;
  draggingSeek.value = false;
  if (!seekTouched.value) return;
  seekTouched.value = false;
  player.seek(seekLocal.value);
}

function onSeekPointerCancel(): void {
  draggingSeek.value = false;
  seekTouched.value = false;
}

async function toggleLikeCurrent() {
  if (player.currentTrack) await library.toggleLike(player.currentTrack);
}

/** 「更多」二级菜单：一级列出不常用入口，二级展开倍速档位 / 输出设备 */
const moreView = ref<"root" | "rate" | "device" | null>(null);
const morePicker = ref<HTMLElement | null>(null);

/** 输出设备（「更多」菜单内联选择，打开二级菜单时读取） */
const DEFAULT_OUTPUT_LABEL = "系统默认";
const outputDevices = ref<string[]>([]);
const currentOutputLabel = computed(() => settings.outputDevice || DEFAULT_OUTPUT_LABEL);
const outputDeviceOptions = computed(() => [
  { value: "", label: DEFAULT_OUTPUT_LABEL },
  ...outputDevices.value.map((name) => ({ value: name, label: name })),
]);

function toggleMoreMenu(): void {
  moreView.value = moreView.value ? null : "root";
}

function pickRate(value: number): void {
  void player.setRate(value);
  moreView.value = null;
}

async function openDeviceMenu(): Promise<void> {
  moreView.value = "device";
  outputDevices.value = await getAudioEngine().listOutputDevices();
}

function pickOutputDevice(value: string): void {
  void settings.setOutputDevice(value);
  moreView.value = null;
}

/** 点击面板外部或按 Esc 关闭 */
function onDocumentPointerDown(event: PointerEvent): void {
  if (!moreView.value) return;
  const target = event.target;
  if (target instanceof Node && morePicker.value?.contains(target)) return;
  moreView.value = null;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") moreView.value = null;
}

onMounted(() => {
  window.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onDocumentKeydown);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <footer class="playerbar">
    <!-- 左：当前曲目 -->
    <div class="now-playing">
      <div class="cover">
        <CachedImage
          v-if="player.currentTrack?.cover"
          :src="player.currentTrack.cover"
          class="cover-img"
        />
        <span v-else class="wp-icon cover-placeholder">&#xE852;</span>
      </div>
      <div class="meta">
        <div class="title ellipsis">{{ player.currentTrack ? trackTitle(player.currentTrack) : "未在播放" }}</div>
        <div class="artist ellipsis">
          <template v-if="!player.currentTrack">从插件来源发现音乐</template>
          <template v-else-if="!artistCells.length">{{ trackArtist(player.currentTrack) }}</template>
          <template v-else>
            <template v-for="(artist, index) in artistCells" :key="`${artist.name}-${index}`">
              <span v-if="index" class="artist-sep"> / </span>
              <button
                v-if="artist.target"
                class="artist-link"
                :title="`查看歌手「${artist.name}」`"
                @click="go(artist.target!)"
              >
                {{ artist.name }}
              </button>
              <span v-else>{{ artist.name }}</span>
            </template>
          </template>
        </div>
      </div>
      <button
        class="wp-icon-button like-button"
        :class="{ active: liked }"
        :disabled="!player.currentTrack"
        :title="liked ? '取消喜欢' : '添加到我喜欢'"
        @click="toggleLikeCurrent"
      >
        <span class="wp-icon" :class="{ filled: liked }">{{ liked ? "&#xF47E;" : "&#xF47A;" }}</span>
      </button>
    </div>

    <!-- 中：控制与进度 -->
    <div class="controls">
      <div class="transport">
        <button
          class="wp-icon-button mode-button"
          :title="PLAY_MODE_LABEL[player.mode]"
          @click="player.cycleMode"
        >
          <span class="wp-icon" :class="{ filled: modeIconFilled }" v-html="modeIcon" />
        </button>
        <button class="wp-icon-button" title="上一首" :disabled="!player.queue.length" @click="player.prev">
          <span class="wp-icon filled">&#xF633;</span>
        </button>
        <button
          class="play-button"
          :title="player.playing ? '暂停' : '播放'"
          :disabled="!player.queue.length && !player.currentTrack"
          @click="player.togglePlay"
        >
          <span v-if="player.loading" class="wp-icon">&#xF709;</span>
          <span v-else class="wp-icon filled">{{ player.playing ? "&#xF5AC;" : "&#xF610;" }}</span>
        </button>
        <button class="wp-icon-button" title="下一首" :disabled="!player.queue.length" @click="player.next()">
          <span class="wp-icon filled">&#xF574;</span>
        </button>
        <button
          class="wp-icon-button"
          :class="{ active: player.showLyrics }"
          title="歌词"
          :disabled="!player.currentTrack"
          @click="player.showLyrics = !player.showLyrics; player.showQueue = false"
        >
          <span class="wp-icon">&#xF801;</span>
        </button>
      </div>
      <div class="seek-row">
        <span class="time">{{ seekTime }}</span>
        <div
          class="seek-slider"
          @pointerdown.capture="onSeekPointerDown"
          @pointerup="onSeekPointerUp"
          @pointercancel="onSeekPointerCancel"
        >
          <Slider
            :Value="seekValue"
            :Minimum="0"
            :Maximum="progressMax"
            :StepFrequency="0.5"
            :SmallChange="0.5"
            :LargeChange="5"
            :IsEnabled="player.duration > 0"
            :ThumbToolTipValueConverter="formatTime"
            @update:Value="onSeekInput"
          />
        </div>
        <span class="time">{{ formatTime(player.duration) }}</span>
      </div>
    </div>

    <!-- 右：音量与队列 -->
    <div class="extras">
      <button
        class="wp-icon-button"
        :class="{ active: player.showQueue }"
        title="播放队列"
        @click="player.showQueue = !player.showQueue; player.showLyrics = false"
      >
        <span class="wp-icon">&#xF4EE;</span>
      </button>
      <div ref="morePicker" class="more-picker">
        <button
          class="wp-icon-button"
          :class="{ active: player.rate !== 1 }"
          title="更多"
          @click="toggleMoreMenu"
        >
          <span class="wp-icon">&#xE825;</span>
        </button>
        <transition name="more-menu">
          <div v-if="moreView" class="more-menu">
            <template v-if="moreView === 'root'">
              <button class="more-item" @click="moreView = 'rate'">
                <span class="more-item-label">播放速度</span>
                <span class="more-item-tail">
                  <span class="more-item-value">{{ formatRate(player.rate) }}</span>
                  <span class="wp-icon more-item-chevron">&#xF2B0;</span>
                </span>
              </button>
              <button class="more-item" @click="openDeviceMenu">
                <span class="more-item-label">输出设备</span>
                <span class="more-item-tail">
                  <span class="more-item-value">{{ currentOutputLabel }}</span>
                  <span class="wp-icon more-item-chevron">&#xF2B0;</span>
                </span>
              </button>
            </template>
            <template v-else-if="moreView === 'rate'">
              <button class="more-back" @click="moreView = 'root'">
                <span class="wp-icon">&#xF2AA;</span>
                <span>播放速度</span>
              </button>
              <button
                v-for="value in PLAYBACK_RATES"
                :key="value"
                class="more-item"
                @click="pickRate(value)"
              >
                <span class="more-item-label">{{ formatRate(value) }}</span>
                <span v-if="player.rate === value" class="wp-icon more-item-check">&#xF294;</span>
              </button>
            </template>
            <template v-else>
              <button class="more-back" @click="moreView = 'root'">
                <span class="wp-icon">&#xF2AA;</span>
                <span>输出设备</span>
              </button>
              <button
                v-for="option in outputDeviceOptions"
                :key="option.value || 'default'"
                class="more-item"
                @click="pickOutputDevice(option.value)"
              >
                <span class="more-item-label">{{ option.label }}</span>
                <span
                  v-if="settings.outputDevice === option.value"
                  class="wp-icon more-item-check"
                >&#xF294;</span>
              </button>
            </template>
          </div>
        </transition>
      </div>
      <div class="volume-group">
        <button class="wp-icon-button" :title="player.muted ? '取消静音' : '静音'" @click="player.toggleMute">
          <span class="wp-icon">{{ player.muted || player.volume === 0 ? "&#xEB4B;" : "&#xEB43;" }}</span>
        </button>
        <Slider
          class="volume-slider"
          :Value="player.muted ? 0 : player.volume"
          :Minimum="0"
          :Maximum="1"
          :StepFrequency="0.01"
          :IsThumbToolTipEnabled="false"
          @update:Value="player.setVolume"
        />
      </div>
    </div>

    <QueuePanel />
    <LyricsPanel />
  </footer>
</template>

<style scoped>
.playerbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-xl);
  padding: 0 var(--space-xl);
  background: var(--wp-layer-solid);
  border-top: 1px solid var(--wp-divider);
}

/* ---------------- 左：曲目信息 ---------------- */
.now-playing {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 300px;
  min-width: 0;
}

.cover {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-card);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  font-size: 22px;
  color: var(--wp-text-tertiary);
}

.meta {
  min-width: 0;
  flex: 1;
}

.title {
  font-size: 14px;
  font-weight: 600;
}

.artist {
  font-size: 12px;
  color: var(--wp-text-secondary);
  margin-top: 2px;
}

.artist-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 3px;
}

.artist-link:hover {
  color: var(--wp-text-primary);
  text-decoration: underline;
}

.artist-sep {
  color: var(--wp-text-tertiary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.like-button {
  flex: none;
  width: 32px;
  height: 32px;
}

/* ---------------- 中：控制区 ---------------- */
.controls {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 640px;
  margin: 0 auto;
}

.transport {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.mode-button {
  width: 32px;
  height: 32px;
  font-size: 15px;
}

.play-button {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: var(--wp-accent);
  color: var(--wp-text-on-accent);
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin: 0 var(--space-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}

.play-button:hover {
  background: var(--wp-accent-hover);
}

.play-button:active {
  background: var(--wp-accent-active);
}

.play-button:disabled {
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-disabled);
  cursor: default;
}

.seek-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
}

.time {
  font-size: 11px;
  color: var(--wp-text-secondary);
  font-variant-numeric: tabular-nums;
  width: 40px;
  text-align: center;
  flex: none;
}

.seek-slider {
  flex: 1;
  min-width: 0;
}

/* ---------------- 右：音量/队列 ---------------- */
.extras {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 300px;
  justify-content: flex-end;
  flex: none;
}

/* 「更多」二级菜单：图标按钮 + 锚定上方的浮出面板 */
.more-picker {
  position: relative;
  display: flex;
  align-items: center;
}

.more-picker .wp-icon {
  font-size: 16px;
}

.more-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  min-width: 152px;
  max-width: 280px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--wp-flyout);
  border: 1px solid var(--wp-flyout-stroke);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-flyout);
}

.more-item,
.more-back {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.more-item:hover,
.more-back:hover {
  background: var(--wp-control-fill-secondary);
}

.more-item:active,
.more-back:active {
  background: var(--wp-control-fill-tertiary);
}

.more-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.more-item-tail {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--wp-text-secondary);
}

.more-item-value {
  font-variant-numeric: tabular-nums;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more-item-chevron,
.more-back .wp-icon {
  font-size: 12px;
}

.more-item-check {
  font-size: 14px;
  color: var(--wp-accent);
}

.more-menu-enter-active,
.more-menu-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.more-menu-enter-from,
.more-menu-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.volume-group {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

/* 提高权重覆盖 Slider 默认的 width:100%（音量条固定 96px） */
.volume-group .volume-slider {
  width: 96px;
}
</style>
