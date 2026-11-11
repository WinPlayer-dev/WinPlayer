/**
 * 桌面歌词（Desktop Lyrics）——主窗口侧控制器。
 *
 * 歌词本体画在一个**独立置顶透明窗口**里（Rust 侧 `commands::lyrics_window` 创建，
 * label = `desktop-lyrics`）。本模块只在主窗口运行，负责：
 *   1. 开关窗口（真相在 `settings.desktopLyricsEnabled`）；
 *   2. 把歌词 / 播放状态单向推给歌词窗口（`emitTo`）；
 *   3. 接收歌词窗口回传的指令（播放暂停 / 锁定 / 关闭）。
 *
 * 进度**不读** `player.currentTime`：窗口隐藏到托盘或最小化时，
 * `services/backgroundMode` 会让 player store 跳过响应式进度写入
 * （见 timeupdate 处理里的 `isThrottled()` 分支）。直接读它会让桌面歌词
 * 停在原地。这里自己订阅引擎的 timeupdate，拿到的是未经节流的真实进度。
 */

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { watch, type WatchStopHandle } from "vue";
import { t } from "@/i18n";
import { getAudioEngine } from "./audio";
import { cachedImgUrl } from "./imageCache";
import { findLyricIndex } from "./lrc";
import { toast } from "./toast";
import { trackArtist, trackTitle } from "@/types/player";
import type { usePlayerStore } from "@/stores/player";
import type { DesktopLyricsStyle, useSettingsStore } from "@/stores/settings";

/** 歌词窗口的 label（与 Rust 侧 `const LYRICS_WINDOW` 保持一致） */
export const LYRICS_WINDOW_LABEL = "desktop-lyrics";

/** 主 → 歌词窗口：一次完整的状态快照 */
const STATE_EVENT = "desktop-lyrics:state";
/** 歌词窗口 → 主：前端已挂载，请推首帧（窗口加载完成前推送会丢） */
const READY_EVENT = "desktop-lyrics:ready";
/** 歌词窗口 → 主：悬浮工具栏的操作 */
const COMMAND_EVENT = "desktop-lyrics:command";

export type DesktopLyricsCommand = "toggle-play" | "prev" | "next" | "lock" | "unlock" | "close";

export interface DesktopLyricsState {
  /** 上一行歌词（弱化显示；没有则为空串） */
  prev: string;
  /** 上一行的翻译（弱化显示；没有则为空串） */
  prevTranslation: string;
  /** 当前行歌词 */
  text: string;
  /** 当前行翻译（没有则为空串） */
  translation: string;
  /** 下一行歌词（弱化显示） */
  next: string;
  /** 下一行的翻译（弱化显示；没有则为空串） */
  nextTranslation: string;
  /** 换行序号：每换一行 +1，歌词窗口据此播入场动画 */
  seq: number;
  playing: boolean;
  /** 当前曲目是否真的取到了歌词（否则 text 是占位提示） */
  hasLyrics: boolean;
  style: DesktopLyricsStyle;
  fontSize: number;
  locked: boolean;
  /** 歌曲卡片外观用的歌曲信息（纯文字外观不显示，推过去也无害） */
  title: string;
  artist: string;
  /** 封面地址，已改写为 cachedimg 缓存地址；没有封面为空串 */
  cover: string;
}

type PlayerStore = ReturnType<typeof usePlayerStore>;
type SettingsStore = ReturnType<typeof useSettingsStore>;
/** 当前展示用曲目（已合并用户自定义信息） */
type TrackLike = NonNullable<PlayerStore["displayTrack"]>;

let player: PlayerStore | null = null;
let settings: SettingsStore | null = null;
let stopSettingsWatch: WatchStopHandle | null = null;
let stopStateWatch: WatchStopHandle | null = null;
let stopLockWatch: WatchStopHandle | null = null;
let stopEngine: (() => void) | null = null;
const unlisteners: UnlistenFn[] = [];

/** 歌词用的真实进度（秒），由引擎 timeupdate 驱动，不受后台节流影响 */
let engineTime = 0;
/** 换行序号 */
let seq = 0;
/** 上一次推送时的行号，用于判断「是否真的换行了」 */
let lastIndex = -1;
/** 上一次推送的曲目（切歌时要把进度基准清零，否则会用上一首的时间算出错误的行） */
let lastTrackKey = "";
/** 上一次推送的 payload（序列化后），用于去重——引擎进度变化很密集 */
let lastPayload = "";

/* ------------------------------ 状态组装 ------------------------------ */

function buildState(): DesktopLyricsState {
  const store = player!;
  const config = settings!;
  const lines = store.lyrics;
  const track = store.displayTrack;
  const index = findLyricIndex(lines, engineTime * 1000);

  // 行号变化才推进 seq：歌词窗口用它做「换行」入场动画
  if (index !== lastIndex) {
    lastIndex = index;
    seq += 1;
  }

  const line = index >= 0 ? lines[index] : undefined;
  const hasLyrics = lines.length > 0;
  const title = track ? trackTitle(track) : "";
  const artist = track ? trackArtist(track) : "";

  let text = line?.text ?? "";
  if (!hasLyrics) {
    if (!track) text = "WinPlayer";
    else if (store.lyricsLoading) text = t("player.lyrics.loading");
    // 卡片外观上方已经有歌名 / 歌手了，这里只提示没有歌词
    else text = config.desktopLyricsStyle === "glass" ? t("player.lyrics.empty") : `${title} — ${artist}`;
  }

  const previous = index > 0 ? lines[index - 1] : undefined;
  const upcoming = hasLyrics ? lines[index + 1] : undefined;

  return {
    prev: previous?.text ?? "",
    prevTranslation: previous?.translation ?? "",
    text,
    translation: hasLyrics ? (line?.translation ?? "") : "",
    next: upcoming?.text ?? "",
    nextTranslation: upcoming?.translation ?? "",
    seq,
    playing: store.playing,
    hasLyrics,
    style: config.desktopLyricsStyle,
    fontSize: config.desktopLyricsFontSize,
    locked: config.desktopLyricsLocked,
    title,
    artist,
    cover: coverOf(track),
  };
}

/** 封面走 cachedimg 协议（与主界面同一份磁盘缓存），没有封面时回空串 */
function coverOf(track: TrackLike | null | undefined): string {
  return track?.cover ? (cachedImgUrl(track.cover) ?? "") : "";
}

/** 组装并推送；内容没变就不发（引擎每秒会抛很多次进度） */
function pushState(): void {
  if (!player || !settings) return;
  const state = buildState();
  const serialized = JSON.stringify(state);
  if (serialized === lastPayload) return;
  lastPayload = serialized;
  // 窗口没开 / 正在销毁时 emitTo 会失败，静默即可
  void emitTo(LYRICS_WINDOW_LABEL, STATE_EVENT, state).catch(() => {
    lastPayload = ""; // 让下次真正打开时能重推同样内容
  });
}

/** 把「锁定」同步给 Rust（穿透是窗口级属性，不在 payload 里生效） */
async function syncCursorPassthrough(): Promise<void> {
  if (!settings) return;
  try {
    await invoke("lyrics_window_set_ignore_cursor", {
      ignore: settings.desktopLyricsLocked,
    });
  } catch {
    /* 窗口不存在时忽略 */
  }
}

/* ------------------------------ 窗口开关 ------------------------------ */

async function openWindow(): Promise<void> {
  try {
    // 带上外观：窗口尺寸按外观决定（纯文字窗口比卡片小得多）
    await invoke("lyrics_window_open", { style: settings?.desktopLyricsStyle });
  } catch (error) {
    console.warn("[desktop-lyrics] 打开歌词窗口失败", error);
    toast(t("errors.generic.desktopLyricsOpenFailed"), "error");
    // 开关回落：否则界面停在「已开启」但桌面上什么都没有
    await settings?.setDesktopLyricsEnabled(false);
    return;
  }
  // 窗口已存在（比如被关到后台）时不会再有 ready 事件，这里补推一次
  pushState();
}

async function closeWindow(): Promise<void> {
  try {
    await invoke("lyrics_window_close");
  } catch {
    /* 已经关掉了 */
  }
}

async function applyEnabled(value: boolean): Promise<void> {
  if (value) await openWindow();
  else await closeWindow();
}

/* ------------------------------ 指令处理 ------------------------------ */

function handleCommand(command: unknown): void {
  if (!player || !settings) return;
  switch (command) {
    case "toggle-play":
      void player.togglePlay();
      break;
    case "prev":
      void player.prev();
      break;
    case "next":
      void player.next();
      break;
    // 锁定：点下去立刻穿透。锁定时歌词窗虽然收不到鼠标事件，但 Rust 侧会轮询
    // 游标位置，游标进入顶部工具栏热区时会临时放开穿透，所以「解锁」也能在歌词窗点
    case "lock":
      void settings.setDesktopLyricsLocked(true);
      break;
    case "unlock":
      void settings.setDesktopLyricsLocked(false);
      break;
    case "close":
      void settings.setDesktopLyricsEnabled(false);
      break;
    default:
      break;
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

export async function initDesktopLyrics(
  playerStore: PlayerStore,
  settingsStore: SettingsStore,
): Promise<void> {
  if (player) return;
  player = playerStore;
  settings = settingsStore;
  engineTime = playerStore.currentTime;

  // 进度：行号变化才推，避免每秒几十次跨窗口 IPC
  stopEngine = getAudioEngine().on("timeupdate", (time) => {
    engineTime = time;
    const index = findLyricIndex(player!.lyrics, time * 1000);
    if (index !== lastIndex) pushState();
  });

  // 歌词 / 曲目 / 开关样式变化：整体重推
  stopStateWatch = watch(
    [
      () => player!.lyrics,
      () => player!.playing,
      () => player!.lyricsLoading,
      // 用「来源 + 曲目 id」：不同来源可能撞 id，只监听 id 会漏掉切歌
      () => {
        const track = player!.currentTrack;
        return track ? `${track.sourceId}:${track.id}` : "";
      },
      // 封面 / 歌名会被「自定义歌曲信息」改写，且不改变曲目 id
      () => player!.displayTrack?.cover ?? "",
      () => player!.displayTrack?.name ?? "",
      () => settings!.desktopLyricsStyle,
      () => settings!.desktopLyricsFontSize,
      () => settings!.desktopLyricsLocked,
    ],
    () => {
      // 切歌：进度基准清零，否则新曲首帧会用上一首的时间定位到错误的行
      const track = player!.currentTrack;
      const key = track ? `${track.sourceId}:${track.id}` : "";
      if (key !== lastTrackKey) {
        lastTrackKey = key;
        engineTime = 0;
        lastIndex = -1;
      }
      pushState();
    },
  );

  // 开关与锁定：真相在 settings，服务只负责落到窗口上
  stopSettingsWatch = watch(
    () => settings!.desktopLyricsEnabled,
    (value) => void applyEnabled(value),
  );
  stopLockWatch = watch(
    () => settings!.desktopLyricsLocked,
    () => void syncCursorPassthrough(),
  );
  // 换外观时套用该外观上次的尺寸（用户拖过的尺寸会被记住，见 Rust on_resized）
  watch(
    () => settings!.desktopLyricsStyle,
    (style) => {
      if (!settings!.desktopLyricsEnabled) return;
      void invoke("lyrics_window_set_style", { style }).catch(() => {});
    },
  );

  unlisteners.push(
    await listen(READY_EVENT, () => {
      lastPayload = ""; // 新窗口不认旧快照
      pushState();
      void syncCursorPassthrough();
    }),
  );
  unlisteners.push(await listen(COMMAND_EVENT, (event) => handleCommand(event.payload)));

  if (settings.desktopLyricsEnabled) await applyEnabled(true);
}

export function disposeDesktopLyrics(): void {
  stopSettingsWatch?.();
  stopStateWatch?.();
  stopLockWatch?.();
  stopEngine?.();
  stopSettingsWatch = null;
  stopStateWatch = null;
  stopLockWatch = null;
  stopEngine = null;
  for (const off of unlisteners.splice(0)) off();
  player = null;
  settings = null;
  lastPayload = "";
  lastIndex = -1;
  lastTrackKey = "";
}
