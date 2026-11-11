/**
 * 离线下载的前端 IPC 层：默认目录、单曲下载（含进度事件）、取消/删除/
 * 歌词写入/导出/定位/存在性检查。
 *
 * 具体队列编排、失败重试与离线索引落库见 stores/downloads.ts。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Rust 侧上报下载进度的事件名 */
export const DOWNLOAD_PROGRESS_EVENT = "download://progress";

/** 文件名模板变量（与 Rust 侧 DownloadVars 的 camelCase 字段一致） */
export interface DownloadVars {
  name: string;
  artist: string;
  album: string;
  /** 来源插件显示名 */
  source: string;
  /** 曲目 ID */
  id: string;
}

/** 下载进度 */
export interface DownloadProgress {
  taskId: string;
  downloaded: number;
  total: number;
  /** 平均速度（字节/秒） */
  speed: number;
}

/** 单曲下载结果 */
export interface DownloadResult {
  /** 音频文件落盘绝对路径 */
  path: string;
  size: number;
  hasLyrics: boolean;
}

/** 默认下载目录（桌面：音乐目录/WinPlayer；移动端：应用私有目录） */
export function downloadDefaultDir(): Promise<string> {
  return invoke<string>("download_default_dir");
}

/* ------------------------------ 歌曲标签 ------------------------------ */

/** 写进音频文件的元数据（camelCase 与 Rust 侧 TagWriteMeta 对齐） */
export interface TagWriteMeta {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number | null;
  trackNo?: number | null;
  discNo?: number | null;
}

/** 标签写入结果 */
export interface TagWriteResult {
  /** 元数据是否写进文件（false 表示容器不支持，需要退回数据库存储） */
  hasTags: boolean;
  hasCover: boolean;
  hasLyrics: boolean;
}

/** 离线文件标签回读结果 */
export interface OfflineTagInfo {
  path: string;
  hasTags: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  trackNo?: number | null;
  year?: string | null;
  durationMs?: number | null;
  /** 内嵌封面导出的协议地址（`http://localcover.localhost/`） */
  cover?: string | null;
  hasLyrics: boolean;
}

/**
 * 把元数据 / 封面 / 歌词写进已下载的音频文件。
 *
 * 封面在 Rust 侧现取现压（不带 Referer），失败只是不内嵌封面；
 * 整个标签写入失败时返回 `hasTags = false`，调用方应把元数据存进数据库兜底。
 */
export function writeDownloadTags(args: {
  path: string;
  meta: TagWriteMeta;
  coverUrl?: string | null;
  lyrics?: string | null;
}): Promise<TagWriteResult> {
  return invoke<TagWriteResult>("download_write_tags", {
    path: args.path,
    meta: args.meta,
    coverUrl: args.coverUrl ?? null,
    lyrics: args.lyrics ?? null,
  });
}

/** 批量回读离线文件的标签（离线索引载入时重建元数据） */
export function readDownloadTags(paths: string[]): Promise<OfflineTagInfo[]> {
  return invoke<OfflineTagInfo[]>("download_read_tags", { paths });
}

/** 下载单曲到本地；lyrics 非空时写同名 .lrc 边车 */
export function downloadSong(args: {
  taskId: string;
  url: string;
  dir: string;
  template: string;
  vars: DownloadVars;
  lyrics?: string | null;
  /** 直链必需请求头（防盗链），与播放一致 */
  headers?: Record<string, string> | null;
}): Promise<DownloadResult> {
  return invoke<DownloadResult>("download_song", {
    taskId: args.taskId,
    url: args.url,
    dir: args.dir,
    template: args.template,
    vars: args.vars,
    lyrics: args.lyrics ?? null,
    headers: args.headers ?? null,
  });
}

/** 取消指定任务的下载（保留断点，可续传） */
export function cancelDownload(taskId: string): Promise<void> {
  return invoke("download_cancel", { taskId });
}

/** 删除离线文件（音频 + 同名 .lrc + .part 残留） */
export function deleteDownload(path: string): Promise<void> {
  return invoke("download_delete", { path });
}

/** 写入文本文件（离线歌词边车） */
export function writeDownloadText(path: string, content: string): Promise<void> {
  return invoke("download_write_text", { path, content });
}

/** 读取文本文件（离线歌词），无文件返回 null */
export function readDownloadText(path: string): Promise<string | null> {
  return invoke<string | null>("download_read_text", { path });
}

/** 复制文件（导出到用户选择的目录） */
export function copyDownload(src: string, dest: string): Promise<void> {
  return invoke("download_copy", { src, dest });
}

/** 在系统文件管理器中定位文件 */
export function revealDownload(path: string): Promise<void> {
  return invoke("download_reveal", { path });
}

/** 批量检查文件是否仍存在 */
export function checkDownloads(paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("download_check", { paths });
}

/** 订阅下载进度，返回取消订阅函数 */
export function onDownloadProgress(
  handler: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>(DOWNLOAD_PROGRESS_EVENT, (event) => handler(event.payload));
}

/** 字节数格式化（B/KB/MB/GB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const text = index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1);
  return `${text} ${units[index]}`;
}

/** 判断错误是否来自用户主动取消下载 */
export function isCanceledError(error: unknown): boolean {
  // i18n-ignore：比对的是 **Rust 侧**的取消文案（原生层未接 i18n），不是界面文案
  return String(error).includes("已取消");
}
