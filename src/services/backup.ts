/**
 * 设置 / 曲库的导入导出（备份与还原）。
 *
 * 备份文件是一个自描述的 JSON：
 * - `settings`：settings 表中的用户设置（排除页面数据缓存 `cache.data.*`；
 *   可选包含插件登录凭证）；
 * - `likedSongs` / `playlists` / `playlistTracks` / `offlineSongs`：本地曲库；
 * - `queue`：播放队列快照（player.queue 那个 key，方便换机后接着听）。
 *
 * 还原策略是「按 id 合并」而不是清库重建：
 * - 歌单按名称去重（同名视为同一个歌单，只补曲目不新建）；
 * - 喜欢、离线索引按 (source_id, track_id) 幂等写入；
 * - 设置项逐条覆盖。
 * 这样重复导入同一份备份不会产生重复数据，也不会毁掉备份之后新增的内容。
 */

import { invoke } from "@tauri-apps/api/core";
import { getDb, getSetting, setSetting } from "@/services/db";
import { toast } from "@/services/toast";
import { useUpdaterStore } from "@/stores/updater";

/** 备份文件格式版本：结构变化时递增，导入时据此拒绝未来版本 */
export const BACKUP_VERSION = 1;

/** 页面数据缓存前缀（备份时排除，还原时不覆盖） */
const CACHE_PREFIX = "cache.data.";

/** 插件登录凭证的 key：默认不导出，避免备份文件泄露账号 */
const CREDENTIAL_KEYS = new Set(["cookie", "credential", "token"]);

export interface BackupPayload {
  app: "WinPlayer";
  version: number;
  exportedAt: number;
  /** 应用版本号（仅信息性） */
  appVersion?: string;
  settings?: Array<{ key: string; value: string }>;
  likedSongs?: Array<Record<string, unknown>>;
  playlists?: Array<Record<string, unknown>>;
  playlistTracks?: Array<Record<string, unknown>>;
  offlineSongs?: Array<Record<string, unknown>>;
  /** 播放队列快照（player.queue 的 value 文本） */
  queue?: string | null;
}

export interface ExportOptions {
  /** 是否包含插件登录凭证（cookie / token），默认 false */
  includeCredentials?: boolean;
}

export interface ImportSummary {
  settings: number;
  likedSongs: number;
  playlists: number;
  playlistTracks: number;
  offlineSongs: number;
  queue: boolean;
  skipped: string[];
}

/* ------------------------------ 导出 ------------------------------ */

/** 插件 ID 的登录凭证 key（形如 `plugin.xxx.cookie` 或直接 `cookie`） */
function isCredentialKey(key: string): boolean {
  const tail = key.split(".").pop() ?? "";
  return CREDENTIAL_KEYS.has(tail) || CREDENTIAL_KEYS.has(key);
}

/** 收集备份数据（不落盘，供 UI 预览与保存复用） */
export async function collectBackup(options: ExportOptions = {}): Promise<BackupPayload> {
  const db = await getDb();
  const includeCredentials = Boolean(options.includeCredentials);

  const settingsRows = await db.select<Array<{ key: string; value: string }>>(
    "select key, value from settings order by key asc",
  );
  const settings = settingsRows.filter(
    (row) =>
      !row.key.startsWith(CACHE_PREFIX) && (includeCredentials || !isCredentialKey(row.key)),
  );

  const [likedSongs, playlists, playlistTracks, offlineSongs, queue] = await Promise.all([
    db.select<Array<Record<string, unknown>>>("select * from liked_songs order by id asc"),
    db.select<Array<Record<string, unknown>>>("select * from playlists order by id asc"),
    db.select<Array<Record<string, unknown>>>(
      "select * from playlist_tracks order by playlist_id asc, position asc",
    ),
    db.select<Array<Record<string, unknown>>>(
      "select * from offline_songs order by saved_at desc",
    ),
    getSetting<string | null>("player.queue", null),
  ]);

  return {
    app: "WinPlayer",
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: currentAppVersion(),
    settings,
    likedSongs,
    playlists,
    playlistTracks,
    offlineSongs,
    queue: typeof queue === "string" ? queue : queue ? JSON.stringify(queue) : null,
  };
}

/** 应用版本号（仅用于在备份里留个信息性标记；取不到时留空） */
function currentAppVersion(): string {
  try {
    return useUpdaterStore().currentVersion || "";
  } catch {
    return "";
  }
}

/** 序列化成带缩进的 JSON 文本（方便用户肉眼检查，也便于 diff） */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** 通过对话框让用户选择保存位置，并把备份写下去 */
export async function exportBackupToFile(options: ExportOptions = {}): Promise<boolean> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    .slice(0, 12);
  const target = await save({
    title: "导出 WinPlayer 备份",
    defaultPath: `winplayer-backup-${stamp}.json`,
    filters: [{ name: "WinPlayer 备份", extensions: ["json"] }],
  });
  if (!target) return false;

  const payload = await collectBackup(options);
  const text = serializeBackup(payload);
  await invoke("download_write_text", { path: target, content: text });
  return true;
}

/* ------------------------------ 导入 ------------------------------ */

/** 从文件读取并解析备份（结构不合法时抛错） */
export async function readBackupFile(): Promise<BackupPayload | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    title: "选择 WinPlayer 备份文件",
    multiple: false,
    directory: false,
    filters: [{ name: "WinPlayer 备份", extensions: ["json"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  const text = await invoke<string | null>("download_read_text", { path: picked });
  if (!text) throw new Error("备份文件为空或无法读取");
  return parseBackup(text);
}

/** 解析并校验备份文本 */
export function parseBackup(text: string): BackupPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("不是合法的 JSON 文件");
  }
  if (!payload || typeof payload !== "object") throw new Error("备份内容为空");
  const data = payload as Partial<BackupPayload>;
  if (data.app !== "WinPlayer") throw new Error("这不是 WinPlayer 的备份文件");
  if (typeof data.version !== "number") throw new Error("备份缺少版本号");
  if (data.version > BACKUP_VERSION) {
    throw new Error(`备份版本 ${data.version} 高于当前应用支持的 ${BACKUP_VERSION}，请先升级`);
  }
  return data as BackupPayload;
}

/** 还原备份；返回实际写入的条目数与跳过的项目说明 */
export async function restoreBackup(payload: BackupPayload): Promise<ImportSummary> {
  const db = await getDb();
  const summary: ImportSummary = {
    settings: 0,
    likedSongs: 0,
    playlists: 0,
    playlistTracks: 0,
    offlineSongs: 0,
    queue: false,
    skipped: [],
  };

  // 1. 设置：逐条覆盖（不删库里多出来的 key，避免抹掉新版应用新增的默认项）
  for (const row of payload.settings ?? []) {
    if (typeof row?.key !== "string" || typeof row?.value !== "string") continue;
    if (row.key.startsWith(CACHE_PREFIX)) continue;
    await db.execute(
      "insert into settings (key, value) values ($1, $2) on conflict(key) do update set value = $2",
      [row.key, row.value],
    );
    summary.settings += 1;
  }

  // 2. 喜欢：按 (source_id, track_id) 幂等
  for (const row of payload.likedSongs ?? []) {
    const sourceId = String(row.source_id ?? "");
    const trackId = String(row.track_id ?? "");
    const track = typeof row.track === "string" ? row.track : "";
    if (!track) continue;
    await db.execute(
      `insert into liked_songs (source_id, track_id, track, liked_at) values ($1, $2, $3, $4)
       on conflict(source_id, track_id) do nothing`,
      [sourceId, trackId, track, Number(row.liked_at ?? Date.now())],
    );
    summary.likedSongs += 1;
  }

  /**
   * 3. 歌单：按名称合并。
   *    备份里的 playlist id 只在本文件内有意义，导入后要换成新库里的 id，
   *    因此这里维护一份「旧 id → 新 id」映射供曲目归位。
   */
  const idMap = new Map<number, number>();
  for (const row of payload.playlists ?? []) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const oldId = Number(row.id);
    const existing = await db.select<Array<{ id: number }>>(
      "select id from playlists where name = $1 limit 1",
      [name],
    );
    if (existing.length) {
      idMap.set(oldId, existing[0].id);
      summary.skipped.push(`歌单「${name}」已存在，已合并曲目`);
      continue;
    }
    const now = Date.now();
    await db.execute(
      "insert into playlists (name, description, cover, created_at, updated_at) values ($1, $2, $3, $4, $5)",
      [
        name,
        String(row.description ?? ""),
        String(row.cover ?? ""),
        Number(row.created_at ?? now),
        Number(row.updated_at ?? now),
      ],
    );
    const created = await db.select<Array<{ id: number }>>(
      "select id from playlists where name = $1 order by id desc limit 1",
      [name],
    );
    if (created.length) {
      idMap.set(oldId, created[0].id);
      summary.playlists += 1;
    }
  }

  // 4. 歌单曲目：映射到新 id，按 (playlist_id, position) 去重
  for (const row of payload.playlistTracks ?? []) {
    const oldPlaylistId = Number(row.playlist_id);
    const newPlaylistId = idMap.get(oldPlaylistId);
    if (!newPlaylistId) {
      summary.skipped.push(`曲目所属歌单（#${oldPlaylistId}）不在备份中，已跳过`);
      continue;
    }
    const track = typeof row.track === "string" ? row.track : "";
    if (!track) continue;
    const position = Number(row.position ?? 0);
    const duplicate = await db.select<Array<{ id: number }>>(
      "select id from playlist_tracks where playlist_id = $1 and track = $2 limit 1",
      [newPlaylistId, track],
    );
    if (duplicate.length) continue;
    await db.execute(
      "insert into playlist_tracks (playlist_id, track, position, added_at) values ($1, $2, $3, $4)",
      [newPlaylistId, track, position, Number(row.added_at ?? Date.now())],
    );
    summary.playlistTracks += 1;
  }

  // 5. 离线索引：只恢复索引，音频文件路径可能已失效（离线页会标记 missing）
  for (const row of payload.offlineSongs ?? []) {
    const sourceId = String(row.source_id ?? "");
    const trackId = String(row.track_id ?? "");
    const track = typeof row.track === "string" ? row.track : "";
    const path = String(row.path ?? "");
    if (!track || !path) continue;
    await db.execute(
      `insert into offline_songs
         (source_id, track_id, track, path, size, has_lyrics, groups, saved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict(source_id, track_id) do nothing`,
      [
        sourceId,
        trackId,
        track,
        path,
        Number(row.size ?? 0),
        Number(row.has_lyrics ?? 0),
        typeof row.groups === "string" ? row.groups : "[]",
        Number(row.saved_at ?? Date.now()),
      ],
    );
    summary.offlineSongs += 1;
  }

  // 6. 播放队列
  if (typeof payload.queue === "string" && payload.queue.trim()) {
    await setSetting("player.queue", JSON.parse(payload.queue));
    summary.queue = true;
  }

  return summary;
}

/** 导入后的一次性提示文案 */
export function describeImport(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.settings) parts.push(`${summary.settings} 项设置`);
  if (summary.likedSongs) parts.push(`${summary.likedSongs} 首喜欢`);
  if (summary.playlists) parts.push(`${summary.playlists} 个歌单`);
  if (summary.playlistTracks) parts.push(`${summary.playlistTracks} 首歌单曲目`);
  if (summary.offlineSongs) parts.push(`${summary.offlineSongs} 条离线索引`);
  if (summary.queue) parts.push("播放队列");
  return parts.length ? `已恢复：${parts.join("、")}` : "备份里没有可恢复的内容";
}

/** 导出失败/成功与否的统一提示（供设置页调用） */
export async function runExport(options: ExportOptions = {}): Promise<void> {
  try {
    const saved = await exportBackupToFile(options);
    if (saved) toast("备份已导出", "success");
  } catch (error) {
    toast(`导出失败: ${error}`, "error");
  }
}

/** 导入流程（选择文件 → 校验 → 还原）的统一封装 */
export async function runImport(): Promise<ImportSummary | null> {
  try {
    const payload = await readBackupFile();
    if (!payload) return null;
    const summary = await restoreBackup(payload);
    toast(describeImport(summary), "success");
    if (summary.skipped.length) {
      toast(`有 ${summary.skipped.length} 项被跳过：${summary.skipped[0]}`, "info");
    }
    return summary;
  } catch (error) {
    toast(`导入失败: ${error}`, "error");
    return null;
  }
}
