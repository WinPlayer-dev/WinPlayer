/** 本地曲库：我喜欢的音乐 + 自定义歌单（SQLite 持久化） */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDb } from "@/services/db";
import { toast } from "@/services/toast";
import { hapticSuccess, hapticTap } from "@/services/haptics";
import type { UnifiedTrack } from "@/types/plugin";

export interface LocalPlaylist {
  id: number;
  name: string;
  description: string;
  cover: string;
  createdAt: number;
  updatedAt: number;
  trackCount?: number;
}

interface LikedRow {
  track: UnifiedTrack;
  likedAt: number;
}

export function trackKey(track: UnifiedTrack): string {
  return `${track.sourceId ?? ""}:${track.id}`;
}

export const useLibraryStore = defineStore("library", () => {
  const liked = ref<LikedRow[]>([]);
  const playlists = ref<LocalPlaylist[]>([]);

  const likedTracks = computed(() => liked.value.map((row) => row.track));
  const likedKeys = computed(() => new Set(liked.value.map((row) => trackKey(row.track))));

  function isLiked(track: UnifiedTrack): boolean {
    return likedKeys.value.has(trackKey(track));
  }

  async function loadLiked(): Promise<void> {
    const db = await getDb();
    const rows = await db.select<Array<{ track: string; liked_at: number }>>(
      "select track, liked_at from liked_songs order by liked_at desc",
    );
    liked.value = rows
      .map((row) => {
        try {
          return { track: JSON.parse(row.track) as UnifiedTrack, likedAt: row.liked_at };
        } catch {
          return null;
        }
      })
      .filter((row): row is LikedRow => row !== null);
  }

  async function loadPlaylists(): Promise<void> {
    const db = await getDb();
    const rows = await db.select<LocalPlaylist[]>(
      `select p.id, p.name, p.description, p.cover, p.created_at as createdAt, p.updated_at as updatedAt,
              (select count(*) from playlist_tracks t where t.playlist_id = p.id) as trackCount
       from playlists p order by p.updated_at desc`,
    );
    playlists.value = rows ?? [];
  }

  async function loadAll(): Promise<void> {
    await Promise.all([loadLiked(), loadPlaylists()]);
  }

  /** 收藏 / 取消收藏 */
  async function toggleLike(track: UnifiedTrack): Promise<boolean> {
    const db = await getDb();
    if (isLiked(track)) {
      await db.execute("delete from liked_songs where source_id = $1 and track_id = $2", [
        track.sourceId ?? "",
        track.id,
      ]);
      await loadLiked();
      hapticTap();
      toast("已取消喜欢", "info");
      return false;
    }
    await db.execute(
      "insert into liked_songs (source_id, track_id, track, liked_at) values ($1, $2, $3, $4)",
      [track.sourceId ?? "", track.id, JSON.stringify(track), Date.now()],
    );
    await loadLiked();
    hapticSuccess();
    toast("已添加到我喜欢的音乐", "success");
    return true;
  }

  async function createPlaylist(name: string, description = ""): Promise<LocalPlaylist | null> {
    const trimmed = name.trim();
    if (!trimmed) {
      toast("歌单名称不能为空", "error");
      return null;
    }
    const db = await getDb();
    const now = Date.now();
    await db.execute(
      "insert into playlists (name, description, cover, created_at, updated_at) values ($1, $2, '', $3, $3)",
      [trimmed, description, now],
    );
    await loadPlaylists();
    toast(`歌单「${trimmed}」创建成功`, "success");
    const rows = await db.select<Array<{ id: number }>>(
      "select id from playlists where created_at = $1 order by id desc limit 1",
      [now],
    );
    return rows?.length ? (playlists.value.find((p) => p.id === rows[0].id) ?? null) : null;
  }

  async function renamePlaylist(id: number, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getDb();
    await db.execute("update playlists set name = $1, updated_at = $2 where id = $3", [
      trimmed,
      Date.now(),
      id,
    ]);
    await loadPlaylists();
  }

  async function deletePlaylist(id: number): Promise<void> {
    const db = await getDb();
    await db.execute("delete from playlists where id = $1", [id]);
    await loadPlaylists();
    toast("歌单已删除", "info");
  }

  async function getPlaylistTracks(playlistId: number): Promise<UnifiedTrack[]> {
    const db = await getDb();
    const rows = await db.select<Array<{ track: string }>>(
      "select track from playlist_tracks where playlist_id = $1 order by position asc",
      [playlistId],
    );
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.track) as UnifiedTrack;
        } catch {
          return null;
        }
      })
      .filter((track): track is UnifiedTrack => track !== null);
  }

  /** 向歌单添加曲目（自动去重） */
  async function addTracksToPlaylist(playlistId: number, tracks: UnifiedTrack[]): Promise<number> {
    if (!tracks.length) return 0;
    const db = await getDb();
    const existing = await db.select<Array<{ track: string }>>(
      "select track from playlist_tracks where playlist_id = $1",
      [playlistId],
    );
    const existingKeys = new Set(
      existing
        .map((row) => {
          try {
            return trackKey(JSON.parse(row.track) as UnifiedTrack);
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    );

    let added = 0;
    const now = Date.now();
    let position = existing.length;
    for (const track of tracks) {
      if (existingKeys.has(trackKey(track))) continue;
      await db.execute(
        "insert into playlist_tracks (playlist_id, track, position, added_at) values ($1, $2, $3, $4)",
        [playlistId, JSON.stringify(track), position, now],
      );
      position += 1;
      added += 1;
    }
    await db.execute("update playlists set updated_at = $1 where id = $2", [now, playlistId]);
    await loadPlaylists();
    return added;
  }

  async function removeTrackFromPlaylist(playlistId: number, track: UnifiedTrack): Promise<void> {
    const db = await getDb();
    const rows = await db.select<Array<{ id: number; track: string }>>(
      "select id, track from playlist_tracks where playlist_id = $1",
      [playlistId],
    );
    const target = rows.find((row) => {
      try {
        return trackKey(JSON.parse(row.track) as UnifiedTrack) === trackKey(track);
      } catch {
        return false;
      }
    });
    if (!target) return;
    await db.execute("delete from playlist_tracks where id = $1", [target.id]);
    // 重排位置
    const remaining = rows.filter((row) => row.id !== target.id);
    for (const [index, row] of remaining.entries()) {
      await db.execute("update playlist_tracks set position = $1 where id = $2", [index, row.id]);
    }
    await db.execute("update playlists set updated_at = $1 where id = $2", [Date.now(), playlistId]);
    await loadPlaylists();
  }

  return {
    liked,
    playlists,
    likedTracks,
    likedKeys,
    isLiked,
    loadAll,
    loadLiked,
    loadPlaylists,
    toggleLike,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    getPlaylistTracks,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
  };
});
