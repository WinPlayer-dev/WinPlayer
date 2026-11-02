/**
 * 歌曲自定义信息（用户手改的歌名 / 歌手 / 歌手主页 / 专辑 / 封面）。
 *
 * 三层数据各管一件事，互不覆盖：
 * - 来源给的原始元数据：随曲目快照存在 liked_songs / playlist_tracks / offline_songs；
 * - 用户改写：只存这张表（`track_meta`），字段缺省 = 沿用原始值；
 * - 展示：`decorate()` 把两者合起来给界面用，**只读**，绝不回写快照。
 *
 * 「只读装饰」这点很关键：喜欢 / 历史 / 歌单里存的是原始曲目，用户点「恢复原始
 * 信息」后各处立刻回到原样；如果把合并结果存进快照，撤销后就会留下改名的残影。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { getDb } from "@/services/db";
import { cachedImgUrl } from "@/services/imageCache";
import type { UnifiedTrack } from "@/types/plugin";

/** 一条自定义信息（字段缺省 = 该字段沿用原始值） */
export interface TrackMetaOverride {
  name?: string;
  /** 歌手名（支持多个） */
  artists?: string[];
  /** 与 artists 一一对应；null / 缺省表示该歌手没有站内主页 */
  artistIds?: Array<string | null>;
  /** 歌手 ID 所属播放源 */
  artistSourceId?: string;
  album?: string;
  albumId?: string;
  /** 专辑 ID 所属播放源 */
  albumSourceId?: string;
  /** 封面原图地址（http(s) 或 localcover 协议） */
  cover?: string;
  updatedAt: number;
}

/** 曲目 → 覆盖表的键（与 library.trackKey / player.trackUid 同构） */
export function trackMetaKey(track: UnifiedTrack): string {
  return `${track.sourceId ?? ""}:${track.id}`;
}

/** 去掉首尾空白的可选文本；空串统一当「没填」 */
function cleanText(value?: string): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

/** 规整一条覆盖：空字段删掉，全空则返回 null（等于没有覆盖） */
function normalize(input: Partial<TrackMetaOverride>): TrackMetaOverride | null {
  const artists = (input.artists ?? []).map((name) => name.trim()).filter(Boolean);
  const artistIds = artists.map((_, index) => {
    const id = input.artistIds?.[index];
    return id && String(id).trim() ? String(id).trim() : null;
  });
  const album = cleanText(input.album);
  const meta: TrackMetaOverride = {
    name: cleanText(input.name),
    artists: artists.length ? artists : undefined,
    artistIds: artists.length ? artistIds : undefined,
    artistSourceId: artists.length ? cleanText(input.artistSourceId) : undefined,
    album,
    albumId: album ? cleanText(input.albumId) : undefined,
    albumSourceId: album ? cleanText(input.albumSourceId) : undefined,
    cover: cleanText(input.cover),
    updatedAt: Date.now(),
  };
  const hasAny =
    meta.name ||
    meta.artists ||
    meta.album ||
    meta.cover;
  return hasAny ? meta : null;
}

export const useTrackMetaStore = defineStore("trackMeta", () => {
  /** 键 → 覆盖；整体替换以便 Vue 追踪（曲目数量远小于渲染频率，够用） */
  const overrides = ref<Record<string, TrackMetaOverride>>({});
  const loaded = ref(false);

  function get(track: UnifiedTrack): TrackMetaOverride | undefined {
    return overrides.value[trackMetaKey(track)];
  }

  function has(track: UnifiedTrack): boolean {
    return Boolean(overrides.value[trackMetaKey(track)]);
  }

  async function load(): Promise<void> {
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ source_id: string; track_id: string; meta: string }>>(
        "select source_id, track_id, meta from track_meta",
      );
      const next: Record<string, TrackMetaOverride> = {};
      for (const row of rows ?? []) {
        try {
          next[`${row.source_id}:${row.track_id}`] = JSON.parse(row.meta) as TrackMetaOverride;
        } catch {
          // 单条坏了不影响其它曲目
        }
      }
      overrides.value = next;
    } catch (error) {
      console.error("[trackMeta] 读取自定义歌曲信息失败", error);
    } finally {
      loaded.value = true;
    }
  }

  /** 保存（空字段自动丢弃；整条空等于删除） */
  async function save(track: UnifiedTrack, patch: Partial<TrackMetaOverride>): Promise<boolean> {
    const meta = normalize(patch);
    const key = trackMetaKey(track);
    const db = await getDb();
    if (!meta) {
      await db.execute("delete from track_meta where source_id = $1 and track_id = $2", [
        track.sourceId ?? "",
        track.id,
      ]);
      const next = { ...overrides.value };
      delete next[key];
      overrides.value = next;
      return false;
    }
    await db.execute(
      `insert into track_meta (source_id, track_id, meta, updated_at) values ($1, $2, $3, $4)
       on conflict(source_id, track_id) do update set meta = $3, updated_at = $4`,
      [track.sourceId ?? "", track.id, JSON.stringify(meta), meta.updatedAt],
    );
    overrides.value = { ...overrides.value, [key]: meta };
    return true;
  }

  /** 恢复原始信息（删掉这一条的覆盖） */
  async function reset(track: UnifiedTrack): Promise<void> {
    await save(track, {});
  }

  /**
   * 把覆盖套到曲目上（只读）。
   *
   * 没有任何覆盖时**原样返回同一个对象**：列表 `:key`、模板里的引用比较、
   * 以及各处 `track ===` 判定都不受影响。
   */
  function decorate(track: UnifiedTrack): UnifiedTrack {
    const patch = overrides.value[trackMetaKey(track)];
    if (!patch) return track;

    const artists = patch.artists?.length ? patch.artists : track.artists;
    const artistIds = patch.artists?.length ? patch.artistIds : track.artistIds;
    const hasAlbum = Boolean(patch.album);

    return {
      ...track,
      name: patch.name ?? track.name,
      artists,
      // 模型里 artistIds 是纯字符串数组：没有主页的歌手用空串占位（各列表按真假值判断能否跳转）
      artistIds: artistIds?.map((id) => id ?? ""),
      // 歌手 / 专辑 id 可能来自别的播放源（拿别处的歌当模板）：缺省仍是曲目自身的源
      artistSourceId: patch.artists?.length ? patch.artistSourceId ?? track.sourceId : track.artistSourceId,
      album: patch.album ?? track.album,
      albumId: hasAlbum ? patch.albumId : track.albumId,
      albumSourceId: hasAlbum ? patch.albumSourceId ?? track.sourceId : track.albumSourceId,
      cover: patch.cover ? cachedImgUrl(patch.cover) : track.cover,
    };
  }

  return {
    overrides,
    loaded,
    get,
    has,
    load,
    save,
    reset,
    decorate,
  };
});
