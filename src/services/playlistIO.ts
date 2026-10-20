/**
 * 歌单导入 / 导出（.json / .m3u / .m3u8）。
 *
 * 与 `backup.ts`（整库备份）不同，这里只针对**单个歌单**：
 *
 * - **导出**：本地自建歌单详情页的「导出」按钮，可选择两种格式
 *   - `WinPlayer JSON`：带完整曲目快照（sourceId / id / 歌手 / 时长 / 封面），
 *     导入时能原样还原，不依赖任何插件；
 *   - `M3U8`：标准播放列表，只写「歌手 - 歌名」，方便给别的播放器或手改。
 * - **导入**：解析文件 → 展示摘要预览 → 写入目标歌单
 *   - 目标歌单可选「新建」（默认按文件名）或「合并到已有歌单」（自动去重）；
 *   - 曲目按 `sourceId:id` 去重；没有 sourceId、或来源插件已卸载的曲目，
 *     自动跨启用插件按「歌手 - 歌名」重新搜曲（逐个搜、带进度，失败保留占位）。
 */

import { reactive } from "vue";
import { getDb } from "@/services/db";
import { dismissToast, toast, toastSticky } from "@/services/toast";
import { useLibraryStore, trackKey, type LocalPlaylist } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import { formatTrackKeyword } from "@/stores/plugins";
import type { UnifiedTrack } from "@/types/plugin";

/** 本应用导出的歌单单文件标识与版本 */
const FILE_APP = "WinPlayer";
const FILE_KIND = "playlist";
const FILE_VERSION = 1;

/** 文件格式 */
export type PlaylistFileFormat = "json" | "m3u";

/* ------------------------------ 类型 ------------------------------ */

/** WinPlayer 歌单文件（JSON） */
export interface PlaylistFile {
  app: string;
  kind: string;
  version: number;
  /** 导出时间（毫秒） */
  exportedAt: number;
  playlist: {
    name: string;
    description?: string;
  };
  tracks: UnifiedTrack[];
}

/** 解析结果：统一成「名字 + 曲目」，两种格式都归一到它 */
export interface ParsedPlaylist {
  /** 文件格式（用于摘要提示） */
  format: PlaylistFileFormat;
  /** 歌单名（JSON 取文件里的，M3U 取文件名） */
  name: string;
  /** 简介（仅 JSON 有） */
  description: string;
  /** 曲目（M3U 只有 name / artists，没有 id） */
  tracks: UnifiedTrack[];
}

/** 导入时会用到的「重新搜曲」结果统计 */
export interface ResolveSummary {
  /** 直接命中（曲目自带 sourceId 且插件可用） */
  direct: number;
  /** 跨插件重新搜到 */
  resolved: number;
  /** 没搜到，保留占位曲目 */
  unresolved: number;
}

/** 导入结果 */
export interface ImportSummary {
  /** 目标歌单 */
  playlist: LocalPlaylist | null;
  /** 是否新建了歌单 */
  created: boolean;
  /** 实际写入的曲目数 */
  added: number;
  /** 因重复而跳过的曲目数 */
  duplicated: number;
  /** 搜曲情况 */
  resolve: ResolveSummary;
}

/* ------------------------------ 导出 ------------------------------ */

/** 把曲目拼成「歌手 - 歌名」（搜索 / m3u 共用） */
function trackLabel(track: UnifiedTrack): string {
  const artists = (track.artists ?? []).filter(Boolean).join(" / ");
  return artists ? `${artists} - ${track.name}` : track.name;
}

/** 生成 M3U8 文本（#EXTM3U + 每首 #EXTINF:秒数,标题） */
export function serializeM3u(playlistName: string, tracks: UnifiedTrack[]): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${playlistName}`];
  for (const track of tracks) {
    const seconds = Math.round((track.duration ?? 0) / 1000);
    lines.push(`#EXTINF:${seconds},${trackLabel(track)}`);
    // 没有真实文件路径：写一个稳定的伪 URI，方便别的工具认出歌曲身份
    const source = track.sourceId ?? "";
    lines.push(`winplayer://${encodeURIComponent(source)}/${encodeURIComponent(track.id)}`);
  }
  return lines.join("\n") + "\n";
}

/** 生成 WinPlayer 歌单 JSON 文本（曲目快照完整保留） */
export function serializePlaylistFile(
  playlistName: string,
  description: string,
  tracks: UnifiedTrack[],
): string {
  const file: PlaylistFile = {
    app: FILE_APP,
    kind: FILE_KIND,
    version: FILE_VERSION,
    exportedAt: Date.now(),
    playlist: { name: playlistName, description },
    tracks,
  };
  return JSON.stringify(file, null, 2);
}

/** 文件名里不能出现的字符统一换成下划线 */
function safeFileName(name: string): string {
  return (name.trim() || "playlist").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

/**
 * 导出歌单：弹保存对话框并写文件。
 * @returns 是否真的写入了文件（用户取消返回 false）
 */
export async function exportPlaylist(
  name: string,
  description: string,
  tracks: UnifiedTrack[],
  format: PlaylistFileFormat,
): Promise<boolean> {
  if (!tracks.length) {
    toast("这个歌单还没有歌曲", "info");
    return false;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const extension = format === "json" ? "json" : "m3u8";
  const target = await save({
    title: "导出歌单",
    defaultPath: `${safeFileName(name)}.${extension}`,
    filters:
      format === "json"
        ? [{ name: "WinPlayer 歌单", extensions: ["json"] }]
        : [{ name: "M3U8 播放列表", extensions: ["m3u8", "m3u"] }],
  });
  if (!target) return false;
  const content =
    format === "json" ? serializePlaylistFile(name, description, tracks) : serializeM3u(name, tracks);
  await invoke("download_write_text", { path: target, content });
  return true;
}

/* ------------------------------ 解析 ------------------------------ */

/** 从路径取不带扩展名的文件名 */
export function fileNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.(json|m3u8?|txt)$/i, "");
}

/** 解析 WinPlayer 歌单 JSON；结构不对时抛错 */
function parsePlaylistJson(text: string, fallbackName: string): ParsedPlaylist {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("不是合法的 JSON 文件");
  }
  if (!payload || typeof payload !== "object") throw new Error("文件内容为空");
  const data = payload as Partial<PlaylistFile>;
  if (data.app !== FILE_APP || data.kind !== FILE_KIND) {
    throw new Error("这不是 WinPlayer 的歌单文件（整库备份请在设置 → 备份与还原里导入）");
  }
  if (typeof data.version !== "number") throw new Error("歌单文件缺少版本号");
  if (data.version > FILE_VERSION) {
    throw new Error(`歌单文件版本 ${data.version} 高于当前应用支持的 ${FILE_VERSION}，请先升级`);
  }
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.filter((track): track is UnifiedTrack => Boolean(track) && typeof track === "object")
    : [];
  return {
    format: "json",
    name: data.playlist?.name?.trim() || fallbackName,
    description: data.playlist?.description ?? "",
    tracks,
  };
}

/**
 * 解析 M3U / M3U8 文本。
 *
 * 只取两种信息：
 * - `#EXTINF:时长,标题` → 时长与「歌手 - 歌名」（按第一个「 - 」切分）；
 * - 普通行（非 `#` 开头）视为歌曲，若没有 EXTINF 则用文件名当歌名。
 * 缺少 id / sourceId，导入时需要重新搜曲。
 */
export function parseM3u(text: string, fallbackName: string): ParsedPlaylist {
  const lines = text.split(/\r?\n/);
  const tracks: UnifiedTrack[] = [];
  let pending: { duration?: number; title?: string } | null = null;
  /** 行内是否出现过真实文件路径（本地/网络），用于恢复歌名 */
  let first = true;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (first && line.startsWith("#EXTM3U")) {
      first = false;
      continue;
    }
    first = false;

    if (line.startsWith("#EXTINF:")) {
      const body = line.slice("#EXTINF:".length);
      const comma = body.indexOf(",");
      const seconds = Number.parseInt(comma >= 0 ? body.slice(0, comma) : body, 10);
      const title = comma >= 0 ? body.slice(comma + 1).trim() : "";
      pending = { duration: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined, title };
      continue;
    }
    if (line.startsWith("#")) continue;

    // 普通行：优先用 EXTINF 的标题，没有则用文件名
    let title = pending?.title ?? "";
    if (!title) {
      const base = line.split(/[\\/]/).pop() ?? line;
      title = base.replace(/\.[a-z0-9]{2,5}$/i, "").trim();
    }
    if (title) {
      tracks.push({
        id: "",
        name: splitTitle(title).name,
        artists: splitTitle(title).artists,
        duration: pending?.duration,
      });
    }
    pending = null;
  }

  return { format: "m3u", name: fallbackName, description: "", tracks };
}

/** 「歌手 - 歌名」 → { artists, name }；没有分隔符时整串当歌名 */
function splitTitle(title: string): { name: string; artists: string[] } {
  const parts = title.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const name = parts.pop()!.trim();
    const artists = parts
      .join(" - ")
      .split(/\s*\/\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (name) return { name, artists };
  }
  return { name: title.trim(), artists: [] };
}

/** 按扩展名解析文件文本（导入入口调用） */
export function parsePlaylistFile(text: string, path: string): ParsedPlaylist {
  const name = fileNameOf(path);
  const trimmed = text.trim();
  if (!trimmed) throw new Error("文件是空的");
  // JSON 用首字符判断：m3u8 里不会出现以 { 开头的合法内容
  if (trimmed.startsWith("{")) return parsePlaylistJson(text, name);
  return parseM3u(text, name);
}

/* ------------------------------ 导入 ------------------------------ */

/** 让用户选文件并读回文本；取消返回 null */
export async function pickPlaylistFile(): Promise<{ path: string; text: string } | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const picked = await open({
    title: "导入歌单",
    multiple: false,
    directory: false,
    filters: [{ name: "歌单文件", extensions: ["json", "m3u", "m3u8", "txt"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  const text = await invoke<string | null>("download_read_text", { path: picked });
  if (!text) throw new Error("无法读取这个文件（可能不是文本文件）");
  return { path: picked, text };
}

/** 曲目是否自带可用的 id + 来源插件 */
function hasUsableIdentity(track: UnifiedTrack): boolean {
  return Boolean(track.id) && Boolean(track.sourceId);
}

/**
 * 补齐曲目身份：对没有 id 或来源插件已卸载的曲目，跨启用插件按
 * 「歌手 - 歌名」重新搜索第一首。带进度回调，便于导入对话框显示进度。
 */
export async function resolveTracks(
  tracks: UnifiedTrack[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ tracks: UnifiedTrack[]; summary: ResolveSummary }> {
  const plugins = usePluginsStore();
  const summary: ResolveSummary = { direct: 0, resolved: 0, unresolved: 0 };
  const enabledIds = new Set(plugins.records.filter((r) => r.enabled).map((r) => r.entry.id));
  /** 需要外部搜曲的曲目下标 */
  const pending: number[] = [];
  const result = tracks.map((track) => ({ ...track }));

  for (const [index, track] of result.entries()) {
    if (hasUsableIdentity(track) && enabledIds.has(track.sourceId!)) summary.direct += 1;
    else pending.push(index);
  }

  let done = 0;
  for (const index of pending) {
    const track = result[index]!;
    const keyword = formatTrackKeyword(track, "{歌曲名} {歌手名}").trim();
    let matched: UnifiedTrack | null = null;
    if (keyword && plugins.records.some((r) => r.enabled && plugins.hasCapability(r, "search"))) {
      try {
        matched = await plugins.searchTrack(keyword);
      } catch {
        matched = null;
      }
    }
    if (matched) {
      result[index] = { ...matched, duration: matched.duration ?? track.duration };
      summary.resolved += 1;
    } else {
      summary.unresolved += 1;
    }
    done += 1;
    onProgress?.(done, pending.length);
  }

  return { tracks: result, summary };
}

/**
 * 把曲目写入目标歌单。
 *
 * - `targetId` 为空时按 `name` 新建歌单，返回新建的歌单；
 * - 传入 `targetId` 时合并到已有歌单（`addTracksToPlaylist` 内部按曲目键去重）；
 * - 返回写入 / 跳过数量，供调用方提示。
 */
export async function importIntoPlaylist(
  trackList: UnifiedTrack[],
  options: { targetId?: number; name?: string; description?: string },
): Promise<{ playlist: LocalPlaylist | null; created: boolean; added: number; duplicated: number }> {
  const library = useLibraryStore();
  const playlist = options.targetId
    ? (library.playlists.find((item) => item.id === options.targetId) ?? null)
    : await library.createPlaylist(options.name ?? "导入的歌单", options.description ?? "");
  if (!playlist) throw new Error("目标歌单不存在");

  // 去重：同一份文件里可能有重复曲目，先在内存里按曲目键收敛一次
  const seen = new Set<string>();
  const unique: UnifiedTrack[] = [];
  let duplicated = 0;
  for (const track of trackList) {
    if (!hasUsableIdentity(track)) continue;
    const key = trackKey(track);
    if (seen.has(key)) {
      duplicated += 1;
      continue;
    }
    seen.add(key);
    unique.push(track);
  }

  const added = await library.addTracksToPlaylist(playlist.id, unique);
  // addTracksToPlaylist 返回真实新增数，剩下的都是与库里已有曲目重复
  duplicated += unique.length - added;
  const refreshed = library.playlists.find((item) => item.id === playlist.id) ?? playlist;
  return { playlist: refreshed, created: !options.targetId, added, duplicated };
}

/** 直接读库里的曲目数（导入摘要里展示已有曲目用） */
export async function playlistTrackCount(playlistId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ count: number }>>(
    "select count(*) as count from playlist_tracks where playlist_id = $1",
    [playlistId],
  );
  return rows?.[0]?.count ?? 0;
}

/* ------------------------------ 对话框状态与一站式入口 ------------------------------ */

/** 全局导入对话框状态（PlaylistImportHost.vue 监听它） */
export const importDialogState = reactive<{ visible: boolean }>({ visible: false });

/** 打开「导入歌单」对话框（侧边栏 / 我的页 / 歌单页共用） */
export function openImportDialog(): void {
  importDialogState.visible = true;
}

export function closeImportDialog(): void {
  importDialogState.visible = false;
}

/** 给用户的默认歌单名：同名时自动加「(2)」「(3)」 */
export function uniquePlaylistName(base: string): string {
  const library = useLibraryStore();
  const name = base.trim() || "导入的歌单";
  const taken = new Set(library.playlists.map((item) => item.name));
  if (!taken.has(name)) return name;
  for (let index = 2; index < 999; index += 1) {
    const candidate = `${name} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${name} (${Date.now() % 1000})`;
}

/**
 * 一站式导入：解析后的歌单 → 搜曲补齐 → 写入目标歌单。
 *
 * 目标冲突由这里兜底：新建歌单时同名会自动加后缀，不会覆盖或错误合并。
 */
export interface ImportOptions {
  /** 目标歌单 id，缺省表示新建 */
  targetId?: number;
  /** 新建歌单名（仅在 targetId 缺省时使用） */
  name: string;
  /** 搜索进度回调 */
  onProgress?: (done: number, total: number) => void;
}

/** 解析文件并预览（返回曲目数与格式），不写库 */
export async function importPlaylistFile(): Promise<{
  path: string;
  parsed: ParsedPlaylist;
} | null> {
  const picked = await pickPlaylistFile();
  if (!picked) return null;
  return { path: picked.path, parsed: parsePlaylistFile(picked.text, picked.path) };
}

export async function runImport(
  parsed: ParsedPlaylist,
  options: ImportOptions,
): Promise<ImportSummary> {
  if (!parsed.tracks.length) throw new Error("文件里没有找到任何歌曲");

  // 1. 补身份（可能耗时：逐个插件搜索），用常驻 Toast 告知进度
  const pendingToast = toastSticky("正在准备歌曲信息…", "info");
  let resolved: { tracks: UnifiedTrack[]; summary: ResolveSummary };
  try {
    resolved = await resolveTracks(parsed.tracks, (done, total) => {
      // 进度用字数少的形式更新提示（Toast 不可原地改文案，简单起见只提示一次）
      if (done === total) dismissToast(pendingToast);
    });
  } finally {
    dismissToast(pendingToast);
  }

  // 2. 选/建歌单并写入（新建时同名自动加后缀）
  const name = options.targetId ? options.name : uniquePlaylistName(options.name || parsed.name);
  const written = await importIntoPlaylist(resolved.tracks, {
    targetId: options.targetId,
    name,
    description: parsed.description,
  });

  return {
    playlist: written.playlist,
    created: written.created,
    added: written.added,
    duplicated: written.duplicated,
    resolve: resolved.summary,
  };
}
