/**
 * 同频服务器协议层：内置播放源「同频服务器」与账号数据同步共用。
 *
 * 和 `services/webdav.ts` 一样，所有请求经 Rust 的 `http_fetch` 转发
 * （无 CORS 限制、可带任意请求头）。区别是这里需要登录态：
 * 每个请求带 `Authorization: Bearer <accessToken>`，过期了用 refresh token 换新的。
 *
 * 上传例外：音频体积大，走专用的 `cloud_upload` 命令（原始字节 + 进度事件），
 * 不走 `http_fetch` 的字符串请求体。
 */

import { invoke } from "@tauri-apps/api/core";
import { httpFetch } from "@/services/proxy";

/** 内置同频服务器源的 ID（同时作为曲目的 sourceId） */
export const CLOUD_SOURCE_ID = "builtin.cloud";

export interface CloudConfig {
  /** 服务器地址（已规范化） */
  url: string;
  /** 上次登录的用户名（只用于回填输入框） */
  username: string;
  /** 服务器自报的名称（用于展示） */
  serverName: string;
}

export interface CloudSession {
  token: string;
  refreshToken: string;
  /** access token 到期时间（毫秒时间戳） */
  expiresAt: number;
  userId: number;
}

export interface CloudUser {
  id: number;
  username: string;
  role: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface CloudServerInfo {
  name: string;
  version: number;
  registrationOpen: boolean;
  inviteRequired: boolean;
  needsFirstUser: boolean;
  maxUploadBytes: number;
}

/** 服务端曲目（与 `docs/API.md` 一致） */
export interface CloudTrack {
  hash: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  trackNo: number;
  discNo: number;
  duration: number;
  bitrate: number;
  codec: string;
  size: number;
  ext: string;
  hasCover: boolean;
  hasLyrics: boolean;
  originalName: string;
  createdAt: number;
  updatedAt: number;
}

export interface CloudAuthResult {
  user: CloudUser;
  token: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt?: number;
}

/** 允许上传的扩展名（与服务端白名单、原生解码器能力三边对齐） */
export const CLOUD_AUDIO_EXTS = new Set(["mp3", "flac", "m4a", "mp4", "m4b", "aac", "ogg", "oga", "wav"]);

/** 允许用户只填 `host` 或 `host:3456`：缺协议时默认 http（自建服务多为局域网/自签） */
export function normalizeCloudUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  return withScheme.replace(/\/+$/, "");
}

export function mediaHeaders(session: CloudSession | null): Record<string, string> | undefined {
  return session?.token ? { Authorization: `Bearer ${session.token}` } : undefined;
}

export function streamUrlOf(base: string, hash: string): string {
  return `${base}/api/tracks/${encodeURIComponent(hash)}/stream`;
}

/** 封面走 query token：`<img src>` 没法自定义请求头 */
export function coverUrlOf(base: string, hash: string, token: string): string {
  return `${base}/api/tracks/${encodeURIComponent(hash)}/cover?token=${encodeURIComponent(token)}`;
}

/* ------------------------------ 请求封装 ------------------------------ */

interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

export async function cloudRequest<T>(
  base: string,
  path: string,
  options: CallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const result = await httpFetch({
    url: `${base}${path}`,
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    responseType: "text",
    timeoutMs: options.timeoutMs ?? 20_000,
  });

  if (!result.ok) {
    let message = `HTTP ${result.status} ${result.statusText}`.trim();
    try {
      const parsed = JSON.parse(result.body ?? "") as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* 非 JSON 错误体：保留状态码信息 */
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = result.status;
    throw error;
  }

  if (!result.body) return null as T;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    throw new Error("服务器返回的不是合法的 JSON");
  }
}

export function statusOf(error: unknown): number {
  return (error as { status?: number })?.status ?? 0;
}

/* ------------------------------ 鉴权 ------------------------------ */

export function fetchServerInfo(base: string): Promise<CloudServerInfo> {
  return cloudRequest<CloudServerInfo>(base, "/api/server/info", { timeoutMs: 8000 });
}

export function login(base: string, username: string, password: string): Promise<CloudAuthResult> {
  return cloudRequest<CloudAuthResult>(base, "/api/auth/login", {
    method: "POST",
    body: { username, password, device: "WinPlayer" },
  });
}

export function register(
  base: string,
  username: string,
  password: string,
  inviteCode?: string,
): Promise<CloudAuthResult> {
  return cloudRequest<CloudAuthResult>(base, "/api/auth/register", {
    method: "POST",
    body: { username, password, inviteCode: inviteCode || undefined, device: "WinPlayer" },
  });
}

export function refreshSession(
  base: string,
  refreshToken: string,
): Promise<{ token: string; refreshToken: string; expiresIn: number }> {
  return cloudRequest(base, "/api/auth/refresh", {
    method: "POST",
    body: { refreshToken, device: "WinPlayer" },
  });
}

export function fetchMe(base: string, token: string): Promise<{ user: CloudUser; server: { name: string } }> {
  return cloudRequest(base, "/api/auth/me", { token });
}

/* ------------------------------ 曲库 ------------------------------ */

export interface CloudTrackList {
  tracks: CloudTrack[];
  total: number;
  usedBytes: number;
  quotaBytes: number;
}

export function fetchTracks(base: string, token: string): Promise<CloudTrackList> {
  return cloudRequest<CloudTrackList>(base, "/api/tracks?limit=20000", { token, timeoutMs: 60_000 });
}

export function fetchLyrics(base: string, token: string, hash: string): Promise<{ lrc: string }> {
  return cloudRequest<{ lrc: string }>(base, `/api/tracks/${encodeURIComponent(hash)}/lyrics`, { token });
}

export function patchTrack(
  base: string,
  token: string,
  hash: string,
  patch: Record<string, unknown>,
): Promise<{ track: CloudTrack }> {
  return cloudRequest<{ track: CloudTrack }>(base, `/api/tracks/${encodeURIComponent(hash)}`, {
    method: "PATCH",
    token,
    body: patch,
  });
}

export function deleteTrack(base: string, token: string, hash: string): Promise<{ ok: boolean }> {
  return cloudRequest<{ ok: boolean }>(base, `/api/tracks/${encodeURIComponent(hash)}`, {
    method: "DELETE",
    token,
  });
}

/** 封面：交给 Rust 下载并落到本地封面缓存，返回可直接给 `<img>` 用的地址 */
export function cacheCover(
  base: string,
  token: string,
  hash: string,
): Promise<string> {
  return invoke<string>("builtin_cover_fetch", {
    url: coverUrlOf(base, hash, token),
    headers: {},
  });
}

/* ------------------------------ 上传 ------------------------------ */

export type CloudUploadSource =
  | { kind: "path"; path: string }
  | { kind: "url"; url: string; headers?: Record<string, string> };

export interface CloudUploadProgress {
  taskId: string;
  phase: "download" | "upload";
  transferred: number;
  total: number;
}

export interface CloudUploadResult {
  track: CloudTrack;
  duplicate: boolean;
}

/** 上传一首歌（音频来源可以是本地文件路径，也可以是插件源的直链） */
export async function uploadTrack(options: {
  base: string;
  token: string;
  taskId: string;
  filename: string;
  source: CloudUploadSource;
}): Promise<CloudUploadResult> {
  const text = await invoke<string>("cloud_upload", {
    taskId: options.taskId,
    server: options.base,
    token: options.token,
    filename: options.filename,
    source: options.source,
  });
  return JSON.parse(text) as CloudUploadResult;
}

/** 监听上传进度（返回取消监听的函数） */
export async function onUploadProgress(
  handler: (progress: CloudUploadProgress) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<CloudUploadProgress>("cloud-upload-progress", (event) => {
    handler(event.payload);
  });
  return unlisten;
}

/* ------------------------------ 映射 ------------------------------ */

/** 服务端曲目 → 客户端曲库行（`path` 用 hash，天然跨设备稳定） */
export function cloudTrackToLibrary(track: CloudTrack): import("@/services/libraryIndex").LibraryTrack {
  return {
    path: track.hash,
    folder: "同频服务器",
    fileName: track.originalName || `${track.title || track.hash.slice(0, 8)}.${track.ext}`,
    size: track.size,
    mtime: Math.floor(track.updatedAt / 1000),
    title: track.title || track.hash.slice(0, 8),
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist || track.artist,
    genre: track.genre,
    year: track.year,
    trackNo: track.trackNo,
    discNo: track.discNo,
    duration: track.duration,
    bitrate: track.bitrate,
    cover: "",
    hasLyrics: track.hasLyrics,
  };
}
