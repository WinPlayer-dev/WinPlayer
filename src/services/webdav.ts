/**
 * WebDAV 协议层（内置播放源「WebDAV」）。
 *
 * 只做协议与解析，不碰状态：文件夹递归列举（PROPFIND Depth:1）、multistatus
 * 解析、文件名/文件夹推断元数据、同名歌词旁文件定位、封面代理。
 * 所有请求都经 Rust 的 `http_fetch` 转发（无 CORS 限制、可带任意请求头），
 * 播放直链则交给原生解码器，随 Range 请求带上同一套 Basic Auth 头。
 */

import { httpFetch } from "@/services/proxy";
import { invoke } from "@tauri-apps/api/core";
import { stripExtension } from "@/services/libraryIndex";

/** 一个 WebDAV 源的配置（持久化在 settings 表） */
export interface WebdavConfig {
  /** 显示名称（留空则用「WebDAV」） */
  name: string;
  /** 服务器地址，如 `https://dav.example.com/dav` */
  url: string;
  username: string;
  password: string;
  /** 起始目录（相对服务器地址），留空表示根 */
  rootPath: string;
}

/** 递归列举得到的一个音频文件 */
export interface WebdavFile {
  /** 完整文件 URL（同时作为曲目 ID） */
  url: string;
  /** 所在目录 URL */
  dirUrl: string;
  fileName: string;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间（Unix 秒） */
  mtime: number;
  /** 同目录封面 URL（无则空串） */
  coverUrl: string;
  /** 同名歌词文件 URL（无则空串） */
  lyricsUrl: string;
  /** lrc / srt */
  lyricsFormat: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number;
  discNo: number;
}

/** 解码器能解的扩展名（与 Rust 扫描白名单保持一致） */
const AUDIO_EXTS = new Set(["mp3", "m4a", "mp4", "m4b", "aac", "flac", "ogg", "oga", "wav"]);

/** 同目录封面候选文件名（小写比较） */
const COVER_NAMES = [
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
  "album.jpg",
  "album.png",
];

/** 递归深度 / 目录数上限：防止误把超大网盘根目录整个爬一遍 */
const MAX_DEPTH = 10;
const MAX_DIRS = 4000;
const CONCURRENCY = 4;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

/* ------------------------------ 配置与请求头 ------------------------------ */

/** 允许用户只填 `host/dav`：缺协议时默认 https */
export function normalizeServerUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return withScheme.replace(/\/+$/, "");
}

/** 起始目录 URL（带结尾斜杠，便于 href 相对解析） */
export function rootUrlOf(config: WebdavConfig): string {
  const base = normalizeServerUrl(config.url);
  if (!base) return "";
  const root = (config.rootPath ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!root) return `${base}/`;
  const encoded = root
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encoded}/`;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** WebDAV 请求头（Basic Auth + 可选的额外头） */
export function webdavHeaders(
  config: WebdavConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (config.username) {
    headers.Authorization = `Basic ${base64Utf8(`${config.username}:${config.password}`)}`;
  }
  return headers;
}

/** 播放直链需要的请求头（交给原生解码器，随每次 Range 请求发出） */
export function webdavMediaHeaders(config: WebdavConfig): Record<string, string> | undefined {
  if (!config.username) return undefined;
  return { Authorization: `Basic ${base64Utf8(`${config.username}:${config.password}`)}` };
}

/* ------------------------------ multistatus 解析 ------------------------------ */

interface DavEntry {
  /** 绝对 URL（不带结尾斜杠） */
  url: string;
  isDir: boolean;
  size: number;
  mtime: number;
  name: string;
}

/**
 * 取某个属性节点的文本。
 *
 * 注意属性不在 `<response>` 的直接子节点下，而是嵌在
 * `<propstat><prop><getcontentlength/>` 里，必须按后代查找。
 */
function textOf(element: Element, localName: string): string {
  const found = element.getElementsByTagNameNS("*", localName)[0];
  return found?.textContent?.trim() ?? "";
}

/** 是否存在某个后代节点（`<resourcetype><collection/></resourcetype>` 表示目录） */
function hasDescendant(element: Element, localName: string): boolean {
  return element.getElementsByTagNameNS("*", localName).length > 0;
}

/** href 末段解码（服务器有时返回未编码的中文/空格） */
function decodeSegment(url: string): string {
  const key = url.replace(/\/+$/, "");
  const segment = key.slice(key.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 去掉结尾斜杠后的 URL 比较键 */
function urlKey(url: string): string {
  return url.replace(/\/+$/, "");
}

function decodeName(href: string): string {
  const trimmed = href.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** 解析 PROPFIND 的 multistatus 响应（只保留子项，过滤掉自身条目） */
export function parseMultistatus(xml: string, requestUrl: string): DavEntry[] {
  if (!xml.trim()) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("服务器返回的不是合法的 WebDAV 响应");

  const responses = Array.from(doc.getElementsByTagNameNS("*", "response"));
  const base = requestUrl.endsWith("/") ? requestUrl : `${requestUrl}/`;
  const selfKey = urlKey(requestUrl);
  const entries: DavEntry[] = [];

  for (const response of responses) {
    const href = textOf(response, "href");
    if (!href) continue;
    let url: string;
    try {
      // href 可能是绝对路径（/dav/x）或完整 URL，统一按请求地址解析
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    const isDir = hasDescendant(response, "collection");
    const key = urlKey(url);
    if (key === selfKey) continue; // 自身条目

    const length = Number(textOf(response, "getcontentlength"));
    const modified = Date.parse(textOf(response, "getlastmodified"));
    const name = textOf(response, "displayname") || decodeName(href);
    entries.push({
      url: isDir ? `${key}/` : key,
      isDir,
      size: Number.isFinite(length) ? length : 0,
      mtime: Number.isFinite(modified) ? Math.floor(modified / 1000) : 0,
      name,
    });
  }
  return entries;
}

/* ------------------------------ 元数据推断 ------------------------------ */

/** `01. Artist - Title.flac` → 音轨号 / 艺术家 / 标题（推断不出就留空） */
export function parseTrackName(fileName: string): {
  title: string;
  artist: string;
  album: string;
  trackNo: number;
} {
  let rest = stripExtension(fileName).trim();
  let trackNo = 0;

  // 去掉形如 "01 " / "01." / "01 -" / "1_03 " 的编号
  const numbered = /^(\d{1,3})\s*[.\-_)]\s*(.+)$/.exec(rest) ?? /^(\d{1,3})\s+(.+)$/.exec(rest);
  if (numbered) {
    trackNo = Number(numbered[1]);
    rest = numbered[2].trim();
  }

  const parts = rest
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 3) {
    // Artist - Album - Title（专辑名仍以文件夹为准，这里只取首尾）
    return { title: parts[parts.length - 1], artist: parts[0], album: parts.slice(1, -1).join(" - "), trackNo };
  }
  if (parts.length === 2) {
    return { title: parts[1], artist: parts[0], album: "", trackNo };
  }
  return { title: rest, artist: "", album: "", trackNo };
}

/** 文件夹名 → 专辑 / 专辑艺术家：`2021 - Artist - Album`、`[2021] Album` 等 */
export function parseFolderName(name: string): { album: string; artist: string } {
  let text = name.trim();
  // 去掉开头年份：`2021 - `、`(2021) `、`[2021]`
  text = text.replace(/^[([{]?\d{4}[)\]}]?[\s._-]*/, "").trim();
  if (!text) return { album: name.trim(), artist: "" };

  const parts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { album: parts[parts.length - 1], artist: parts[0] };
  return { album: text, artist: "" };
}

function parentDirUrl(url: string): string {
  const key = url.replace(/\/+$/, "");
  const index = key.lastIndexOf("/");
  return index > 0 ? `${key.slice(0, index)}/` : key;
}

/** 是否是 CD1 / Disc 2 之类的分碟目录（此时专辑名要往上取一层） */
function isDiscFolder(name: string): boolean {
  return /^(cd|disc|disk|vol\.?)\s*\d+$/i.test(name.trim());
}

/** 隐藏 / 系统目录：不参与扫描 */
function isSkippedDir(name: string): boolean {
  if (!name || name.startsWith(".")) return true;
  return ["@eaDir", "#recycle", "$RECYCLE.BIN", "System Volume Information"].includes(name);
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/* ------------------------------ 列举与扫描 ------------------------------ */

async function propfind(config: WebdavConfig, url: string, depth: "0" | "1"): Promise<DavEntry[]> {
  const result = await httpFetch({
    url,
    method: "PROPFIND",
    headers: webdavHeaders(config, {
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    }),
    body: PROPFIND_BODY,
    responseType: "text",
    timeoutMs: 30_000,
  });

  if (result.status === 401 || result.status === 403) {
    throw new Error("认证失败：请检查用户名与密码");
  }
  if (result.status === 404) {
    throw new Error("路径不存在：请检查服务器地址与起始目录");
  }
  if (result.status === 405) {
    throw new Error("服务器不支持 WebDAV（PROPFIND 被拒绝）");
  }
  if (!result.ok) {
    throw new Error(`服务器返回 HTTP ${result.status} ${result.statusText}`.trim());
  }
  return parseMultistatus(result.body ?? "", url);
}

/** 测试连接：对起始目录发 Depth:0，能拿到 207/200 即视为可用 */
export async function testWebdav(config: WebdavConfig): Promise<number> {
  const root = rootUrlOf(config);
  if (!root) throw new Error("请先填写服务器地址");
  const entries = await propfind(config, root, "0");
  return entries.length;
}

export interface WebdavScanProgress {
  /** 已列举目录数 */
  dirs: number;
  /** 已发现音频文件数 */
  files: number;
}

/** 递归列举起始目录下的全部音频文件（BFS + 并发 4，跳过隐藏/系统目录） */
export async function scanWebdav(
  config: WebdavConfig,
  onProgress?: (progress: WebdavScanProgress) => void,
): Promise<WebdavFile[]> {
  const root = rootUrlOf(config);
  if (!root) throw new Error("请先填写服务器地址");

  const files: WebdavFile[] = [];
  /** 已列举过的目录（防止深度优先以外的情况重复请求） */
  const visited = new Set<string>();
  /** 已排队的目录（多个父目录指向同一子目录时只排一次） */
  const scheduled = new Set<string>([root]);
  let queue: Array<{ url: string; depth: number }> = [{ url: root, depth: 0 }];
  let dirs = 0;

  while (queue.length && dirs < MAX_DIRS) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (item) => ({ item, entries: await propfind(config, item.url, "1") })),
    );

    let firstError: unknown = null;
    for (const result of results) {
      if (result.status === "rejected") {
        firstError ??= result.reason;
        continue;
      }
      const { item, entries } = result.value;
      visited.add(item.url);
      dirs += 1;

      const audio: WebdavFile[] = [];
      let coverUrl = "";
      const byLowerName = new Map<string, DavEntry>();
      for (const entry of entries) byLowerName.set(entry.name.toLowerCase(), entry);

      // 同目录封面：找第一个候选
      for (const candidate of COVER_NAMES) {
        const found = byLowerName.get(candidate);
        if (found && !found.isDir) {
          coverUrl = found.url;
          break;
        }
      }

      const folderName = decodeSegment(item.url);
      // `CD1` / `Disc 2` 这类分碟目录：专辑名与艺术家往上取一层
      const disc = isDiscFolder(folderName);
      const folderMeta = parseFolderName(folderName);
      const parentName = disc ? decodeSegment(parentDirUrl(item.url)) : "";

      for (const entry of entries) {
        if (entry.isDir) {
          if (item.depth + 1 > MAX_DEPTH) continue;
          if (isSkippedDir(entry.name)) continue;
          if (visited.has(entry.url) || scheduled.has(entry.url)) continue;
          scheduled.add(entry.url);
          queue.push({ url: entry.url, depth: item.depth + 1 });
          continue;
        }

        const ext = extOf(entry.name);
        if (!AUDIO_EXTS.has(ext)) continue;

        const parsed = parseTrackName(entry.name);
        const album = parsed.album || (disc ? parseFolderName(parentName).album : folderMeta.album);
        const folderArtist = disc ? parseFolderName(parentName).artist : folderMeta.artist;
        const artist = parsed.artist || folderArtist;

        // 同名歌词旁文件：`.lrc` 优先于 `.srt`
        const baseName = stripExtension(entry.name).toLowerCase();
        const lrc = byLowerName.get(`${baseName}.lrc`);
        const srt = byLowerName.get(`${baseName}.srt`);
        const lyricsEntry = lrc && !lrc.isDir ? lrc : srt && !srt.isDir ? srt : null;

        audio.push({
          url: entry.url,
          dirUrl: item.url,
          fileName: entry.name,
          size: entry.size,
          mtime: entry.mtime,
          coverUrl,
          lyricsUrl: lyricsEntry?.url ?? "",
          lyricsFormat: lyricsEntry ? extOf(lyricsEntry.name) : "",
          title: parsed.title,
          artist,
          album,
          albumArtist: artist,
          trackNo: parsed.trackNo,
          discNo: disc ? Number(/(\d+)/.exec(folderName)?.[1] ?? 0) : 1,
        });
      }

      audio.sort((a, b) => a.trackNo - b.trackNo || a.fileName.localeCompare(b.fileName));
      files.push(...audio);
      onProgress?.({ dirs, files: files.length });
    }

    // 根目录就失败（地址/认证问题）：直接抛出，避免静默返回空曲库
    if (!dirs && firstError) throw firstError;
  }

  return files;
}

/** 抓取歌词文本（经 Rust 转发，带鉴权头） */
export async function fetchWebdavText(config: WebdavConfig, url: string): Promise<string | null> {
  const result = await httpFetch({
    url,
    method: "GET",
    headers: webdavHeaders(config),
    responseType: "text",
    timeoutMs: 15_000,
  });
  if (!result.ok) return null;
  return result.body ?? "";
}

/** 远程封面 → 本地封面缓存，返回可直接放进 `<img src>` 的地址 */
export function cacheWebdavCover(url: string, config: WebdavConfig): Promise<string> {
  return invoke<string>("builtin_cover_fetch", {
    url,
    headers: webdavMediaHeaders(config) ?? {},
  });
}

/** 扩展名 → 原生解码器认的编码名 */
export function codecOfWebdavUrl(url: string): string {
  switch (extOf(url)) {
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
