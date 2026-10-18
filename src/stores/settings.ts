/** 应用设置：主题、插件市场源等（持久化于 SQLite settings 表） */

import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "@/services/db";
import { getAudioEngine } from "@/services/audio";
import { useIsMobile } from "@/composables/useIsMobile";
import { setHapticsEnabled } from "@/services/haptics";
import { clearDataCache } from "@/services/cache";
import { applyWindowMaterial, type WindowMaterial } from "@/services/windowMaterial";
import {
  EQ_CUSTOM_PRESET_ID,
  EQ_PRESETS,
  FLAT_GAINS,
  findEqPreset,
} from "@/constants/eqPresets";
import type { MarketSource } from "@/types/plugin";

export type ThemePreference = "system" | "light" | "dark";

/** 「缓存项」策略：歌单（页面数据）/ 图片，可组合或全关 */
export type CachePolicy = "playlist" | "images" | "both" | "none";

/** 自动检查更新的频率：每次启动 / 每 24 小时 / 仅手动 */
export type UpdateCheckFrequency = "startup" | "daily" | "manual";

/** 「来源偏好」默认值：空串表示不指定插件，由系统按当前逻辑自动决定 */
export type SourcePreference = string;

/** 播放源/歌词源搜索关键词的默认拼接格式 */
export const DEFAULT_SOURCE_SEARCH_FORMAT = "{歌曲名} - {歌手名}";

/** 下载文件名默认模板（`/` 可建子目录） */
export const DEFAULT_DOWNLOAD_NAME_TEMPLATE = "{artist} - {name}";

/** 下载文件名模板可用变量（设置页展示用） */
export const DOWNLOAD_TEMPLATE_VARS = [
  "{name}",
  "{artist}",
  "{album}",
  "{source}",
  "{id}",
] as const;

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemePreference>("system");
  const marketSources = ref<MarketSource[]>([]);
  /** GitHub 镜像源前缀（URL 拼接型，如 https://ghproxy.net/），空串表示直连 */
  const githubMirror = ref("");
  /** 是否启用系统媒体传输控件（SMTC，仅 Windows） */
  const smtcEnabled = ref(true);
  /** 歌曲信息源（插件 ID，空串为默认）：搜索结果聚合时置顶 */
  const trackSourceId = ref<SourcePreference>("");
  /** 播放源（插件 ID，空串为默认）：播放时按搜索格式在该插件重新搜曲并取其直链 */
  const playSourceId = ref<SourcePreference>("");
  /** 歌词源（插件 ID，空串为默认）：歌词按搜索格式在该插件重新搜曲后取词 */
  const lyricsSourceId = ref<SourcePreference>("");
  /** 头像源（插件 ID，空串为默认）：右上角头像优先从该插件获取 */
  const avatarSourceId = ref<SourcePreference>("");
  /** 播放源/歌词源共用的搜索关键词格式 */
  const sourceSearchFormat = ref(DEFAULT_SOURCE_SEARCH_FORMAT);
  /** 均衡器开关 */
  const eqEnabled = ref(false);
  /** 均衡器预设 ID（手动调整滑杆后为 custom） */
  const eqPreset = ref("flat");
  /** 均衡器 10 段增益（dB） */
  const eqGains = ref<number[]>([...FLAT_GAINS]);
  /** 横向淡入淡出（Crossfade）开关；关闭后自动切歌仍无缝衔接（Gapless）。移动端仅 Gapless */
  const crossfadeEnabled = ref(true);
  /** 输出设备名称（空串 = 系统默认设备） */
  const outputDevice = ref("");
  /** 全局字体（CSS font-family 值，空串 = 使用默认字体） */
  const fontFamily = ref("");
  /** 窗口材质：Mica / Acrylic / 关闭（仅 Windows 桌面生效，其余平台 no-op） */
  const windowMaterial = ref<WindowMaterial>("mica");
  /** 触感反馈（震动，仅移动端生效） */
  const hapticsEnabled = ref(true);
  /** 是否跟随当前播放封面提取主色作为应用强调色 */
  const coverAccent = ref(false);
  /** 缓存项策略：歌单（页面数据）/ 图片缓存开关组合 */
  const cachePolicy = ref<CachePolicy>("both");
  /** 下载目录（绝对路径；空串 = 使用平台默认目录） */
  const downloadDir = ref("");
  /** 下载文件名模板（`/` 可建子目录） */
  const downloadNameTemplate = ref(DEFAULT_DOWNLOAD_NAME_TEMPLATE);
  /** 下载时同时保存歌词（同名 .lrc 边车） */
  const downloadSaveLyrics = ref(true);
  /** 下载时同时缓存封面等元数据（供离线列表展示） */
  const downloadSaveMeta = ref(true);
  /** 是否在启动时自动检查更新 */
  const autoCheckUpdate = ref(true);
  /** 自动检查更新的频率 */
  const updateCheckFrequency = ref<UpdateCheckFrequency>("startup");
  /** 是否接收预发布（prerelease）版本 */
  const updateIncludePrerelease = ref(false);
  /** 用户选择「忽略此版本」的版本号（自动检查时不再弹窗提示） */
  const ignoredUpdateVersion = ref("");
  /** 上次检查更新的时间戳（毫秒），用于「每 24 小时」节流 */
  const lastUpdateCheckAt = ref(0);
  const loaded = ref(false);

  /** 系统配色查询：data-theme 属性驱动 tokens.css 的亮/暗控件变量，
   * 跟随系统时也解析出实际配色写入属性，保证自研控件与自身 tokens 一致。 */
  const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(): void {
    const root = document.documentElement;
    const dark = theme.value === "system" ? darkScheme.matches : theme.value === "dark";
    const next = dark ? "dark" : "light";
    if (root.dataset.theme && root.dataset.theme !== next) {
      // 主题实际切换：短暂挂上氛围过渡类，让全局颜色柔和渐变（样式见 global.css）
      root.classList.add("theme-switching");
      window.clearTimeout(themeSwitchTimer);
      themeSwitchTimer = window.setTimeout(() => root.classList.remove("theme-switching"), 400);
    }
    root.dataset.theme = next;
  }

  let themeSwitchTimer = 0;

  // 跟随系统时，系统配色变化后重新应用
  darkScheme.addEventListener("change", () => {
    if (theme.value === "system") applyTheme();
  });

  /** 将自定义字体覆盖到全局字体变量；空值移除覆盖回退到 tokens 默认 */
  function applyFont(): void {
    const root = document.documentElement;
    const value = fontFamily.value.trim();
    if (value) {
      root.style.setProperty("--font-family-display", value);
    } else {
      root.style.removeProperty("--font-family-display");
    }
  }

  /** 把触感反馈开关同步给震动服务 */
  function applyHaptics(): void {
    setHapticsEnabled(hapticsEnabled.value);
  }

  // 首次创建即应用（设置尚未从数据库加载时的默认值）
  applyTheme();
  applyFont();
  applyHaptics();

  async function load(): Promise<void> {
    theme.value = await getSetting<ThemePreference>("settings.theme", "system");
    marketSources.value = await getSetting<MarketSource[]>("settings.marketSources", []);
    githubMirror.value = await getSetting<string>("settings.githubMirror", "");
    smtcEnabled.value = await getSetting("settings.smtcEnabled", true);
    trackSourceId.value = await getSetting<SourcePreference>("settings.trackSourceId", "");
    playSourceId.value = await getSetting<SourcePreference>("settings.playSourceId", "");
    lyricsSourceId.value = await getSetting<SourcePreference>("settings.lyricsSourceId", "");
    avatarSourceId.value = await getSetting<SourcePreference>("settings.avatarSourceId", "");
    sourceSearchFormat.value = await getSetting<string>(
      "settings.sourceSearchFormat",
      DEFAULT_SOURCE_SEARCH_FORMAT,
    );
    eqEnabled.value = await getSetting<boolean>("settings.eqEnabled", false);
    eqPreset.value = await getSetting<string>("settings.eqPreset", "flat");
    eqGains.value = await getSetting<number[]>("settings.eqGains", [...FLAT_GAINS]);
    crossfadeEnabled.value = await getSetting<boolean>("settings.crossfadeEnabled", true);
    applyCrossfade();
    outputDevice.value = await getSetting<string>("settings.outputDevice", "");
    // 启动时把持久化的输出设备同步给原生引擎（引擎首次打开输出流时生效）
    getAudioEngine().setOutputDevice(outputDevice.value);
    fontFamily.value = await getSetting<string>("settings.fontFamily", "");
    windowMaterial.value = await getSetting<WindowMaterial>("settings.windowMaterial", "mica");
    hapticsEnabled.value = await getSetting<boolean>("settings.hapticsEnabled", true);
    coverAccent.value = await getSetting<boolean>("settings.coverAccent", false);
    cachePolicy.value = await getSetting<CachePolicy>("settings.cachePolicy", "both");
    downloadDir.value = await getSetting<string>("settings.downloadDir", "");
    downloadNameTemplate.value = await getSetting<string>(
      "settings.downloadNameTemplate",
      DEFAULT_DOWNLOAD_NAME_TEMPLATE,
    );
    downloadSaveLyrics.value = await getSetting<boolean>("settings.downloadSaveLyrics", true);
    downloadSaveMeta.value = await getSetting<boolean>("settings.downloadSaveMeta", true);
    autoCheckUpdate.value = await getSetting<boolean>("settings.autoCheckUpdate", true);
    updateCheckFrequency.value = await getSetting<UpdateCheckFrequency>(
      "settings.updateCheckFrequency",
      "startup",
    );
    updateIncludePrerelease.value = await getSetting<boolean>(
      "settings.updateIncludePrerelease",
      false,
    );
    ignoredUpdateVersion.value = await getSetting<string>("settings.ignoredUpdateVersion", "");
    lastUpdateCheckAt.value = await getSetting<number>("settings.lastUpdateCheckAt", 0);
    applyTheme();
    applyFont();
    applyHaptics();
    // 窗口材质按持久化偏好应用（仅 Windows 桌面实际生效）
    void applyWindowMaterial(windowMaterial.value);
    // 启动时把均衡器配置应用到原生引擎
    applyEq();
    loaded.value = true;
  }

  async function setTheme(value: ThemePreference): Promise<void> {
    theme.value = value;
    applyTheme();
    await setSetting("settings.theme", value);
  }

  async function setFontFamily(value: string): Promise<void> {
    fontFamily.value = value;
    applyFont();
    await setSetting("settings.fontFamily", value);
  }

  async function setWindowMaterial(value: WindowMaterial): Promise<void> {
    windowMaterial.value = value;
    await applyWindowMaterial(value);
    await setSetting("settings.windowMaterial", value);
  }

  async function setHaptics(value: boolean): Promise<void> {
    hapticsEnabled.value = value;
    applyHaptics();
    await setSetting("settings.hapticsEnabled", value);
  }

  async function setCoverAccent(value: boolean): Promise<void> {
    coverAccent.value = value;
    await setSetting("settings.coverAccent", value);
  }

  async function setMarketSources(value: MarketSource[]): Promise<void> {
    marketSources.value = value;
    await setSetting("settings.marketSources", value);
  }

  async function setGithubMirror(value: string): Promise<void> {
    githubMirror.value = value.trim().replace(/\/+$/, "");
    await setSetting("settings.githubMirror", githubMirror.value);
  }

  async function setSmtcEnabled(value: boolean): Promise<void> {
    smtcEnabled.value = value;
    await setSetting("settings.smtcEnabled", value);
  }

  /** 切换缓存项策略：立即清除新被关闭类型的已有缓存 */
  async function setCachePolicy(value: CachePolicy): Promise<void> {
    const prev = cachePolicy.value;
    cachePolicy.value = value;
    await setSetting("settings.cachePolicy", value);
    const wasPlaylist = prev === "both" || prev === "playlist";
    const wasImages = prev === "both" || prev === "images";
    const isPlaylist = value === "both" || value === "playlist";
    const isImages = value === "both" || value === "images";
    if (wasPlaylist && !isPlaylist) await clearDataCache();
    if (wasImages && !isImages) await invoke("cache_clear").catch(() => {});
  }

  /* ------------------------------ 下载与离线 ------------------------------ */

  /** 设置下载目录（空串 = 平台默认）；目录切换不影响已下载文件 */
  async function setDownloadDir(value: string): Promise<void> {
    downloadDir.value = value.trim();
    await setSetting("settings.downloadDir", downloadDir.value);
  }

  /** 设置文件名模板（空串回退默认模板） */
  async function setDownloadNameTemplate(value: string): Promise<void> {
    downloadNameTemplate.value = value;
    await setSetting("settings.downloadNameTemplate", value);
  }

  async function setDownloadSaveLyrics(value: boolean): Promise<void> {
    downloadSaveLyrics.value = value;
    await setSetting("settings.downloadSaveLyrics", value);
  }

  async function setDownloadSaveMeta(value: boolean): Promise<void> {
    downloadSaveMeta.value = value;
    await setSetting("settings.downloadSaveMeta", value);
  }

  /* ------------------------------ 自动更新 ------------------------------ */
  async function setAutoCheckUpdate(value: boolean): Promise<void> {
    autoCheckUpdate.value = value;
    await setSetting("settings.autoCheckUpdate", value);
  }

  async function setUpdateCheckFrequency(value: UpdateCheckFrequency): Promise<void> {
    updateCheckFrequency.value = value;
    await setSetting("settings.updateCheckFrequency", value);
  }

  async function setUpdateIncludePrerelease(value: boolean): Promise<void> {
    updateIncludePrerelease.value = value;
    await setSetting("settings.updateIncludePrerelease", value);
  }

  async function setIgnoredUpdateVersion(value: string): Promise<void> {
    ignoredUpdateVersion.value = value;
    await setSetting("settings.ignoredUpdateVersion", value);
  }

  async function setLastUpdateCheckAt(value: number): Promise<void> {
    lastUpdateCheckAt.value = value;
    await setSetting("settings.lastUpdateCheckAt", value);
  }

  /** 通用来源偏好写入（四个来源选择框共用） */
  async function setSourcePreference(key: "trackSourceId" | "playSourceId" | "lyricsSourceId" | "avatarSourceId", value: SourcePreference): Promise<void> {
    const refs = { trackSourceId, playSourceId, lyricsSourceId, avatarSourceId };
    refs[key].value = value;
    await setSetting(`settings.${key}`, value);
  }

  async function setSourceSearchFormat(value: string): Promise<void> {
    sourceSearchFormat.value = value;
    await setSetting("settings.sourceSearchFormat", value);
  }

  /* ------------------------------ 无缝播放 ------------------------------ */

  /** 同步淡入淡出配置到引擎；移动端仅 Gapless（始终关闭 crossfade） */
  function applyCrossfade(): void {
    getAudioEngine().setCrossfade(!useIsMobile() && crossfadeEnabled.value, 6.0);
  }

  async function setCrossfadeEnabled(value: boolean): Promise<void> {
    crossfadeEnabled.value = value;
    applyCrossfade();
    await setSetting("settings.crossfadeEnabled", value);
  }

  /* ------------------------------ 输出设备 ------------------------------ */

  /** 切换输出设备（空串 = 系统默认）：立即通知引擎并在新设备上续播 */
  async function setOutputDevice(value: string): Promise<void> {
    outputDevice.value = value;
    getAudioEngine().setOutputDevice(value);
    await setSetting("settings.outputDevice", value);
  }

  /* ------------------------------ 均衡器 ------------------------------ */

  function applyEq(): void {
    getAudioEngine().setEq(eqEnabled.value, eqGains.value);
  }

  async function setEqEnabled(value: boolean): Promise<void> {
    eqEnabled.value = value;
    applyEq();
    await setSetting("settings.eqEnabled", value);
  }

  /** 切换预设：自动套用预设增益；custom 仅作为 UI 标识传入 */
  async function setEqPreset(id: string): Promise<void> {
    eqPreset.value = id;
    const preset = findEqPreset(id);
    if (preset) {
      eqGains.value = [...preset.gains];
      applyEq();
      await setSetting("settings.eqGains", eqGains.value);
    }
    await setSetting("settings.eqPreset", id);
  }

  /** 滑杆拖动期间的高频写入防抖计时器 */
  let eqGainsPersistTimer: ReturnType<typeof setTimeout> | undefined;

  /** 手动调整某段增益：预设转为「自定义」（增益持久化防抖，拖动结束才落库） */
  async function setEqGains(gains: number[]): Promise<void> {
    eqGains.value = gains;
    if (eqPreset.value !== EQ_CUSTOM_PRESET_ID) {
      eqPreset.value = EQ_CUSTOM_PRESET_ID;
      await setSetting("settings.eqPreset", EQ_CUSTOM_PRESET_ID);
    }
    applyEq();
    clearTimeout(eqGainsPersistTimer);
    eqGainsPersistTimer = setTimeout(() => {
      void setSetting("settings.eqGains", gains);
    }, 400);
  }

  /** 重置为平直增益（预设回到「平坦」） */
  async function resetEq(): Promise<void> {
    await setEqPreset(EQ_PRESETS[0].id);
  }

  return {
    theme,
    fontFamily,
    windowMaterial,
    hapticsEnabled,
    coverAccent,
    marketSources,
    githubMirror,
    smtcEnabled,
    cachePolicy,
    downloadDir,
    downloadNameTemplate,
    downloadSaveLyrics,
    downloadSaveMeta,
    autoCheckUpdate,
    updateCheckFrequency,
    updateIncludePrerelease,
    ignoredUpdateVersion,
    lastUpdateCheckAt,
    trackSourceId,
    playSourceId,
    lyricsSourceId,
    avatarSourceId,
    sourceSearchFormat,
    eqEnabled,
    eqPreset,
    eqGains,
    crossfadeEnabled,
    outputDevice,
    loaded,
    load,
    setTheme,
    setFontFamily,
    setWindowMaterial,
    setHaptics,
    setCoverAccent,
    setMarketSources,
    setGithubMirror,
    setSmtcEnabled,
    setCachePolicy,
    setDownloadDir,
    setDownloadNameTemplate,
    setDownloadSaveLyrics,
    setDownloadSaveMeta,
    setAutoCheckUpdate,
    setUpdateCheckFrequency,
    setUpdateIncludePrerelease,
    setIgnoredUpdateVersion,
    setLastUpdateCheckAt,
    setSourcePreference,
    setSourceSearchFormat,
    setCrossfadeEnabled,
    setOutputDevice,
    setEqEnabled,
    setEqPreset,
    setEqGains,
    resetEq,
  };
});
