/**
 * 歌曲拖拽（把曲目拖到侧边栏歌单）
 *
 * 拖拽源（SongTable / 推荐页歌曲卡片）在 `dragstart` 调 `startTrackDrag()`，
 * 投放端（侧边栏）用 `isTrackDrag()` 判断是否本应用的曲目拖拽、`readDraggedTracks()`
 * 取回曲目。
 *
 * 内容除了写进 `dataTransfer` 自定义 MIME，还同时记在模块内存里：
 * - 部分 WebView / 浏览器在 `dragover` 阶段读不到自定义 MIME（甚至读不到 data），
 *   靠内存里的当前拖拽内容判断才能让投放区正常高亮；
 * - `dragstart` 与 `drop` 中间不会插入别的拖拽，内存内容一定是最新的一份。
 */

import { reactive } from "vue";
import type { UnifiedTrack } from "@/types/plugin";
import { trackTitle } from "@/types/player";

/** 自定义 MIME：避免把网页/文件/纯文本拖进侧边栏时被误判成歌曲 */
export const TRACK_DRAG_MIME = "application/x-winplayer-tracks";

interface TrackDragState {
  /** 正在拖拽曲目（用于高亮可投放区域、启用侧栏自动滚动） */
  active: boolean;
  /** 本次拖拽携带的曲目（当前只支持单曲，保留数组以便后续多选） */
  tracks: UnifiedTrack[];
}

export const trackDragState = reactive<TrackDragState>({ active: false, tracks: [] });

/** 全局兜底复位只挂一次（拖到窗口外松手时组件收不到 dragend） */
let globalResetBound = false;

function bindGlobalReset(): void {
  if (globalResetBound) return;
  globalResetBound = true;
  const reset = () => endTrackDrag();
  // capture 阶段监听，保证在任何页面内的 dragend 处理后状态一定复位；
  // 不监听 drop：drop 的 capture 回调会早于投放端自己的 drop 处理器，
  // 提前清空内存内容会让兜底读取拿不到曲目（dragend 一定会随后到达）
  window.addEventListener("dragend", reset, true);
}

/** 开始拖拽一组曲目（在 dragstart 里调用） */
export function startTrackDrag(event: DragEvent, tracks: UnifiedTrack[]): void {
  const list = tracks.filter(Boolean);
  if (!list.length) return;
  const dt = event.dataTransfer;
  if (dt) {
    dt.effectAllowed = "copyMove";
    dt.setData(TRACK_DRAG_MIME, JSON.stringify(list));
    // 有些平台没有 setData 就不启动拖拽，补一份纯文本（拖到编辑器里也说得过去）
    dt.setData("text/plain", list.map((track) => trackTitle(track)).join("\n"));
  }
  trackDragState.active = true;
  trackDragState.tracks = list;
  bindGlobalReset();
}

export function endTrackDrag(): void {
  if (!trackDragState.active && !trackDragState.tracks.length) return;
  trackDragState.active = false;
  trackDragState.tracks = [];
}

/** 当前事件是否是「歌曲拖拽」（dragover/dragenter 判断是否 preventDefault 用） */
export function isTrackDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (types && Array.from(types).includes(TRACK_DRAG_MIME)) return true;
  return trackDragState.active;
}

/** 读取本次拖拽的曲目（drop 时调用） */
export function readDraggedTracks(event: DragEvent): UnifiedTrack[] {
  const raw = event.dataTransfer?.getData(TRACK_DRAG_MIME);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as UnifiedTrack[];
    } catch {
      /* 解析失败就走内存兜底 */
    }
  }
  return trackDragState.tracks.slice();
}
