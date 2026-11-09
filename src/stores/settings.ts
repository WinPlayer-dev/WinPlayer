/** 应用设置：主题、插件市场源等（持久化于 SQLite settings 表） */

import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "@/services/db";
import { getAudioEngine } from "@/services/audio";
import { useIsMobile } from "@/composables/useIsMobile";
import { setHapticsEnabled } from "@/services/haptics";
import { setDemoModeState, demoMode } from "@/services/demoMode";
import { clearDataCache } from "@/services/cache";
import { applyWindowMaterial, type WindowMaterial } from "@/services/windowMaterial";
import { setWindowStateEnabled } from "@/services/windowState";
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

/** 关闭按钮行为：关闭到托盘 / 最小化到任务栏 / 直接退出 */
export type CloseBehavior = "tray" | "minimize" | "quit";

/** 桌面歌词外观：无底色纯文字 + 描边投影 / 歌曲卡片（封面模糊底 + 歌曲信息） */
export type DesktopLyricsStyle = "plain" | "glass";

/* ------------------------------ 听完自动加歌单 ------------------------------ */

/** 自动加歌单的方式：固定进某个歌单 / 按语种与类型自动分类 */
export type AutoPlaylistMode = "fixed" | "auto";

/** 自动分类时的语种判定结果 */
export type AutoPlaylistLanguage = "english" | "chinese" | "japanese" | "korean" | "other";

/** 语种选项（设置页展示顺序即此顺序） */
export const AUTO_PLAYLIST_LANGUAGES: ReadonlyArray<{
  value: AutoPlaylistLanguage;
  label: string;
}> = [
  { value: "english", label: "英语" },
  { value: "chinese", label: "华语" },
  { value: "japanese", label: "日语" },
  { value: "korean", label: "韩语" },
  { value: "other", label: "其他" },
];

/**
 * 自动加歌单的目标歌单。
 *
 * - `local`：曲库里的本地歌单（数字主键）；
 * - `remote`：某个插件来源的平台个人歌单。平台歌单 id 只在同一来源内有效，
 *   所以它只能接收同来源的曲目（跨源添加没有意义）。
 *
 * `name` 存一份展示名：平台未登录 / 离线拉不到歌单列表时，设置页仍能显示
 * 用户当初选的是哪个歌单，而不是退回「不自动添加」。
 */
export type AutoPlaylistTarget =
  | { kind: "local"; id: number; name: string }
  | { kind: "remote"; sourceId: string; id: string; name: string };

/** 目标歌单的唯一键：写进 auto_playlist_done.playlist_ref，也用于下拉框去重 */
export function autoPlaylistTargetKey(target: AutoPlaylistTarget | null): string {
  if (!target) return "";
  return target.kind === "local" ? `local:${target.id}` : `${target.sourceId}:${target.id}`;
}

/**
 * 听完自动加歌单（实验性）配置。
 *
 * 目标为 null 表示「未选择」，语义是「这类歌曲不自动添加」；
 * 自动分类模式下 Vocaloid 优先于语种（识别为 Vocaloid 就只进类型歌单）。
 */
export interface AutoPlaylistConfig {
  enabled: boolean;
  mode: AutoPlaylistMode;
  /** 固定模式的目标歌单 */
  fixedTarget: AutoPlaylistTarget | null;
  /** 自动分类：各语种对应的歌单 */
  languageTargets: Record<AutoPlaylistLanguage, AutoPlaylistTarget | null>;
  /** 自动分类：Vocaloid 对应的歌单 */
  vocaloidTarget: AutoPlaylistTarget | null;
  /** Vocaloid 自定义关键词：追加在内置词表之外，忽略大小写、按子串匹配 */
  vocaloidKeywords: string[];
}

export const DEFAULT_AUTO_PLAYLIST: AutoPlaylistConfig = {
  enabled: false,
  mode: "fixed",
  fixedTarget: null,
  languageTargets: { english: null, chinese: null, japanese: null, korean: null, other: null },
  vocaloidTarget: null,
  vocaloidKeywords: [],
};

/** 自定义关键词上限：条数与单条长度都收一下，避免整段歌词被当成词表 */
const MAX_VOCALOID_KEYWORDS = 50;
const MAX_VOCALOID_KEYWORD_LENGTH = 40;

/** 单个目标歌单收敛：字段不全或 id 非法一律视为「未选择」 */
function normalizeTarget(input: unknown): AutoPlaylistTarget | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (raw.kind === "remote") {
    const sourceId = typeof raw.sourceId === "string" ? raw.sourceId.trim() : "";
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    return sourceId && id ? { kind: "remote", sourceId, id, name } : null;
  }
  const num = Math.trunc(Number(raw.id));
  return Number.isFinite(num) && num > 0 ? { kind: "local", id: num, name } : null;
}

/** 关键词表收敛：去首尾空白、忽略大小写去重、丢弃超长项 */
function normalizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    const text = String(item ?? "").trim().slice(0, MAX_VOCALOID_KEYWORD_LENGTH);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(text);
    if (result.length >= MAX_VOCALOID_KEYWORDS) break;
  }
  return result;
}

/** 把持久化 / 手改数据库的值收敛成合法配置（兼容只存数字 id 的旧配置） */
function normalizeAutoPlaylist(value: unknown): AutoPlaylistConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const legacy = (input: unknown): AutoPlaylistTarget | null => {
    const num = Math.trunc(Number(input));
    return Number.isFinite(num) && num > 0 ? { kind: "local", id: num, name: "" } : null;
  };
  const languages = (raw.languageTargets ?? {}) as Record<string, unknown>;
  const legacyLanguages = (raw.languagePlaylists ?? {}) as Record<string, unknown>;
  const language = (key: AutoPlaylistLanguage): AutoPlaylistTarget | null =>
    normalizeTarget(languages[key]) ?? legacy(legacyLanguages[key]);
  return {
    enabled: Boolean(raw.enabled),
    mode: raw.mode === "auto" ? "auto" : "fixed",
    fixedTarget: normalizeTarget(raw.fixedTarget) ?? legacy(raw.fixedPlaylistId),
    languageTargets: {
      english: language("english"),
      chinese: language("chinese"),
      japanese: language("japanese"),
      korean: language("korean"),
      other: language("other"),
    },
    vocaloidTarget: normalizeTarget(raw.vocaloidTarget) ?? legacy(raw.vocaloidPlaylistId),
    vocaloidKeywords: normalizeKeywords(raw.vocaloidKeywords),
  };
}

/** 桌面歌词字号范围（px）：下限保证小屏看得清，上限与歌词窗口固定高度对齐 */
export const DESKTOP_LYRICS_FONT_MIN = 20;
export const DESKTOP_LYRICS_FONT_MAX = 36;

/** 把持久化 / 用户输入的字号夹到合法区间（老版本或手改数据库时兜底） */
export function normalizeLyricsFontSize(value: unknown): number {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return 30;
  return Math.min(DESKTOP_LYRICS_FONT_MAX, Math.max(DESKTOP_LYRICS_FONT_MIN, size));
}

/* ------------------------------ 动效手感 ------------------------------ */

/**
 * 弹簧回弹幅度：直接就是缓动曲线第二控制点的 y 值（见 styles/motion.css）。
 * 1 = 严格单调不回弹，数值越大「冲过头再落回」越明显。
 */
export const SPRING_STRENGTH_MIN = 1.2;
export const SPRING_STRENGTH_MAX = 2;
export const SPRING_STRENGTH_DEFAULT = 1.55;

/** 把持久化 / 用户拖动的强度夹到合法区间，并按 0.05 取整（滑杆步进） */
export function normalizeSpringStrength(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return SPRING_STRENGTH_DEFAULT;
  const clamped = Math.min(SPRING_STRENGTH_MAX, Math.max(SPRING_STRENGTH_MIN, raw));
  return Math.round(clamped * 20) / 20;
}

/** 冷启动后直接进入的页面（默认推荐页） */
export type StartupPage = "recommend" | "liked" | "offline" | "mine";

/** 启动页候选项：`mobileOnly` 的项仅在移动端出现在设置下拉中（桌面端路由仍可达） */
export interface StartupPageOption {
  value: StartupPage;
  label: string;
  /** 目标路由名 */
  route: string;
  mobileOnly?: boolean;
}

export const STARTUP_PAGE_OPTIONS: readonly StartupPageOption[] = [
  { value: "recommend", label: "推荐", route: "recommend" },
  { value: "liked", label: "我喜欢的音乐", route: "liked" },
  { value: "offline", label: "离线音乐", route: "offline" },
  // 「我的」页是移动端底部导航的入口，桌面端侧边栏没有它，故不在桌面端设置里出现
  { value: "mine", label: "我的", route: "mine", mobileOnly: true },
];

/** 校验持久化值是否仍是合法页面（老版本 / 手改数据库时回退到推荐页） */
function normalizeStartupPage(value: unknown): StartupPage {
  const hit = STARTUP_PAGE_OPTIONS.find((item) => item.value === value);
  return hit ? hit.value : "recommend";
}

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
  /**
   * 首次引导是否已完成：false 时启动会进入欢迎页（且当前没有任何插件）。
   * 老用户升级上来时由 App 初始化阶段自动置为 true，不会被打扰；
   * 设置 → 通用 里可随时重新进入（不改写已安装的插件）。
   */
  const onboardingDone = ref(false);
  /**
   * 录音棚（实验性）入口开关：默认关闭，需在「设置 → 实验性」里主动打开。
   * 关闭时侧边栏 / 播放器「更多」菜单都不显示入口，直接访问 `/studio` 也会被送回推荐页；
   * 已有录音数据不会被删除。
   */
  const studioEnabled = ref(false);
  /**
   * 听完自动加歌单（实验性）：歌曲自然播完后按配置归入本地歌单。
   * 已处理过的曲目记录在 auto_playlist_done 表里，不会重复添加。
   */
  const autoPlaylist = ref<AutoPlaylistConfig>({
    ...DEFAULT_AUTO_PLAYLIST,
    languageTargets: { ...DEFAULT_AUTO_PLAYLIST.languageTargets },
  });
  /**
   * 演示模式（录屏 / 截图用）：打开后界面上的播放源名称统一显示成通用名，
   * 歌单 / 平台歌单的入口整体隐藏。只影响显示，不动数据。
   * 状态本体在 services/demoMode（模板与工具函数都要读它），这里直接暴露同一个 ref，
   * 避免「store 一份、服务一份」导致两边不同步。
   */
  /**
   * 打开时页面：每次冷启动后直接进入所选页面（仅在 App 初始化时跳一次，
   * 之后手动回首页仍是推荐页）。「我的」只在移动端可选。
   */
  const startupPage = ref<StartupPage>("recommend");
  const marketSources = ref<MarketSource[]>([]);
  /** GitHub 镜像源前缀（URL 拼接型，如 https://ghproxy.net/），空串表示直连 */
  const githubMirror = ref("");
  /** 是否启用系统媒体传输控件（SMTC，仅 Windows） */
  const smtcEnabled = ref(true);
  /**
   * 车载模式：把系统媒体控件（Windows 媒体浮出窗 / 安卓媒体通知）的标题换成
   * 当前播放的歌词行，副标题换成「歌曲名 - 作者」。驾驶时抬头看大标题即可，
   * 不必眯着眼找小字。没有歌词 / 前奏 / 纯音乐段仍回退成歌名。
   */
  const carMode = ref(false);
  /**
   * 聚合搜索：开启后搜索页在插件 Tab 之外多出一个「全部」Tab，
   * 把各插件结果交错融合展示；关闭后每个 Tab 只搜自己那一个插件。
   */
  const aggregateSearch = ref(true);
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
  /** 是否记住窗口尺寸 / 位置 / 最大化状态（仅桌面端；关闭后不再写盘） */
  const rememberWindowState = ref(true);
  /** 关闭按钮行为：关闭到托盘 / 最小化到任务栏 / 直接退出（仅 Windows 桌面） */
  const closeBehavior = ref<CloseBehavior>("tray");
  /** 后台优化：窗口隐藏（托盘/最小化）时降低渲染与轮询开销（默认开启） */
  const backgroundOptimize = ref(true);
  /**
   * 桌面歌词：独立置顶透明窗口是否开启（仅桌面端）。
   * 关掉只是销毁窗口，不影响播放；重新打开会恢复上次拖到的位置。
   */
  const desktopLyricsEnabled = ref(false);
  /** 桌面歌词外观：纯文字描边 / 歌曲卡片 */
  const desktopLyricsStyle = ref<DesktopLyricsStyle>("plain");
  /** 桌面歌词当前行字号（px） */
  const desktopLyricsFontSize = ref(30);
  /** 桌面歌词是否锁定（鼠标穿透到下层窗口，只能回主窗口解锁） */
  const desktopLyricsLocked = ref(false);
  /** 触感反馈（震动，仅移动端生效） */
  const hapticsEnabled = ref(true);
  /** 是否跟随当前播放封面提取主色作为应用强调色 */
  const coverAccent = ref(false);
  /** 是否按封面原始宽高比显示（关闭则所有封面统一裁切为正方形） */
  const coverNaturalRatio = ref(false);
  /** 弹簧动效：开启后全站缓动换成带回弹的曲线，交互更「Q 弹」 */
  const springMotion = ref(false);
  /** 弹簧回弹幅度（缓动曲线第二控制点 y 值，越大冲得越远） */
  const springStrength = ref(SPRING_STRENGTH_DEFAULT);
  /** 是否记录播放历史（关闭后不再写库，已有数据保留） */
  const historyEnabled = ref(true);
  /** 缓存项策略：歌单（页面数据）/ 图片缓存开关组合 */
  const cachePolicy = ref<CachePolicy>("both");
  /** 下载目录（绝对路径；空串 = 使用平台默认目录） */
  const downloadDir = ref("");
  /** 下载文件名模板（`/` 可建子目录） */
  const downloadNameTemplate = ref(DEFAULT_DOWNLOAD_NAME_TEMPLATE);
  /** 下载时把元数据 / 封面 / 歌词写进歌曲文件（离线曲库的元数据来源），同时写 .lrc */
  const downloadWriteTags = ref(true);
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

  /** 把「按封面原始比例」开关同步到 <html>：各封面位的尺寸由 cover-natural.css 统一接管 */
  function applyCoverNaturalRatio(): void {
    document.documentElement.classList.toggle("cover-natural", coverNaturalRatio.value);
  }

  /**
   * 把「弹簧动效」开关与幅度同步到 <html>：样式见 styles/motion.css。
   *
   * 全站 transition 都引用 `--ease-*` 令牌，所以只在根节点挂一个类 + 一个数值变量，
   * 就能整体换手感，不需要逐个组件改。
   */
  function applySpringMotion(): void {
    const root = document.documentElement;
    root.classList.toggle("spring-motion", springMotion.value);
    root.style.setProperty("--spring-ease-y", String(springStrength.value));
  }

  // 首次创建即应用（设置尚未从数据库加载时的默认值）
  applyTheme();
  applyFont();
  applyHaptics();
  applyCoverNaturalRatio();
  applySpringMotion();

  async function load(): Promise<void> {
    theme.value = await getSetting<ThemePreference>("settings.theme", "system");
    onboardingDone.value = await getSetting<boolean>("settings.onboardingDone", false);
    studioEnabled.value = await getSetting<boolean>("settings.studioEnabled", false);
    autoPlaylist.value = normalizeAutoPlaylist(
      await getSetting<unknown>("settings.autoPlaylist", null),
    );
    demoMode.value = await getSetting<boolean>("settings.demoMode", false);
    startupPage.value = normalizeStartupPage(
      await getSetting<string>("settings.startupPage", "recommend"),
    );
    marketSources.value = await getSetting<MarketSource[]>("settings.marketSources", []);
    githubMirror.value = await getSetting<string>("settings.githubMirror", "");
    smtcEnabled.value = await getSetting("settings.smtcEnabled", true);
    carMode.value = await getSetting<boolean>("settings.carMode", false);
    aggregateSearch.value = await getSetting<boolean>("settings.aggregateSearch", true);
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
    rememberWindowState.value = await getSetting<boolean>("settings.rememberWindowState", true);
    // 启动时按持久化值决定是否继续记录窗口状态（Rust 侧默认开启）
    await setWindowStateEnabled(rememberWindowState.value);
    closeBehavior.value = await getSetting<CloseBehavior>("settings.closeBehavior", "tray");
    backgroundOptimize.value = await getSetting<boolean>("settings.backgroundOptimize", true);
    desktopLyricsEnabled.value = await getSetting<boolean>("settings.desktopLyricsEnabled", false);
    desktopLyricsStyle.value =
      (await getSetting<string>("settings.desktopLyricsStyle", "plain")) === "glass"
        ? "glass"
        : "plain";
    desktopLyricsFontSize.value = normalizeLyricsFontSize(
      await getSetting<number>("settings.desktopLyricsFontSize", 30),
    );
    desktopLyricsLocked.value = await getSetting<boolean>("settings.desktopLyricsLocked", false);
    // 把关闭行为同步给 Rust（托盘拦截关闭、最小化/退出判定）
    await import("@/services/tray").then(({ setCloseBehavior }) => setCloseBehavior(closeBehavior.value));
    hapticsEnabled.value = await getSetting<boolean>("settings.hapticsEnabled", true);
    coverAccent.value = await getSetting<boolean>("settings.coverAccent", false);
    coverNaturalRatio.value = await getSetting<boolean>("settings.coverNaturalRatio", false);
    springMotion.value = await getSetting<boolean>("settings.springMotion", false);
    springStrength.value = normalizeSpringStrength(
      await getSetting<number>("settings.springStrength", SPRING_STRENGTH_DEFAULT),
    );
    historyEnabled.value = await getSetting<boolean>("settings.historyEnabled", true);
    applyHistoryEnabled();
    cachePolicy.value = await getSetting<CachePolicy>("settings.cachePolicy", "both");
    downloadDir.value = await getSetting<string>("settings.downloadDir", "");
    downloadNameTemplate.value = await getSetting<string>(
      "settings.downloadNameTemplate",
      DEFAULT_DOWNLOAD_NAME_TEMPLATE,
    );
    // 老版本是两个开关（保存歌词 / 缓存封面），迁移时任一为开即写入标签
    const writeTags = await getSetting<boolean | null>("settings.downloadWriteTags", null);
    if (writeTags === null) {
      const legacyLyrics = await getSetting<boolean>("settings.downloadSaveLyrics", true);
      const legacyMeta = await getSetting<boolean>("settings.downloadSaveMeta", true);
      downloadWriteTags.value = legacyLyrics || legacyMeta;
    } else {
      downloadWriteTags.value = writeTags;
    }
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
    applyCoverNaturalRatio();
    applySpringMotion();
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

  /** 切换「记住窗口大小与位置」：同步给 Rust，关闭后停止写盘（已有存档保留） */
  async function setRememberWindowState(value: boolean): Promise<void> {
    rememberWindowState.value = value;
    await setSetting("settings.rememberWindowState", value);
    await setWindowStateEnabled(value);
  }

  /** 切换关闭按钮行为：同步给 Rust（托盘拦截 / 最小化 / 退出判定） */
  async function setCloseBehavior(value: CloseBehavior): Promise<void> {
    closeBehavior.value = value;
    await setSetting("settings.closeBehavior", value);
    const { setCloseBehavior: sync } = await import("@/services/tray");
    await sync(value);
  }

  /** 切换后台优化：体积标注开关本身即可，优化逻辑按需查询 */
  async function setBackgroundOptimize(value: boolean): Promise<void> {
    backgroundOptimize.value = value;
    await setSetting("settings.backgroundOptimize", value);
  }

  /** 开关桌面歌词窗口：窗口本身由 `services/desktopLyrics` 监听这个值来创建 / 销毁 */
  async function setDesktopLyricsEnabled(value: boolean): Promise<void> {
    desktopLyricsEnabled.value = value;
    await setSetting("settings.desktopLyricsEnabled", value);
    // 关窗顺手解锁：否则下次打开时窗口一出现就穿透，用户会以为「打不开」
    if (!value && desktopLyricsLocked.value) await setDesktopLyricsLocked(false);
  }

  async function setDesktopLyricsStyle(value: DesktopLyricsStyle): Promise<void> {
    desktopLyricsStyle.value = value === "glass" ? "glass" : "plain";
    await setSetting("settings.desktopLyricsStyle", desktopLyricsStyle.value);
  }

  async function setDesktopLyricsFontSize(value: number): Promise<void> {
    desktopLyricsFontSize.value = normalizeLyricsFontSize(value);
    await setSetting("settings.desktopLyricsFontSize", desktopLyricsFontSize.value);
  }

  /** 锁定 = 整个歌词窗口鼠标穿透，避免挡住下面窗口的点击 */
  async function setDesktopLyricsLocked(value: boolean): Promise<void> {
    desktopLyricsLocked.value = value;
    await setSetting("settings.desktopLyricsLocked", value);
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

  async function setCoverNaturalRatio(value: boolean): Promise<void> {
    coverNaturalRatio.value = value;
    applyCoverNaturalRatio();
    await setSetting("settings.coverNaturalRatio", value);
  }

  /* ------------------------------ 动效手感 ------------------------------ */

  async function setSpringMotion(value: boolean): Promise<void> {
    springMotion.value = value;
    applySpringMotion();
    await setSetting("settings.springMotion", value);
  }

  /** 滑杆拖动中的实时预览：只改内存与样式，不写库（落库由 setSpringStrength 防抖调用） */
  function previewSpringStrength(value: number): void {
    springStrength.value = normalizeSpringStrength(value);
    applySpringMotion();
  }

  async function setSpringStrength(value: number): Promise<void> {
    previewSpringStrength(value);
    await setSetting("settings.springStrength", springStrength.value);
  }

  /* ------------------------------ 播放历史 ------------------------------ */

  /** 把开关同步给 history store（store 内部据此短路写入） */
  function applyHistoryEnabled(): void {
    void import("./history").then(({ useHistoryStore }) =>
      useHistoryStore().setEnabled(historyEnabled.value),
    );
  }

  async function setHistoryEnabled(value: boolean): Promise<void> {
    historyEnabled.value = value;
    applyHistoryEnabled();
    await setSetting("settings.historyEnabled", value);
  }

  async function setMarketSources(value: MarketSource[]): Promise<void> {
    marketSources.value = value;
    await setSetting("settings.marketSources", value);
  }

  /** 标记首次引导已完成（跳过或装好播放源都会写入；设置里的「重新查看」不重置它） */
  async function setOnboardingDone(value: boolean): Promise<void> {
    onboardingDone.value = value;
    await setSetting("settings.onboardingDone", value);
  }

  /** 开关录音棚入口：只影响入口显示，已有录音作品保留在本地 */
  async function setStudioEnabled(value: boolean): Promise<void> {
    studioEnabled.value = value;
    await setSetting("settings.studioEnabled", value);
  }

  /**
   * 更新自动歌单配置（按字段合并）。
   *
   * 只写配置本身：判定逻辑在 services/autoPlaylist，删掉歌单后旧目标会自然失效
   * （找不到歌单就不添加，也不记录），不需要额外的清理。
   */
  async function setAutoPlaylist(
    patch: Partial<Omit<AutoPlaylistConfig, "languageTargets">> & {
      languageTargets?: Partial<Record<AutoPlaylistLanguage, AutoPlaylistTarget | null>>;
    },
  ): Promise<void> {
    autoPlaylist.value = normalizeAutoPlaylist({
      ...autoPlaylist.value,
      ...patch,
      languageTargets: {
        ...autoPlaylist.value.languageTargets,
        ...(patch.languageTargets ?? {}),
      },
    });
    await setSetting("settings.autoPlaylist", autoPlaylist.value);
  }

  /** 开关演示模式：同步给 demoMode 服务，界面各处据此隐藏来源名与歌单入口 */
  async function setDemoMode(value: boolean): Promise<void> {
    setDemoModeState(value);
    await setSetting("settings.demoMode", value);
  }

  /** 切换打开时页面：只写入偏好，下次冷启动才生效（不影响当前所在页面） */
  async function setStartupPage(value: StartupPage): Promise<void> {
    startupPage.value = normalizeStartupPage(value);
    await setSetting("settings.startupPage", startupPage.value);
  }

  async function setGithubMirror(value: string): Promise<void> {
    githubMirror.value = value.trim().replace(/\/+$/, "");
    await setSetting("settings.githubMirror", githubMirror.value);
  }

  async function setSmtcEnabled(value: boolean): Promise<void> {
    smtcEnabled.value = value;
    await setSetting("settings.smtcEnabled", value);
  }

  /** 切换车载模式：只改变系统媒体控件上的文案，播放与界面其余部分不受影响 */
  async function setCarMode(value: boolean): Promise<void> {
    carMode.value = value;
    await setSetting("settings.carMode", value);
  }

  /** 切换聚合搜索：只影响搜索页是否出现「全部」Tab，不改变任何插件状态 */
  async function setAggregateSearch(value: boolean): Promise<void> {
    aggregateSearch.value = value;
    await setSetting("settings.aggregateSearch", value);
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

  /** 切换「写入歌曲标签」：关闭后下载只保存音频（离线曲库退回数据库元数据） */
  async function setDownloadWriteTags(value: boolean): Promise<void> {
    downloadWriteTags.value = value;
    await setSetting("settings.downloadWriteTags", value);
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
    rememberWindowState,
    closeBehavior,
    backgroundOptimize,
    desktopLyricsEnabled,
    desktopLyricsStyle,
    desktopLyricsFontSize,
    desktopLyricsLocked,
    hapticsEnabled,
    coverAccent,
    coverNaturalRatio,
    springMotion,
    springStrength,
    historyEnabled,
    onboardingDone,
    studioEnabled,
    autoPlaylist,
    demoMode,
    startupPage,
    marketSources,
    githubMirror,
    smtcEnabled,
    carMode,
    aggregateSearch,
    cachePolicy,
    downloadDir,
    downloadNameTemplate,
    downloadWriteTags,
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
    setRememberWindowState,
    setCloseBehavior,
    setBackgroundOptimize,
    setDesktopLyricsEnabled,
    setDesktopLyricsStyle,
    setDesktopLyricsFontSize,
    setDesktopLyricsLocked,
    setHaptics,
    setCoverAccent,
    setCoverNaturalRatio,
    setSpringMotion,
    setSpringStrength,
    previewSpringStrength,
    setHistoryEnabled,
    setMarketSources,
    setOnboardingDone,
    setStudioEnabled,
    setAutoPlaylist,
    setDemoMode,
    setStartupPage,
    setGithubMirror,
    setSmtcEnabled,
    setCarMode,
    setAggregateSearch,
    setCachePolicy,
    setDownloadDir,
    setDownloadNameTemplate,
    setDownloadWriteTags,
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
