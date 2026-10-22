/**
 * 内置播放源的共用曲库索引。
 *
 * 「本地音乐」与「WebDAV」拿到的都是同一形状的曲目行（路径/文件夹/文件名 +
 * 标题/歌手/专辑等元数据），差别只在曲目 ID 是本地绝对路径还是远程 URL。
 * 分组、搜索、转 `Unified*` 的规则完全一致，因此统一放在这里，避免两个 store
 * 各写一套、日后修一处漏一处。
 */

import type { UnifiedAlbum, UnifiedArtist, UnifiedTrack } from "@/types/plugin";

/** 曲库里的一行（本地 music / WebDAV 共用） */
export interface LibraryTrack {
  /**
   * 曲目 ID：本地音乐是绝对路径，WebDAV 是完整文件 URL。
   * 同时也是播放直链的解析依据（`local://<path>` / 远程 URL）。
   */
  path: string;
  /** 所属根（本地=配置的文件夹，WebDAV=所在目录 URL） */
  folder: string;
  fileName: string;
  size: number;
  /** 修改时间（Unix 秒） */
  mtime: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  trackNo: number;
  discNo: number;
  /** 时长（毫秒），未知为 0 */
  duration: number;
  bitrate: number;
  /** 封面地址（`localcover://` 协议或空串） */
  cover: string;
  hasLyrics: boolean;
}

/** 专辑分组 */
export interface LibraryAlbumGroup {
  id: string;
  name: string;
  artist: string;
  cover: string;
  tracks: LibraryTrack[];
}

/** 歌手分组 */
export interface LibraryArtistGroup {
  id: string;
  name: string;
  cover: string;
  tracks: LibraryTrack[];
}

/** 专辑 ID 的分隔符：标签里不可能出现，避免「歌手 - 专辑」拼接歧义 */
const ALBUM_ID_SEP = "\u0001";

/** 未知歌手 / 未知专辑的展示名（也作为分组键） */
export const UNKNOWN_ARTIST = "未知艺术家";
export const UNKNOWN_ALBUM = "未知专辑";

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 专辑展示用艺术家：优先 album artist，其次曲目艺术家 */
export function albumArtistOf(track: LibraryTrack): string {
  return track.albumArtist || track.artist || UNKNOWN_ARTIST;
}

export function artistOf(track: LibraryTrack): string {
  return track.artist || UNKNOWN_ARTIST;
}

export function albumNameOf(track: LibraryTrack): string {
  return track.album || UNKNOWN_ALBUM;
}

export function albumIdOf(track: LibraryTrack): string {
  return `${encodeURIComponent(albumArtistOf(track))}${ALBUM_ID_SEP}${encodeURIComponent(albumNameOf(track))}`;
}

export function parseAlbumId(id: string): { artist: string; album: string } {
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

/** 按 歌手 → 专辑 → 碟号 → 音轨号 的稳定顺序（专辑/歌手/曲目列表共用） */
export function compareTracks(a: LibraryTrack, b: LibraryTrack): number {
  const artist = albumArtistOf(a).localeCompare(albumArtistOf(b), "zh-Hans-CN");
  if (artist !== 0) return artist;
  const album = albumNameOf(a).localeCompare(albumNameOf(b), "zh-Hans-CN");
  if (album !== 0) return album;
  if (a.discNo !== b.discNo) return a.discNo - b.discNo;
  if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
  return a.fileName.localeCompare(b.fileName);
}

/** 按专辑分组 */
export function buildAlbumGroups(tracks: LibraryTrack[]): LibraryAlbumGroup[] {
  const map = new Map<string, LibraryAlbumGroup>();
  for (const track of tracks) {
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
    // 封面取第一张非空的（同专辑封面通常一致）
    if (!group.cover && track.cover) group.cover = track.cover;
    group.tracks.push(track);
  }
  for (const group of map.values()) {
    group.tracks.sort((a, b) => a.discNo - b.discNo || a.trackNo - b.trackNo || a.fileName.localeCompare(b.fileName));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 按歌手分组（按曲目数降序，热门歌手在前） */
export function buildArtistGroups(tracks: LibraryTrack[]): LibraryArtistGroup[] {
  const map = new Map<string, LibraryArtistGroup>();
  for (const track of tracks) {
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
}

/** 曲库行 → 统一曲目结构（内置源的所有上层接口都用它） */
export function libraryTrackToUnified(track: LibraryTrack, sourceId: string): UnifiedTrack {
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
    sourceId,
  };
}

export function albumGroupToUnified(group: LibraryAlbumGroup, sourceId: string): UnifiedAlbum {
  return {
    id: group.id,
    name: group.name,
    cover: group.cover || undefined,
    artistNames: [group.artist],
    artistIds: [group.artist],
    trackCount: group.tracks.length,
    sourceId,
  };
}

export function artistGroupToUnified(group: LibraryArtistGroup, sourceId: string): UnifiedArtist {
  return {
    id: group.id,
    name: group.name,
    avatar: group.cover || undefined,
    songCount: group.tracks.length,
    sourceId,
  };
}

/** 多关键词 AND 匹配（标题 / 文件名 / 歌手 / 专辑 / 专辑艺术家） */
export function matchKeywords(haystack: string, keyword: string): boolean {
  const words = keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  const text = haystack.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** 曲库模糊搜索 */
export function searchLibraryTracks(
  tracks: LibraryTrack[],
  keyword: string,
  limit = 200,
): LibraryTrack[] {
  if (!keyword.trim()) return [];
  const matched: LibraryTrack[] = [];
  for (const track of tracks) {
    const haystack = `${track.title} ${track.fileName} ${track.artist} ${track.album} ${track.albumArtist}`;
    if (matchKeywords(haystack, keyword)) {
      matched.push(track);
      if (matched.length >= limit) break;
    }
  }
  return matched;
}

/** 按关键词过滤曲目（曲库页用：空关键词返回全部） */
export function filterLibraryTracks(tracks: LibraryTrack[], keyword: string): LibraryTrack[] {
  if (!keyword.trim()) return tracks;
  return tracks.filter((track) =>
    matchKeywords(
      `${track.title} ${track.fileName} ${track.artist} ${track.album} ${track.albumArtist}`,
      keyword,
    ),
  );
}
