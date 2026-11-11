/**
 * 内置播放源。
 *
 * 与插件走同一套协议（`PluginEntry` + `invoke(method, args)`），但实现不经过
 * Worker 沙箱：宿主在本地直接调用对应的 store 与 Rust 命令。这样搜索页 Tab、
 * 设置里的「播放源 / 歌词源」、专辑与歌手详情页都能零改动地复用，
 * 而它们并不出现在「已安装的插件」列表里，也无法被卸载。
 *
 * 新增一个内置源只要两步：在 `BUILTIN_SOURCE_DEFS` 里加一条定义，
 * 再在 `createHost()` 里给出它的 `invoke` 实现。
 */

import { LOCAL_MUSIC_SOURCE_ID, toUnifiedTrack, useLocalMusicStore } from "@/stores/localMusic";
import {
  WEBDAV_SOURCE_ID,
  useWebdavStore,
  webdavTrackToUnified,
} from "@/stores/webdav";
import { useCloudStore } from "@/stores/cloud";
import { CLOUD_SOURCE_ID } from "@/services/cloud";
import { libraryTrackToUnified } from "@/services/libraryIndex";
import { codecOfPath, readLocalLyrics } from "@/services/localMusic";
import { srtToLrc } from "@/services/lrc";
import { PLUGIN_API_VERSION } from "@/types/plugin";
import type { PluginEntry, PluginManifest } from "@/types/plugin";
import { t } from "@/i18n";

/** 内置源通用接口（与 `PluginHost` 的运行时接口同形，便于在 store 里统一持有） */
export interface BuiltinSourceHost {
  readonly ready: Promise<void>;
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T | null>;
  dispose(): void;
}

/** 卡片 / 弹窗展示用的统计信息 */
export interface BuiltinSourceStats {
  /** 是否已完成配置（未配置的源不会出现在搜索页 Tab 与播放源下拉里） */
  configured: boolean;
  /** 一句话状态，如「3 个文件夹 · 128 首」「未配置」 */
  summary: string;
  tracks: number;
  albums: number;
  artists: number;
}

/** 一个内置播放源的定义（UI 与 store 共用同一份） */
export interface BuiltinSourceDef {
  id: string;
  name: string;
  /** 卡片上的一句话说明 */
  description: string;
  /** Segoe Fluent / MDL2 图标字形（`wp-icon` 字体） */
  icon: string;
  /** 图标底色（渐变用的两个颜色） */
  accent: string;
  manifest: PluginManifest;
  /** 当前配置状态（必须保持响应式：在 computed 里被读取） */
  stats: () => BuiltinSourceStats;
}

const LOCAL_MANIFEST: PluginManifest = {
  id: LOCAL_MUSIC_SOURCE_ID,
  name: t("plugins.builtin.local.name"),
  version: t("plugins.builtin.badge"),
  description: t("plugins.builtin.local.manifestDescription"),
  author: "WinPlayer",
  apiVersion: PLUGIN_API_VERSION,
  // 声明 search 才能在搜索页出现 Tab、才能被设为「歌曲信息源 / 播放源」；
  // album / artist 让专辑、歌手详情页可以直接打开曲库里的分组
  capabilities: ["search", "songUrl", "lyrics", "album", "artist"],
};

const WEBDAV_MANIFEST: PluginManifest = {
  id: WEBDAV_SOURCE_ID,
  name: t("plugins.builtin.webdav.name"),
  version: t("plugins.builtin.badge"),
  description: t("plugins.builtin.webdav.manifestDescription"),
  author: "WinPlayer",
  apiVersion: PLUGIN_API_VERSION,
  capabilities: ["search", "songUrl", "lyrics", "album", "artist"],
};

const CLOUD_MANIFEST: PluginManifest = {
  id: CLOUD_SOURCE_ID,
  name: t("plugins.builtin.cloud.name"),
  version: t("plugins.builtin.badge"),
  description: t("plugins.builtin.cloud.manifestDescription"),
  author: "WinPlayer",
  apiVersion: PLUGIN_API_VERSION,
  capabilities: ["search", "songUrl", "lyrics", "album", "artist"],
};

export const BUILTIN_LOCAL_MANIFEST = LOCAL_MANIFEST;
export const BUILTIN_WEBDAV_MANIFEST = WEBDAV_MANIFEST;
export const BUILTIN_CLOUD_MANIFEST = CLOUD_MANIFEST;

/** 内置源定义表（顺序即播放源管理页的排列顺序） */
export const BUILTIN_SOURCE_DEFS: BuiltinSourceDef[] = [
  {
    id: LOCAL_MUSIC_SOURCE_ID,
    name: t("plugins.builtin.local.name"),
    description: t("plugins.builtin.local.description"),
    // Fluent 图标字体（bundled）的真实码位：folder_24_regular
    icon: "\uF419",
    accent: "linear-gradient(135deg, #5b8cff, #7b5cff)",
    manifest: LOCAL_MANIFEST,
    stats: () => {
      const store = useLocalMusicStore();
      const folders = store.folders.length;
      return {
        // 本地音乐始终可用：没文件夹时只是曲库为空，不算「未配置」
        configured: true,
        summary: folders
          ? t("plugins.builtin.local.folderSummary", { folders, tracks: store.trackCount })
          : t("plugins.builtin.local.noFolder"),
        tracks: store.trackCount,
        albums: store.albumCount,
        artists: store.artistCount,
      };
    },
  },
  {
    id: WEBDAV_SOURCE_ID,
    name: t("plugins.builtin.webdav.name"),
    description: t("plugins.builtin.webdav.description"),
    // cloud_24_regular
    icon: "\uF2E5",
    accent: "linear-gradient(135deg, #22b8a6, #1f9bd1)",
    manifest: WEBDAV_MANIFEST,
    stats: () => {
      const store = useWebdavStore();
      const configured = store.configured;
      if (!configured) {
        return {
          configured: false,
          summary: t("plugins.builtin.webdav.unconfigured"),
          tracks: 0,
          albums: 0,
          artists: 0,
        };
      }
      return {
        configured: true,
        summary: store.trackCount
          ? t("plugins.builtin.webdav.trackSummary", {
              name: store.displayName,
              count: store.trackCount,
            })
          : t("plugins.builtin.webdav.pendingScan", { name: store.displayName }),
        tracks: store.trackCount,
        albums: store.albumCount,
        artists: store.artistCount,
      };
    },
  },
  {
    id: CLOUD_SOURCE_ID,
    name: t("plugins.builtin.cloud.name"),
    description: t("plugins.builtin.cloud.description"),
    // music_note_2_24_regular（Fluent 真实码位，别抄 MDL2 的）
    icon: "\uE855",
    accent: "linear-gradient(135deg, #4f7cff, #22b8a6)",
    manifest: CLOUD_MANIFEST,
    stats: () => {
      const store = useCloudStore();
      const configured = store.configured;
      if (!configured) {
        return {
          configured: false,
          summary: t("plugins.builtin.cloud.unconfigured"),
          tracks: 0,
          albums: 0,
          artists: 0,
        };
      }
      return {
        configured: true,
        summary: store.trackCount
          ? t("plugins.builtin.cloud.trackSummary", {
              name: store.displayName,
              count: store.trackCount,
            })
          : t("plugins.builtin.cloud.emptyLibrary", { name: store.displayName }),
        tracks: store.trackCount,
        albums: store.albumCount,
        artists: store.artistCount,
      };
    },
  },
];

export function builtinSourceDef(id: string | undefined): BuiltinSourceDef | undefined {
  return BUILTIN_SOURCE_DEFS.find((def) => def.id === id);
}

/** 内置源在 store 里的「插件条目」 */
export const BUILTIN_ENTRIES: PluginEntry[] = BUILTIN_SOURCE_DEFS.map((def) => ({
  id: def.id,
  kind: "builtin",
  manifest: def.manifest,
}));

/** 内置源 ID 集合（判断某个 record 是否内置） */
export const BUILTIN_SOURCE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SOURCE_DEFS.map((def) => def.id),
);

export function isBuiltinSource(id: string | undefined): boolean {
  return Boolean(id && BUILTIN_SOURCE_IDS.has(id));
}

/** 未配置的内置源不参与搜索 Tab / 播放源下拉（避免出现一个点了没反应的来源） */
export function isBuiltinSourceReady(id: string): boolean {
  const def = builtinSourceDef(id);
  return def ? def.stats().configured : true;
}

/* ------------------------------ 宿主实现 ------------------------------ */

/** 本地音乐的宿主实现 */
class LocalMusicHost implements BuiltinSourceHost {
  readonly ready: Promise<void> = Promise.resolve();

  dispose(): void {
    /* 无沙箱与计时器，无需清理 */
  }

  async invoke<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
    const store = useLocalMusicStore();
    await store.load();
    // 返回值按上层声明的泛型参数透传（实现内部不做类型收窄）
    const ok = <R>(value: unknown): R => value as R;

    switch (method) {
      case "search": {
        const keyword = String(args.keyword ?? "").trim();
        const type = args.type as string | undefined;
        if (type === "album") return ok<T>({ albums: store.searchAlbums(keyword) });
        if (type === "artist") return ok<T>({ artists: store.searchArtists(keyword) });
        if (type === "playlist") return ok<T>({ playlists: [] });
        const songs = store.searchTracks(keyword).map(toUnifiedTrack);
        return ok<T>({ songs, total: songs.length });
      }

      case "getSongUrl": {
        const path = String(args.id ?? "");
        // 文件可能已被移除：不在曲库里就当本档不可用，交给上层降级/回退
        if (!store.trackOf(path)) return null;
        return ok<T>({
          url: `local://${path}`,
          quality: "local",
          codec: codecOfPath(path),
        });
      }

      case "getLyrics": {
        const path = String(args.id ?? "");
        const lyrics = await readLocalLyrics(path);
        if (!lyrics?.text) return null;
        const lrc = lyrics.format === "srt" ? srtToLrc(lyrics.text) : lyrics.text;
        return ok<T>({ lrc });
      }

      case "getAlbum": {
        const detail = store.albumDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtist": {
        const detail = store.artistDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtistAlbums": {
        const albums = store.artistAlbums(String(args.id ?? ""));
        return ok<T>({ albums, total: albums.length, hasMore: false });
      }

      default:
        return null;
    }
  }
}

/** WebDAV 的宿主实现 */
class WebdavHost implements BuiltinSourceHost {
  readonly ready: Promise<void> = Promise.resolve();

  dispose(): void {
    /* 无沙箱与计时器，无需清理 */
  }

  async invoke<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
    const store = useWebdavStore();
    await store.load();
    if (!store.configured) return null;
    const ok = <R>(value: unknown): R => value as R;

    switch (method) {
      case "search": {
        const keyword = String(args.keyword ?? "").trim();
        const type = args.type as string | undefined;
        if (type === "album") return ok<T>({ albums: store.searchAlbums(keyword) });
        if (type === "artist") return ok<T>({ artists: store.searchArtists(keyword) });
        if (type === "playlist") return ok<T>({ playlists: [] });
        const songs = store.searchTracks(keyword).map(webdavTrackToUnified);
        return ok<T>({ songs, total: songs.length });
      }

      case "getSongUrl": {
        const info = store.songUrlOf(String(args.id ?? ""));
        if (!info) return null;
        return ok<T>({
          url: info.url,
          quality: "webdav",
          codec: info.codec,
          headers: info.headers,
        });
      }

      case "getLyrics": {
        const lrc = await store.lyricsOf(String(args.id ?? ""));
        return lrc ? ok<T>({ lrc }) : null;
      }

      case "getAlbum": {
        const detail = store.albumDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtist": {
        const detail = store.artistDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtistAlbums": {
        const albums = store.artistAlbums(String(args.id ?? ""));
        return ok<T>({ albums, total: albums.length, hasMore: false });
      }

      default:
        return null;
    }
  }
}

/** 同频服务器的宿主实现 */
class CloudHost implements BuiltinSourceHost {
  readonly ready: Promise<void> = Promise.resolve();

  dispose(): void {
    /* 无沙箱与计时器，无需清理 */
  }

  async invoke<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
    const store = useCloudStore();
    await store.load();
    if (!store.configured) return null;
    const ok = <R>(value: unknown): R => value as R;

    switch (method) {
      case "search": {
        const keyword = String(args.keyword ?? "").trim();
        const type = args.type as string | undefined;
        if (type === "album") return ok<T>({ albums: store.searchAlbums(keyword) });
        if (type === "artist") return ok<T>({ artists: store.searchArtists(keyword) });
        if (type === "playlist") return ok<T>({ playlists: [] });
        const songs = store.searchTracks(keyword).map((track) =>
          libraryTrackToUnified(track, CLOUD_SOURCE_ID),
        );
        return ok<T>({ songs, total: songs.length });
      }

      case "getSongUrl": {
        const info = store.songUrlOf(String(args.id ?? ""));
        if (!info) return null;
        return ok<T>({
          url: info.url,
          quality: "cloud",
          codec: info.codec,
          headers: info.headers,
        });
      }

      case "getLyrics": {
        const lrc = await store.lyricsOf(String(args.id ?? ""));
        return lrc ? ok<T>({ lrc }) : null;
      }

      case "getAlbum": {
        const detail = store.albumDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtist": {
        const detail = store.artistDetail(String(args.id ?? ""));
        return detail ? ok<T>(detail) : null;
      }

      case "getArtistAlbums": {
        const albums = store.artistAlbums(String(args.id ?? ""));
        return ok<T>({ albums, total: albums.length, hasMore: false });
      }

      default:
        return null;
    }
  }
}

/** 内置源宿主单例（按 id 取；未知 id 返回 null，调用方回落到插件宿主） */
const hosts = new Map<string, BuiltinSourceHost>();

export function builtinSourceHost(id: string): BuiltinSourceHost | null {
  if (!isBuiltinSource(id)) return null;
  let host = hosts.get(id);
  if (!host) {
    host =
      id === WEBDAV_SOURCE_ID
        ? new WebdavHost()
        : id === CLOUD_SOURCE_ID
          ? new CloudHost()
          : new LocalMusicHost();
    hosts.set(id, host);
  }
  return host;
}
