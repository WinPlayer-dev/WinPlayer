import type { UnifiedTrack } from "./plugin";

/** 播放模式 */
export type PlayMode = "sequential" | "loop-all" | "loop-one" | "shuffle";

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequential: "顺序播放",
  "loop-all": "列表循环",
  "loop-one": "单曲循环",
  shuffle: "随机播放",
};

/** 播放模式图标（Fluent Icons 码点实体）；顺序播放借用播放图标，避免与循环混淆 */
export function playModeIcon(mode: PlayMode): string {
  switch (mode) {
    case "shuffle":
      return "&#xEF37;";
    case "loop-one":
      return "&#xEF34;";
    case "loop-all":
      return "&#xF172;";
    default:
      return "&#xF610;";
  }
}

/** F610 在 Regular 字重撞码为电源键，顺序播放时需切到 Filled 字重 */
export function playModeIconFilled(mode: PlayMode): boolean {
  return !["shuffle", "loop-one", "loop-all"].includes(mode);
}

/** 播放倍速可选档位（0.5x–2.0x），与后端 player_set_rate 的取值范围一致 */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** 倍速显示文案，如 0.5x / 1x / 1.25x */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/** 播放队列条目 */
export interface QueueItem {  /** 队列内唯一标识（同曲目可重复入队） */
  uid: string;
  track: UnifiedTrack;
}

/** 歌词行 */
export interface LyricLine {
  /** 时间（毫秒） */
  time: number;
  text: string;
}

let uidCounter = 0;

/** 生成队列条目唯一 ID */
export function createQueueUid(): string {
  uidCounter += 1;
  return `${Date.now().toString(36)}-${uidCounter}`;
}

/** 格式化毫秒为 m:ss */
export function formatDuration(ms?: number): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return "--:--";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** 格式化秒为 m:ss（用于播放进度） */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/** 曲目显示名：歌名 - 艺术家 */
export function trackTitle(track: UnifiedTrack): string {
  return track.name || "未知歌曲";
}

export function trackArtist(track: UnifiedTrack): string {
  return track.artists?.length ? track.artists.join(" / ") : "未知艺术家";
}
