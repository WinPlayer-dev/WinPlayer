<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { Slider } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { useDownloadsStore } from "@/stores/downloads";
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
import DownloadPanel from "./DownloadPanel.vue";
import WpIconButton from "@/components/theme/WpIconButton.vue";
import { useSleepTimer } from "@/services/sleepTimer";
import { useQualityControl } from "@/services/quality";
import SleepTimerPicker from "@/components/common/SleepTimerPicker.vue";

const player = usePlayerStore();
const library = useLibraryStore();
const settings = useSettingsStore();
const downloads = useDownloadsStore();
const router = useRouter();

/** 拖动进度滑块时的本地预览值（拖动结束才 seek，期间屏蔽 timeupdate 覆盖） */
const draggingSeek = ref(false);
const seekLocal = ref(0);
/** 本次指针交互是否产生过 update:Value（防止空区域按下用陈旧值 seek） */
const seekTouched = ref(false);

/* ------------------------------ 进度条悬停预览 ------------------------------ */

/** 进度条容器（用于把鼠标位置换算成时间） */
const seekAreaRef = ref<HTMLElement | null>(null);
/** 悬停位置对应的时间（秒）；null 表示指针不在进度条上 */
const hoverTime = ref<number | null>(null);
/** 悬停气泡的横向百分比（0~100，已夹在两端留白内） */
const hoverPercent = ref(0);

/** 把指针横坐标换算成进度条上的时间并更新气泡位置 */
function updateHover(event: PointerEvent): void {
  const el = seekAreaRef.value;
  if (!el || player.duration <= 0) {
    hoverTime.value = null;
    return;
  }
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  hoverTime.value = ratio * player.duration;
  hoverPercent.value = ratio * 100;
}

function onSeekHover(event: PointerEvent): void {
  // 拖动中不显示悬停气泡（此时有滑块自带的数值气泡）
  if (draggingSeek.value) {
    hoverTime.value = null;
    return;
  }
  updateHover(event);
}

function onSeekLeave(): void {
  hoverTime.value = null;
}

/** A 点 / B 点在进度条上的位置（百分比），未打点时为空 */
const abMarkA = computed(() => abPercent(player.abPointA));
const abMarkB = computed(() => abPercent(player.abPointB));
/** 循环区间高亮条（左 / 宽百分比） */
const abRange = computed(() => {
  const a = abPercent(player.abPointA);
  const b = abPercent(player.abPointB);
  if (a === null || b === null) return null;
  return { left: `${a}%`, width: `${Math.max(0, b - a)}%` };
});

function abPercent(value: number | null): number | null {
  if (value === null || player.duration <= 0) return null;
  return Math.min(100, Math.max(0, (value / player.duration) * 100));
}

const abLabel = computed(() => {
  if (player.abEnabled) {
    return `${formatTime(player.abPointA!)} – ${formatTime(player.abPointB!)}`;
  }
  if (player.abPointA !== null) return `A ${formatTime(player.abPointA)}`;
  return "未设置";
});

/** 打点：没有 A 打 A，有 A 没 B 打 B，都已设置则回到「重设 A」 */
function markAbPoint(): void {
  if (player.abPointA === null || player.abEnabled) player.setAbPointA();
  else player.setAbPointB();
}

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

/** 下载管理面板：与播放队列 / 歌词面板互斥 */
function toggleDownloads(): void {
  const next = !downloads.panelOpen;
  downloads.panelOpen = next;
  if (next) {
    player.showQueue = false;
    player.showLyrics = false;
  }
}

/** 「更多」二级菜单：一级列出不常用入口，二级展开倍速档位 / 输出设备 / 音质 / 睡眠定时器 */
const moreView = ref<"root" | "rate" | "device" | "quality" | "sleep" | "ab" | null>(null);
const morePicker = ref<HTMLElement | null>(null);

/** 睡眠定时器：按钮高亮与二级菜单摘要都依赖它的状态 */
const sleepTimer = useSleepTimer();
const sleepActive = computed(() => sleepTimer.mode.value !== "off");
const sleepSummary = computed(() => {
  if (sleepTimer.mode.value === "after-track") return "播完当前曲";
  if (!sleepTimer.countingDown.value) return "未设置";
  return sleepTimer.remainingLabel.value;
});

/** 音质快速切换：跟随当前曲目实际会用到的播放源；插件不支持时整项隐藏 */
const quality = useQualityControl(() => player.currentTrack);
const qualityLabel = computed(() => {
  const info = quality.support.value;
  if (!info) return "默认";
  return info.options.find((option) => option.value === info.current)?.label ?? info.current;
});
/** 当前档位是否为该插件的最高档（用于菜单项提示） */
const qualityIsTop = computed(() => {
  const info = quality.support.value;
  if (!info) return false;
  return info.current === info.options[info.options.length - 1]?.value;
});

async function pickQuality(value: string): Promise<void> {
  await quality.setQuality(value);
  moreView.value = null;
}

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

/** 「更多」菜单浮层引用：二级页切换时用于高度过渡 */
const moreMenuEl = ref<HTMLElement | null>(null);

/** 当前高度过渡的清理函数：快速连续切换时丢弃上一次的收尾，避免中途跳变 */
let moreMenuHeightCleanup: (() => void) | null = null;

/** 二级页切换高度过渡：离开时锁定当前高度，避免容器在 out-in 间隙塌缩 */
function onPageLeave(): void {
  const menu = moreMenuEl.value;
  if (!menu) return;
  moreMenuHeightCleanup?.();
  moreMenuHeightCleanup = null;
  menu.style.height = `${menu.scrollHeight}px`;
  menu.style.overflow = "hidden";
}

/** 新页插入后测量高度，平滑过渡过去；结束后清除内联样式恢复 auto。
    注意不能直接读 scrollHeight：它只会返回 max(容器, 内容)，新页更矮时
    读到的仍是旧锁定高度，导致过渡失效、清理时瞬间塌缩。
    这里瞬时放开锁定测自然高度，再锁回旧值作为过渡起点。 */
function onPageEnter(): void {
  const menu = moreMenuEl.value;
  if (!menu) return;
  const locked = menu.style.height;
  menu.style.height = "auto";
  const target = menu.scrollHeight;
  menu.style.height = locked;
  void menu.offsetHeight; // 强制回流，确保过渡从旧高度起算
  menu.style.height = `${target}px`;
  let timer = 0;
  const finish = () => {
    window.clearTimeout(timer);
    menu.removeEventListener("transitionend", onEnd);
    menu.style.height = "";
    menu.style.overflow = "";
  };
  const onEnd = (event: TransitionEvent) => {
    if (event.target === menu && event.propertyName === "height") finish();
  };
  menu.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(finish, 400);
  moreMenuHeightCleanup = finish;
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
        <transition name="cover-fade" mode="out-in">
          <CachedImage
            v-if="player.currentTrack?.cover"
            :key="player.currentTrack.cover"
            :src="player.currentTrack.cover"
            class="cover-img"
          />
          <span v-else class="wp-icon cover-placeholder">&#xE852;</span>
        </transition>
      </div>
      <transition name="track-meta" mode="out-in">
        <div class="meta" :key="player.currentTrack ? `${player.currentTrack.sourceId}:${player.currentTrack.id}` : 'empty'">
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
      </transition>
      <WpIconButton :active="liked" class="like-button" :disabled="!player.currentTrack" :title="liked ? '取消喜欢' : '添加到我喜欢'" @click="toggleLikeCurrent">
        <transition name="icon-pop" mode="out-in">
          <span class="wp-icon" :class="{ filled: liked }" :key="liked ? 'liked' : 'unliked'">{{ liked ? "&#xF47E;" : "&#xF47A;" }}</span>
        </transition>
      </WpIconButton>
    </div>

    <!-- 中：控制与进度 -->
    <div class="controls">
      <div class="transport">
        <WpIconButton class="mode-button" :title="PLAY_MODE_LABEL[player.mode]" @click="player.cycleMode">
          <span class="wp-icon" :class="{ filled: modeIconFilled }" v-html="modeIcon" />
        </WpIconButton>
        <WpIconButton title="上一首" :disabled="!player.queue.length" @click="player.prev">
          <span class="wp-icon filled">&#xF633;</span>
        </WpIconButton>
        <button
          class="play-button"
          :title="player.playing ? '暂停' : '播放'"
          :disabled="!player.queue.length && !player.currentTrack"
          @click="player.togglePlay"
        >
          <transition name="icon-pop" mode="out-in">
            <span v-if="player.loading" key="loading" class="wp-icon">&#xF709;</span>
            <span v-else-if="player.playing" key="play" class="wp-icon filled">&#xF5AC;</span>
            <span v-else key="pause" class="wp-icon filled">&#xF610;</span>
          </transition>
        </button>
        <WpIconButton title="下一首" :disabled="!player.queue.length" @click="player.next()">
          <span class="wp-icon filled">&#xF574;</span>
        </WpIconButton>
        <WpIconButton :active="player.showLyrics" title="歌词" :disabled="!player.currentTrack" @click="player.showLyrics = !player.showLyrics; player.showQueue = false; downloads.panelOpen = false">
          <span class="wp-icon">&#xF801;</span>
        </WpIconButton>
      </div>
      <div class="seek-row">
        <span class="time">{{ seekTime }}</span>
        <div
          ref="seekAreaRef"
          class="seek-slider"
          @pointerdown.capture="onSeekPointerDown"
          @pointerup="onSeekPointerUp"
          @pointercancel="onSeekPointerCancel"
          @pointermove="onSeekHover"
          @pointerleave="onSeekLeave"
        >
          <!-- A-B 循环区间：在滑块下方画一条强调色细线，两端各一个标记 -->
          <div v-if="abRange" class="ab-range" :style="abRange" aria-hidden="true" />
          <span v-if="abMarkA !== null" class="ab-mark ab-mark-a" :style="{ left: `${abMarkA}%` }" aria-hidden="true">
            A
          </span>
          <span v-if="abMarkB !== null" class="ab-mark ab-mark-b" :style="{ left: `${abMarkB}%` }" aria-hidden="true">
            B
          </span>
          <!-- 悬停时间预览：跟随指针，pointer-events:none 不挡拖动 -->
          <div
            v-if="hoverTime !== null"
            class="seek-hover"
            :style="{ left: `${hoverPercent}%` }"
            aria-hidden="true"
          >
            {{ formatTime(hoverTime) }}
          </div>
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
      <WpIconButton :active="downloads.panelOpen" class="download-button" title="下载管理" @click="toggleDownloads">
        <span class="wp-icon">&#xF151;</span>
        <span v-if="downloads.downloadingCount" class="download-dot" aria-hidden="true" />
      </WpIconButton>
      <WpIconButton :active="player.showQueue" title="播放队列" @click="player.showQueue = !player.showQueue; player.showLyrics = false; downloads.panelOpen = false">
        <span class="wp-icon">&#xF4EE;</span>
      </WpIconButton>
      <div ref="morePicker" class="more-picker">
        <WpIconButton :active="player.rate !== 1 || sleepActive" title="更多" @click="toggleMoreMenu">
          <span class="wp-icon">&#xE825;</span>
        </WpIconButton>
        <transition name="more-menu">
          <div v-if="moreView" ref="moreMenuEl" class="more-menu">
            <transition name="more-page" mode="out-in" @enter="onPageEnter" @leave="onPageLeave">
              <div v-if="moreView === 'root'" key="root" class="more-page">
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
                <button
                  v-if="quality.support.value"
                  class="more-item"
                  :class="{ 'is-on': qualityIsTop }"
                  @click="moreView = 'quality'"
                >
                  <span class="more-item-label">播放音质</span>
                  <span class="more-item-tail">
                    <span class="more-item-value">{{ qualityLabel }}</span>
                    <span class="wp-icon more-item-chevron">&#xF2B0;</span>
                  </span>
                </button>
                <button class="more-item" :class="{ 'is-on': player.abEnabled }" @click="moreView = 'ab'">
                  <span class="more-item-label">A-B 循环</span>
                  <span class="more-item-tail">
                    <span class="more-item-value">{{ abLabel }}</span>
                    <span class="wp-icon more-item-chevron">&#xF2B0;</span>
                  </span>
                </button>
                <button class="more-item" :class="{ 'is-on': sleepActive }" @click="moreView = 'sleep'">
                  <span class="more-item-label">睡眠定时器</span>
                  <span class="more-item-tail">
                    <span class="more-item-value">{{ sleepSummary }}</span>
                    <span class="wp-icon more-item-chevron">&#xF2B0;</span>
                  </span>
                </button>
              </div>
              <div v-else-if="moreView === 'rate'" key="rate" class="more-page">
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
              </div>
              <div v-else-if="moreView === 'ab'" key="ab" class="more-page">
                <button class="more-back" @click="moreView = 'root'">
                  <span class="wp-icon">&#xF2AA;</span>
                  <span>A-B 循环</span>
                </button>
                <div class="ab-summary">
                  <span class="ab-point">A：{{ player.abPointA === null ? "未打点" : formatTime(player.abPointA) }}</span>
                  <span class="ab-point">B：{{ player.abPointB === null ? "未打点" : formatTime(player.abPointB) }}</span>
                </div>
                <button class="more-item" @click="markAbPoint">
                  <span class="more-item-label">
                    {{ player.abPointA === null ? "打 A 点（当前位置）" : player.abEnabled ? "重新打 A 点" : "打 B 点（当前位置）" }}
                  </span>
                  <span class="wp-icon more-item-check">&#xF294;</span>
                </button>
                <button
                  class="more-item"
                  @click="player.setAbLoopAroundCurrent(30); moreView = null"
                >
                  <span class="more-item-label">快速循环当前 30 秒</span>
                </button>
                <div class="ab-hint">
                  {{ player.abEnabled ? "已生效：播到 B 点会跳回 A 点继续循环" : "打满 A、B 两点后即开始循环" }}
                </div>
                <button
                  class="more-item more-item-danger"
                  :disabled="player.abPointA === null"
                  @click="player.clearAbLoop(); moreView = null"
                >
                  <span class="more-item-label">清除 A-B 循环</span>
                </button>
              </div>
              <div v-else-if="moreView === 'device'" key="device" class="more-page">
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
              </div>
              <div v-else-if="moreView === 'quality'" key="quality" class="more-page">
                <button class="more-back" @click="moreView = 'root'">
                  <span class="wp-icon">&#xF2AA;</span>
                  <span>播放音质</span>
                </button>
                <button
                  v-for="option in quality.support.value?.options ?? []"
                  :key="option.value"
                  class="more-item"
                  @click="pickQuality(option.value)"
                >
                  <span class="more-item-label">{{ option.label }}</span>
                  <span
                    v-if="quality.current.value === option.value"
                    class="wp-icon more-item-check"
                  >&#xF294;</span>
                </button>
                <p class="more-hint">
                  写入 {{ quality.support.value?.sourceName }} 的音质设置；取不到时自动降级
                </p>
              </div>
              <div v-else key="sleep" class="more-page">
                <button class="more-back" @click="moreView = 'root'">
                  <span class="wp-icon">&#xF2AA;</span>
                  <span>睡眠定时器</span>
                </button>
                <SleepTimerPicker @close="moreView = null" />
              </div>
            </transition>
          </div>
        </transition>
      </div>
      <div class="volume-group">
        <WpIconButton :title="player.muted ? '取消静音' : '静音'" @click="player.toggleMute">
          <span class="wp-icon">{{ player.muted || player.volume === 0 ? "&#xEB4B;" : "&#xEB43;" }}</span>
        </WpIconButton>
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
    <DownloadPanel />
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

/* 封面换曲淡入：旧封面快速淡出、新封面柔和淡入 */
.cover-fade-enter-active {
  transition: opacity var(--duration-normal) var(--ease-decelerate);
}

.cover-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.cover-fade-enter-from,
.cover-fade-leave-to {
  opacity: 0;
}

/* 曲名 / 歌手换曲切换：轻微上滑淡入 */
.track-meta-enter-active {
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    opacity var(--duration-normal) var(--ease-decelerate);
}

.track-meta-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.track-meta-enter-from {
  transform: translateY(8px);
  opacity: 0;
}

.track-meta-leave-to {
  opacity: 0;
}

/* 图标切换弹跳（播放/暂停、喜欢红心）：缩放回落，带轻微过冲 */
.icon-pop-enter-active {
  transition:
    transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 180ms var(--ease-standard);
}

.icon-pop-leave-active {
  transition:
    transform var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.icon-pop-enter-from {
  transform: scale(0.5);
  opacity: 0;
}

.icon-pop-leave-to {
  transform: scale(0.75);
  opacity: 0;
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

/* A-B 循环：区间高亮 + 两端 A/B 标记 */
.ab-range {
  position: absolute;
  bottom: 6px;
  height: 2px;
  border-radius: 1px;
  background: var(--wp-accent);
  opacity: 0.75;
  pointer-events: none;
}

.ab-mark {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  font-size: 9px;
  line-height: 1;
  font-weight: 600;
  color: var(--wp-text-on-accent);
  background: var(--wp-accent);
  border-radius: 2px;
  padding: 1px 2px;
  pointer-events: none;
}

.ab-mark-a {
  bottom: 10px;
}

.ab-mark-b {
  bottom: 10px;
  background: var(--wp-accent-hover);
}

/* 悬停时间预览气泡 */
.seek-hover {
  position: absolute;
  bottom: calc(100% - 4px);
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--wp-flyout);
  border: 1px solid var(--wp-control-stroke);
  box-shadow: var(--shadow-flyout);
  color: var(--wp-text-primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
}

/* A-B 二级菜单里的 A/B 点摘要 */
/* A-B 二级菜单底部的状态说明 */
.ab-hint {
  padding: 2px var(--space-lg) 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--wp-text-tertiary);
}

.ab-summary {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 2px var(--space-lg) 6px;
  font-size: 12px;
  color: var(--wp-text-secondary);
  font-variant-numeric: tabular-nums;
}

.seek-slider {
  position: relative;
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

/* 下载管理按钮：有进行中的任务时右上角显示强调色小圆点 */
.download-button {
  position: relative;
}

.download-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wp-accent);
  pointer-events: none;
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
  /* 锚定按钮右上方弹出：缩放/位移以此为原点，飞出方向更自然 */
  transform-origin: bottom right;
  /* 二级页切换时的高度过渡：常驻基类，保证 JS 钩子改 height 时能缓动
     （进出场的 active 类会整体覆盖 transition，故那里也单独声明了 height） */
  transition: height var(--duration-normal) var(--ease-decelerate);
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

/* 破坏性操作（清除 A-B）用危险色 */
.more-item-danger .more-item-label {
  color: var(--wp-danger);
}

.more-item:disabled {
  opacity: 0.5;
  cursor: default;
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

/* 已生效的开关型菜单项（如睡眠定时器倒计时中）：值文本用强调色提示 */
.more-item.is-on .more-item-value {
  color: var(--wp-accent);
}

/* 二级菜单里的说明文字（音质可能被自动降级等） */
.more-hint {
  margin: 4px 0 0;
  padding: 0 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--wp-text-tertiary);
}

/* 浮层进出场（WinUI 飞出近似）：进场缩放+上浮淡入，退场快速收回。
   进场列表包含 height：二级页切换时容器高度由 JS 钩子驱动平滑过渡 */
.more-menu-enter-active {
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    opacity var(--duration-normal) var(--ease-decelerate),
    height var(--duration-normal) var(--ease-decelerate);
}

.more-menu-leave-active {
  transition:
    transform var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.more-menu-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
}

.more-menu-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

/* 内部二级页切换（根 → 倍速/输出设备）：横向滑动过渡 */
.more-page {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.more-page-enter-active {
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    opacity var(--duration-normal) var(--ease-decelerate);
}

.more-page-leave-active {
  transition:
    transform var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.more-page-enter-from {
  transform: translateX(14px);
  opacity: 0;
}

.more-page-leave-to {
  transform: translateX(-10px);
  opacity: 0;
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
