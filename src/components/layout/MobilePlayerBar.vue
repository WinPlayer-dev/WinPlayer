<script setup lang="ts">
/**
 * 移动端播放条：迷你条 + 全屏播放页（沉浸式歌词页）
 * - 未播放任何歌曲时整体隐藏
 * - 点击迷你条打开全屏页：封面模糊铺满作背景，歌词浮于其上
 * - 歌词：逐行层级渐变（当前行放大高亮、相邻行渐隐）+ 翻译副行小字 + 上下边缘渐隐
 * - 手势：歌词滚到顶部时下拉收起页面；封面/标题区左右滑动切歌
 * - 歌词偏移校准（±0.5s，按曲目持久化）、进度条拖动时间气泡、队列拖拽排序与滑动删除
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import CachedImage from "@/components/common/CachedImage.vue";
import { useAutoCenter } from "@/composables/useAutoCenter";
import { registerBackInterceptor } from "@/services/backButton";
import { getSetting, setSetting } from "@/services/db";
import { findLyricIndex } from "@/services/lrc";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { useSleepTimer } from "@/services/sleepTimer";
import { useQualityControl } from "@/services/quality";
import WpIconButton from "@/components/theme/WpIconButton.vue";
import SleepTimerPicker from "@/components/common/SleepTimerPicker.vue";
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

const player = usePlayerStore();
const library = useLibraryStore();
const router = useRouter();

const showFull = ref(false);
const showQueue = ref(false);
const showOffset = ref(false);
/** 播放速度面板 */
const showRate = ref(false);
/** 「更多」二级菜单面板 */
const showMore = ref(false);
/** 睡眠定时器面板 */
const showSleep = ref(false);
/** 播放音质面板 */
const showQuality = ref(false);

/** 选择播放倍速并关闭面板 */
function selectRate(value: number): void {
  void player.setRate(value);
  showRate.value = false;
}

/* ------------------------------ 睡眠定时器 ------------------------------ */

const sleepTimer = useSleepTimer();
/** 面板入口的摘要文案 */
const sleepSummary = computed(() => {
  if (sleepTimer.mode.value === "after-track") return "播完当前曲";
  if (!sleepTimer.countingDown.value) return "";
  return sleepTimer.remainingLabel.value;
});

/* ------------------------------ 播放音质 ------------------------------ */

const quality = useQualityControl(() => player.currentTrack);
const qualityLabel = computed(() => {
  const info = quality.support.value;
  if (!info) return "默认";
  return info.options.find((option) => option.value === info.current)?.label ?? info.current;
});

function selectQuality(value: string): void {
  void quality.setQuality(value);
  showQuality.value = false;
}

/** 打开最近播放页并逐层收起浮层 */
function openHistory(): void {
  showMore.value = false;
  void router.push({ name: "history" });
}

/** 打开离线音乐页并逐层收起浮层 */
function openOffline(): void {
  showMore.value = false;
  void router.push({ name: "offline" });
}

const liked = computed(() => (player.currentTrack ? library.isLiked(player.currentTrack) : false));

async function toggleLikeCurrent(): Promise<void> {
  if (player.currentTrack) await library.toggleLike(player.currentTrack);
}

function openFull(): void {
  if (!player.currentTrack) return;
  resetGesture();
  showFull.value = true;
}

/* ------------------------------ 歌词 ------------------------------ */

/** 歌词偏移（毫秒，正值 = 歌词整体后移、更晚出现），按曲目持久化 */
const lyricOffset = ref(0);

function lyricOffsetKey(): string | null {
  const track = player.currentTrack;
  return track ? `lyric.offset:${track.sourceId ?? ""}:${track.id}` : null;
}

async function loadLyricOffset(): Promise<void> {
  const key = lyricOffsetKey();
  lyricOffset.value = 0;
  if (!key) return;
  lyricOffset.value = await getSetting<number>(key, 0);
}

function persistLyricOffset(value: number): void {
  const key = lyricOffsetKey();
  if (!key) return;
  void setSetting(key, value);
}

/** 微调歌词偏移：正值让歌词更晚出现（上限 ±5s） */
function shiftLyricOffset(delta: number): void {
  lyricOffset.value = Math.min(5000, Math.max(-5000, lyricOffset.value + delta));
  persistLyricOffset(lyricOffset.value);
}

function resetLyricOffset(): void {
  lyricOffset.value = 0;
  persistLyricOffset(0);
}

/** 偏移显示文案，如 +0.5s / −1.0s */
const offsetLabel = computed(
  () => `${lyricOffset.value >= 0 ? "+" : "−"}${(Math.abs(lyricOffset.value) / 1000).toFixed(1)}s`,
);

/** 当前歌词行（已按偏移校正，-1 表示尚未开始） */
const activeIndex = computed(() =>
  findLyricIndex(player.lyrics, player.currentTime * 1000 - lyricOffset.value),
);

/** 歌词行：首行为原文，其余行（翻译）作为副行小字展示 */
const lyricRows = computed(() =>
  player.lyrics.map((line) => {
    const [text, ...rest] = line.text.split("\n");
    return { time: line.time, text, translation: rest.join(" ") };
  }),
);

/** 模糊/渐隐的作用范围（行数）：约等于歌词视口能显示的行数 */
const FOCUS_SPAN = 9;

/**
 * 视觉层级：0 当前行 / 1~3 逐级模糊渐隐 / 4 远端仅压暗。
 * 档位按 FOCUS_SPAN 均分，歌词区变高后模糊范围同步变大，避免靠外的行
 * 「既没模糊又被压暗」的断层感；超过 FOCUS_SPAN 的行不再加模糊（此时
 * 已滚出视口），以控制渲染开销。
 */
function lineLevel(index: number): number {
  const distance = Math.abs(index - activeIndex.value);
  if (distance === 0) return 0;
  if (distance >= FOCUS_SPAN) return 4;
  return Math.min(3, Math.ceil((distance / FOCUS_SPAN) * 3));
}

/** 点击歌词行：按偏移校正后的时间跳转，使该行成为当前行 */
function seekToLine(index: number): void {
  const row = lyricRows.value[index];
  if (!row) return;
  player.seek((row.time + lyricOffset.value) / 1000);
}

/** 全屏页歌词当前行自动居中；用户手动滚动后延迟回正 */
const listRef = ref<HTMLElement | null>(null);

useAutoCenter({
  container: listRef,
  itemSelector: ".full-lrc-line",
  getIndex: () => activeIndex.value,
  isActive: () => showFull.value,
});

/* ------------------------------ 播放模式 ------------------------------ */

const modeIcon = computed(() => playModeIcon(player.mode));
const modeIconFilled = computed(() => playModeIconFilled(player.mode));
const modeLabel = computed(() => PLAY_MODE_LABEL[player.mode]);

/* ------------------------------ 进度条拖动 ------------------------------ */

const progressPercent = computed(() =>
  player.duration > 0 ? Math.min(100, (player.currentTime / player.duration) * 100) : 0,
);

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragPercent = ref(0);

/** 拖动时显示手指位置，否则显示播放进度 */
const displayedPercent = computed(() => (dragging.value ? dragPercent.value : progressPercent.value));
const displayedTime = computed(() =>
  dragging.value ? formatTime((player.duration * dragPercent.value) / 100) : formatTime(player.currentTime),
);

function percentFromEvent(event: PointerEvent): number {
  const el = trackRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
}

function onProgressDown(event: PointerEvent): void {
  if (player.duration <= 0) return;
  dragging.value = true;
  dragPercent.value = percentFromEvent(event);
  // 合成事件 / 无效 pointerId 时 setPointerCapture 会抛错，忽略即可
  try {
    trackRef.value?.setPointerCapture(event.pointerId);
  } catch {
    /* 忽略：无法捕获时仍可在轨道内拖动 */
  }
}

function onProgressMove(event: PointerEvent): void {
  if (!dragging.value) return;
  dragPercent.value = percentFromEvent(event);
}

function onProgressUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  player.seek((player.duration * percentFromEvent(event)) / 100);
}

/* ------------------------------ 页面手势 ------------------------------ */

/** 下拉收起页面的触发距离（像素） */
const CLOSE_THRESHOLD = 110;
/** 左右滑动切歌的触发距离（像素） */
const SWITCH_THRESHOLD = 70;
/** 下拉阻尼：手指位移 × 系数 */
const DRAG_DAMPING = 0.85;
/** 手势方向锁定所需的最小位移（像素） */
const AXIS_SLOP = 10;
/** 收起动画时长（毫秒，与样式中的过渡保持一致） */
const CLOSE_MS = 240;
/** 切歌动画单程时长（毫秒） */
const SWITCH_MS = 200;

const sheetX = ref(0);
const sheetY = ref(0);
const closing = ref(false);
const animating = ref(false);
/** 本次手势接管的方向：close = 下拉收起，switch = 左右切歌 */
const axis = ref<"none" | "close" | "switch">("none");

let startX = 0;
let startY = 0;
/** 页面级手势是否已接管（响应式：只在接管期间才提升合成层） */
const armed = ref(false);
let canClose = false;
let canSwitch = false;

const sheetStyle = computed(() => {
  if (closing.value) {
    return {
      transform: "translate3d(0, 100%, 0)",
      opacity: "0",
      transition: `transform ${CLOSE_MS}ms var(--ease-standard), opacity ${CLOSE_MS}ms linear`,
    };
  }
  return {
    transform: `translate3d(${sheetX.value}px, ${sheetY.value}px, 0)`,
    transition: animating.value ? `transform ${SWITCH_MS}ms var(--ease-standard)` : "none",
  };
});

function resetGesture(): void {
  axis.value = "none";
  armed.value = false;
  animating.value = false;
  sheetX.value = 0;
  sheetY.value = 0;
}

/** 收起全屏页：下滑动画结束后再卸载 */
function closeFull(): void {
  if (closing.value) return;
  closing.value = true;
  window.setTimeout(() => {
    closing.value = false;
    showFull.value = false;
    resetGesture();
  }, CLOSE_MS);
}

/** 双帧等待：确保上一帧样式落盘后再启用过渡 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function onSheetStart(event: TouchEvent): void {
  armed.value = false;
  if (closing.value || animating.value || showQueue.value) return;
  const touch = event.touches[0];
  const target = event.target as HTMLElement | null;
  if (!touch || !target) return;
  // 进度条 / 按钮 / 偏移面板自带手势语义，页面级手势不介入
  if (target.closest(".full-progress, .full-offset, button")) return;
  startX = touch.clientX;
  startY = touch.clientY;
  axis.value = "none";
  const atTop = (listRef.value?.scrollTop ?? 0) <= 0;
  const inTop = target.closest(".full-top") !== null;
  // 下拉收起：只在歌词已滚到顶部（或手指按在封面/标题区）时接管，避免干扰歌词滚动
  canClose = atTop || inTop;
  // 左右切歌：只在封面/标题区，避免与歌词阅读冲突
  canSwitch = inTop;
  armed.value = true;
}

function onSheetMove(event: TouchEvent): void {
  if (!armed.value) return;
  const touch = event.touches[0];
  if (!touch) return;
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;

  if (axis.value === "none") {
    if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (!canSwitch) {
        armed.value = false;
        return;
      }
      axis.value = "switch";
    } else {
      // 只有「已到顶部继续下拉」才接管，其余交给歌词原生滚动
      if (dy <= 0 || !canClose) {
        armed.value = false;
        return;
      }
      axis.value = "close";
    }
  }

  if (event.cancelable) event.preventDefault();

  if (axis.value === "close") sheetY.value = Math.max(0, dy) * DRAG_DAMPING;
  else sheetX.value = dx;
}

function onSheetEnd(): void {
  if (!armed.value && axis.value === "none") return;
  armed.value = false;
  const mode = axis.value;
  axis.value = "none";

  if (mode === "close") {
    if (sheetY.value >= CLOSE_THRESHOLD) closeFull();
    else snapBack();
    return;
  }
  if (mode === "switch") {
    if (Math.abs(sheetX.value) >= SWITCH_THRESHOLD) void switchByGesture(sheetX.value < 0 ? 1 : -1);
    else snapBack();
  }
}

/** 位移未达阈值：带动画回弹到原位，避免松手瞬间生硬跳回 */
function snapBack(): void {
  animating.value = true;
  sheetX.value = 0;
  sheetY.value = 0;
  window.setTimeout(() => {
    animating.value = false;
  }, SWITCH_MS + 40);
}

/** 横向切歌：整页随手指滑出 → 屏幕外切歌 → 从另一侧滑入 */
async function switchByGesture(dir: 1 | -1): Promise<void> {
  const width = window.innerWidth || 360;
  animating.value = true;
  await nextTick();
  await nextFrame();
  sheetX.value = -dir * width; // 滑出屏幕
  await wait(SWITCH_MS + 20);
  // 屏幕外完成切歌，用户看不到内容突变；不等待加载（网络慢时页面稍后才更新）
  if (dir === 1) void player.next();
  else void player.prev();
  animating.value = false;
  sheetX.value = dir * width; // 无过渡瞬移到另一侧
  await nextTick();
  await nextFrame();
  animating.value = true;
  await nextTick();
  await nextFrame();
  sheetX.value = 0; // 滑入
  await wait(SWITCH_MS + 20);
  animating.value = false;
}

/* ------------------------------ 队列抽屉 ------------------------------ */

/** 滑动删除：正在横滑的条目 uid 与位移 */
const swipeUid = ref<string | null>(null);
const swipeX = ref(0);
let swipeStartX = 0;
let swipeStartY = 0;
let swipeLocked = false;

function onRowDown(event: PointerEvent, uid: string): void {
  if (event.pointerType === "mouse") return;
  swipeUid.value = uid;
  swipeX.value = 0;
  swipeLocked = false;
  swipeStartX = event.clientX;
  swipeStartY = event.clientY;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    /* 忽略 */
  }
}

function onRowMove(event: PointerEvent): void {
  if (!swipeUid.value) return;
  const dx = event.clientX - swipeStartX;
  const dy = event.clientY - swipeStartY;
  if (!swipeLocked) {
    if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
    // 纵向手势交给队列列表滚动
    if (Math.abs(dy) >= Math.abs(dx)) {
      swipeUid.value = null;
      return;
    }
    swipeLocked = true;
  }
  swipeX.value = Math.min(0, Math.max(-88, dx));
}

/** 左滑 / 拖拽结束后抑制浏览器补发的 click，避免误触播放 */
let suppressRowClick = false;

function onRowUp(uid: string): void {
  if (!swipeUid.value) return;
  const swiped = swipeLocked;
  const remove = swiped && swipeX.value <= -64;
  swipeUid.value = null;
  swipeX.value = 0;
  swipeLocked = false;
  if (swiped) {
    suppressRowClick = true;
    window.setTimeout(() => {
      suppressRowClick = false;
    }, 400);
  }
  if (remove) player.removeFromQueue(uid);
}

function onRowClick(index: number): void {
  if (suppressRowClick) {
    suppressRowClick = false;
    return;
  }
  void player.playAt(index);
}

/** 队列条目位移：拖拽排序时整行跟手（左滑位移作用于内层内容，露出删除底色） */
function rowStyle(index: number): Record<string, string> {
  if (queueDragging.value && index === queueDragFrom.value) {
    return { transform: `translateY(${queueDragDy.value}px)` };
  }
  return {};
}

/** 左滑删除：内容层跟手位移，松手后由样式中的过渡自然回位 */
function rowContentStyle(uid: string): Record<string, string> {
  if (swipeUid.value !== uid) return {};
  return { transform: `translateX(${swipeX.value}px)`, transition: "none" };
}

/** 拖拽排序：起止下标、拖动位移与行高（行高统一，用于换算目标下标） */
const queueListRef = ref<HTMLElement | null>(null);
const queueDragFrom = ref(-1);
const queueDragTo = ref(-1);
const queueDragDy = ref(0);
const queueDragging = ref(false);
let queueRowHeight = 52;
let queueContentTop = 0;
let queueDragStartY = 0;
let queuePointerY = 0;
let queueAutoScrollFrame = 0;

function cancelQueueAutoScroll(): void {
  if (queueAutoScrollFrame) cancelAnimationFrame(queueAutoScrollFrame);
  queueAutoScrollFrame = 0;
}

/** 拖动到列表上/下边缘时自动滚动 */
function startQueueAutoScroll(): void {
  cancelQueueAutoScroll();
  const step = (): void => {
    if (!queueDragging.value) return;
    const list = queueListRef.value;
    if (list) {
      const rect = list.getBoundingClientRect();
      if (queuePointerY < rect.top + 48) list.scrollTop -= 8;
      else if (queuePointerY > rect.bottom - 48) list.scrollTop += 8;
    }
    queueAutoScrollFrame = requestAnimationFrame(step);
  };
  queueAutoScrollFrame = requestAnimationFrame(step);
}

function onHandleDown(event: PointerEvent, index: number): void {
  event.stopPropagation();
  if (event.pointerType === "mouse") return;
  const list = queueListRef.value;
  const rows = list?.querySelectorAll<HTMLElement>(".queue-sheet-item");
  if (!list || !rows?.[index]) return;
  queueRowHeight = rows[index].offsetHeight || 52;
  // 首行内容顶部相对滚动内容的位置（含列表内边距），用于换算手指落在第几行
  queueContentTop = rows[0].getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  queueDragFrom.value = index;
  queueDragTo.value = index;
  queueDragDy.value = 0;
  queueDragging.value = true;
  queueDragStartY = event.clientY;
  queuePointerY = event.clientY;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    /* 忽略 */
  }
  startQueueAutoScroll();
}

function onHandleMove(event: PointerEvent): void {
  if (!queueDragging.value) return;
  queuePointerY = event.clientY;
  queueDragDy.value = event.clientY - queueDragStartY;
  const list = queueListRef.value;
  if (!list) return;
  const contentY = event.clientY - list.getBoundingClientRect().top + list.scrollTop - queueContentTop;
  queueDragTo.value = Math.min(
    player.queue.length - 1,
    Math.max(0, Math.floor(contentY / queueRowHeight)),
  );
}

function onHandleUp(): void {
  if (!queueDragging.value) return;
  const from = queueDragFrom.value;
  const to = queueDragTo.value;
  queueDragging.value = false;
  queueDragFrom.value = -1;
  queueDragTo.value = -1;
  queueDragDy.value = 0;
  cancelQueueAutoScroll();
  if (from >= 0 && to >= 0 && from !== to) player.moveQueueItem(from, to);
}

/** 拖拽落点指示线位置；-1 表示不显示 */
const dropLineTop = computed(() => {
  if (!queueDragging.value || queueDragTo.value < 0 || queueDragTo.value === queueDragFrom.value) return -1;
  const offset = queueDragTo.value > queueDragFrom.value ? 1 : 0;
  return (queueDragTo.value + offset) * queueRowHeight;
});

/* ------------------------------ Android 返回键 ------------------------------ */

/**
 * 全屏播放页的返回键处理：逐层收起浮层，最后收起全屏页。
 * 返回键监听本身由 App.vue 统一注册（services/backButton.ts），
 * 这里只挂一层拦截器，避免每个组件各注册一个监听互相抢默认行为。
 */
let unregisterBack: (() => void) | null = null;

// 打开全屏页：读取本曲目歌词偏移并注册返回键拦截；收起时逐个复位
watch(showFull, (open) => {
  unregisterBack?.();
  unregisterBack = null;
  if (!open) {
    showQueue.value = false;
    showOffset.value = false;
    showRate.value = false;
    showMore.value = false;
    showSleep.value = false;
    showQuality.value = false;
    return;
  }
  void loadLyricOffset();
  unregisterBack = registerBackInterceptor(() => {
    if (showMore.value) {
      showMore.value = false;
      return true;
    }
    if (showOffset.value) {
      showOffset.value = false;
      return true;
    }
    if (showRate.value) {
      showRate.value = false;
      return true;
    }
    if (showSleep.value) {
      showSleep.value = false;
      return true;
    }
    if (showQuality.value) {
      showQuality.value = false;
      return true;
    }
    if (showQueue.value) {
      showQueue.value = false;
      return true;
    }
    closeFull();
    return true;
  });
});

// 切歌后重新读取该曲目保存的歌词偏移
watch(
  () => player.currentTrack,
  () => {
    if (showFull.value) void loadLyricOffset();
  },
);

onBeforeUnmount(() => {
  unregisterBack?.();
  unregisterBack = null;
  cancelQueueAutoScroll();
});
</script>

<template>
  <template v-if="player.currentTrack">
    <!-- 迷你播放条 -->
    <footer class="mini-bar" @click="openFull">
      <!-- 用 scaleX 而不是 width：每 250ms 一次的进度推进不该触发 layout/paint -->
      <div
        class="mini-progress"
        :style="{ transform: `scaleX(${progressPercent / 100})` }"
      />
      <div class="mini-cover">
        <CachedImage
          v-if="player.currentTrack.cover"
          :src="player.currentTrack.cover"
          class="mini-cover-img"
        />
        <span v-else class="wp-icon mini-cover-placeholder">&#xE852;</span>
      </div>
      <div class="mini-meta">
        <div class="mini-title ellipsis">{{ trackTitle(player.currentTrack) }}</div>
        <div class="mini-artist ellipsis">{{ trackArtist(player.currentTrack) }}</div>
      </div>
      <WpIconButton class="mini-action" :title="liked ? '取消喜欢' : '添加到我喜欢'" @click.stop="toggleLikeCurrent">
        <transition name="icon-pop" mode="out-in">
          <span class="wp-icon" :class="{ filled: liked }" :key="liked ? 'liked' : 'unliked'">{{ liked ? "&#xF47E;" : "&#xF47A;" }}</span>
        </transition>
      </WpIconButton>
      <WpIconButton class="mini-action" :title="player.playing ? '暂停' : '播放'" @click.stop="player.togglePlay">
        <transition name="icon-pop" mode="out-in">
          <span v-if="player.loading" key="loading" class="wp-icon">&#xF709;</span>
          <span v-else-if="player.playing" key="play" class="wp-icon filled">&#xF5AC;</span>
          <span v-else key="pause" class="wp-icon filled">&#xF610;</span>
        </transition>
      </WpIconButton>
      <WpIconButton class="mini-action" title="下一首" :disabled="!player.queue.length" @click.stop="player.next()">
        <span class="wp-icon filled">&#xF574;</span>
      </WpIconButton>
    </footer>

    <!-- 全屏播放页（沉浸式歌词） -->
    <transition name="full-fade">
      <div
        v-if="showFull"
        class="full-player"
        :class="{ 'is-gesturing': armed || animating }"
        :style="sheetStyle"
        @touchstart.passive="onSheetStart"
        @touchmove="onSheetMove"
        @touchend="onSheetEnd"
        @touchcancel="onSheetEnd"
      >
        <!-- 背景：封面高斯模糊铺满 + 暗色遮罩 -->
        <div class="full-bg" aria-hidden="true">
          <CachedImage
            v-if="player.currentTrack.cover"
            :src="player.currentTrack.cover"
            class="full-bg-img"
          />
        </div>
        <div class="full-scrim" aria-hidden="true" />

        <!-- 顶部区（横版：左封面 / 右曲名歌手）：此区域内可左右滑动切歌 -->
        <div class="full-top">
          <div class="full-header">
            <button class="full-icon-button" title="收起" @click="closeFull">
              <span class="wp-icon">&#xF2AB;</span>
            </button>
            <span class="full-header-title">正在播放</span>
            <div class="full-header-actions">
              <button class="full-icon-button" title="更多" @click="showMore = true">
                <span class="wp-icon">&#xE825;</span>
              </button>
              <button
                class="full-icon-button"
                :title="liked ? '取消喜欢' : '添加到我喜欢'"
                @click="toggleLikeCurrent"
              >
                <transition name="icon-pop" mode="out-in">
                  <span class="wp-icon" :class="{ filled: liked }" :key="liked ? 'liked' : 'unliked'">{{ liked ? "&#xF47E;" : "&#xF47A;" }}</span>
                </transition>
              </button>
            </div>
          </div>

          <div class="full-hero">
            <div class="full-cover">
              <CachedImage
                v-if="player.currentTrack.cover"
                :src="player.currentTrack.cover"
                class="full-cover-img"
              />
              <span v-else class="wp-icon full-cover-placeholder">&#xE852;</span>
            </div>

            <div class="full-meta">
              <div class="full-title ellipsis">{{ trackTitle(player.currentTrack) }}</div>
              <div class="full-artist ellipsis">{{ trackArtist(player.currentTrack) }}</div>
            </div>
          </div>
        </div>

        <!-- 歌词：当前行放大高亮，相邻行渐隐，上下边缘渐隐 -->
        <div ref="listRef" class="full-lyrics">
          <div v-if="player.lyricsLoading" class="lyrics-empty">歌词加载中…</div>
          <div v-else-if="!lyricRows.length" class="lyrics-empty">暂无歌词</div>
          <template v-else>
            <p
              v-for="(line, index) in lyricRows"
              :key="index"
              class="full-lrc-line"
              :class="`level-${lineLevel(index)}`"
              @click="seekToLine(index)"
            >
              <span class="full-lrc-text">{{ line.text }}</span>
              <span v-if="line.translation" class="full-lrc-translation">{{ line.translation }}</span>
            </p>
          </template>
        </div>

        <!-- 进度条（拖动时显示时间气泡） -->
        <div class="full-progress">
          <span class="full-time">{{ displayedTime }}</span>
          <div
            ref="trackRef"
            class="full-progress-track"
            @pointerdown="onProgressDown"
            @pointermove="onProgressMove"
            @pointerup="onProgressUp"
            @pointercancel="onProgressUp"
          >
            <div
              class="full-progress-fill"
              :style="{ transform: `scaleX(${displayedPercent / 100})` }"
            />
            <div
              class="full-progress-thumb"
              :class="{ dragging }"
              :style="{ left: `${displayedPercent}%` }"
            />
            <div
              v-if="dragging"
              class="full-progress-bubble"
              :style="{ left: `${displayedPercent}%` }"
            >
              {{ displayedTime }}
            </div>
          </div>
          <span class="full-time">{{ formatTime(player.duration) }}</span>
        </div>

        <!-- 播放控制 -->
        <div class="full-controls">
          <button class="full-icon-button" :title="modeLabel" @click="player.cycleMode">
            <span class="wp-icon" :class="{ filled: modeIconFilled }" v-html="modeIcon" />
          </button>
          <button class="full-icon-button" :disabled="!player.queue.length" title="上一首" @click="player.prev">
            <span class="wp-icon filled">&#xF633;</span>
          </button>
          <button
            class="full-play-button"
            :title="player.playing ? '暂停' : '播放'"
            @click="player.togglePlay"
          >
            <span v-if="player.loading" class="wp-icon">&#xF709;</span>
            <span v-else class="wp-icon filled">{{ player.playing ? "&#xF5AC;" : "&#xF610;" }}</span>
          </button>
          <button class="full-icon-button" :disabled="!player.queue.length" title="下一首" @click="player.next()">
            <span class="wp-icon filled">&#xF574;</span>
          </button>
          <button
            class="full-icon-button"
            title="播放队列"
            :disabled="!player.queue.length"
            @click="showQueue = true"
          >
            <span class="wp-icon">&#xF4EE;</span>
          </button>
        </div>

        <!-- 更多（二级菜单入口：歌词偏移 / 播放速度） -->
        <transition name="full-fade">
          <div v-if="showMore" class="full-offset" @click.self="showMore = false">
            <div class="offset-panel">
              <div class="offset-header">
                <span class="offset-title">更多</span>
                <WpIconButton title="关闭" @click="showMore = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div class="more-list">
                <button class="more-row" @click="showMore = false; showOffset = true">
                  <span class="wp-icon more-row-icon">&#xF588;</span>
                  <span class="more-row-label">歌词偏移</span>
                  <span class="more-row-value">{{ offsetLabel }}</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
                <button class="more-row" @click="showMore = false; showRate = true">
                  <span class="wp-icon more-row-icon">&#xF831;</span>
                  <span class="more-row-label">播放速度</span>
                  <span class="more-row-value">{{ formatRate(player.rate) }}</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
                <button class="more-row" @click="showMore = false; showSleep = true">
                  <span class="wp-icon more-row-icon">&#xF2A1;</span>
                  <span class="more-row-label">睡眠定时器</span>
                  <span class="more-row-value">{{ sleepSummary || "未设置" }}</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
                <button
                  v-if="quality.support.value"
                  class="more-row"
                  @click="showMore = false; showQuality = true"
                >
                  <span class="wp-icon more-row-icon">&#xF2CE;</span>
                  <span class="more-row-label">播放音质</span>
                  <span class="more-row-value">{{ qualityLabel }}</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
                <button class="more-row" @click="openHistory">
                  <span class="wp-icon more-row-icon">&#xF2A1;</span>
                  <span class="more-row-label">最近播放</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
                <button class="more-row" @click="openOffline">
                  <span class="wp-icon more-row-icon">&#xF151;</span>
                  <span class="more-row-label">离线音乐</span>
                  <span class="wp-icon more-row-chevron">&#xF2B0;</span>
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 歌词偏移校准（按曲目持久化） -->
        <transition name="full-fade">
          <div v-if="showOffset" class="full-offset" @click.self="showOffset = false">
            <div class="offset-panel">
              <div class="offset-header">
                <span class="offset-title">歌词偏移</span>
                <WpIconButton title="关闭" @click="showOffset = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div class="offset-hint">歌词比音乐早出现时按 + ，整体后移</div>
              <div class="offset-row">
                <button class="offset-step" @click="shiftLyricOffset(-500)">−0.5s</button>
                <span class="offset-value">{{ offsetLabel }}</span>
                <button class="offset-step" @click="shiftLyricOffset(500)">+0.5s</button>
              </div>
              <button class="offset-reset" @click="resetLyricOffset">重置偏移</button>
            </div>
          </div>
        </transition>

        <!-- 播放速度（0.5x–2x，保持音调） -->
        <transition name="full-fade">
          <div v-if="showRate" class="full-offset" @click.self="showRate = false">
            <div class="offset-panel">
              <div class="offset-header">
                <span class="offset-title">播放速度</span>
                <WpIconButton title="关闭" @click="showRate = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div class="offset-hint">保持音调变速，适合播客 / 有声书</div>
              <div class="rate-grid">
                <button
                  v-for="value in PLAYBACK_RATES"
                  :key="value"
                  class="rate-option"
                  :class="{ active: player.rate === value }"
                  @click="selectRate(value)"
                >
                  {{ formatRate(value) }}
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 睡眠定时器（定时停止 / 播完当前曲停止 / 到点停止） -->
        <transition name="full-fade">
          <div v-if="showSleep" class="full-offset" @click.self="showSleep = false">
            <div class="offset-panel">
              <div class="offset-header">
                <span class="offset-title">睡眠定时器</span>
                <WpIconButton title="关闭" @click="showSleep = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div class="offset-hint">到点后暂停播放，不会退出应用</div>
              <SleepTimerPicker tone="dark" @close="showSleep = false" />
            </div>
          </div>
        </transition>

        <!-- 播放音质（写入当前播放源的音质设置） -->
        <transition name="full-fade">
          <div v-if="showQuality" class="full-offset" @click.self="showQuality = false">
            <div class="offset-panel">
              <div class="offset-header">
                <span class="offset-title">播放音质</span>
                <WpIconButton title="关闭" @click="showQuality = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div class="offset-hint">
                {{ quality.support.value?.sourceName }} · 取不到该档位时自动降级
              </div>
              <div class="quality-list">
                <button
                  v-for="option in quality.support.value?.options ?? []"
                  :key="option.value"
                  class="quality-option"
                  :class="{ active: quality.current.value === option.value }"
                  @click="selectQuality(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <span
                    v-if="quality.current.value === option.value"
                    class="wp-icon quality-check"
                  >&#xF294;</span>
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 播放队列（底部抽屉：拖拽排序 / 左滑删除） -->
        <transition name="full-fade">
          <div v-if="showQueue" class="full-queue" @click.self="showQueue = false">
            <div class="queue-sheet">
              <div class="queue-sheet-header">
                <span class="queue-sheet-title">播放队列</span>
                <span class="queue-sheet-count">{{ player.queue.length }} 首</span>
                <button v-if="player.queue.length" class="queue-sheet-clear" @click="player.clearQueue()">
                  清空
                </button>
                <WpIconButton title="关闭" @click="showQueue = false">
                  <span class="wp-icon">&#xF36A;</span>
                </WpIconButton>
              </div>
              <div ref="queueListRef" class="queue-sheet-body">
                <div v-if="!player.queue.length" class="queue-sheet-empty">队列为空，去发现音乐吧</div>
                <ul v-else class="queue-sheet-list">
                  <li
                    v-for="(item, index) in player.queue"
                    :key="item.uid"
                    class="queue-sheet-item"
                    :class="{
                      current: index === player.currentIndex,
                      swiping: swipeUid === item.uid,
                      dragged: queueDragging && index === queueDragFrom,
                    }"
                    :style="rowStyle(index)"
                    @pointerdown="onRowDown($event, item.uid)"
                    @pointermove="onRowMove"
                    @pointerup="onRowUp(item.uid)"
                    @pointercancel="onRowUp(item.uid)"
                    @click="onRowClick(index)"
                  >
                    <span class="queue-sheet-remove-bg">
                      <span class="wp-icon">&#xF34D;</span>
                      移除
                    </span>
                    <div class="queue-sheet-row" :style="rowContentStyle(item.uid)">
                      <span class="queue-sheet-index">
                        <span v-if="index === player.currentIndex" class="wp-icon filled queue-sheet-playing">&#xE855;</span>
                        <span v-else>{{ index + 1 }}</span>
                      </span>
                      <span class="queue-sheet-meta">
                        <span class="queue-sheet-name ellipsis">{{ trackTitle(item.track) }}</span>
                        <span class="queue-sheet-artist ellipsis">{{ trackArtist(item.track) }}</span>
                      </span>
                      <span
                        class="queue-sheet-handle"
                        title="拖动排序"
                        @click.stop
                        @pointerdown="onHandleDown($event, index)"
                        @pointermove="onHandleMove"
                        @pointerup="onHandleUp"
                        @pointercancel="onHandleUp"
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      <button
                        class="queue-sheet-remove"
                        title="移除"
                        @click.stop="player.removeFromQueue(item.uid)"
                      >
                        <span class="wp-icon">&#xF36A;</span>
                      </button>
                    </div>
                  </li>
                  <li
                    v-if="dropLineTop >= 0"
                    aria-hidden="true"
                    class="queue-sheet-drop"
                    :style="{ top: `${dropLineTop}px` }"
                  />
                </ul>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </template>
</template>

<style scoped>
/* ---------------- 迷你条 ---------------- */
.mini-bar {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 56px;
  padding: 0 var(--space-md);
  background: var(--wp-layer-solid);
  border-top: 1px solid var(--wp-divider);
  cursor: pointer;
  z-index: 31;
}

/* 顶部细进度线 */
.mini-progress {
  position: absolute;
  top: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--wp-accent);
  transform-origin: left center;
  transition: transform 0.25s linear;
  pointer-events: none;
}

.mini-cover {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mini-cover-placeholder {
  font-size: 16px;
  color: var(--wp-text-tertiary);
}

.mini-meta {
  flex: 1;
  min-width: 0;
}

.mini-title {
  font-size: 13px;
  font-weight: 600;
}

.mini-artist {
  font-size: 11px;
  color: var(--wp-text-secondary);
  margin-top: 1px;
}

.mini-action {
  width: 36px;
  height: 36px;
  flex: none;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------- 全屏播放页（沉浸式） ---------------- */
.full-player {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 沉浸式配色不随主题变化：始终深底浅字，保证模糊背景上的可读性 */
  background: #0b0b10;
  color: #fff;
  z-index: 100;
  /* 全屏浮层脱离 app-shell 内边距：自行避开状态栏与底部导航栏 */
  padding-top: var(--safe-area-top);
  padding-bottom: var(--safe-area-bottom);
  will-change: transform;
}

/* 背景：封面高斯模糊铺满 + 暗色遮罩 */
.full-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.full-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 放大后模糊，避免边缘透出底色 */
  transform: scale(1.35);
  filter: blur(36px) saturate(1.6) brightness(0.55);
}

.full-scrim {
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

/* 浮层内容统一压在背景之上 */
.full-top,
.full-lyrics,
.full-progress,
.full-controls {
  position: relative;
  z-index: 1;
}

.full-fade-enter-active,
.full-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-decelerate);
}

.full-fade-enter-from,
.full-fade-leave-to {
  opacity: 0;
}

.full-top {
  flex: none;
}

.full-header {
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
}

.full-header-title {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.72);
}

.full-header-actions {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}

.full-icon-button {
  flex: none;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  font-size: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.full-icon-button:active {
  background: rgba(255, 255, 255, 0.14);
}

.full-icon-button:disabled {
  opacity: 0.32;
}

.full-hero {
  flex: none;
  display: flex;
  /* 拉伸：让右侧文字块与封面等高 */
  align-items: stretch;
  gap: var(--space-lg);
  padding: var(--space-xs) var(--space-xl) var(--space-md);
}

.full-cover {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}

.full-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.full-cover-placeholder {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.3);
}

.full-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.full-title {
  font-size: 17px;
  line-height: 1.3;
  font-weight: 600;
  color: #fff;
}

.full-artist {
  font-size: 12.5px;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 5px;
}

.full-lyrics {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 var(--space-lg);
  scrollbar-width: none;
  /* 上下边缘渐隐：歌词从视野边缘淡入淡出 */
  mask-image: linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 20%,
    #000 80%,
    transparent 100%
  );
}

.full-lyrics::-webkit-scrollbar {
  display: none;
}

/* 首尾留白：让第一行与最后一行也能滚动到正中 */
.full-lyrics::before,
.full-lyrics::after {
  content: "";
  display: block;
  height: 42%;
}

.lyrics-empty {
  padding: var(--space-3xl) 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}

.full-lrc-line {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  margin: 0 auto;
  padding: 10px 0;
  max-width: 96%;
  text-align: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.32);
  transition:
    color var(--duration-normal) var(--ease-standard),
    filter var(--duration-normal) var(--ease-standard);
}

.full-lrc-text {
  font-size: 16px;
  line-height: 1.45;
  transition: font-size var(--duration-normal) var(--ease-standard);
}

/* 翻译副行：小字跟随原文的明暗层级 */
.full-lrc-translation {
  font-size: 12px;
  line-height: 1.4;
  color: inherit;
  opacity: 0.62;
  transition: opacity var(--duration-normal) var(--ease-standard);
}

/* 视觉层级：0 当前行 / 1~3 越远越模糊越淡 / 4 远端仅压暗 */
.full-lrc-line.level-0 {
  color: #fff;
}

.full-lrc-line.level-0 .full-lrc-text {
  font-size: 19px;
  font-weight: 700;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
}

.full-lrc-line.level-0 .full-lrc-translation {
  opacity: 0.88;
}

.full-lrc-line.level-1 {
  color: rgba(255, 255, 255, 0.68);
  filter: blur(0.6px);
}

.full-lrc-line.level-2 {
  color: rgba(255, 255, 255, 0.44);
  filter: blur(1.4px);
}

.full-lrc-line.level-3 {
  color: rgba(255, 255, 255, 0.26);
  filter: blur(2.4px);
}

.full-lrc-line.level-4 {
  color: rgba(255, 255, 255, 0.14);
}

.full-progress {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
}

.full-time {
  flex: none;
  width: 40px;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.55);
}

.full-progress-track {
  position: relative;
  flex: 1;
  /* 可见线只有 4px，但把整体高度撑到 26px 方便手指点按；
     背景只在正中画 4px 的线（border-box 下 padding 吃掉多余高度）。 */
  height: 26px;
  padding: 11px 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.22));
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 4px;
  cursor: pointer;
  /* 拖动进度条时不触发页面滚动 */
  touch-action: none;
}

.full-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.95);
  transform-origin: left center;
  transition: transform 0.18s linear;
}

/* 拖动时才显示，避免静止时干扰视觉 */
.full-progress-thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
  pointer-events: none;
}

.full-progress-thumb.dragging {
  opacity: 1;
}

/* 拖动时跟随手指的时间气泡 */
.full-progress-bubble {
  position: absolute;
  top: 0;
  margin-top: -8px;
  transform: translate(-50%, -100%);
  padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.full-controls {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  padding: var(--space-lg) 0 var(--space-xl);
}

.full-play-button {
  width: 62px;
  height: 62px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  color: #111;
  font-size: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.full-play-button:active {
  background: #fff;
  transform: scale(0.96);
}

/* ---------------- 歌词偏移面板 ---------------- */
.full-offset {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.45);
  z-index: 2;
}

.offset-panel {
  background: #1c1c22;
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  padding: var(--space-lg) var(--space-xl) calc(var(--space-lg) + var(--safe-area-bottom));
}

.offset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.offset-title {
  font-size: 15px;
  font-weight: 600;
}

.offset-hint {
  margin-top: var(--space-xs);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.offset-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  margin: var(--space-lg) 0;
}

.offset-step {
  min-width: 76px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.offset-step:active {
  background: rgba(255, 255, 255, 0.2);
}

.offset-value {
  min-width: 84px;
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.offset-reset {
  width: 100%;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-md);
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  cursor: pointer;
}

.offset-reset:active {
  background: rgba(255, 255, 255, 0.1);
}

/* 播放速度：档位网格 */
.rate-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
  margin: var(--space-lg) 0 var(--space-sm);
}

.rate-option {
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.rate-option:active {
  background: rgba(255, 255, 255, 0.2);
}

.rate-option.active {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.92);
  color: #111;
  font-weight: 600;
}

/* 播放音质：纵向档位列表（档位文本较长，不适合网格） */
.quality-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: var(--space-lg) 0 var(--space-sm);
}

.quality-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 46px;
  padding: 0 var(--space-lg);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard);
}

.quality-option:active {
  background: rgba(255, 255, 255, 0.2);
}

.quality-option.active {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.92);
  color: #111;
  font-weight: 600;
}

.quality-check {
  font-size: 14px;
}

/* 「更多」二级菜单：入口列表 */
.more-list {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-sm);
}

.more-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 52px;
  padding: 0 var(--space-xs);
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.more-row:last-child {
  border-bottom: none;
}

.more-row:active {
  background: rgba(255, 255, 255, 0.06);
}

.more-row-icon {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.7);
}

.more-row-label {
  flex: 1;
  min-width: 0;
}

.more-row-value {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.more-row-chevron {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

/* 深色面板内的图标按钮统一改为浅色 */
.offset-header .wp-icon-button,
.queue-sheet-header .wp-icon-button {
  color: rgba(255, 255, 255, 0.8);
}

/* ---------------- 播放队列（底部抽屉） ---------------- */
.full-queue {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.45);
  z-index: 2;
}

.queue-sheet {
  display: flex;
  flex-direction: column;
  max-height: 76%;
  background: #1c1c22;
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  padding-bottom: var(--safe-area-bottom);
  box-shadow: var(--shadow-flyout);
}

.queue-sheet-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-md) var(--space-md) var(--space-xl);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.queue-sheet-title {
  font-size: 15px;
  font-weight: 600;
}

.queue-sheet-count {
  flex: 1;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.queue-sheet-clear {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.queue-sheet-clear:active {
  background: rgba(255, 255, 255, 0.12);
}

.queue-sheet-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: var(--space-xs) var(--space-sm) var(--space-lg);
}

.queue-sheet-empty {
  padding: var(--space-3xl) var(--space-xl);
  text-align: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}

.queue-sheet-list {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
}

.queue-sheet-item {
  position: relative;
  min-height: 52px;
  border-radius: var(--radius-md);
  /* 裁剪左滑时露出的删除底色 */
  overflow: hidden;
  /* 纵向滚动交给列表，横向滑动由脚本接管 */
  touch-action: pan-y;
  transition: transform 0.18s var(--ease-standard);
  will-change: transform;
}

/* 拖拽排序中的行：抬高并加重阴影 */
.queue-sheet-item.dragged {
  z-index: 5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.queue-sheet-item.current .queue-sheet-name {
  color: #fff;
  font-weight: 600;
}

/* 左滑时露出的删除底色 */
.queue-sheet-remove-bg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding-right: 56px;
  /* 不使用 --wp-danger：暗色主题下它是浅粉，白字对比不足 */
  background: #d13b30;
  color: #fff;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.queue-sheet-item.swiping .queue-sheet-remove-bg {
  opacity: 1;
}

/* 内容层：不透明深色底，左滑时整块位移露出底色 */
.queue-sheet-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 52px;
  padding: var(--space-sm) var(--space-md);
  background: #1c1c22;
  transition: transform 0.18s var(--ease-standard);
}

.queue-sheet-item:active .queue-sheet-row {
  background: #26262e;
}

.queue-sheet-index {
  flex: none;
  width: 28px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.queue-sheet-playing {
  color: #fff;
  font-size: 12px;
}

.queue-sheet-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.queue-sheet-name {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.queue-sheet-artist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}

/* 拖拽把手：三点自制图标 */
.queue-sheet-handle {
  flex: none;
  width: 32px;
  height: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: grab;
  touch-action: none;
}

.queue-sheet-handle i {
  display: block;
  width: 12px;
  height: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.4);
}

.queue-sheet-remove {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.queue-sheet-remove:active {
  background: rgba(255, 255, 255, 0.12);
}

/* 拖拽落点指示线 */
.queue-sheet-drop {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
  list-style: none;
  pointer-events: none;
  z-index: 6;
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
</style>
