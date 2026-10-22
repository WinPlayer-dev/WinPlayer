/** 播放源管理：插件的安装/卸载/启停/配置、内置源注入，以及跨来源的聚合调用 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { PluginHost } from "@/plugin-runtime/host";
import { getDb } from "@/services/db";
import { cachedImgUrl } from "@/services/imageCache";
import { httpFetchJson } from "@/services/proxy";
import { toast } from "@/services/toast";
import { applyGithubMirror, resolveAssetUrl } from "@/services/githubMirror";
import { QUALITY_SETTING_KEY, qualityChainOf } from "@/services/quality";
import { rememberMediaHeaders } from "@/services/audio";
import {
  BUILTIN_ENTRIES,
  builtinSourceHost,
  isBuiltinSource,
  isBuiltinSourceReady,
  type BuiltinSourceHost,
} from "@/services/builtinSources";
import { useSettingsStore } from "@/stores/settings";
import type {
  AlbumDetail,
  ArtistAlbumsResult,
  ArtistDetail,
  AvatarResult,
  LoginPollResult,
  LoginQr,
  LoginState,
  LyricsResult,
  MarketEntry,
  MarketIndex,
  MarketSource,
  PlaylistDetail,
  PlayRecordPhase,
  PluginCapability,
  PluginEntry,
  PluginManifest,
  RecommendResult,
  SearchResult,
  SongUrlResult,
  UnifiedPlaylist,
  UnifiedTrack,
} from "@/types/plugin";

export interface PluginRecord {
  entry: PluginEntry;
  enabled: boolean;
  settings: Record<string, unknown>;
  /** 最近一次运行时错误（用于播放源管理页展示） */
  error?: string;
}

export interface AggregatedSourceResult<T> {
  record: PluginRecord;
  result: T | null;
  error?: string;
}

/**
 * 原生解码器（symphonia）能解的音频编码，与 `src-tauri/Cargo.toml` 里
 * symphonia 的 features 对齐（mp3 / aac / flac / pcm / vorbis）。
 *
 * 音源可能给出编码更高级的直链（如杜比全景声的 `ec-3`），但下载得了不等于
 * 播得出来。插件只负责如实上报 `codec`，能不能播由这里裁决：不在表里的档位
 * 直接算作本档不可用，继续沿降级链往下走，而不是把解码失败抛给用户。
 */
const DECODABLE_CODECS = new Set(["aac", "flac", "mp3", "vorbis", "pcm"]);

/** 插件提供的头像（能力：avatar，含来源，供界面展示提示） */
export interface AppAvatar {
  image: string;
  label?: string;
  sourceId: string;
}

/** 从 manifest 设置定义生成默认值 */
export function defaultSettingsFromManifest(manifest: PluginManifest): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const item of manifest.settings ?? []) {
    values[item.key] = item.default ?? (item.type === "switch" ? false : "");
  }
  return values;
}

/** 由已安装条目 + 落库状态（plugin_state）构造插件记录 */
function buildRecord(
  entry: PluginEntry,
  row?: { enabled: number; settings: string },
): PluginRecord {
  let settings: Record<string, unknown> = defaultSettingsFromManifest(entry.manifest);
  if (row?.settings) {
    try {
      settings = { ...settings, ...(JSON.parse(row.settings) as Record<string, unknown>) };
    } catch {
      /* 配置损坏时回退默认值 */
    }
  }
  return { entry, enabled: row ? row.enabled === 1 : true, settings };
}

/**
 * 登录凭证存放的设置项 key。
 *
 * 登录凭证属于「插件私有配置」，由宿主统一持久化到该 key，而不是让每个插件
 * 自己想办法落盘——这样设置表单天然能展示/清除凭证，退出登录也只是清空它。
 */
export function credentialKeyOf(manifest: PluginManifest): string {
  return manifest.login?.credentialKey || "credential";
}

/** 官方内置插件市场源：始终存在，不可在设置中删除 */
export const OFFICIAL_MARKET_SOURCE: MarketSource = {
  name: "官方市场",
  url: "https://raw.githubusercontent.com/WinPlayer-dev/plugin-market/main/market-index.json",
};

export const usePluginsStore = defineStore("plugins", () => {
  const settingsStore = useSettingsStore();
  const records = ref<PluginRecord[]>([]);
  const loading = ref(false);

  /** 运行时宿主（非响应式）：插件走 Worker 沙箱，内置源走本地实现，接口同形 */
  const hosts = new Map<string, PluginHost | BuiltinSourceHost>();

  /**
   * 参与聚合调用的来源：启用中，且内置源已经配置好。
   * 未配置的 WebDAV 若也算进来，搜索页会多出一个永远没结果的 Tab。
   */
  const enabledRecords = computed(() =>
    records.value.filter(
      (record) => record.enabled && (!isBuiltinSource(record.entry.id) || isBuiltinSourceReady(record.entry.id)),
    ),
  );

  /** 已安装的插件（不含内置播放源）：插件市场/统计/引导判定都用它 */
  const installedRecords = computed(() =>
    records.value.filter((record) => !isBuiltinSource(record.entry.id)),
  );

  /** 内置播放源（始终存在，不可卸载） */
  const builtinRecords = computed(() =>
    records.value.filter((record) => isBuiltinSource(record.entry.id)),
  );

  function hasCapability(record: PluginRecord, capability: PluginCapability): boolean {
    return record.entry.manifest.capabilities?.includes(capability) ?? false;
  }

  async function persistState(record: PluginRecord): Promise<void> {
    const db = await getDb();
    await db.execute(
      `insert into plugin_state (plugin_id, enabled, settings) values ($1, $2, $3)
       on conflict(plugin_id) do update set enabled = $2, settings = $3`,
      [record.entry.id, record.enabled ? 1 : 0, JSON.stringify(record.settings ?? {})],
    );
  }

  /** 加载已安装插件列表（磁盘 + 启用状态/配置） */
  async function loadInstalled(): Promise<void> {
    loading.value = true;
    try {
      const entries = await invoke<PluginEntry[]>("plugin_list");
      const db = await getDb();
      const states = await db.select<Array<{ plugin_id: string; enabled: number; settings: string }>>(
        "select plugin_id, enabled, settings from plugin_state",
      );
      const stateMap = new Map(states.map((row) => [row.plugin_id, row]));

      records.value = [
        // 内置播放源固定排在前面：它们不属于「已安装的插件」，但同样参与
        // 搜索页 Tab、播放源偏好等所有按 record 走的逻辑
        ...BUILTIN_ENTRIES.map((entry) => buildRecord(entry, stateMap.get(entry.id))),
        ...entries.map((entry) => buildRecord(entry, stateMap.get(entry.id))),
      ];

      // 清理已卸载插件的运行时
      for (const [id, host] of hosts) {
        if (!records.value.some((r) => r.entry.id === id)) {
          host.dispose();
          hosts.delete(id);
        }
      }
    } catch (error) {
      console.error("加载插件列表失败", error);
      toast(`加载插件列表失败: ${error}`, "error");
    } finally {
      loading.value = false;
    }
  }

  /** 获取来源运行时（懒加载）：插件启动 Worker 沙箱，内置源直接返回本地宿主 */
  async function getHost(id: string): Promise<PluginHost | BuiltinSourceHost> {
    const record = records.value.find((r) => r.entry.id === id);
    if (!record) throw new Error(`播放源不存在: ${id}`);
    if (!record.enabled) throw new Error(`播放源已停用: ${record.entry.manifest.name}`);

    const existing = hosts.get(id);
    if (existing) return existing;

    // 内置源：不读磁盘、不起 Worker，直接取本地实现
    const builtin = builtinSourceHost(id);
    if (builtin) {
      hosts.set(id, builtin);
      record.error = undefined;
      return builtin;
    }

    const code = await invoke<string>("plugin_read_code", { id });
    const host = new PluginHost(record.entry, code, record.settings);
    hosts.set(id, host);
    try {
      await host.ready;
      record.error = undefined;
    } catch (error) {
      hosts.delete(id);
      host.dispose();
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return host;
  }

  async function togglePlugin(id: string, enabled: boolean): Promise<void> {
    const record = records.value.find((r) => r.entry.id === id);
    if (!record) return;
    record.enabled = enabled;
    await persistState(record);
    if (!enabled) {
      hosts.get(id)?.dispose();
      hosts.delete(id);
    }
  }

  /** 保存插件配置并重建运行时 */
  async function updateSettings(id: string, values: Record<string, unknown>): Promise<void> {
    const record = records.value.find((r) => r.entry.id === id);
    if (!record) return;
    record.settings = { ...defaultSettingsFromManifest(record.entry.manifest), ...values };
    await persistState(record);
    hosts.get(id)?.dispose();
    hosts.delete(id);
  }

  /** 从本地文件/目录/zip 安装 */
  async function installFromDialog(): Promise<boolean> {
    const path = await open({
      multiple: false,
      directory: false,
      title: "选择插件包（.zip / .json）",
      filters: [{ name: "WinPlayer 插件", extensions: ["zip", "json"] }],
    });
    if (!path || Array.isArray(path)) return false;
    try {
      const entry = await invoke<PluginEntry>("plugin_install_from_path", { src: path });
      await loadInstalled();
      toast(`插件「${entry.manifest.name}」安装成功`, "success");
      return true;
    } catch (error) {
      toast(`安装失败: ${error}`, "error");
      return false;
    }
  }

  /** 从 URL 安装（GitHub 仓库地址 / GitHub 系直链自动走设置的镜像源） */
  async function installFromUrl(url: string): Promise<boolean> {
    try {
      const entry = await invoke<PluginEntry>("plugin_install_from_url", {
        url,
        mirror: settingsStore.githubMirror,
      });
      await loadInstalled();
      toast(`插件「${entry.manifest.name}」安装成功`, "success");
      return true;
    } catch (error) {
      toast(`安装失败: ${error}`, "error");
      return false;
    }
  }

  async function uninstall(id: string): Promise<void> {
    if (isBuiltinSource(id)) {
      // 内置源由宿主提供，没有可删除的插件包
      toast("内置播放源无法卸载，可直接停用", "info");
      return;
    }
    const record = records.value.find((r) => r.entry.id === id);
    hosts.get(id)?.dispose();
    hosts.delete(id);
    try {
      await invoke("plugin_remove", { id });
      await loadInstalled();
      toast(`插件「${record?.entry.manifest.name ?? id}」已卸载`, "success");
    } catch (error) {
      toast(`卸载失败: ${error}`, "error");
    }
  }

  /** 卸载全部运行时（应用退出时调用） */
  function disposeAll(): void {
    for (const host of hosts.values()) host.dispose();
    hosts.clear();
  }

  /* ------------------------------ 聚合调用 ------------------------------ */

  /**
   * 按来源搜索：只调用传入的插件（顺序即 Tab 顺序），失败的来源以 error 返回而不抛错。
   *
   * - `type` 省略：插件返回单曲 + 歌单（一次请求覆盖两个 Tab，省一次往返）
   * - `type` = album / artist：单独请求该类型
   *
   * 搜索页每个插件 Tab 只把自己的 id 传进来（切到哪个 Tab 才搜哪个插件）；
   * 「全部」Tab 才把所有权重一起传入做聚合。
   */
  async function searchSources(
    pluginIds: string[],
    keyword: string,
    type?: "song" | "playlist" | "album" | "artist",
  ): Promise<AggregatedSourceResult<SearchResult>[]> {
    const targets = pluginIds
      .map((id) => enabledRecords.value.find((r) => r.entry.id === id))
      .filter(
        (record): record is PluginRecord =>
          record !== undefined && hasCapability(record, "search"),
      );
    const results = await Promise.all(
      targets.map(async (record): Promise<AggregatedSourceResult<SearchResult>> => {
        try {
          const host = await getHost(record.entry.id);
          const params = type ? { keyword, type, page: 1 } : { keyword, page: 1 };
          const result = await host.invoke<SearchResult>("search", params);
          return { record, result: normalizeSearchResult(result, record.entry.id) };
        } catch (error) {
          return { record, result: null, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    return sortByPreferredSource(results, settingsStore.trackSourceId);
  }

  /** 聚合推荐 */
  async function recommendAll(): Promise<AggregatedSourceResult<RecommendResult>[]> {
    const targets = enabledRecords.value.filter((r) => hasCapability(r, "recommend"));
    return Promise.all(
      targets.map(async (record): Promise<AggregatedSourceResult<RecommendResult>> => {
        try {
          const host = await getHost(record.entry.id);
          const result = await host.invoke<RecommendResult>("getRecommendations", {});
          return { record, result: normalizeRecommendResult(result, record.entry.id) };
        } catch (error) {
          return { record, result: null, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }

  /**
   * 跨插件搜一首歌（歌单导入时给没有来源信息的曲目补身份）。
   *
   * 按「歌曲信息源」偏好排序，逐个插件串行尝试，取第一个有结果的插件的第一首；
   * 全部失败返回 null，由调用方保留原占位曲目。
   */
  async function searchTrack(keyword: string): Promise<UnifiedTrack | null> {
    const trimmed = keyword.trim();
    if (!trimmed) return null;
    const targets = sortByPreferredSource(
      enabledRecords.value
        .filter((r) => hasCapability(r, "search"))
        .map((record) => ({ record })),
      settingsStore.trackSourceId,
    );
    for (const { record } of targets) {
      try {
        const host = await getHost(record.entry.id);
        const result = await host.invoke<SearchResult>("search", { keyword: trimmed, page: 1 });
        const song = result?.songs?.[0];
        if (song) return { ...song, sourceId: record.entry.id };
      } catch {
        // 这个插件不可用（未登录 / 网络错误），换下一个
      }
    }
    return null;
  }

  /**
   * 在指定插件里按搜索格式重新定位曲目（播放源/歌词源用）。
   * 用设置中的「搜索格式」拼接关键词，取该插件搜索结果的第一首；
   * 插件不可用、搜索失败或无结果时返回 null，由调用方回退原曲目来源。
   */
  async function relocateTrack(sourceId: string, track: UnifiedTrack): Promise<UnifiedTrack | null> {
    const record = records.value.find((r) => r.entry.id === sourceId);
    if (!record || !record.enabled || !hasCapability(record, "search")) return null;
    const keyword = formatTrackKeyword(track, settingsStore.sourceSearchFormat);
    if (!keyword) return null;
    try {
      const host = await getHost(sourceId);
      const result = await host.invoke<SearchResult>("search", { keyword, page: 1 });
      const song = result?.songs?.[0];
      return song ? { ...song, sourceId } : null;
    } catch {
      return null;
    }
  }

  /**
   * 获取某首歌的播放直链。
   *
   * 三段回退，任一段成功即返回：
   * 1. **播放源偏好**（设置里的「播放源」）：按搜索格式在该源重新搜曲；
   * 2. **曲目自身来源**：直接用曲目 ID 取直链；
   * 3. **其它启用插件**：逐个按关键词重搜（每个插件只取第一条），
   *    用于原来源下架 / 限地区 / 未登录的场景。
   *
   * 每一段内部还会沿 `QUALITY_DESCENT` 逐档降级，高音质被版权 / 会员权限
   * 拒绝也能出声。全部失败时汇总各段的原因抛错，便于用户判断是「没登录」
   * 还是「所有来源都没有这首歌」。
   */
  async function getSongUrl(track: UnifiedTrack): Promise<SongUrlResult> {
    const failures: string[] = [];
    const playSourceId = settingsStore.playSourceId;

    // 1. 播放源偏好
    if (playSourceId && playSourceId !== track.sourceId) {
      const relocated = await relocateTrack(playSourceId, track);
      if (relocated) {
        try {
          const host = await getHost(playSourceId);
          return await invokeWithQualityFallback(host, playSourceId, relocated.id);
        } catch (error) {
          failures.push(`${pluginDisplayName(records.value, playSourceId)}: ${describeError(error)}`);
        }
      } else {
        failures.push(`${pluginDisplayName(records.value, playSourceId)}: 未搜索到对应歌曲`);
      }
    }

    // 2. 曲目自身来源
    if (track.sourceId) {
      try {
        const host = await getHost(track.sourceId);
        return await invokeWithQualityFallback(host, track.sourceId, track.id);
      } catch (error) {
        failures.push(`${pluginDisplayName(records.value, track.sourceId)}: ${describeError(error)}`);
      }
    } else {
      failures.push("曲目缺少来源信息");
    }

    // 3. 其它启用插件（跳过前面已经试过的来源；内置源的本地曲库不参与网络歌曲换源）
    const tried = new Set([track.sourceId ?? "", playSourceId].filter(Boolean));
    const keyword = formatTrackKeyword(track, settingsStore.sourceSearchFormat);
    if (keyword) {
      for (const record of enabledRecords.value) {
        if (tried.has(record.entry.id)) continue;
        if (isBuiltinSource(record.entry.id)) continue;
        if (!hasCapability(record, "songUrl") || !hasCapability(record, "search")) continue;
        const sample = await relocateTrack(record.entry.id, track);
        if (!sample) continue;
        try {
          const host = await getHost(record.entry.id);
          const result = await invokeWithQualityFallback(host, record.entry.id, sample.id);
          // 命中备用来源：提示一次，让用户知道换源了
          toast(`原来源无法播放，已改用「${record.entry.manifest.name}」`, "info");
          return result;
        } catch (error) {
          failures.push(`${record.entry.manifest.name}: ${describeError(error)}`);
        }
      }
    }

    const detail = failures.length ? failures.join("；") : "没有可用的播放来源";
    throw new Error(`无法获取播放地址（已尝试 ${Math.max(1, failures.length)} 个来源）：${detail}`);
  }

  /** 按「从高到低」候选链请求直链：高音质失败自动降级，全部失败抛最后一次错误 */
  async function invokeWithQualityFallback(
    host: PluginHost | BuiltinSourceHost,
    sourceId: string,
    id: string,
  ): Promise<SongUrlResult> {
    const current = currentQualityOf(sourceId);
    const record = records.value.find((entry) => entry.entry.id === sourceId);
    // 降级链来自插件自己声明的档位：插件加了新档位（杜比 / 无损等）宿主自动跟上
    const chain = qualityChainOf(record, current);
    // 未识别的档位（自定义插件值）：只请求它本身，不猜降级链
    const candidates: Array<string | undefined> = chain.length ? chain : current ? [current] : [undefined];
    let lastError: unknown = null;
    for (const [index, quality] of candidates.entries()) {
      try {
        const result = await host.invoke<SongUrlResult>("getSongUrl", { id, quality });
        if (result?.url) {
          const codec = String(result.codec ?? "").trim().toLowerCase();
          if (codec && !DECODABLE_CODECS.has(codec)) {
            // 音源拿到了这一档，但原生解码器解不了：当作本档不可用，继续降级
            lastError = new Error(`当前解码器不支持 ${codec} 编码`);
            console.warn(
              `[plugins] ${sourceId} 音质 ${quality ?? "默认"} 的编码 ${codec} 原生解码器不支持，自动降级`,
            );
            continue;
          }
          // 防盗链直链：把插件声明的请求头记到 URL 上，播放/预载/播放链自动带上
          rememberMediaHeaders(result.url, result.headers);
          if (index > 0) {
            console.warn(
              `[plugins] ${sourceId} 音质 ${current} 不可用，已降级到 ${quality ?? "插件默认"}`,
            );
          }
          return result;
        }
        lastError = new Error("来源未返回可用的播放地址");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("来源未返回可用的播放地址");
  }

  /** 读取插件的音质设置（未声明 quality 设置项时返回空串，表示由插件自行决定） */
  function currentQualityOf(sourceId: string): string {
    const record = records.value.find((entry) => entry.entry.id === sourceId);
    if (!record) return "";
    return String(record.settings[QUALITY_SETTING_KEY] ?? "");
  }

  /** 获取歌词（失败返回 null，不打断播放）。配置了歌词源时优先在该源重新搜曲取词，失败回退原来源 */
  async function getLyrics(track: UnifiedTrack): Promise<LyricsResult | null> {
    const lyricsSourceId = settingsStore.lyricsSourceId;
    if (lyricsSourceId && lyricsSourceId !== track.sourceId) {
      const relocated = await relocateTrack(lyricsSourceId, track);
      if (relocated) {
        try {
          const host = await getHost(lyricsSourceId);
          const result = await host.invoke<LyricsResult>("getLyrics", { id: relocated.id });
          if (result?.lrc) return result;
        } catch {
          /* 歌词源取词失败，回退到曲目自身来源 */
        }
      }
    }
    if (!track.sourceId) return null;
    try {
      const host = await getHost(track.sourceId);
      return await host.invoke<LyricsResult>("getLyrics", { id: track.id });
    } catch {
      return null;
    }
  }

  /** 获取插件来源的歌单详情 */
  async function getPlaylistDetail(sourceId: string, playlistId: string): Promise<PlaylistDetail | null> {
    const host = await getHost(sourceId);
    const detail = await host.invoke<PlaylistDetail>("getPlaylist", { id: playlistId });
    if (detail) {
      detail.sourceId = sourceId;
      detail.cover = cachedImgUrl(detail.cover);
      detail.tracks = (detail.tracks ?? []).map((t) => withCover({ ...t, sourceId }));
    }
    return detail;
  }

  /** 获取插件来源的专辑详情（含曲目） */
  async function getAlbumDetail(sourceId: string, albumId: string): Promise<AlbumDetail | null> {
    const host = await getHost(sourceId);
    const detail = await host.invoke<AlbumDetail>("getAlbum", { id: albumId });
    if (detail) {
      detail.sourceId = sourceId;
      detail.cover = cachedImgUrl(detail.cover);
      detail.tracks = (detail.tracks ?? []).map((t) => withCover({ ...t, sourceId }));
    }
    return detail;
  }

  /** 获取插件来源的歌手详情（含热门歌曲） */
  async function getArtistDetail(sourceId: string, artistId: string): Promise<ArtistDetail | null> {
    const host = await getHost(sourceId);
    const detail = await host.invoke<ArtistDetail>("getArtist", { id: artistId });
    if (detail) {
      detail.sourceId = sourceId;
      detail.avatar = cachedImgUrl(detail.avatar);
      detail.hotTracks = (detail.hotTracks ?? []).map((t) => withCover({ ...t, sourceId }));
    }
    return detail;
  }

  /** 获取插件来源的歌手专辑列表（分页，滚动加载用） */
  async function getArtistAlbums(
    sourceId: string,
    artistId: string,
    page = 1,
  ): Promise<ArtistAlbumsResult | null> {
    const host = await getHost(sourceId);
    const result = await host.invoke<ArtistAlbumsResult>("getArtistAlbums", { id: artistId, page });
    if (result) {
      result.albums = (result.albums ?? []).map((album) => withCover({ ...album, sourceId }));
    }
    return result;
  }

  /** 获取热搜词（聚合所有支持的插件） */
  async function getHotKeywords(): Promise<string[]> {
    const targets = enabledRecords.value.filter((r) => hasCapability(r, "hotKeywords"));
    const results = await Promise.allSettled(
      targets.map(async (record) => {
        const host = await getHost(record.entry.id);
        return host.invoke<string[]>("getHotKeywords", {});
      }),
    );
    const words = new Set<string>();
    for (const result of results) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        for (const word of result.value) if (word) words.add(String(word));
      }
    }
    return [...words];
  }

  /* ------------------------------ 登录（能力：login） ------------------------------ */

  /** 生成登录二维码；插件未实现登录能力时返回 null */
  async function getLoginQr(sourceId: string): Promise<LoginQr | null> {
    const record = getRecordOrThrow(sourceId);
    if (!hasCapability(record, "login")) return null;
    const host = await getHost(sourceId);
    return await host.invoke<LoginQr>("getLoginQr", { fresh: true });
  }

  /**
   * 轮询扫码状态。
   *
   * 返回 success 时会把凭证写回插件配置的 credentialKey 设置项——该写入会重建
   * Worker，因此调用方在拿到 success 后必须停止轮询，否则下一次 invoke 会抛
   * “插件已卸载”。
   */
  async function pollLogin(sourceId: string, key?: string): Promise<LoginPollResult | null> {
    const record = getRecordOrThrow(sourceId);
    if (!hasCapability(record, "login")) return null;
    const host = await getHost(sourceId);
    const result = await host.invoke<LoginPollResult>("pollLogin", key ? { key } : {});

    if (result?.status !== "success") return result;
    if (!result.credential) {
      // 成功但没拿到凭证，宁可报错也不能让 UI 显示“已登录”却查不到任何数据
      return { status: "error", message: "插件未返回登录凭证" };
    }
    const credentialKey = credentialKeyOf(record.entry.manifest);
    await updateSettings(sourceId, { ...record.settings, [credentialKey]: result.credential });
    return result;
  }

  /** 查询当前登录态（插件未实现时返回 null） */
  async function getLoginState(sourceId: string): Promise<LoginState | null> {
    try {
      const host = await getHost(sourceId);
      return await host.invoke<LoginState>("getLoginState", {});
    } catch {
      return null;
    }
  }

  /** 退出登录：清空凭证设置项（同样会重建 Worker） */
  async function logout(sourceId: string): Promise<void> {
    const record = getRecordOrThrow(sourceId);
    if (!hasCapability(record, "login")) return;
    try {
      const host = await getHost(sourceId);
      await host.invoke("logout", {});
    } catch {
      /* 插件侧清理失败不影响凭证清除 */
    }
    const credentialKey = credentialKeyOf(record.entry.manifest);
    await updateSettings(sourceId, { ...record.settings, [credentialKey]: "" });
  }

  /* ------------------------------ 头像（能力：avatar） ------------------------------ */

  /**
   * 获取窗口右上角展示的头像。
   *
   * 设置了头像源时优先尝试该插件，随后按启用插件的声明顺序依次尝试其余插件，
   * 取第一个返回结果（AvatarResult）的插件；未登录/无头像返回 null 的插件视为
   * 未提供，继续找下一个。全部失败时返回 null，调用方回退到默认头像。
   */
  async function getAvatar(): Promise<AppAvatar | null> {
    const targets = enabledRecords.value.filter((r) => hasCapability(r, "avatar"));
    const preferred = settingsStore.avatarSourceId;
    const ordered = preferred
      ? [...targets.filter((r) => r.entry.id === preferred), ...targets.filter((r) => r.entry.id !== preferred)]
      : targets;
    for (const record of ordered) {
      try {
        const host = await getHost(record.entry.id);
        const result = await host.invoke<AvatarResult>("getAvatar", {});
        if (result?.image) {
          return { image: cachedImgUrl(result.image) ?? result.image, label: result.label, sourceId: record.entry.id };
        }
      } catch {
        /* 该插件取头像失败，尝试下一个 */
      }
    }
    return null;
  }

  /* ------------------------------ 个人歌单（能力：myPlaylists） ------------------------------ */

  /**
   * 聚合所有支持个人歌单的插件，拉取平台账号的歌单列表。
   * 单个插件失败（如未登录）不影响其它插件，错误挂在对应分组上供界面提示。
   */
  async function getUserPlaylistsAll(): Promise<AggregatedSourceResult<UnifiedPlaylist[]>[]> {
    const targets = enabledRecords.value.filter((r) => hasCapability(r, "myPlaylists"));
    return Promise.all(
      targets.map(async (record): Promise<AggregatedSourceResult<UnifiedPlaylist[]>> => {
        try {
          const host = await getHost(record.entry.id);
          const result = await host.invoke<UnifiedPlaylist[]>("getUserPlaylists", {});
          const playlists = (result ?? []).map((p) => withCover({ ...p, sourceId: record.entry.id }));
          return { record, result: playlists };
        } catch (error) {
          return {
            record,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  }

  /** 某个插件来源的平台歌单列表（加入歌单选择器用） */
  async function getUserPlaylists(sourceId: string): Promise<UnifiedPlaylist[]> {
    const host = await getHost(sourceId);
    const result = await host.invoke<UnifiedPlaylist[]>("getUserPlaylists", {});
    return (result ?? []).map((p) => withCover({ ...p, sourceId }));
  }

  /** 把歌曲加入插件平台的歌单 */
  async function addToUserPlaylist(sourceId: string, playlistId: string, trackId: string): Promise<void> {
    const host = await getHost(sourceId);
    await host.invoke("addToUserPlaylist", { playlistId, trackId });
  }

  /** 把歌曲从插件平台的歌单移除 */
  async function removeFromUserPlaylist(sourceId: string, playlistId: string, trackId: string): Promise<void> {
    const host = await getHost(sourceId);
    await host.invoke("removeFromUserPlaylist", { playlistId, trackId });
  }

  /* ------------------------------ 播放回传（能力：playRecord） ------------------------------ */

  /**
   * 把一次播放回传给平台（能力：playRecord）。
   *
   * 只回传给**曲目自身所属的插件**：曲目 ID 只在这个来源里有效（跨源换播时
   * 网易云 ID 在别的平台毫无意义）。未声明能力、插件未登录、请求失败都只写
   * 一条 warn——这是纯旁路能力，绝不能影响播放。
   */
  function reportPlay(track: UnifiedTrack, phase: PlayRecordPhase, seconds = 0): void {
    const sourceId = track.sourceId;
    if (!sourceId) return;
    const record = records.value.find((entry) => entry.entry.id === sourceId);
    if (!record || !record.enabled || !hasCapability(record, "playRecord")) return;
    void (async () => {
      try {
        const host = await getHost(sourceId);
        await host.invoke("reportPlay", { track, phase, seconds });
      } catch (error) {
        console.warn(`[plugins] ${sourceId} 播放回传（${phase}）失败：${describeError(error)}`);
      }
    })();
  }

  /** 按 id 找到插件记录，找不到时抛出可读错误 */
  function getRecordOrThrow(sourceId: string): PluginRecord {
    const record = records.value.find((r) => r.entry.id === sourceId);
    if (!record) throw new Error(`插件 ${sourceId} 未安装`);
    return record;
  }

  /* ------------------------------ 插件市场 ------------------------------ */

  /** 全部市场源：官方内置源固定在首位（不可删除），后接用户自建源（按 url 去重） */
  function allMarketSources(): MarketSource[] {
    const rest = settingsStore.marketSources.filter(
      (source) => source.url !== OFFICIAL_MARKET_SOURCE.url,
    );
    return [OFFICIAL_MARKET_SOURCE, ...rest];
  }

  /**
   * 识别 GitHub 仓库地址，返回仓库内 manifest.json 的 raw 候选地址（用于解析真实版本）。
   * 仓库根地址依次尝试 main / master 默认分支；/tree/{branch} 地址用指定分支。
   */
  function rawManifestCandidates(url: string): string[] {
    if (!url.startsWith("https://github.com/")) return [];
    const segs = url
      .slice("https://github.com/".length)
      .replace(/\/+$/, "")
      .split("/");
    if (segs.length < 2 || !segs[0] || !segs[1]) return [];
    const base = `https://raw.githubusercontent.com/${segs[0]}/${segs[1]}`;
    if (segs[2] === "tree" && segs.length > 3) {
      const branch = segs.slice(3).join("/");
      return branch ? [`${base}/${branch}/manifest.json`] : [];
    }
    if (segs.length !== 2) return [];
    return [`${base}/main/manifest.json`, `${base}/master/manifest.json`];
  }

  /** 从插件源头解析版本号：GitHub 仓库地址拉仓库 manifest.json 的 version，其余或失败返回 undefined */
  async function resolvePluginVersion(url: string, mirror: string): Promise<string | undefined> {
    for (const rawUrl of rawManifestCandidates(url)) {
      try {
        const manifest = await httpFetchJson<{ version?: unknown }>(
          applyGithubMirror(rawUrl, mirror),
          10_000,
        );
        if (typeof manifest.version === "string" && manifest.version) return manifest.version;
      } catch {
        /* 尝试下一个候选分支 */
      }
    }
    return undefined;
  }

  /**
   * 拉取所有市场源的索引，合并为可安装条目列表（GitHub 系地址走镜像）。
   * 版本号不取自市场索引，而是从插件源头解析（GitHub 仓库拉 manifest.json），
   * 直链 zip/json 或解析失败时版本未知。
   */
  async function fetchMarketEntries(): Promise<MarketEntry[]> {
    const mirror = settingsStore.githubMirror;
    const results = await Promise.allSettled(
      allMarketSources().map(async (source) => {
        const index = await httpFetchJson<MarketIndex>(applyGithubMirror(source.url, mirror), 15_000);
        return (index.plugins ?? []).map((entry) => ({
          ...entry,
          sourceName: source.name,
          // 索引中的 version 字段已废弃，版本号一律从插件源头解析
          version: undefined,
          // banner 支持相对索引地址的相对路径；GitHub 系图片同样走镜像
          banner: entry.banner
            ? applyGithubMirror(resolveAssetUrl(source.url, entry.banner), mirror)
            : undefined,
        }));
      }),
    );
    const entries: MarketEntry[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") entries.push(...result.value);
    }
    await Promise.all(
      entries.map(async (entry) => {
        entry.version = await resolvePluginVersion(entry.url, mirror);
      }),
    );
    return entries;
  }

  return {
    records,
    loading,
    enabledRecords,
    installedRecords,
    builtinRecords,
    isBuiltinSource,
    /** 「播放源」偏好（空串 = 跟随曲目自身来源）；音质入口据此判断实际生效的插件 */
    playSourcePreference: computed(() => settingsStore.playSourceId),
    hasCapability,
    loadInstalled,
    getHost,
    togglePlugin,
    updateSettings,
    installFromDialog,
    installFromUrl,
    uninstall,
    disposeAll,
    searchSources,
    recommendAll,
    getSongUrl,
    getLyrics,
    getPlaylistDetail,
    getAlbumDetail,
    getArtistDetail,
    getArtistAlbums,
    getHotKeywords,
    getLoginQr,
    pollLogin,
    getLoginState,
    logout,
    getAvatar,
    getUserPlaylistsAll,
    getUserPlaylists,
    searchTrack,
    addToUserPlaylist,
    removeFromUserPlaylist,
    reportPlay,
    fetchMarketEntries,
  };
});

/* --------------------------- 结果归一化辅助 --------------------------- */

/** 把指定来源的结果排到最前（信息源优先），其余保持原顺序（sort 稳定） */
function sortByPreferredSource<T extends { record: PluginRecord }>(
  results: T[],
  preferredSourceId: string,
): T[] {
  if (!preferredSourceId) return results;
  return results.sort(
    (a, b) =>
      (a.record.entry.id === preferredSourceId ? 0 : 1) -
      (b.record.entry.id === preferredSourceId ? 0 : 1),
  );
}

/** 变量占位符：歌曲名 / 歌手名（逗号连接） / 专辑名 / 别名 */
const KEYWORD_VARIABLES: Record<string, (track: UnifiedTrack) => string> = {
  "{歌曲名}": (track) => track.name ?? "",
  "{歌手名}": (track) => (track.artists ?? []).join(", "),
  "{专辑名}": (track) => track.album ?? "",
  "{别名}": (track) => track.alias ?? "",
};

/** 按「搜索格式」拼接曲目的搜索关键词，默认「{歌曲名} - {歌手名}」 */
export function formatTrackKeyword(track: UnifiedTrack, format: string): string {
  let keyword = format?.trim() ? format : "{歌曲名} - {歌手名}";
  for (const [token, resolve] of Object.entries(KEYWORD_VARIABLES)) {
    keyword = keyword.split(token).join(resolve(track));
  }
  return keyword.trim();
}

function normalizeSearchResult(result: SearchResult | null, sourceId: string): SearchResult {
  if (!result) return {};
  return {
    ...result,
    songs: (result.songs ?? []).map((t) => withCover({ ...t, sourceId })),
    playlists: (result.playlists ?? []).map((p) => withCover({ ...p, sourceId })),
    albums: (result.albums ?? []).map((a) => withCover({ ...a, sourceId })),
    artists: (result.artists ?? []).map((a) => ({ ...a, sourceId, avatar: cachedImgUrl(a.avatar) })),
  };
}

function normalizeRecommendResult(result: RecommendResult | null, sourceId: string): RecommendResult {
  if (!result) return {};
  return {
    ...result,
    songs: (result.songs ?? []).map((t) => withCover({ ...t, sourceId })),
    playlists: (result.playlists ?? []).map((p) => withCover({ ...p, sourceId })),
  };
}

/** 把 http(s) 封面改写为本地磁盘缓存地址（cachedimg 协议，见 services/imageCache.ts） */
function withCover<T extends { cover?: string }>(item: T): T {
  return { ...item, cover: cachedImgUrl(item.cover) };
}

/** 供外部（如视图）判断插件来源显示名 */
export function pluginDisplayName(records: PluginRecord[], sourceId?: string): string {
  if (!sourceId) return "";
  return records.find((r) => r.entry.id === sourceId)?.entry.manifest.name ?? sourceId;
}

/** 把各种来源的错误压成一句可读文本（汇总多来源失败原因时用） */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  const text = String(error ?? "").trim();
  // Worker 抛出的错误常带 "Error: " 前缀，去掉避免重复
  return text.replace(/^Error:\s*/i, "") || "未知错误";
}

export type { UnifiedPlaylist };
