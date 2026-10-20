/**
 * 播放历史（最近播放 / 播放次数）。
 *
 * 数据落在 SQLite 的 `play_history` 表（迁移见 003_history.sql），每首曲目
 * 一行，按 (source_id, track_id) 去重，记录首次 / 最近播放时间与累计次数。
 *
 * 写入时机由 player store 调用 `recordPlay(track)`：只在真正开始播放时写，
 * 而不是每次 load——否则暂停后继续、seek 后缓冲都会把次数灌水。
 * 「记录播放历史」关闭时这里全部短路，不产生任何写入。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDb } from "@/services/db";
import type { UnifiedTrack } from "@/types/plugin";

/** 历史条目（含曲目快照与统计） */
export interface HistoryEntry {
  track: UnifiedTrack;
  firstPlayed: number;
  lastPlayed: number;
  playCount: number;
}

/** 与 library.trackKey 保持一致的曲目键 */
function keyOf(sourceId: string, trackId: string): string {
  return `${sourceId}:${trackId}`;
}

export const useHistoryStore = defineStore("history", () => {
  /** 全量历史（按最近播放倒序），历史页与统计都基于它 */
  const entries = ref<HistoryEntry[]>([]);
  const loaded = ref(false);

  /** 是否启用记录（由设置项同步；关闭后不再写入，但已有数据保留） */
  const enabled = ref(true);

  /** 曲目键 → 播放次数（SongTable 显示次数列用） */
  const countMap = computed(() => {
    const map = new Map<string, number>();
    for (const entry of entries.value) {
      map.set(keyOf(entry.track.sourceId ?? "", entry.track.id), entry.playCount);
    }
    return map;
  });

  /** 最近播放（历史页默认视图） */
  const recent = computed(() => entries.value);

  /** 最常听：按次数倒序，次数相同按最近播放 */
  const mostPlayed = computed(() =>
    [...entries.value].sort(
      (a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed,
    ),
  );

  function countOf(track: UnifiedTrack): number {
    return countMap.value.get(keyOf(track.sourceId ?? "", track.id)) ?? 0;
  }

  async function load(): Promise<void> {
    const db = await getDb();
    const rows = await db.select<
      Array<{ track: string; first_played: number; last_played: number; play_count: number }>
    >("select track, first_played, last_played, play_count from play_history order by last_played desc");
    entries.value = rows
      .map((row) => {
        try {
          return {
            track: JSON.parse(row.track) as UnifiedTrack,
            firstPlayed: row.first_played,
            lastPlayed: row.last_played,
            playCount: row.play_count,
          };
        } catch {
          return null;
        }
      })
      .filter((row): row is HistoryEntry => row !== null);
    loaded.value = true;
  }

  /**
   * 记录一次播放。
   *
   * 用 upsert 一条 SQL 完成「首次插入 / 后续累加」，避免先查后写的竞态；
   * 曲目快照同步刷新，这样插件侧改名后历史页能显示最新名字。
   */
  async function recordPlay(track: UnifiedTrack): Promise<void> {
    if (!enabled.value) return;
    if (!track?.id) return;
    const sourceId = track.sourceId ?? "";
    const now = Date.now();
    try {
      const db = await getDb();
      await db.execute(
        `insert into play_history (source_id, track_id, track, first_played, last_played, play_count)
         values ($1, $2, $3, $4, $4, 1)
         on conflict(source_id, track_id) do update set
           track = $3,
           last_played = $4,
           play_count = play_count + 1`,
        [sourceId, track.id, JSON.stringify(track), now],
      );
      await load();
    } catch (error) {
      // 历史记录失败不应影响播放
      console.warn("[history] 写入播放历史失败", error);
    }
  }

  /** 删除单条历史 */
  async function removeEntry(track: UnifiedTrack): Promise<void> {
    const db = await getDb();
    await db.execute("delete from play_history where source_id = $1 and track_id = $2", [
      track.sourceId ?? "",
      track.id,
    ]);
    await load();
  }

  /** 清空全部历史 */
  async function clear(): Promise<void> {
    const db = await getDb();
    await db.execute("delete from play_history");
    entries.value = [];
  }

  /** 同步「记录播放历史」开关 */
  function setEnabled(value: boolean): void {
    enabled.value = value;
  }

  return {
    entries,
    loaded,
    enabled,
    recent,
    mostPlayed,
    countMap,
    countOf,
    load,
    recordPlay,
    removeEntry,
    clear,
    setEnabled,
  };
});
