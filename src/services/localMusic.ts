/**
 * 本地音乐取数层（内置播放源「本地音乐」）。
 *
 * Rust 侧负责递归扫描、标签解析、封面落盘与歌词查找，这里只做命令封装与类型声明。
 * 增量扫描由上层（`stores/localMusic`）提供已索引文件的 size/mtime：
 * 未变化的文件不会重复解析标签。
 */

import { invoke } from "@tauri-apps/api/core";

/** 扫描结果：一个音频文件 */
export interface ScannedAudioFile {
  /** 绝对路径，同时作为曲目 ID */
  path: string;
  fileName: string;
  /** 所属配置文件夹 */
  folder: string;
  size: number;
  /** 修改时间（Unix 秒） */
  mtime: number;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  year?: string | null;
  trackNo?: number | null;
  discNo?: number | null;
  /** 时长（毫秒） */
  durationMs?: number | null;
  bitrate?: number | null;
  /** 内嵌封面协议地址 */
  cover?: string | null;
  hasLyrics: boolean;
  /**
   * 命中已索引列表且未变化：除路径/大小/时间外的字段为 null，
   * 调用方沿用数据库里的旧元数据
   */
  unchanged: boolean;
}

/** 已索引文件（增量扫描的比对基准） */
export interface KnownLocalFile {
  path: string;
  size: number;
  mtime: number;
}

/** 歌词文件内容 */
export interface LocalLyricsFile {
  text: string;
  /** lrc / srt / embedded（标签内嵌歌词） */
  format: string;
}

/** 扫描全部文件夹（`known` 用于跳过未变化文件） */
export function scanLocalMusic(
  folders: string[],
  known: KnownLocalFile[],
): Promise<ScannedAudioFile[]> {
  return invoke<ScannedAudioFile[]>("local_music_scan", { folders, known });
}

/** 读取某首本地歌曲的歌词（同名 .lrc > 同名 .srt > 内嵌），无歌词返回 null */
export function readLocalLyrics(path: string): Promise<LocalLyricsFile | null> {
  return invoke<LocalLyricsFile | null>("local_music_lyrics", { path });
}

/** 扩展名 → 原生解码器认的编码名（用于 `SongUrlResult.codec`） */
export function codecOfPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "m4a":
    case "m4b":
    case "mp4":
    case "aac":
      return "aac";
    case "flac":
      return "flac";
    case "ogg":
    case "oga":
      return "vorbis";
    case "wav":
      return "pcm";
    default:
      return "mp3";
  }
}
