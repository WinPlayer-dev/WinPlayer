/**
 * 曲目列表的搜索 / 排序状态（与 TrackListToolbar + SongTable 配套使用）。
 *
 * 典型用法：
 *
 * ```ts
 * const list = useTrackList(() => tracks.value, { addedAt: () => likedAtMap.value });
 * // 模板：<TrackListToolbar v-bind="list.toolbarProps" />
 * //       <SongTable :tracks="list.tracks.value" />
 * //       <EmptyState v-if="!list.tracks.value.length" … />
 * ```
 *
 * 所有派生值都是 computed，tracks 更新（刷新 / 增删）后自动重算。
 */

import { computed, ref } from "vue";
import {
  matchesTrackQuery,
  sortTracks,
  trackIdentity,
  type TrackSortKey,
} from "@/services/trackQuery";
import type { UnifiedTrack } from "@/types/plugin";

export interface UseTrackListOptions {
  /** 「添加时间」排序用的时间戳映射；缺省时该排序退化为默认顺序 */
  addedAt?: () => ReadonlyMap<string, number> | undefined;
  /** 搜索时额外参与匹配的来源名（如插件显示名） */
  sourceName?: (track: UnifiedTrack) => string | undefined;
  /** 默认排序字段，默认 "default" */
  defaultSort?: TrackSortKey;
  /** 默认是否降序，默认 false */
  defaultDescending?: boolean;
}

export function useTrackList(
  source: () => UnifiedTrack[],
  options: UseTrackListOptions = {},
) {
  const query = ref("");
  const sortKey = ref<TrackSortKey>(options.defaultSort ?? "default");
  const descending = ref(options.defaultDescending ?? false);

  const total = computed(() => source().length);

  /** 过滤 + 排序后的曲目：列表渲染与"播放全部"都用这一份 */
  const tracks = computed(() => {
    const addedAt = options.addedAt?.();
    const keyword = query.value.trim();
    const filtered = keyword
      ? source().filter((track) =>
          matchesTrackQuery(track, keyword, options.sourceName?.(track)),
        )
      : source();
    return sortTracks(filtered, sortKey.value, descending.value, addedAt);
  });

  /** 当前是否处于"有搜索词"的状态（空列表文案据此区分） */
  const filtering = computed(() => query.value.trim().length > 0);

  /** 与 v-model 风格一致的一组工具条属性 */
  const toolbarProps = computed(() => ({
    Query: query.value,
    SortKey: sortKey.value,
    Descending: descending.value,
    Shown: tracks.value.length,
    Total: total.value,
    "onUpdate:Query": (value: string) => {
      query.value = value;
    },
    "onUpdate:SortKey": (value: TrackSortKey) => {
      sortKey.value = value;
    },
    "onUpdate:Descending": (value: boolean) => {
      descending.value = value;
    },
  }));

  function clearQuery(): void {
    query.value = "";
  }

  return {
    query,
    sortKey,
    descending,
    tracks,
    total,
    filtering,
    toolbarProps,
    clearQuery,
  };
}

/** 曲目唯一键（重新导出，避免使用方再多 import 一个模块） */
export { trackIdentity };
