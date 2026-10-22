/**
 * 内置播放源。
 *
 * 与插件走同一套协议（`PluginEntry` + `invoke(method, args)`），但实现不经过
 * Worker 沙箱：宿主在本地直接调用 `stores/localMusic` 与 Rust 命令。这样搜索页
 * Tab、设置里的「播放源 / 歌词源」、专辑与歌手详情页都能零改动地复用，
 * 而它并不出现在「已安装的插件」列表里，也无法被卸载。
 */

import {
  LOCAL_MUSIC_SOURCE_ID,
  toUnifiedTrack,
  useLocalMusicStore,
} from "@/stores/localMusic";
import { codecOfPath, readLocalLyrics } from "@/services/localMusic";
import { srtToLrc } from "@/services/lrc";
import { PLUGIN_API_VERSION } from "@/types/plugin";
import type { PluginEntry, PluginManifest } from "@/types/plugin";

/** 内置源通用接口（与 `PluginHost` 的运行时接口同形，便于在 store 里统一持有） */
export interface BuiltinSourceHost {
  readonly ready: Promise<void>;
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T | null>;
  dispose(): void;
}

export const BUILTIN_LOCAL_MANIFEST: PluginManifest = {
  id: LOCAL_MUSIC_SOURCE_ID,
  name: "本地音乐",
  version: "内置",
  description: "播放本机文件夹里的音乐，可读取 ID3 / FLAC / MP4 标签、内嵌封面与同名 SRT / LRC 歌词",
  author: "WinPlayer",
  apiVersion: PLUGIN_API_VERSION,
  // 声明 search 才能在搜索页出现 Tab、才能被设为「歌曲信息源 / 播放源」；
  // album / artist 让专辑、歌手详情页可以直接打开本地曲库里的分组
  capabilities: ["search", "songUrl", "lyrics", "album", "artist"],
};

/** 内置源在 store 里的「插件条目」 */
export const BUILTIN_LOCAL_ENTRY: PluginEntry = {
  id: LOCAL_MUSIC_SOURCE_ID,
  kind: "builtin",
  manifest: BUILTIN_LOCAL_MANIFEST,
};

/** 内置源 ID 集合（判断某个 record 是否内置） */
export const BUILTIN_SOURCE_IDS: ReadonlySet<string> = new Set([LOCAL_MUSIC_SOURCE_ID]);

export function isBuiltinSource(id: string | undefined): boolean {
  return Boolean(id && BUILTIN_SOURCE_IDS.has(id));
}

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

/** 内置源单例（按 id 取；未知 id 返回 null，调用方回落到插件宿主） */
const hosts = new Map<string, LocalMusicHost>();

export function builtinSourceHost(id: string): BuiltinSourceHost | null {
  if (!isBuiltinSource(id)) return null;
  let host = hosts.get(id);
  if (!host) {
    host = new LocalMusicHost();
    hosts.set(id, host);
  }
  return host;
}
