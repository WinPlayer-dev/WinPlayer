/**
 * 本地曲库（内置播放源「本地音乐」）。
 *
 * 职责：
 * - 管理用户添加的音乐文件夹（持久化到 settings 表）；
 * - 把 Rust 扫描结果与 SQLite 索引（`local_tracks`）对齐：只写变化的行、
 *   删除消失的行，未变化文件沿用旧元数据（增量扫描）；
 * - 把本地行映射为统一曲目结构（`UnifiedTrack`），供内置源宿主、曲库页、
 *   专辑/歌手详情页复用同一份数据。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { getDb, getSetting, setSetting } from "@/services/db";
import {
  scanLocalMusic,
  type KnownLocalFile,
  type ScannedAudioFile,
} from "@/services/localMusic";
import { toast } from "@/services/toast";
import type {
  AlbumDetail,
  ArtistDetail,
  UnifiedAlbum,
  UnifiedArtist,
  UnifiedTrack,
} from "@/types/plugin";

/** 内置本地音乐源的 ID（同时也是曲目的 sourceId） */
export const LOCAL_MUSIC_SOURCE_ID = "builtin.local";

/** 文件夹列表的持久化 key */
const FOLDERS_KEY = "settings.localMusicFolders";

/** 专辑 ID 的分隔符：标签里不可能出现，避免「歌手 - 专辑」拼接歧义 */
const ALBUM_ID_SEP = "\u0001";

/** 未知歌手 / 未知专辑的展示名（也作为分组键） */
const UNKNOWN_ARTIST = "未知艺术家";
const UNKNOWN_ALBUM = "未知专辑";

/** 曲库中的一行（`local_tracks` 表的映射） */
export interface LocalTrack {
  path: string;
  folder: string;
  fileName: string;
  size: number;
  mtime: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  trackNo: number;
  discNo: number;
  /** 时长（毫秒） */
  duration: number;
  bitrate: number;
  cover: string;
  hasLyrics: boolean;
}

/** 专辑分组 */
export interface LocalAlbumGroup {
  id: string;
  name: string;
  artist: string;
  cover: string;
  tracks: LocalTrack[];
}

/** 歌手分组 */
export interface LocalArtistGroup {
  id: string;
  name: string;
  cover: string;
  tracks: LocalTrack[];
}

const COLUMNS = [
  "path",
  "folder",
  "file_name",
  "size",
  "mtime",
  "title",
  "artist",
  "album",
  "album_artist",
  "genre",
  "year",
  "track_no",
  "disc_no",
  "duration",
  "bitrate",
  "cover",
  "has_lyrics",
] as const;

function rowOf(track: LocalTrack): unknown[] {
  return [
    track.path,
    track.folder,
    track.fileName,
    track.size,
    track.mtime,
    track.title,
    track.artist,
    track.album,
    track.albumArtist,
    track.genre,
    track.year,
    track.trackNo,
    track.discNo,
    track.duration,
    track.bitrate,
    track.cover,
    track.hasLyrics ? 1 : 0,
  ];
}

function toLocalTrack(row: Record<string, unknown>): LocalTrack {
  return {
    path: String(row.path ?? ""),
    folder: String(row.folder ?? ""),
    fileName: String(row.file_name ?? ""),
    size: Number(row.size ?? 0),
    mtime: Number(row.mtime ?? 0),
    title: String(row.title ?? ""),
    artist: String(row.artist ?? ""),
    album: String(row.album ?? ""),
    albumArtist: String(row.album_artist ?? ""),
    genre: String(row.genre ?? ""),
    year: String(row.year ?? ""),
    trackNo: Number(row.track_no ?? 0),
    discNo: Number(row.disc_no ?? 0),
    duration: Number(row.duration ?? 0),
    bitrate: Number(row.bitrate ?? 0),
    cover: String(row.cover ?? ""),
    hasLyrics: Number(row.has_lyrics ?? 0) === 1,
  };
}

/** 扫描结果 + 旧记录 → 曲库行（未变化的条目沿用旧元数据） */
function mergeScanned(file: ScannedAudioFile, previous: LocalTrack | undefined): LocalTrack {
  if (file.unchanged && previous) return previous;
  return {
    path: file.path,
    folder: file.folder,
    fileName: file.fileName,
    size: file.size,
    mtime: file.mtime,
    title: file.title ?? "",
    artist: file.artist ?? "",
    album: file.album ?? "",
    albumArtist: file.albumArtist ?? "",
    genre: file.genre ?? "",
    year: file.year ?? "",
    trackNo: file.trackNo ?? 0,
    discNo: file.discNo ?? 0,
    duration: file.durationMs ?? 0,
    bitrate: file.bitrate ?? 0,
    cover: file.cover ?? "",
    hasLyrics: file.hasLyrics,
  };
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 专辑展示用艺术家：优先 album artist，其次曲目艺术家 */
function albumArtistOf(track: LocalTrack): string {
  return track.albumArtist || track.artist || UNKNOWN_ARTIST;
}

function artistOf(track: LocalTrack): string {
  return track.artist || UNKNOWN_ARTIST;
}

function albumNameOf(track: LocalTrack): string {
  return track.album || UNKNOWN_ALBUM;
}

export function albumIdOf(track: LocalTrack): string {
  return `${encodeURIComponent(albumArtistOf(track))}${ALBUM_ID_SEP}${encodeURIComponent(albumNameOf(track))}`;
}

function parseAlbumId(id: string): { artist: string; album: string } {
  const index = id.indexOf(ALBUM_ID_SEP);
  if (index < 0) return { artist: "", album: id };
  try {
    return {
      artist: decodeURIComponent(id.slice(0, index)),
      album: decodeURIComponent(id.slice(index + ALBUM_ID_SEP.length)),
    };
  } catch {
    return { artist: "", album: id };
  }
}

/** 曲库行 → 统一曲目结构（内置源的所有上层接口都用它） */
export function toUnifiedTrack(track: LocalTrack): UnifiedTrack {
  const name = track.title || stripExtension(track.fileName);
  const artist = artistOf(track);
  return {
    id: track.path,
    name,
    artists: [artist],
    album: track.album || undefined,
    cover: track.cover || undefined,
    duration: track.duration || undefined,
    albumId: albumIdOf(track),
    artistIds: [artist],
    sourceId: LOCAL_MUSIC_SOURCE_ID,
  };
}

export const useLocalMusicStore = defineStore("localMusic", () => {
  /** 用户添加的音乐文件夹（绝对路径） */
  const folders = ref<string[]>([]);
  const tracks = ref<LocalTrack[]>([]);
  const loaded = ref(false);
  const scanning = ref(false);
  /** 上次扫描完成时间（毫秒） */
  const lastScanAt = ref(0);

  const trackCount = computed(() => tracks.value.length);

  /** 每个文件夹的曲目数（文件夹管理区展示） */
  const folderCounts = computed(() => {
    const map = new Map<string, number>();
    for (const track of tracks.value) map.set(track.folder, (map.get(track.folder) ?? 0) + 1);
    return map;
  });

  /** 按专辑分组（专辑视图 / 搜索的专辑结果 / getAlbum 都用同一份） */
  const albumGroups = computed<LocalAlbumGroup[]>(() => {
    const map = new Map<string, LocalAlbumGroup>();
    for (const track of tracks.value) {
      const id = albumIdOf(track);
      let group = map.get(id);
      if (!group) {
        group = {
          id,
          name: albumNameOf(track),
          artist: albumArtistOf(track),
          cover: track.cover,
          tracks: [],
        };
        map.set(id, group);
      }
      // 封面取第一张非空的（同专辑内嵌封面通常一致）
      if (!group.cover && track.cover) group.cover = track.cover;
      group.tracks.push(track);
    }
    for (const group of map.values()) {
      group.tracks.sort((a, b) => a.discNo - b.discNo || a.trackNo - b.trackNo || a.fileName.localeCompare(b.fileName));
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  });

  /** 按歌手分组 */
  const artistGroups = computed<LocalArtistGroup[]>(() => {
    const map = new Map<string, LocalArtistGroup>();
    for (const track of tracks.value) {
      const name = artistOf(track);
      let group = map.get(name);
      if (!group) {
        group = { id: name, name, cover: track.cover, tracks: [] };
        map.set(name, group);
      }
      if (!group.cover && track.cover) group.cover = track.cover;
      group.tracks.push(track);
    }
    for (const group of map.values()) {
      group.tracks.sort((a, b) => a.album.localeCompare(b.album) || a.discNo - b.discNo || a.trackNo - b.trackNo);
    }
    return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length);
  });

  const albumCount = computed(() => albumGroups.value.length);
  const artistCount = computed(() => artistGroups.value.length);

  /* ------------------------------ 持久化 ------------------------------ */

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      folders.value = await getSetting<string[]>(FOLDERS_KEY, []);
      const db = await getDb();
      const rows = await db.select<Array<Record<string, unknown>>>("select * from local_tracks");
      tracks.value = rows.map(toLocalTrack);
    } catch (error) {
      // 索引读不出来（迁移未执行 / 数据库损坏）不该拖垮整个应用：
      // 曲库降级为空，用户重新扫描即可重建
      console.error("加载本地曲库失败", error);
    } finally {
      loaded.value = true;
    }
  }

  async function persistFolders(): Promise<void> {
    await setSetting(FOLDERS_KEY, folders.value);
  }

  /** 批量写库：新增/变化的行 replace，消失的行删除（未变化的不触碰） */
  async function syncDatabase(next: LocalTrack[], removed: string[]): Promise<void> {
    const db = await getDb();
    const chunkSize = Math.max(1, Math.floor(400 / COLUMNS.length));

    for (let index = 0; index < next.length; index += chunkSize) {
      const chunk = next.slice(index, index + chunkSize);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((track, rowIndex) => {
        const base = rowIndex * COLUMNS.length;
        const placeholders = COLUMNS.map((_, colIndex) => `$${base + colIndex + 1}`);
        values.push(`(${placeholders.join(",")})`);
        params.push(...rowOf(track));
      });
      await db.execute(
        `insert or replace into local_tracks (${COLUMNS.join(",")}) values ${values.join(",")}`,
        params,
      );
    }

    for (let index = 0; index < removed.length; index += chunkSize) {
      const chunk = removed.slice(index, index + chunkSize);
      const placeholders = chunk.map((_, i) => `$${i + 1}`);
      await db.execute(
        `delete from local_tracks where path in (${placeholders.join(",")})`,
        chunk,
      );
    }
  }

  /* ------------------------------ 文件夹 ------------------------------ */

  /** 弹出目录选择框，支持一次选多个文件夹；已存在的自动去重 */
  async function addFolders(): Promise<number> {
    const picked = await open({
      multiple: true,
      directory: true,
      title: "选择音乐文件夹",
    });
    if (!picked) return 0;
    const list = (Array.isArray(picked) ? picked : [picked]).filter(
      (path): path is string => Boolean(path),
    );
    const added = list.filter((path) => !folders.value.includes(path));
    if (!added.length) return 0;
    folders.value = [...folders.value, ...added];
    await persistFolders();
    await scan();
    return added.length;
  }

  /** 移除文件夹：同步删掉该文件夹下的曲库记录 */
  async function removeFolder(folder: string): Promise<void> {
    folders.value = folders.value.filter((item) => item !== folder);
    await persistFolders();
    const gone = tracks.value.filter((track) => track.folder === folder);
    if (gone.length) {
      tracks.value = tracks.value.filter((track) => track.folder !== folder);
      await syncDatabase([], gone.map((track) => track.path));
    }
  }

  /* ------------------------------ 扫描 ------------------------------ */

  async function scan(): Promise<void> {
    if (scanning.value) return;
    if (!loaded.value) await load();
    if (!folders.value.length) {
      // 没有文件夹时清空索引（用户可能刚移除了全部文件夹）
      tracks.value = [];
      await syncDatabase([], []);
      return;
    }

    scanning.value = true;
    try {
      const known: KnownLocalFile[] = tracks.value.map((track) => ({
        path: track.path,
        size: track.size,
        mtime: track.mtime,
      }));
      const files = await scanLocalMusic(folders.value, known);

      const previous = new Map(tracks.value.map((track) => [track.path, track]));
      const next: LocalTrack[] = [];
      const changed: LocalTrack[] = [];
      for (const file of files) {
        const old = previous.get(file.path);
        const track = mergeScanned(file, old);
        next.push(track);
        // 未变化的条目不需要写库
        if (!file.unchanged || !old) changed.push(track);
      }

      const alive = new Set(next.map((track) => track.path));
      const removed = tracks.value.filter((track) => !alive.has(track.path)).map((track) => track.path);

      tracks.value = next;
      if (changed.length || removed.length) await syncDatabase(changed, removed);
      lastScanAt.value = Date.now();
    } catch (error) {
      console.error("扫描本地音乐失败", error);
      toast(`扫描本地音乐失败: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      scanning.value = false;
    }
  }

  /** 应用启动时调用：读索引后后台增量扫描（不阻塞首屏） */
  async function init(): Promise<void> {
    await load();
    if (folders.value.length) void scan();
  }

  /* ------------------------------ 查询与映射 ------------------------------ */

  function trackOf(path: string): LocalTrack | undefined {
    return tracks.value.find((track) => track.path === path);
  }

  /** 本地曲库模糊搜索（标题 / 文件名 / 歌手 / 专辑） */
  function searchTracks(keyword: string, limit = 200): LocalTrack[] {
    const words = keyword
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    const matched: LocalTrack[] = [];
    for (const track of tracks.value) {
      const haystack = `${track.title} ${track.fileName} ${track.artist} ${track.album} ${track.albumArtist}`.toLowerCase();
      if (words.every((word) => haystack.includes(word))) {
        matched.push(track);
        if (matched.length >= limit) break;
      }
    }
    return matched;
  }

  /** 搜索用的专辑结果 */
  function searchAlbums(keyword: string): UnifiedAlbum[] {
    const lower = keyword.trim().toLowerCase();
    if (!lower) return [];
    return albumGroups.value
      .filter(
        (group) =>
          group.name.toLowerCase().includes(lower) || group.artist.toLowerCase().includes(lower),
      )
      .slice(0, 50)
      .map((group) => ({
        id: group.id,
        name: group.name,
        cover: group.cover || undefined,
        artistNames: [group.artist],
        artistIds: [group.artist],
        trackCount: group.tracks.length,
        sourceId: LOCAL_MUSIC_SOURCE_ID,
      }));
  }

  /** 搜索用的歌手结果 */
  function searchArtists(keyword: string): UnifiedArtist[] {
    const lower = keyword.trim().toLowerCase();
    if (!lower) return [];
    return artistGroups.value
      .filter((group) => group.name.toLowerCase().includes(lower))
      .slice(0, 50)
      .map((group) => ({
        id: group.id,
        name: group.name,
        avatar: group.cover || undefined,
        songCount: group.tracks.length,
        sourceId: LOCAL_MUSIC_SOURCE_ID,
      }));
  }

  /** 专辑详情（AlbumView 通过内置源的 getAlbum 拿到它） */
  function albumDetail(id: string): AlbumDetail | null {
    const group = albumGroups.value.find((item) => item.id === id);
    if (!group) {
      // 兼容未编码的「歌手 + 专辑」直接传参
      const parsed = parseAlbumId(id);
      const fallback = albumGroups.value.find(
        (item) => item.name === parsed.album || item.id === `${parsed.artist}${ALBUM_ID_SEP}${parsed.album}`,
      );
      if (!fallback) return null;
      return albumDetail(fallback.id);
    }
    return {
      id: group.id,
      name: group.name,
      cover: group.cover || undefined,
      artistNames: [group.artist],
      artistIds: [group.artist],
      trackCount: group.tracks.length,
      tracks: group.tracks.map(toUnifiedTrack),
      sourceId: LOCAL_MUSIC_SOURCE_ID,
    };
  }

  /** 歌手详情（ArtistView 通过内置源的 getArtist 拿到它） */
  function artistDetail(id: string): ArtistDetail | null {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return null;
    return {
      id: group.id,
      name: group.name,
      avatar: group.cover || undefined,
      songCount: group.tracks.length,
      albumCount: new Set(group.tracks.map((track) => albumIdOf(track))).size,
      hotTracks: group.tracks.slice(0, 50).map(toUnifiedTrack),
      sourceId: LOCAL_MUSIC_SOURCE_ID,
    };
  }

  /** 歌手下的专辑（ArtistView 分页取用） */
  function artistAlbums(id: string): UnifiedAlbum[] {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return [];
    const albumIds = new Set(group.tracks.map((track) => albumIdOf(track)));
    return albumGroups.value
      .filter((album) => albumIds.has(album.id))
      .map((album) => ({
        id: album.id,
        name: album.name,
        cover: album.cover || undefined,
        artistNames: [album.artist],
        artistIds: [album.artist],
        trackCount: album.tracks.length,
        sourceId: LOCAL_MUSIC_SOURCE_ID,
      }));
  }

  return {
    folders,
    tracks,
    loaded,
    scanning,
    lastScanAt,
    trackCount,
    albumCount,
    artistCount,
    folderCounts,
    albumGroups,
    artistGroups,
    load,
    init,
    scan,
    addFolders,
    removeFolder,
    trackOf,
    searchTracks,
    searchAlbums,
    searchArtists,
    albumDetail,
    artistDetail,
    artistAlbums,
  };
});
