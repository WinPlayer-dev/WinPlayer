/**
 * 同频服务器曲库（内置播放源「同频服务器」+ 账号数据同步的宿主）。
 *
 * 结构与 `stores/webdav.ts` 平行，因为两者本质是同一类东西：远程曲库 + 索引缓存 +
 * 直链播放。差别在于这里多一层登录态，曲目列表来自服务端 API 而不是目录遍历，
 * 曲目 ID 用文件内容哈希（所以换机、重传、改名都不会错位）。
 *
 * 索引策略：曲目列表是一次性的轻量 JSON（几千首也就几百 KB），
 * 每次登录/手动刷新时整体拉取并落到 `builtin_source_tracks`，
 * 启动时只读缓存、不发请求 —— 断网也能看到曲库、能播已下载的歌。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { t } from "@/i18n";
import { getDb, getSetting, setSetting } from "@/services/db";
import {
  CLOUD_SOURCE_ID,
  cacheCover,
  cloudTrackToLibrary,
  deleteTrack as deleteCloudTrack,
  fetchLyrics,
  fetchMe,
  fetchServerInfo,
  fetchTracks,
  login as loginApi,
  normalizeCloudUrl,
  onUploadProgress,
  patchTrack as patchCloudTrack,
  refreshSession,
  register as registerApi,
  statusOf,
  streamUrlOf,
  uploadTrack as uploadApi,
  type CloudAuthResult,
  type CloudConfig,
  type CloudServerInfo,
  type CloudSession,
  type CloudTrack,
  type CloudUploadResult,
  type CloudUploadSource,
} from "@/services/cloud";
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
import { toast } from "@/services/toast";
import type { AlbumDetail, ArtistDetail, UnifiedAlbum, UnifiedArtist } from "@/types/plugin";

/** 配置与登录态分开存：配置可以进备份，token 不行（`services/backup.ts` 会排除它） */
const CONFIG_KEY = "settings.cloudConfig";
const SESSION_KEY = "settings.cloudSession";

/** 封面预取并发 */
const COVER_CONCURRENCY = 4;

const EMPTY_CONFIG: CloudConfig = { url: "", username: "", serverName: "" };

export interface CloudUploadItem {
  taskId: string;
  filename: string;
  /** downloading（从源站拉取） → uploading → done / failed */
  phase: "downloading" | "uploading" | "done" | "failed";
  transferred: number;
  total: number;
  error: string;
}

export const useCloudStore = defineStore("cloud", () => {
  const config = ref<CloudConfig>({ ...EMPTY_CONFIG });
  const session = ref<CloudSession | null>(null);
  const tracks = ref<LibraryTrack[]>([]);
  const serverInfo = ref<CloudServerInfo | null>(null);
  const loaded = ref(false);
  const refreshing = ref(false);
  const lastRefreshAt = ref(0);
  const usedBytes = ref(0);
  const quotaBytes = ref(0);
  const error = ref("");
  const uploads = ref<CloudUploadItem[]>([]);

  const configured = computed(() => Boolean(config.value.url && session.value?.token));
  const displayName = computed(() => config.value.serverName || t("cloud.server.defaultName"));
  const trackCount = computed(() => tracks.value.length);
  const albumGroups = computed<LibraryAlbumGroup[]>(() => buildAlbumGroups(tracks.value));
  const artistGroups = computed<LibraryArtistGroup[]>(() => buildArtistGroups(tracks.value));
  const albumCount = computed(() => albumGroups.value.length);
  const artistCount = computed(() => artistGroups.value.length);
  const pendingUploads = computed(
    () => uploads.value.filter((item) => item.phase !== "done" && item.phase !== "failed").length,
  );

  function trackToUnified(track: LibraryTrack) {
    return libraryTrackToUnified(track, CLOUD_SOURCE_ID);
  }

  /* ------------------------------ 持久化 ------------------------------ */

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const savedConfig = await getSetting<Partial<CloudConfig>>(CONFIG_KEY, {});
      config.value = { ...EMPTY_CONFIG, ...savedConfig };
      const savedSession = await getSetting<CloudSession | null>(SESSION_KEY, null);
      if (savedSession?.refreshToken) session.value = savedSession;

      const db = await getDb();
      const rows = await db.select<Array<{ payload: string }>>(
        "select payload from builtin_source_tracks where source_id = $1",
        [CLOUD_SOURCE_ID],
      );
      const parsed: LibraryTrack[] = [];
      for (const row of rows) {
        try {
          const track = JSON.parse(row.payload) as LibraryTrack;
          if (track?.path) parsed.push(track);
        } catch {
          /* 单行损坏不影响整体 */
        }
      }
      tracks.value = parsed;
    } catch (loadError) {
      console.error("加载同频服务器曲库失败", loadError);
    } finally {
      loaded.value = true;
    }
  }

  async function persistConfig(): Promise<void> {
    await setSetting(CONFIG_KEY, config.value);
  }

  async function persistSession(next: CloudSession | null): Promise<void> {
    session.value = next;
    await setSetting(SESSION_KEY, next);
  }

  async function persistTracks(next: LibraryTrack[]): Promise<void> {
    const db = await getDb();
    await db.execute("delete from builtin_source_tracks where source_id = $1", [CLOUD_SOURCE_ID]);
    const CHUNK = 20;
    for (let index = 0; index < next.length; index += CHUNK) {
      const chunk = next.slice(index, index + CHUNK);
      const values = chunk.map((_, row) => `($${row * 3 + 1}, $${row * 3 + 2}, $${row * 3 + 3})`);
      const params: unknown[] = [];
      for (const track of chunk) params.push(CLOUD_SOURCE_ID, track.path, JSON.stringify(track));
      await db.execute(
        `insert or replace into builtin_source_tracks (source_id, path, payload) values ${values.join(",")}`,
        params,
      );
    }
  }

  async function clearIndex(): Promise<void> {
    tracks.value = [];
    lastRefreshAt.value = 0;
    const db = await getDb();
    await db.execute("delete from builtin_source_tracks where source_id = $1", [CLOUD_SOURCE_ID]);
  }

  /* ------------------------------ 登录态 ------------------------------ */

  function applyAuth(base: string, result: CloudAuthResult): Promise<void> {
    return persistSession({
      token: result.token,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
      userId: result.user.id,
    }).then(async () => {
      config.value = {
        url: base,
        username: result.user.username,
        serverName: config.value.serverName || t("cloud.server.defaultName"),
      };
      await persistConfig();
    });
  }

  /** 快到期的 token 先换新（提前 60 秒），避免请求边界上失败 */
  async function ensureSession(): Promise<CloudSession | null> {
    const current = session.value;
    if (!current?.token) return null;
    if (current.expiresAt - 60_000 > Date.now()) return current;
    if (!current.refreshToken) return current;
    try {
      const next = await refreshSession(config.value.url, current.refreshToken);
      const merged: CloudSession = {
        token: next.token,
        refreshToken: next.refreshToken,
        expiresAt: Date.now() + next.expiresIn * 1000,
        userId: current.userId,
      };
      await persistSession(merged);
      return merged;
    } catch (refreshError) {
      // refresh 也失效了：清掉登录态，调用方会走「未登录」分支提示重新登录
      if (statusOf(refreshError) === 401) await persistSession(null);
      return session.value;
    }
  }

  /** 统一包装：带上有效 token 执行请求 */
  async function withSession<T>(action: (base: string, token: string) => Promise<T>): Promise<T> {
    const base = config.value.url;
    if (!base) throw new Error(t("cloud.session.notConfigured"));
    const active = await ensureSession();
    if (!active?.token) throw new Error(t("cloud.session.notLoggedIn"));
    return action(base, active.token);
  }

  /* ------------------------------ 服务器与登录 ------------------------------ */

  async function loadServerInfo(rawUrl: string): Promise<CloudServerInfo> {
    const base = normalizeCloudUrl(rawUrl);
    if (!base) throw new Error(t("cloud.session.missingUrl"));
    const info = await fetchServerInfo(base);
    serverInfo.value = info;
    return info;
  }

  async function login(rawUrl: string, username: string, password: string): Promise<void> {
    const base = normalizeCloudUrl(rawUrl);
    if (!base) throw new Error(t("cloud.session.missingUrl"));
    error.value = "";
    try {
      const info = await fetchServerInfo(base);
      serverInfo.value = info;
      const result = await loginApi(base, username.trim(), password);
      config.value = { ...config.value, serverName: info.name };
      await applyAuth(base, result);
      // 换了服务器/账号：旧索引已失效
      await clearIndex();
      await refresh();
    } catch (loginError) {
      error.value = loginError instanceof Error ? loginError.message : String(loginError);
      throw loginError;
    }
  }

  async function register(
    rawUrl: string,
    username: string,
    password: string,
    inviteCode?: string,
  ): Promise<void> {
    const base = normalizeCloudUrl(rawUrl);
    if (!base) throw new Error(t("cloud.session.missingUrl"));
    error.value = "";
    try {
      const info = await fetchServerInfo(base);
      serverInfo.value = info;
      const result = await registerApi(base, username.trim(), password, inviteCode);
      config.value = { ...config.value, serverName: info.name };
      await applyAuth(base, result);
      await clearIndex();
      await refresh();
    } catch (registerError) {
      error.value = registerError instanceof Error ? registerError.message : String(registerError);
      throw registerError;
    }
  }

  async function logout(): Promise<void> {
    await persistSession(null);
    await clearIndex();
    serverInfo.value = null;
  }

  /* ------------------------------ 曲库刷新 ------------------------------ */

  /** 预取封面（服务端曲目才有封面；Rust 侧有磁盘缓存，重复调用不重复下载） */
  async function prefetchCovers(list: CloudTrack[]): Promise<Map<string, string>> {
    const covers = new Map<string, string>();
    const token = session.value?.token;
    if (!token) return covers;
    const pending = list.filter((track) => track.hasCover).map((track) => track.hash);
    for (let index = 0; index < pending.length; index += COVER_CONCURRENCY) {
      const batch = pending.slice(index, index + COVER_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((hash) => cacheCover(config.value.url, token, hash)),
      );
      results.forEach((result, offset) => {
        if (result.status === "fulfilled") covers.set(batch[offset], result.value);
      });
    }
    return covers;
  }

  /** 从服务器拉取曲目列表（登录后、手动刷新、上传完成后调用） */
  async function refresh(): Promise<void> {
    if (refreshing.value) return;
    if (!loaded.value) await load();
    if (!configured.value) {
      error.value = t("cloud.session.notLoggedInShort");
      return;
    }
    refreshing.value = true;
    error.value = "";
    try {
      const list = await withSession((base, token) => fetchTracks(base, token));
      usedBytes.value = list.usedBytes;
      quotaBytes.value = list.quotaBytes;
      const covers = await prefetchCovers(list.tracks);
      const next = list.tracks.map((track) => {
        const row = cloudTrackToLibrary(track);
        return { ...row, cover: covers.get(track.hash) ?? "" };
      });
      tracks.value = next;
      await persistTracks(next);
      lastRefreshAt.value = Date.now();
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      error.value = message;
      if (statusOf(refreshError) === 401) {
        await persistSession(null);
        toast(t("cloud.session.expired"), "error");
      }
    } finally {
      refreshing.value = false;
    }
  }

  /* ------------------------------ 播放与歌词 ------------------------------ */

  function trackOf(hash: string): LibraryTrack | undefined {
    return tracks.value.find((track) => track.path === hash);
  }

  /** 播放直链 + Authorization 头（交给原生解码器，每次 Range 请求都会带上） */
  function songUrlOf(hash: string): { url: string; codec: string; headers?: Record<string, string> } | null {
    const track = trackOf(hash);
    const current = session.value;
    if (!track || !current?.token) return null;
    return {
      url: streamUrlOf(config.value.url, hash),
      codec: codecOfExt(hashOfExt(track.fileName)),
      headers: { Authorization: `Bearer ${current.token}` },
    };
  }

  /** 读歌词（服务端存的是上传时内嵌或客户端附带的 LRC） */
  async function lyricsOf(hash: string): Promise<string | null> {
    try {
      const result = await withSession((base, token) => fetchLyrics(base, token, hash));
      return result.lrc?.trim() ? result.lrc : null;
    } catch {
      return null;
    }
  }

  /* ------------------------------ 增删改 ------------------------------ */

  /** 上传一首歌（`source` 决定音频从本地文件还是插件源直链来） */
  async function upload(options: {
    filename: string;
    source: CloudUploadSource;
    lyrics?: string;
  }): Promise<CloudUploadResult> {
    const taskId = `cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: CloudUploadItem = {
      taskId,
      filename: options.filename,
      phase: options.source.kind === "path" ? "uploading" : "downloading",
      transferred: 0,
      total: 0,
      error: "",
    };
    uploads.value = [item, ...uploads.value].slice(0, 50);

    const find = () => uploads.value.find((entry) => entry.taskId === taskId);
    const unlisten = await onUploadProgress((progress) => {
      if (progress.taskId !== taskId) return;
      const target = find();
      if (!target) return;
      target.phase = progress.phase === "download" ? "downloading" : "uploading";
      target.transferred = progress.transferred;
      target.total = progress.total;
    });

    try {
      const result = await withSession((base, token) =>
        uploadApi({
          base,
          token,
          taskId,
          filename: options.filename,
          source: options.source,
        }),
      );
      const target = find();
      if (target) {
        target.phase = "done";
        target.total = result.track.size;
        target.transferred = result.track.size;
      }
      // 上传时带了歌词就顺手写上去（服务端不会解析插件源的歌词）
      if (options.lyrics?.trim()) {
        try {
          await withSession((base, token) =>
            patchCloudTrack(base, token, result.track.hash, { lyrics: options.lyrics }),
          );
        } catch {
          /* 歌词写入失败不影响音频已上传的事实 */
        }
      }
      return result;
    } catch (uploadError) {
      const target = find();
      if (target) {
        target.phase = "failed";
        target.error = uploadError instanceof Error ? uploadError.message : String(uploadError);
      }
      throw uploadError;
    } finally {
      unlisten();
    }
  }

  /** 改元数据（歌名 / 歌手 / 专辑…），改完就地更新索引，不必整库刷新 */
  async function patchTrack(hash: string, patch: Record<string, unknown>): Promise<void> {
    const result = await withSession((base, token) => patchCloudTrack(base, token, hash, patch));
    const row = cloudTrackToLibrary(result.track);
    const index = tracks.value.findIndex((track) => track.path === hash);
    if (index >= 0) tracks.value[index] = { ...row, cover: tracks.value[index].cover };
    await persistTracks(tracks.value);
  }

  async function remove(hash: string): Promise<void> {
    await withSession((base, token) => deleteCloudTrack(base, token, hash));
    tracks.value = tracks.value.filter((track) => track.path !== hash);
    await persistTracks(tracks.value);
  }

  /** 给同步引擎用：拿到可用的 base + token（必要时先刷新） */
  async function requestContext(): Promise<{ base: string; token: string } | null> {
    const base = config.value.url;
    if (!base) return null;
    const active = await ensureSession();
    if (!active?.token) return null;
    return { base, token: active.token };
  }

  /** 当前登录用户信息（设置页展示） */
  async function me(): Promise<{ username: string; role: string } | null> {
    try {
      const result = await withSession((base, token) => fetchMe(base, token));
      return { username: result.user.username, role: result.user.role };
    } catch {
      return null;
    }
  }

  /* ------------------------------ 查询 ------------------------------ */

  function searchTracks(keyword: string, limit = 200): LibraryTrack[] {
    const words = keyword
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    const matched: LibraryTrack[] = [];
    for (const track of tracks.value) {
      const haystack = `${track.title} ${track.fileName} ${track.artist} ${track.album}`.toLowerCase();
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
      .map((group) => albumGroupToUnified(group, CLOUD_SOURCE_ID));
  }

  function searchArtists(keyword: string): UnifiedArtist[] {
    const lower = keyword.trim().toLowerCase();
    if (!lower) return [];
    return artistGroups.value
      .filter((group) => group.name.toLowerCase().includes(lower))
      .slice(0, 50)
      .map((group) => artistGroupToUnified(group, CLOUD_SOURCE_ID));
  }

  function albumDetail(id: string): AlbumDetail | null {
    const group = albumGroups.value.find((item) => item.id === id);
    if (!group) return null;
    return {
      ...albumGroupToUnified(group, CLOUD_SOURCE_ID),
      tracks: group.tracks.map(trackToUnified),
    };
  }

  function artistDetail(id: string): ArtistDetail | null {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return null;
    return {
      ...artistGroupToUnified(group, CLOUD_SOURCE_ID),
      albumCount: new Set(group.tracks.map((track) => albumIdOf(track))).size,
      hotTracks: group.tracks.slice(0, 50).map(trackToUnified),
    };
  }

  function artistAlbums(id: string): UnifiedAlbum[] {
    const group = artistGroups.value.find((item) => item.id === id || item.name === id);
    if (!group) return [];
    const albumIds = new Set(group.tracks.map((track) => albumIdOf(track)));
    return albumGroups.value
      .filter((album) => albumIds.has(album.id))
      .map((album) => albumGroupToUnified(album, CLOUD_SOURCE_ID));
  }

  async function init(): Promise<void> {
    await load();
  }

  return {
    config,
    session,
    tracks,
    serverInfo,
    loaded,
    refreshing,
    lastRefreshAt,
    usedBytes,
    quotaBytes,
    error,
    uploads,
    configured,
    displayName,
    trackCount,
    albumCount,
    artistCount,
    albumGroups,
    artistGroups,
    pendingUploads,
    load,
    init,
    requestContext,
    login,
    register,
    logout,
    refresh,
    loadServerInfo,
    trackOf,
    songUrlOf,
    lyricsOf,
    upload,
    patchTrack,
    remove,
    me,
    searchTracks,
    searchAlbums,
    searchArtists,
    albumDetail,
    artistDetail,
    artistAlbums,
  };
});

/** 从文件名取扩展名 */
function hashOfExt(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "mp3";
}

/** 扩展名 → 原生解码器认的编码名（与 `services/cloud.ts` 服务端的 codecFor 对齐） */
function codecOfExt(ext: string): string {
  switch (ext) {
    case "flac":
      return "flac";
    case "m4a":
    case "m4b":
    case "mp4":
    case "aac":
      return "aac";
    case "ogg":
    case "oga":
      return "vorbis";
    case "wav":
      return "pcm";
    default:
      return "mp3";
  }
}
