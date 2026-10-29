/**
 * 系统媒体控件桥接：Windows 走 SMTC，Android 走媒体通知（media-session 插件）。
 *
 * 前端把播放器状态整理成快照，Windows 推给 Rust（`smtc_sync`）写入
 * `SystemMediaTransportControls`（媒体浮出窗、锁屏、蓝牙设备），Android 则调
 * vendored 插件 `plugin:media-session|update_state` 显示 MediaStyle 媒体通知；
 * 系统侧的播放 / 暂停 / 上一首 / 下一首 / 拖动进度条反向驱动播放器。
 *
 * 推送策略：
 * - 曲目、播放状态、时长变化 → 立即同步（这些变化用户能立刻感知）
 * - 进度变化 → 节流到每秒一次，避免频繁 IPC
 * - 同一时刻只允许一个同步请求在途，新的快照会覆盖待发送的旧快照，
 *   保证系统侧最终收敛到最新状态且顺序不会错乱
 *
 * 车载模式（`setCarMode`）：标题换成当前歌词行、副标题换成「歌曲名 - 作者」。
 * 歌词会随播放逐句推进，因此这里额外挂一个轻量轮询，直接读引擎进度
 * ——窗口隐藏时 store 的 `currentTime` 会被后台优化冻结，靠响应式推送
 * 会让系统媒体控件一直停在同一句歌词上。
 */

import { addPluginListener, invoke, type PluginListener } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { watch, type WatchStopHandle } from "vue";
import { getAudioEngine } from "@/services/audio";
import { resolveImgUrl } from "@/services/imageCache";
import { isThrottled } from "@/services/backgroundMode";
import { findLyricIndex } from "@/services/lrc";
import type { LyricLine } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

/** Rust → 前端的按钮事件名（见 src-tauri/src/smtc.rs） */
const BUTTON_EVENT = "smtc-button";

/** 进度更新的最小间隔（毫秒） */
const POSITION_INTERVAL = 1_000;
/** 后台优化下的进度最大间隔：锁屏/蓝牙仍需要位置，但不能太频繁 */
const POSITION_INTERVAL_BACKGROUND = 5_000;
/**
 * 车载模式的歌词轮询间隔（毫秒）。
 * 比 1s 的进度推送更细：歌词换行后系统媒体控件最多滞后半秒，
 * 读的是引擎的非响应式进度，窗口隐藏时同样有效。
 */
const CAR_TICK_INTERVAL = 500;

export type SmtcStatus = "playing" | "paused" | "stopped";
export type SmtcButton = "play" | "pause" | "stop" | "next" | "previous" | "seek";

/** media-session 插件回传的媒体控件操作（vendored 插件 guest 事件） */
export interface MediaActionEvent {
  action: SmtcButton;
  /** 仅 seek 操作：目标位置（秒） */
  seekPosition?: number;
}

/** 与 Rust 端 `SmtcSnapshot` 对应的快照（serde 转换为 camelCase） */
export interface SmtcSnapshot {
  /** 是否存在已加载的曲目；false 时隐藏系统媒体控件 */
  active: boolean;
  status: SmtcStatus;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  /** 播放位置（毫秒） */
  positionMs: number;
  /** 总时长（毫秒） */
  durationMs: number;
}

/** 服务需要的播放器能力（避免服务反向依赖 store 造成循环引用） */
export interface SmtcPlayer {
  readonly currentTrack: UnifiedTrack | null;
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number;
  /** 当前曲目的歌词行（车载模式据此取「正在唱的那一句」） */
  readonly lyrics: LyricLine[];
  togglePlay(): Promise<void>;
  /** 确保处于播放态（系统「播放」按钮用：不依赖可能过时的 playing 位） */
  resume(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** 跳转到指定位置（秒），Android 媒体通知进度条拖动用 */
  seek(seconds: number): void;
}

/** 非 Tauri 环境（如浏览器里跑 `pnpm dev`）直接降级，不产生报错噪声 */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** SMTC 是 Windows 专属能力；Android 走 vendored media-session 插件 */
const onWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
const onAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

let player: SmtcPlayer | null = null;
let enabled = false;
let started = false;
let stopWatch: WatchStopHandle | null = null;
let unlisten: Promise<() => void> | null = null;
let mediaListener: Promise<PluginListener> | null = null;

let pending: SmtcSnapshot | null = null;
/** 最近一次进入发送流程的快照，用于判断变化是否“显著” */
let last: SmtcSnapshot | null = null;
let inFlight = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

/** 车载模式是否开启（可在 initSmtc 之前设置：启动时设置先于桥接初始化完成） */
let carMode = false;
/** 车载模式的歌词轮询计时器（仅车载模式且桥接已启动时存在） */
let carTimer: ReturnType<typeof setInterval> | null = null;

function inactiveSnapshot(): SmtcSnapshot {
  return {
    active: false,
    status: "stopped",
    title: "",
    artist: "",
    album: "",
    cover: null,
    positionMs: 0,
    durationMs: 0,
  };
}

/**
 * 当前进度对应的歌词文案（车载模式标题）。
 * 无歌词 / 还没到第一句（前奏）/ 当前行是空行（纯音乐段）时返回空串，
 * 由调用方回退成歌名。
 */
function carLyricText(positionSec: number): string {
  const lines = player?.lyrics ?? [];
  if (!lines.length) return "";

  const index = findLyricIndex(lines, Math.max(0, positionSec) * 1000);
  if (index < 0) return "";
  return (lines[index]?.text ?? "").trim();
}

/**
 * 引擎真实进度（秒）。
 * 后台优化会冻结 store 的 `currentTime`（见 backgroundMode），
 * 但引擎自己一直在推进；车载模式要的就是「隐藏窗口时歌词照样走」。
 */
function livePosition(): number {
  const engine = getAudioEngine();
  if (engine.currentTime > 0) return engine.currentTime;
  return player?.currentTime ?? 0;
}

function buildSnapshot(): SmtcSnapshot {
  const track = player?.currentTrack ?? null;
  if (!track) return inactiveSnapshot();

  // 车载模式下进度取引擎的真实值，其余场景沿用 store 的（已做后台节流的）进度
  const positionSec = carMode ? livePosition() : (player?.currentTime ?? 0);
  const positionMs = Math.max(0, Math.round(positionSec * 1000));
  const engineDurationMs = Math.round((player?.duration ?? 0) * 1000);
  const artist = (track.artists ?? []).join(" / ");
  const snapshot: SmtcSnapshot = {
    active: true,
    status: player?.playing ? "playing" : "paused",
    title: track.name,
    artist,
    album: track.album ?? "",
    // cover 可能是 cachedimg:// 改写地址（WebView 专属），还原成原图交给系统侧
    cover: resolveImgUrl(track.cover?.trim() ? track.cover : null),
    positionMs,
    durationMs: engineDurationMs > 0 ? engineDurationMs : (track.duration ?? 0),
  };

  if (!carMode) return snapshot;

  const lyric = carLyricText(positionSec);
  // 没有可显示的歌词行：退回「歌名 + 作者」，别让标题和副标题重复同一首歌名
  if (!lyric) return snapshot;

  return {
    ...snapshot,
    title: lyric,
    // 副标题固定为「歌曲名 - 作者」；专辑位一并让出来，避免系统在副标题后追加专辑名
    artist: artist ? `${track.name} - ${artist}` : track.name,
    album: "",
  };
}

/** 是否需要立即同步（曲目 / 状态 / 时长变化，而非单纯进度推进） */
function significant(previous: SmtcSnapshot, next: SmtcSnapshot): boolean {
  return (
    previous.active !== next.active ||
    previous.status !== next.status ||
    previous.title !== next.title ||
    previous.artist !== next.artist ||
    previous.album !== next.album ||
    previous.cover !== next.cover ||
    previous.durationMs !== next.durationMs
  );
}

function queue(snapshot: SmtcSnapshot): void {
  if (!enabled) return;
  const previous = pending ?? last;
  pending = snapshot;
  if (!previous || significant(previous, snapshot)) flush();
  else schedule();
}

function schedule(hidden = isThrottled()): void {
  if (timer !== null) return;
  // 后台优化时把进度推送放到 5s：锁屏/蓝牙设备仍需要位置，
  // 但不能像前台那样每秒一次占用 IPC
  const interval = hidden ? POSITION_INTERVAL_BACKGROUND : POSITION_INTERVAL;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, interval);
}

/** 快照 → media-session 插件的 MediaState（秒制，与 Rust 端结构对应） */
function toMediaState(snapshot: SmtcSnapshot, cover: string | null): Record<string, unknown> {
  return {
    title: snapshot.title,
    artist: snapshot.artist,
    album: snapshot.album,
    // 空串表示清除封面，避免上一首的封面残留
    artworkUrl: cover ?? "",
    duration: snapshot.durationMs / 1000,
    position: snapshot.positionMs / 1000,
    isPlaying: snapshot.status === "playing",
    canPrev: true,
    canNext: true,
    canSeek: true,
  };
}

/**
 * 封面地址解析：优先返回本地缓存文件（`file://` URI，秒加载且不依赖网络），
 * 缓存未命中时回退原图 URL（Windows 系统直连 / 安卓插件原生下载）。
 */
async function resolveCover(snapshot: SmtcSnapshot): Promise<string | null> {
  const url = snapshot.cover;
  if (!url) return null;
  const local = await invoke<string | null>("cover_cache_path", { url }).catch(() => null);
  return local ?? url;
}

async function send(snapshot: SmtcSnapshot): Promise<void> {
  const cover = await resolveCover(snapshot);
  if (onAndroid) {
    if (!snapshot.active) {
      await invoke("plugin:media-session|clear");
    } else {
      await invoke("plugin:media-session|update_state", { state: toMediaState(snapshot, cover) });
    }
    return;
  }
  await invoke("smtc_sync", { snapshot: { ...snapshot, cover } });
}

function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (inFlight || !pending) return;

  const snapshot = pending;
  pending = null;
  last = snapshot;
  inFlight = true;
  send(snapshot)
    .catch((error) => {
      if (warned) return;
      warned = true;
      console.warn("[smtc] 同步系统媒体控件失败：", error);
    })
    .finally(() => {
      inFlight = false;
      // 在途期间积累了新快照（含禁用时的隐藏快照），继续送最新的一份
      if (pending) flush();
    });
}

/**
 * 车载模式的歌词轮询：只为「窗口隐藏时标题仍跟着歌词走」而存在。
 * 前台时响应式进度本身就会推动快照，这里的 tick 只是把待发送的快照覆盖成最新一份。
 */
function startCarTicker(): void {
  if (carTimer !== null) return;
  carTimer = setInterval(() => {
    // 暂停 / 未播放时进度不动，标题不会变（开启开关时已主动推过一份）
    if (!carMode || !player?.playing) return;
    queue(buildSnapshot());
  }, CAR_TICK_INTERVAL);
}

function stopCarTicker(): void {
  if (carTimer === null) return;
  clearInterval(carTimer);
  carTimer = null;
}

function handleButton(action: string, seekPosition?: number): void {
  const target = player;
  if (!target) return;
  switch (action as SmtcButton) {
    case "play":
      // 不依赖可能过时的 playing 位：后台/锁屏期间引擎的 paused 事件可能
      // 没送达 WebView，若此处按 playing 拦截，系统发来的「播放」会被吞掉。
      void target.resume();
      break;
    case "pause":
    case "stop":
      if (target.playing) void target.togglePlay();
      break;
    case "next":
      void target.next();
      break;
    case "previous":
      void target.prev();
      break;
    case "seek":
      if (typeof seekPosition === "number" && Number.isFinite(seekPosition)) {
        target.seek(seekPosition);
      }
      break;
  }
}

/** 启动桥接：监听播放器状态并注册系统按钮回调（应用启动时调用一次） */
export function initSmtc(target: SmtcPlayer): void {
  if (started || !inTauri || !(onWindows || onAndroid)) return;
  started = true;
  player = target;

  if (onAndroid) {
    mediaListener = addPluginListener<MediaActionEvent>(
      "media-session",
      "media_action",
      (event) => handleButton(event.action, event.seekPosition)
    );
    mediaListener.catch(() => {
      mediaListener = null;
    });
  } else {
    unlisten = listen<string>(BUTTON_EVENT, (event) => handleButton(event.payload));
    unlisten.catch(() => {
      unlisten = null;
    });
  }

  stopWatch = watch(() => buildSnapshot(), (snapshot) => queue(snapshot), { immediate: true });
  // 设置可能先于桥接初始化读出（App.vue 的 watch 早于 initSmtc），这里补开轮询
  if (carMode && enabled) startCarTicker();
}

/**
 * 开关车载模式：标题显示当前歌词行，副标题显示「歌曲名 - 作者」。
 * 只改变系统媒体控件上的文案，播放与界面其余部分不受影响；切换后立刻推一份快照，
 * 免得系统侧停在旧标题上等下一次进度推送。
 */
export function setCarMode(value: boolean): void {
  if (carMode === value) return;
  carMode = value;
  if (!started) return;
  if (value && enabled) startCarTicker();
  else stopCarTicker();
  queue(buildSnapshot());
}

/** 开关系统媒体控件（设置项）。Android 媒体控件始终开启，开关只对 Windows 生效 */
export function setSmtcEnabled(value: boolean): void {
  if (onAndroid) {
    enabled = true;
    return;
  }
  if (!onWindows) return;
  const changed = enabled !== value;
  enabled = value;
  if (!started || !inTauri || !changed) return;

  if (value) {
    // 重新露出媒体控件时补开车载模式的歌词轮询（关闭期间已停掉，省得空转）
    if (carMode) startCarTicker();
    queue(buildSnapshot());
  } else {
    // 控件已撤下：歌词轮询没有再跑的意义
    stopCarTicker();
    // 立即撤下系统媒体控件，避免残留上一首的曲目信息
    pending = inactiveSnapshot();
    flush();
  }
}

/** 卸载桥接（应用退出时调用） */
export function disposeSmtc(): void {
  stopWatch?.();
  stopWatch = null;
  stopCarTicker();
  const pendingUnlisten = unlisten;
  unlisten = null;
  if (pendingUnlisten) void pendingUnlisten.then((fn) => fn()).catch(() => undefined);
  const pendingListener = mediaListener;
  mediaListener = null;
  if (pendingListener) {
    void pendingListener.then((l) => l.unregister()).catch(() => undefined);
  }
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
  player = null;
}
