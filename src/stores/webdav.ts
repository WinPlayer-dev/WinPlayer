/**
 * WebDAV 曲库（内置播放源「WebDAV」）。
 *
 * 职责与 `stores/localMusic` 平行：
 * - 保存服务器配置（地址 / 用户名 / 密码 / 起始目录）；
 * - 递归列举远程目录并把曲目索引落到 `builtin_source_tracks`（JSON，按源分表存）；
 * - 把远程文件映射成与本地曲库同形的 `LibraryTrack`，从而复用同一套分组、
 *   搜索与详情逻辑；
 * - 播放取直链 + Basic Auth 头，歌词取同目录 `.lrc` / `.srt`。
 *
 * 与本地音乐的区别：启动时**不自动扫描**（要跑一遍网络），只读上次的索引，
 * 由用户在播放源弹窗或其曲库页手动「重新扫描」。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDb, getSetting, setSetting } from "@/services/db";
import {
  cacheWebdavCover,
  codecOfWebdavUrl,
  fetchWebdavText,
  normalizeServerUrl,
  scanWebdav,
  testWebdav,
  webdavMediaHeaders,
  type WebdavConfig,
  type WebdavFile,
  type WebdavScanProgress,
} from "@/services/webdav";
import {
  albumGroupToUnified,
  albumIdOf,
  artistGroupToUnified,
  buildAlbumGroups,
  buildArtistGroups,
  libraryTrackToUnified,
  type LibraryAlbumGroup,
  type LibraryArtistGroup,
  type LibraryTrack,
} from "@/services/libraryIndex";
import { srtToLrc } from "@/services/lrc";
import { toast } from "@/services/toast";
import type { AlbumDetail, ArtistDetail, UnifiedAlbum, UnifiedArtist } from "@/types/plugin";

/** 内置 WebDAV 源的 ID（同时也是曲目的 sourceId） */
export const WEBDAV_SOURCE_ID = "builtin.webdav";

/** 配置的持久化 key */
const CONFIG_KEY = "settings.builtinWebdav";

/** 曲目行（多带两个歌词字段） */
export interface WebdavTrack extends LibraryTrack {
  /** 同名歌词文件 URL（无则空串） */
  lyricsUrl: string;
  /** lrc / srt */
  lyricsFormat: string;
}

const EMPTY_CONFIG: WebdavConfig = {
  name: "",
  url: "",
  username: "",
  password: "",
  rootPath: "",
};

/** 封面预取并发：一次扫描最多同时抓 4 张（Rust 侧另有磁盘缓存，重复扫描不再下载） */
const COVER_CONCURRENCY = 4;

function toWebdavTrack(file: WebdavFile, cover: string): WebdavTrack {
  return {
    path: file.url,
    folder: file.dirUrl,
    fileName: file.fileName,
    size: file.size,
    mtime: file.mtime,
    title: file.title,
    artist: file.artist,
    album: file.album,
    albumArtist: file.albumArtist || file.artist,
    genre: "",
    year: "",
    trackNo: file.trackNo,
    discNo: file.discNo,
    duration: 0,
    bitrate: 0,
    cover,
    hasLyrics: Boolean(file.lyricsUrl),
    lyricsUrl: file.lyricsUrl,
    lyricsFormat: file.lyricsFormat,
  };
}

/** 曲目行 → 统一曲目结构（分组里的行是基类 `LibraryTrack`，这里只用到公共字段） */
export function webdavTrackToUnified(track: LibraryTrack) {
  return libraryTrackToUnified(track, WEBDAV_SOURCE_ID);
}

export const useWebdavStore = defineStore("webdav", () => {
  const config = ref<WebdavConfig>({ ...EMPTY_CONFIG });
  const tracks = ref<WebdavTrack[]>([]);
  const loaded = ref(false);
  const scanning = ref(false);
  const lastScanAt = ref(0);
  /** 上次扫描/连接的错误（弹窗内展示） */
  const error = ref("");
  const progress = ref<WebdavScanProgress>({ dirs: 0, files: 0 });

  const configured = computed(() => Boolean(config.value.url.trim()));
  const displayName = computed(() => config.value.name.trim() || "WebDAV");
  const trackCount = computed(() => tracks.value.length);

  const folderCounts = computed(() => {
    const map = new Map<string, number>();
    for (const track of tracks.value) map.set(track.folder, (map.get(track.folder) ?? 0) + 1);
    return map;
  });

  const albumGroups = computed<LibraryAlbumGroup[]>(() => buildAlbumGroups(tracks.value));
  const artistGroups = computed<LibraryArtistGroup[]>(() => buildArtistGroups(tracks.value));
  const albumCount = computed(() => albumGroups.value.length);
  const artistCount = computed(() => artistGroups.value.length);

  /* ------------------------------ 持久化 ------------------------------ */

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const saved = await getSetting<Partial<WebdavConfig>>(CONFIG_KEY, {});
      config.value = { ...EMPTY_CONFIG, ...saved };
      const db = await getDb();
      const rows = await db.select<Array<{ payload: string }>>(
        "select payload from builtin_source_tracks where source_id = $1",
        [WEBDAV_SOURCE_ID],
      );
      const parsed: WebdavTrack[] = [];
      for (const row of rows) {
        try {
          const track = JSON.parse(row.payload) as WebdavTrack;
          if (track?.path) parsed.push(track);
        } catch {
          /* 单行损坏不影响整体索引 */
        }
      }
      tracks.value = parsed;
    } catch (loadError) {
      console.error("加载 WebDAV 曲库失败", loadError);
    } finally {
      loaded.value = true;
    }
  }

  async function persistConfig(): Promise<void> {
    await setSetting(CONFIG_KEY, config.value);
  }

  /** 清空索引（切换服务器 / 起始目录后旧索引已失效） */
  async function clearIndex(): Promise<void> {
    tracks.value = [];
    lastScanAt.value = 0;
    const db = await getDb();
    await db.execute("delete from builtin_source_tracks where source_id = $1", [WEBDAV_SOURCE_ID]);
  }

  /** 保存配置；服务器或起始目录变化时清空旧索引 */
  async function saveConfig(next: WebdavConfig): Promise<void> {
    const normalized: WebdavConfig = {
      name: next.name.trim(),
      url: normalizeServerUrl(next.url),
      username: next.username.trim(),
      password: next.password,
      rootPath: next.rootPath.trim(),
    };
    const changed =
      normalizeServerUrl(config.value.url) !== normalized.url ||
      config.value.rootPath.trim() !== normalized.rootPath;
    config.value = normalized;
    await persistConfig();
    error.value = "";
    if (changed && tracks.value.length) await clearIndex();
  }

  /** 批量写库：按 path 只写新增/变化的行，删掉消失的行 */
  async function persistTracks(next: WebdavTrack[], removed: string[]): Promise<void> {
    const db = await getDb();
    const previous = new Map(tracks.value.map((track) => [track.path, track]));
    const changed = next.filter((track) => {
      const old = previous.get(track.path);
      return (
        !old ||
        old.size !== track.size ||
        old.mtime !== track.mtime ||
        old.cover !== track.cover ||
        old.title !== track.title ||
        old.artist !== track.artist ||
        old.album !== track.album
      );
    });

    const CHUNK = 20;
    for (let index = 0; index < changed.length; index += CHUNK) {
      const chunk = changed.slice(index, index + CHUNK);
      const values = chunk.map((_, row) => `($${row * 3 + 1}, $${row * 3 + 2}, $${row * 3 + 3})`);
      const params: unknown[] = [];
      for (const track of chunk) {
        params.push(WEBDAV_SOURCE_ID, track.path, JSON.stringify(track));
      }
      await db.execute(
        `insert or replace into builtin_source_tracks (source_id, path, payload) values ${values.join(",")}`,
        params,
      );
    }

    for (let index = 0; index < removed.length; index += 30) {
      const chunk = removed.slice(index, index + 30);
      const placeholders = chunk.map((_, i) => `$${i + 2}`);
      await db.execute(
        `delete from builtin_source_tracks where source_id = $1 and path in (${placeholders.join(",")})`,
        [WEBDAV_SOURCE_ID, ...chunk],
      );
    }
  }

  /** 预取封面（按目录去重；Rust 侧有磁盘缓存，重复调用不会再下载） */
  async function prefetchCovers(files: WebdavFile[]): Promise<Map<string, string>> {
    const covers = new Map<string, string>();
    const pending = [...new Set(files.map((file) => file.coverUrl).filter(Boolean))];
    for (let index = 0; index < pending.length; index += COVER_CONCURRENCY) {
      const batch = pending.slice(index, index + COVER_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((url) => cacheWebdavCover(url, config.value)),
      );
      results.forEach((result, offset) => {
        if (result.status === "fulfilled") covers.set(batch[offset], result.value);
      });
    }
    return covers;
  }

  /* ------------------------------ 扫描 ------------------------------ */

  async function scan(): Promise<void> {
    if (scanning.value) return;
    if (!loaded.value) await load();
    if (!configured.value) {
      error.value = "尚未配置 WebDAV 服务器";
      return;
    }

    scanning.value = true;
    error.value = "";
    progress.value = { dirs: 0, files: 0 };
    try {
      const files = await scanWebdav(config.value, (next) => {
        progress.value = next;
      });
      const covers = await prefetchCovers(files);
      const next = files.map((file) =>
        toWebdavTrack(file, covers.get(file.coverUrl) ?? ""),
      );
      const alive = new Set(next.map((track) => track.path));
      const removed = tracks.value.filter((track) => !alive.has(track.path)).map((track) => track.path);

      tracks.value = next;
      await persistTracks(next, removed);
      lastScanAt.value = Date.now();
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      error.value = message;
      toast(`WebDAV 扫描失败：${message}`, "error");
    } finally {
      scanning.value = false;
    }
  }

  /** 测试连接（不动索引）：成功返回 true，失败写入 `error` */
  async function testConnection(candidate: WebdavConfig): Promise<boolean> {
    error.value = "";
    try {
      await testWebdav({
        name: candidate.name,
        url: normalizeServerUrl(candidate.url),
        username: candidate.username.trim(),
        password: candidate.password,
        rootPath: candidate.rootPath.trim(),
      });
      return true;
    } catch (testError) {
      error.value = testError instanceof Error ? testError.message : String(testError);
      return false;
    }
  }

  /** 保存配置并立即扫描（弹窗的「保存并扫描」） */
  async function saveAndScan(next: WebdavConfig): Promise<void> {
    await saveConfig(next);
    await scan();
  }

  /* ------------------------------ 播放与歌词 ------------------------------ */

  function trackOf(path: string): WebdavTrack | undefined {
    return tracks.value.find((track) => track.path === path);
  }

  /** 播放直链（含 Basic Auth 头，交给原生解码器） */
  function songUrlOf(path: string): { url: string; codec: string; headers?: Record<string, string> } | null {
    const track = trackOf(path);
    if (!track || !configured.value) return null;
    return {
      url: track.path,
      codec: codecOfWebdavUrl(track.path),
      headers: webdavMediaHeaders(config.value),
    };
  }

  /** 读取歌词（同名 .lrc / .srt，SRT 转成 LRC 时间轴） */
  async function lyricsOf(path: string): Promise<string | null> {
    const track = trackOf(path);
    if (!track?.lyricsUrl || !configured.value) return null;
    const text = await fetchWebdavText(config.value, track.lyricsUrl);
    if (!text?.trim()) return null;
    return track.lyricsFormat === "srt" ? srtToLrc(text) : text;
  }

  /* ------------------------------ 查询与映射 ------------------------------ */

  function searchTracks(keyword: string, limit = 200): WebdavTrack[] {
    const words = keyword
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    const matched: WebdavTrack[] = [];
    for (const track of tracks.value) {
      const haystack =
        `${track.title} ${track.fileName} ${track.artist} ${track.album} ${track.albumArtist}`.toLowerCase();
      if (words.every((word) => haystack.includes(word))) {
        matched.push(track);
        if (matched.length >= limit) break;
      }
    }
    return matched;
  }

  function searchAlbums(keyword: string): UnifiedAlbum[] {
    const lower = keyword.trim().toLowerCase();
    if (!lower) return [];
    return albumGroups.value
      .filter(
        (group) =>
          group.name.toLowerCase().includes(lower) || group.artist.toLowerCase().includes(lower),
      )
      .slice(0, 50)
      .map((group) => albumGroupToUnified(group, WEBDAV_SOURCE_ID));
  }

  function searchArtists(keyword: string): UnifiedArtist[] {
    const lower = keyword.trim().toLowerCase();
    if (!lower) return [];
    return artistGroups.value
      .filter((group) => group.name.toLowerCase().includes(lower))
      .slice(0, 50)
      .map((group) => artistGroupToUnified(group, WEBDAV_SOURCE_ID));
  }

  function albumDetail(id: string): AlbumDetail | null {
    const group = albumGroups.value.find((item) => item.id === id);
    if (!group) return null;
    return {
      ...albumGroupToUnified(group, WEBDAV_SOURCE_ID),
      tracks: group.tracks.map(webdavTrackToUnified),
    };
  }

  function artistDetail(id: string): ArtistDetail | null {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return null;
    return {
      ...artistGroupToUnified(group, WEBDAV_SOURCE_ID),
      albumCount: new Set(group.tracks.map((track) => albumIdOf(track))).size,
      hotTracks: group.tracks.slice(0, 50).map(webdavTrackToUnified),
    };
  }

  function artistAlbums(id: string): UnifiedAlbum[] {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return [];
    const albumIds = new Set(group.tracks.map((track) => albumIdOf(track)));
    return albumGroups.value
      .filter((album) => albumIds.has(album.id))
      .map((album) => albumGroupToUnified(album, WEBDAV_SOURCE_ID));
  }

  /** 应用启动时调用：只读配置与上次索引，不发网络请求 */
  async function init(): Promise<void> {
    await load();
  }

  return {
    config,
    tracks,
    loaded,
    scanning,
    lastScanAt,
    error,
    progress,
    configured,
    displayName,
    trackCount,
    albumCount,
    artistCount,
    folderCounts,
    albumGroups,
    artistGroups,
    load,
    init,
    scan,
    saveConfig,
    saveAndScan,
    testConnection,
    clearIndex,
    trackOf,
    songUrlOf,
    lyricsOf,
    searchTracks,
    searchAlbums,
    searchArtists,
    albumDetail,
    artistDetail,
    artistAlbums,
  };
});
