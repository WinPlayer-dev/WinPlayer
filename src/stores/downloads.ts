/**
 * 离线下载 + 离线曲库索引。
 *
 * - 串行下载队列：一次只下载一首，已完成/失败/暂停的任务保留在面板中可重试；
 * - 已下载曲目自动跳过（按 sourceId + trackId 去重）；
 * - 每首歌曲记录来源分组（歌单/专辑/歌手/喜欢），离线页据此归类；
 * - **元数据以音频文件里的标签为准**：下载完成后由 Rust 侧把标题 / 歌手 /
 *   专辑 / 封面 / 歌词写进文件，数据库只留路径、分组与时间；容器不支持写标签
 *   时（`hasTags = false`）才退回把 UnifiedTrack JSON 存进 `offline_songs`。
 *
 * 离线播放：`localUrl(track)` 返回 `local://` + 绝对路径，播放器解析直链时
 * 优先使用它，由原生解码器直接读取本地文件（无需插件/网络）。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getDb } from "@/services/db";
import { toast } from "@/services/toast";
import { t } from "@/i18n";
import { useSettingsStore, DEFAULT_DOWNLOAD_NAME_TEMPLATE } from "./settings";
import { pluginDisplayName, usePluginsStore } from "./plugins";
import { useTrackMetaStore } from "./trackMeta";
import { resolveImgUrl } from "@/services/imageCache";
import { mediaHeadersFor } from "@/services/audio";
import { readLocalLyrics } from "@/services/localMusic";
import {
  cancelDownload,
  checkDownloads,
  copyDownload,
  deleteDownload,
  downloadDefaultDir,
  downloadSong,
  formatBytes,
  isCanceledError,
  onDownloadProgress,
  readDownloadTags,
  revealDownload,
  writeDownloadTags,
  type DownloadVars,
  type OfflineTagInfo,
  type TagWriteMeta,
} from "@/services/downloads";
import type { UnifiedTrack } from "@/types/plugin";

/** 下载任务的来源分组类型 */
export type DownloadGroupKind = "playlist" | "album" | "artist" | "liked" | "single";

/** 下载来源分组（离线页归类用） */
export interface DownloadGroup {
  kind: DownloadGroupKind;
  /** 来源插件 ID */
  sourceId?: string;
  /** 歌单/专辑/歌手 ID */
  id?: string;
  name: string;
}

export type DownloadStatus = "queued" | "downloading" | "paused" | "done" | "error";

export interface DownloadTask {
  id: string;
  track: UnifiedTrack;
  status: DownloadStatus;
  downloaded: number;
  total: number;
  /** 平均速度（字节/秒） */
  speed: number;
  error?: string;
  /** 完成后落盘路径 */
  path?: string;
  groups: DownloadGroup[];
  /** 内部：用户请求暂停当前下载（取消后转入 paused 而非 error） */
  pauseRequested?: boolean;
}

/** 离线曲目（对应 offline_songs 一行） */
export interface OfflineSong {
  sourceId: string;
  trackId: string;
  track: UnifiedTrack;
  path: string;
  size: number;
  hasLyrics: boolean;
  groups: DownloadGroup[];
  savedAt: number;
  /** 文件已丢失（索引保留，可清理） */
  missing: boolean;
}

interface OfflineRow {
  source_id: string;
  track_id: string;
  track: string;
  path: string;
  size: number | null;
  has_lyrics: number | null;
  groups: string | null;
  saved_at: number | null;
}

/** 离线键：来源 + 曲目 ID */
function offlineKey(track: UnifiedTrack): string {
  return `${track.sourceId ?? ""}:${track.id}`;
}

/** 曲目在下载列表里的展示名（用于单曲下载的分组名） */
function trackGroupName(track: UnifiedTrack): string {
  return track.name || t("errors.download.singleTrack");
}

/** 写进文件标签的元数据（歌手按「A / B」拼接，与重建时的拆分对应） */
function buildTagMeta(track: UnifiedTrack): TagWriteMeta {
  return {
    title: track.name ?? "",
    artist: (track.artists ?? []).join(" / "),
    album: track.album ?? "",
  };
}

/** 标签里的歌手是「A / B」拼接串（与〔buildTagMeta〕的写入保持一致） */
function splitArtists(value: string): string[] {
  const parts = value
    .split(" / ")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts : [value.trim()];
}

/** 用文件标签重建曲目；标签缺失（老记录 / 容器不支持）时退回数据库里存的 JSON */
function buildTrack(
  row: { track_id: string; source_id: string },
  stored: UnifiedTrack | null,
  info?: OfflineTagInfo | null,
): UnifiedTrack {
  const fallback: UnifiedTrack = {
    id: row.track_id,
    sourceId: row.source_id || undefined,
    name: stored?.name || t("errors.download.unknownTrack"),
    artists: stored?.artists ?? [],
    album: stored?.album,
    cover: stored?.cover,
    duration: stored?.duration,
    albumId: stored?.albumId,
    artistIds: stored?.artistIds,
    vip: stored?.vip,
    alias: stored?.alias,
    extra: stored?.extra,
  };
  if (!info?.hasTags) return fallback;
  return {
    ...fallback,
    name: info.title?.trim() || fallback.name,
    artists: info.artist ? splitArtists(info.artist) : fallback.artists,
    album: info.album?.trim() || fallback.album,
    // 内嵌封面导出成 localcover 协议地址：离线、清缓存、换目录都不会丢
    cover: info.cover ?? fallback.cover,
    duration: info.durationMs ?? fallback.duration,
  };
}

let taskSeq = 0;
function nextTaskId(): string {
  taskSeq += 1;
  return `dl-${Date.now().toString(36)}-${taskSeq}`;
}

export const useDownloadsStore = defineStore("downloads", () => {
  const settings = useSettingsStore();
  const trackMeta = useTrackMetaStore();

  /** 下载任务列表（含历史；新任务排在最前） */
  const tasks = ref<DownloadTask[]>([]);
  /** 离线曲库索引（持久化） */
  const songs = ref<OfflineSong[]>([]);
  /** 平台默认下载目录（首次使用时解析） */
  const defaultDir = ref("");
  /** 下载管理器面板开关 */
  const panelOpen = ref(false);
  /** 全局暂停（暂停后不再取新的排队任务） */
  const queuePaused = ref(false);
  const loaded = ref(false);

  /** 串行处理中标记 */
  let processing = false;
  let unlisten: (() => void) | null = null;

  /** 已下载曲目键集合（不含失效项） */
  const downloadedKeys = computed(
    () =>
      new Set(
        songs.value.filter((song) => !song.missing).map((song) => `${song.sourceId}:${song.trackId}`),
      ),
  );

  const offlineTracks = computed(() => songs.value.filter((song) => !song.missing).map((song) => song.track));

  const downloadedCount = computed(() => downloadedKeys.value.size);

  const totalSize = computed(() =>
    songs.value.reduce((sum, song) => (song.missing ? sum : sum + song.size), 0),
  );

  const missingCount = computed(() => songs.value.filter((song) => song.missing).length);

  const activeTasks = computed(() =>
    tasks.value.filter(
      (task) => task.status === "downloading" || task.status === "queued" || task.status === "paused",
    ),
  );

  const finishedTasks = computed(() =>
    tasks.value.filter((task) => task.status === "done" || task.status === "error"),
  );

  const downloadingCount = computed(
    () => tasks.value.filter((task) => task.status === "downloading" || task.status === "queued").length,
  );

  /** 生效的下载目录：用户自定义优先，否则平台默认 */
  const resolvedDir = computed(() => settings.downloadDir.trim() || defaultDir.value);

  /* ------------------------------ 查询 ------------------------------ */

  function findSong(track: UnifiedTrack): OfflineSong | null {
    const key = offlineKey(track);
    return songs.value.find((song) => `${song.sourceId}:${song.trackId}` === key && !song.missing) ?? null;
  }

  function isDownloaded(track: UnifiedTrack): boolean {
    return downloadedKeys.value.has(offlineKey(track));
  }

  /** 离线播放地址：已下载返回 `local://` + 绝对路径，否则 null */
  function localUrl(track: UnifiedTrack): string | null {
    const song = findSong(track);
    return song ? `local://${song.path}` : null;
  }

  /** 读取离线歌词：同名 .lrc / .srt 优先，其次文件内嵌歌词；没有歌词返回 null */
  async function readLyrics(track: UnifiedTrack): Promise<string | null> {
    const song = findSong(track);
    if (!song || !song.hasLyrics) return null;
    try {
      const lyrics = await readLocalLyrics(song.path);
      return lyrics?.text ?? null;
    } catch {
      return null;
    }
  }

  /* ------------------------------ 初始化 ------------------------------ */

  async function ensureDefaultDir(): Promise<string> {
    if (defaultDir.value) return defaultDir.value;
    defaultDir.value = await downloadDefaultDir();
    return defaultDir.value;
  }

  async function loadIndex(): Promise<void> {
    const db = await getDb();
    const rows =
      (await db.select<OfflineRow[]>(
        `select source_id, track_id, track, path, size, has_lyrics, groups, saved_at
         from offline_songs order by saved_at desc`,
      )) ?? [];

    // 元数据以文件标签为准：一次性批量回读（读不到标签的老记录退回数据库 JSON）
    let tagMap = new Map<string, OfflineTagInfo>();
    if (rows.length) {
      try {
        const infos = await readDownloadTags(rows.map((row) => row.path));
        tagMap = new Map(infos.map((info) => [info.path, info]));
      } catch (error) {
        console.error("[downloads] 读取文件标签失败，退回数据库元数据", error);
      }
    }

    const parsed: OfflineSong[] = [];
    for (const row of rows) {
      let stored: UnifiedTrack | null = null;
      try {
        stored = JSON.parse(row.track) as UnifiedTrack;
      } catch {
        stored = null;
      }
      const info = tagMap.get(row.path);
      let groups: DownloadGroup[] = [];
      try {
        const value = row.groups ? JSON.parse(row.groups) : [];
        if (Array.isArray(value)) groups = value as DownloadGroup[];
      } catch {
        /* 分组损坏时忽略 */
      }
      parsed.push({
        sourceId: row.source_id,
        trackId: row.track_id,
        track: buildTrack(row, stored, info),
        path: row.path,
        size: Number(row.size ?? 0),
        hasLyrics: info?.hasLyrics ?? Boolean(row.has_lyrics),
        groups,
        savedAt: Number(row.saved_at ?? 0),
        missing: false,
      });
    }
    // 批量校验文件存在性（一次性 IPC，避免逐条调用）
    if (parsed.length) {
      try {
        const flags = await checkDownloads(parsed.map((song) => song.path));
        parsed.forEach((song, index) => {
          song.missing = !flags[index];
        });
      } catch {
        /* 校验失败时视为存在 */
      }
    }
    songs.value = parsed;
    loaded.value = true;
  }

  /** 首次进入应用时调用：订阅进度、解析默认目录、载入索引 */
  async function init(): Promise<void> {
    if (!unlisten) {
      unlisten = await onDownloadProgress((progress) => {
        const task = tasks.value.find((item) => item.id === progress.taskId);
        if (task && task.status === "downloading") {
          task.downloaded = progress.downloaded;
          task.total = progress.total;
          task.speed = progress.speed;
        }
      });
    }
    void ensureDefaultDir().catch(() => {});
    if (!loaded.value) {
      try {
        await loadIndex();
      } catch (error) {
        console.error("[downloads] 载入离线索引失败", error);
      }
    }
  }

  /* ------------------------------ 封面预取 ------------------------------ */

  /** 元数据开关开启时，把封面写入图片缓存，供离线列表展示 */
  function prefetchCover(cover?: string): void {
    const original = resolveImgUrl(cover);
    if (!original || !/^https?:/i.test(original)) return;
    void invoke("image_cache_prefetch", { url: original }).catch(() => {});
  }

  /* ------------------------------ 队列 ------------------------------ */

  function buildVars(track: UnifiedTrack): DownloadVars {
    return {
      name: track.name ?? "",
      artist: (track.artists ?? []).join(" / "),
      album: track.album ?? "",
      source: track.sourceId ? pluginDisplayName(usePluginsStore().records, track.sourceId) : "",
      id: track.id,
    };
  }

  async function upsertSong(
    track: UnifiedTrack,
    path: string,
    size: number,
    hasLyrics: boolean,
    groups: DownloadGroup[],
    tagsWritten: boolean,
    tagInfo?: OfflineTagInfo | null,
  ): Promise<void> {
    const db = await getDb();
    const now = Date.now();
    const sourceId = track.sourceId ?? "";
    // 标签写成功时数据库只留身份信息，元数据从文件读；写失败才存完整 JSON 兜底
    const storedTrack = tagsWritten
      ? { id: track.id, sourceId, name: track.name ?? "" }
      : track;
    await db.execute(
      `insert into offline_songs (source_id, track_id, track, path, size, has_lyrics, groups, saved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict(source_id, track_id) do update set
         track = $3, path = $4, size = $5, has_lyrics = $6, groups = $7, saved_at = $8`,
      [sourceId, track.id, JSON.stringify(storedTrack), path, size, hasLyrics ? 1 : 0, JSON.stringify(groups), now],
    );
    const row: OfflineSong = {
      sourceId,
      trackId: track.id,
      // 标签可用时立刻换成文件里的元数据（封面走 localcover，下载完就能离线显示）
      track: tagsWritten ? buildTrack({ track_id: track.id, source_id: sourceId }, track, tagInfo) : track,
      path,
      size,
      hasLyrics,
      groups,
      savedAt: now,
      missing: false,
    };
    const key = `${sourceId}:${track.id}`;
    const index = songs.value.findIndex((song) => `${song.sourceId}:${song.trackId}` === key);
    if (index >= 0) songs.value[index] = row;
    else songs.value.unshift(row);
  }

  /** 加入下载队列：已下载的自动跳过，队列中已有的不重复入队 */
  async function enqueue(tracks: UnifiedTrack[], groups: DownloadGroup[] = []): Promise<void> {
    const pendingKeys = new Set(
      tasks.value.filter((task) => task.status === "queued" || task.status === "downloading").map((task) => offlineKey(task.track)),
    );
    let added = 0;
    let skipped = 0;
    for (const track of tracks) {
      if (!track?.id) continue;
      if (isDownloaded(track)) {
        skipped += 1;
        continue;
      }
      const key = offlineKey(track);
      if (pendingKeys.has(key)) continue;
      pendingKeys.add(key);
      tasks.value.unshift({
        id: nextTaskId(),
        track,
        status: "queued",
        downloaded: 0,
        total: 0,
        speed: 0,
        groups: groups.map((group) => ({ ...group })),
      });
      added += 1;
    }
    if (added) {
      const suffix = skipped ? t("errors.download.skippedSuffix", { count: skipped }) : "";
      toast(t("errors.download.added", { count: added }) + suffix, "success");
      queuePaused.value = false;
      void pump();
    } else if (skipped) {
      toast(t("errors.download.allDownloaded"), "info");
    } else {
      toast(t("errors.download.nothingToDownload"), "info");
    }
  }

  async function pump(): Promise<void> {
    if (processing || queuePaused.value) return;
    const next = tasks.value.find((task) => task.status === "queued");
    if (!next) return;
    processing = true;
    try {
      await runTask(next);
    } finally {
      processing = false;
    }
    if (!queuePaused.value) void pump();
  }

  async function runTask(task: DownloadTask): Promise<void> {
    const plugins = usePluginsStore();
    task.status = "downloading";
    task.downloaded = 0;
    task.total = 0;
    task.speed = 0;
    task.error = undefined;
    try {
      const result = await plugins.getSongUrl(task.track);

      // 歌词：写入同名 .lrc 边车（下载链路）+ 内嵌进歌曲标签（离线唯一来源）
      let lyrics: string | null = null;
      if (settings.downloadWriteTags) {
        try {
          const fetched = await plugins.getLyrics(task.track);
          if (fetched?.lrc) lyrics = fetched.lrc;
        } catch {
          /* 歌词获取失败不影响音频下载 */
        }
      }

      const dir = settings.downloadDir.trim() || (await ensureDefaultDir());
      const saved = await downloadSong({
        taskId: task.id,
        url: result.url,
        dir,
        template: settings.downloadNameTemplate.trim() || DEFAULT_DOWNLOAD_NAME_TEMPLATE,
        vars: buildVars(trackMeta.decorate(task.track)),
        lyrics,
        headers: mediaHeadersFor(result.url),
      });

      // 元数据 / 封面 / 歌词写进音频文件：离线曲库不再依赖数据库里的 JSON
      let tagsWritten = false;
      let tagInfo: OfflineTagInfo | null = null;
      if (settings.downloadWriteTags) {
        try {
          // 用展示版曲目写标签：用户在「编辑歌曲信息」里改过歌名 / 歌手 / 封面时，
          // 下载下来的文件应该带着改后的信息（封面若已落到 localcover，原生侧直接读本地文件）
          const shown = trackMeta.decorate(task.track);
          const written = await writeDownloadTags({
            path: saved.path,
            meta: buildTagMeta(shown),
            coverUrl: resolveImgUrl(shown.cover),
            lyrics,
          });
          tagsWritten = written.hasTags;
          // 回读一次：拿到内嵌封面导出的 localcover 地址与文件实际时长
          if (tagsWritten) tagInfo = (await readDownloadTags([saved.path]))[0] ?? null;
        } catch (error) {
          console.warn("[downloads] 写入歌曲标签失败，退回数据库元数据", error);
        }
      }
      // 标签不可用（关闭写入 / 容器不支持）时，仍然把封面预取进图片缓存供离线展示
      if (!tagsWritten) prefetchCover(trackMeta.decorate(task.track).cover);

      task.path = saved.path;
      task.downloaded = saved.size;
      task.total = saved.size;
      task.status = "done";
      await upsertSong(
        task.track,
        saved.path,
        saved.size,
        saved.hasLyrics || Boolean(tagInfo?.hasLyrics),
        task.groups,
        tagsWritten,
        tagInfo,
      );
    } catch (error) {
      if (task.pauseRequested) {
        task.pauseRequested = false;
        task.status = "paused";
        return;
      }
      if (isCanceledError(error)) {
        task.status = "paused";
        return;
      }
      task.status = "error";
      task.error = error instanceof Error ? error.message : String(error);
    }
  }

  /* ------------------------------ 任务操作 ------------------------------ */

  function pauseTask(id: string): void {
    const task = tasks.value.find((item) => item.id === id);
    if (!task) return;
    if (task.status === "downloading") {
      task.pauseRequested = true;
      void cancelDownload(id);
    } else if (task.status === "queued") {
      task.status = "paused";
    }
  }

  function resumeTask(id: string): void {
    const task = tasks.value.find((item) => item.id === id);
    if (!task || task.status !== "paused") return;
    task.status = "queued";
    queuePaused.value = false;
    void pump();
  }

  function retryTask(id: string): void {
    const task = tasks.value.find((item) => item.id === id);
    if (!task || (task.status !== "error" && task.status !== "paused")) return;
    task.status = "queued";
    task.error = undefined;
    void pump();
  }

  function removeTask(id: string): void {
    const index = tasks.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    const task = tasks.value[index];
    if (task.status === "downloading") void cancelDownload(id);
    tasks.value.splice(index, 1);
  }

  /** 清除已完成 / 失败的任务（保留进行中与用户暂停的任务） */
  function clearFinished(): void {
    tasks.value = tasks.value.filter((task) => task.status !== "done" && task.status !== "error");
  }

  function pauseQueue(): void {
    queuePaused.value = true;
    const active = tasks.value.find((task) => task.status === "downloading");
    if (active) pauseTask(active.id);
  }

  function resumeQueue(): void {
    queuePaused.value = false;
    for (const task of tasks.value) {
      if (task.status === "paused") task.status = "queued";
    }
    void pump();
  }

  function toggleQueuePaused(): void {
    if (queuePaused.value) resumeQueue();
    else pauseQueue();
  }

  /** 面板快捷入口：单曲下载 */
  async function downloadTrack(track: UnifiedTrack, group?: DownloadGroup): Promise<void> {
    const groups: DownloadGroup[] = group
      ? [group]
      : [{ kind: "single", name: trackGroupName(track), sourceId: track.sourceId }];
    await enqueue([track], groups);
  }

  /* ------------------------------ 离线文件操作 ------------------------------ */

  async function deleteSong(song: OfflineSong): Promise<void> {
    try {
      await deleteDownload(song.path);
    } catch (error) {
      toast(t("errors.download.deleteFailed", { error: String(error) }), "error");
      return;
    }
    try {
      const db = await getDb();
      await db.execute("delete from offline_songs where source_id = $1 and track_id = $2", [
        song.sourceId,
        song.trackId,
      ]);
    } catch (error) {
      console.error("[downloads] 删除索引失败", error);
    }
    songs.value = songs.value.filter(
      (item) => !(item.sourceId === song.sourceId && item.trackId === song.trackId),
    );
    toast(t("errors.download.removed"), "success");
  }

  /** 清理文件已丢失的索引项 */
  async function cleanMissing(): Promise<number> {
    const missing = songs.value.filter((song) => song.missing);
    if (!missing.length) return 0;
    try {
      const db = await getDb();
      for (const song of missing) {
        await db.execute("delete from offline_songs where source_id = $1 and track_id = $2", [
          song.sourceId,
          song.trackId,
        ]);
      }
    } catch (error) {
      console.error("[downloads] 清理失效项失败", error);
    }
    songs.value = songs.value.filter((song) => !song.missing);
    return missing.length;
  }

  /** 重新校验所有离线文件是否存在 */
  async function refreshMissing(): Promise<void> {
    if (!songs.value.length) return;
    try {
      const flags = await checkDownloads(songs.value.map((song) => song.path));
      songs.value.forEach((song, index) => {
        song.missing = !flags[index];
      });
    } catch {
      /* 校验失败忽略 */
    }
  }

  /** 在文件管理器中定位 */
  async function reveal(song: OfflineSong): Promise<void> {
    try {
      await revealDownload(song.path);
    } catch (error) {
      toast(`${error}`, "error");
    }
  }

  /** 导出到用户选择的目录（移动端常用） */
  async function exportSong(song: OfflineSong): Promise<void> {
    const defaultName = song.path.split(/[\\/]/).pop() ?? `${song.track.name}.mp3`;
    try {
      const dest = await save({ defaultPath: defaultName });
      if (!dest) return;
      await copyDownload(song.path, dest);
      toast(t("errors.download.exported"), "success");
    } catch (error) {
      toast(t("errors.download.exportFailed", { error: String(error) }), "error");
    }
  }

  return {
    tasks,
    songs,
    defaultDir,
    resolvedDir,
    panelOpen,
    queuePaused,
    loaded,
    downloadedKeys,
    offlineTracks,
    downloadedCount,
    totalSize,
    missingCount,
    activeTasks,
    finishedTasks,
    downloadingCount,
    formatBytes,
    init,
    loadIndex,
    ensureDefaultDir,
    isDownloaded,
    localUrl,
    readLyrics,
    enqueue,
    downloadTrack,
    pauseTask,
    resumeTask,
    retryTask,
    removeTask,
    clearFinished,
    pauseQueue,
    resumeQueue,
    toggleQueuePaused,
    deleteSong,
    cleanMissing,
    refreshMissing,
    reveal,
    exportSong,
  };
});
