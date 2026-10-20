/**
 * 睡眠定时器（Sleep Timer）。
 *
 * 三种停止方式：
 * - `duration`：N 分钟后停止；
 * - `clock`：到某个时刻（时:分）停止，该时刻今天已过则顺延到次日；
 * - `after-track`：播完当前曲目即停止（由 player store 在自动切歌边界处
 *   通过 `notifyTrackFinished()` 配合）。
 *
 * 状态只存在于内存：定时停止是一次性行为，重启应用后自然失效，
 * 不写入 settings 表（避免「上次设的 30 分钟」在第二天启动时突然生效）。
 *
 * 到点后的实际操作（暂停播放、清理预载与播放链）由 player store 注册的
 * 停止回调完成 —— 这里不直接依赖 player store，避免两个模块循环引用。
 */

import { computed, ref } from "vue";

export type SleepTimerMode = "off" | "duration" | "clock" | "after-track";

/** 当前模式 */
const mode = ref<SleepTimerMode>("off");

/** 目标时刻（毫秒时间戳）；`after-track` 模式下为 0 */
const deadlineAt = ref(0);

/** 每秒推进的时钟（驱动剩余时间显示与到点判定） */
const tickNow = ref(Date.now());

/** 到点回调（player store 注册） */
let stopHandler: (() => void) | null = null;

/** 秒级 ticker（仅在需要倒计时 / 到点判定的模式下运行） */
let ticker = 0;

/** 是否处于倒计时模式（duration / clock 需要按秒显示剩余时间） */
const countingDown = computed(() => mode.value === "duration" || mode.value === "clock");

/** 剩余秒数（非倒计时模式为 0） */
const remainingSeconds = computed(() =>
  countingDown.value ? Math.max(0, Math.ceil((deadlineAt.value - tickNow.value) / 1000)) : 0,
);

function stopTicker(): void {
  if (!ticker) return;
  window.clearInterval(ticker);
  ticker = 0;
}

function startTicker(): void {
  stopTicker();
  tickNow.value = Date.now();
  ticker = window.setInterval(() => {
    tickNow.value = Date.now();
    if (countingDown.value && remainingSeconds.value <= 0) fire();
  }, 1000);
}

/** 到点：清状态并通知播放器停止 */
function fire(): void {
  mode.value = "off";
  deadlineAt.value = 0;
  stopTicker();
  stopHandler?.();
}

/** 归零（不触发停止回调） */
function reset(): void {
  mode.value = "off";
  deadlineAt.value = 0;
  stopTicker();
}

/** 注册「到点停止播放」的回调（player store 初始化时调用） */
export function setSleepStopHandler(handler: (() => void) | null): void {
  stopHandler = handler;
}

/** N 分钟后停止（分钟数夹到 1–1440） */
function startMinutes(minutes: number): void {
  const safe = Math.min(1440, Math.max(1, Math.round(minutes)));
  mode.value = "duration";
  deadlineAt.value = Date.now() + safe * 60_000;
  startTicker();
}

/**
 * 到指定时刻停止（`hour` 0–23 / `minute` 0–59）。
 * 该时刻今天已过（或恰好等于现在）时顺延到明天。
 */
function startAtClock(hour: number, minute: number): void {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  mode.value = "clock";
  deadlineAt.value = target.getTime();
  startTicker();
}

/** 播完当前曲目后停止 */
function startAfterTrack(): void {
  reset();
  mode.value = "after-track";
}

/** 取消定时 */
function cancel(): void {
  reset();
}

/** 播放器在「曲目播完 / 即将自动衔接」时通知：`after-track` 模式下执行停止。返回是否触发了停止 */
export function notifyTrackFinished(): boolean {
  if (mode.value !== "after-track") return false;
  fire();
  return true;
}

/**
 * 检查倒计时是否已到点（幂等）。
 *
 * 窗口隐藏（关闭到托盘）时 WebView 的 `setInterval` 可能被系统降频，
 * 播放器每次收到引擎进度事件时顺带调用一次，保证到点即时停止。
 */
export function checkSleepDeadline(): void {
  if (!countingDown.value) return;
  if (Date.now() < deadlineAt.value) return;
  fire();
}

/** 剩余时间文案（m:ss / h:mm:ss） */
function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** 剩余时间（含 after-track 的文案） */
const remainingLabel = computed(() => {
  if (mode.value === "after-track") return "播完当前曲";
  if (!countingDown.value) return "";
  return formatRemaining(remainingSeconds.value);
});

/** 到点时刻文案，如「23:30」（仅 clock 模式） */
const deadlineLabel = computed(() => {
  if (mode.value !== "clock" || !deadlineAt.value) return "";
  const date = new Date(deadlineAt.value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
});

/** 本次定时是否已过夜（clock 模式且目标在明天），UI 用于提示「明天 07:00」 */
const deadlineIsTomorrow = computed(() => {
  if (mode.value !== "clock" || !deadlineAt.value) return false;
  const target = new Date(deadlineAt.value);
  const now = new Date();
  return target.getDate() !== now.getDate();
});

/** 睡眠定时器状态与方法（全局单例，多个组件共用同一份状态） */
export function useSleepTimer() {
  return {
    mode,
    countingDown,
    remainingSeconds,
    remainingLabel,
    deadlineLabel,
    deadlineIsTomorrow,
    startMinutes,
    startAtClock,
    startAfterTrack,
    cancel,
  };
}
