/**
 * 列表内搜索 + 排序的纯函数集合。
 *
 * 供「我喜欢的音乐」「自建歌单」「专辑 / 歌手详情」等曲目列表页共用：
 * 页面只负责持有 query / sortKey / descending 三个状态，过滤与排序都走这里，
 * 保证各处行为（大小写、全半角、缺字段兜底）完全一致。
 */

import { trackArtist } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

/** 可排序字段 */
export type TrackSortKey = "default" | "name" | "artist" | "album" | "duration" | "added";

/** 排序菜单项（顺序即下拉框顺序） */
export const TRACK_SORT_OPTIONS: Array<{ key: TrackSortKey; label: string }> = [
  { key: "default", label: "默认顺序" },
  { key: "name", label: "歌曲名" },
  { key: "artist", label: "歌手" },
  { key: "album", label: "专辑" },
  { key: "duration", label: "时长" },
  { key: "added", label: "添加时间" },
];

/** 曲目唯一键（与 library.trackKey 一致，用于关联外部元数据） */
export function trackIdentity(track: UnifiedTrack): string {
  return `${track.sourceId ?? ""}:${track.id}`;
}

/** 中日韩字符判断：这些语言用 localeCompare 才有意义 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 文本比较：含中文时按本地化（拼音）排序，否则用固定 locale 的
 * localeCompare（数字按数值大小，如「第2章」排在「第10章」前）。
 */
function compareText(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1; // 空值统一沉底
  if (!b) return -1;
  if (CJK.test(a) || CJK.test(b)) return a.localeCompare(b, "zh-Hans-CN", { numeric: true });
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/**
 * 关键词命中判定：歌曲名 / 别名 / 歌手 / 专辑 / 来源名，任一包含即命中。
 * 关键词按空白切成多个词，全部命中才算命中（便于「周杰伦 夜曲」这类组合搜索）。
 */
export function matchesTrackQuery(
  track: UnifiedTrack,
  query: string,
  sourceName?: string,
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const haystack = [
    track.name ?? "",
    track.alias ?? "",
    ...(track.artists ?? []),
    track.album ?? "",
    sourceName ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * 排序：返回新数组，不改动入参。
 *
 * `addedAt` 是「曲目键 → 添加时间戳」的映射，缺失时按 0 处理
 * （`added` 排序在缺少元数据的页面上会退化为稳定排序，即原顺序）。
 */
export function sortTracks(
  tracks: UnifiedTrack[],
  key: TrackSortKey,
  descending: boolean,
  addedAt?: ReadonlyMap<string, number>,
): UnifiedTrack[] {
  if (key === "default") {
    const copy = [...tracks];
    return descending ? copy.reverse() : copy;
  }

  const timestamp = (track: UnifiedTrack): number => addedAt?.get(trackIdentity(track)) ?? 0;

  // 稳定排序：JS 的 Array.prototype.sort 自 ES2019 起保证稳定
  const sorted = [...tracks].sort((a, b) => {
    switch (key) {
      case "name":
        return compareText(a.name ?? "", b.name ?? "");
      case "artist":
        return compareText(trackArtist(a), trackArtist(b));
      case "album":
        return compareText(a.album ?? "", b.album ?? "");
      case "duration":
        return (a.duration ?? 0) - (b.duration ?? 0);
      case "added":
        return timestamp(a) - timestamp(b);
      default:
        return 0;
    }
  });
  return descending ? sorted.reverse() : sorted;
}
