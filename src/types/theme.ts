/**
 * 主题系统类型定义
 *
 * 主题包 = zip（或目录），根目录含 `theme.json`：
 *
 * ```
 * theme.json            # 清单（本文件里的 ThemeManifest）
 * theme.css             # 全局样式（可选，manifest.css）
 * assets/…              # 壁纸 / 字体 / 图片（可选）
 * components/*.vue      # 覆盖内置组件的 Vue 单文件（可选）
 * ```
 *
 * 主题能做三件事，按侵入性递增：
 * 1. **令牌覆盖**：改写 `--wp-*` 设计令牌（颜色、圆角、间距、字体、动效），
 *    深浅色可分别定义，与「跟随系统」联动；
 * 2. **样式与环境层**：注入全局 CSS，叠加壁纸 / 模糊 / 噪点 / 暗角等氛围层；
 * 3. **组件重写**：用 Vue 单文件替换内置的 6 个核心组件（见 ThemeComponentKey）。
 */

/** 当前主题协议版本 */
export const THEME_API_VERSION = 1;

/**
 * 可被主题重写的内置组件键（与宿主注册表一一对应）。
 *
 * 分两类：
 * - **界面骨架**：TitleBar / SideNav / PlayerBar / MediaCard / EmptyState / PageShell，
 *   换掉的是「整块界面」；
 * - **基础控件**：Button / IconButton / TextBox / ComboBox / ToggleSwitch / Slider /
 *   NumberBox，换掉的是「所有地方都在用的输入与按钮」——设置页、对话框、工具栏
 *   会一起变成主题的控件长相。
 */
export const THEME_COMPONENT_KEYS = [
  // 界面骨架
  "TitleBar",
  "SideNav",
  "PlayerBar",
  "MediaCard",
  "EmptyState",
  "PageShell",
  // 基础控件
  "Button",
  "IconButton",
  "TextBox",
  "ComboBox",
  "ToggleSwitch",
  "Slider",
  "NumberBox",
  // 容器与背景
  "Card",
  "Background",
] as const;

export type ThemeComponentKey = (typeof THEME_COMPONENT_KEYS)[number];

/** 界面骨架类组件（设置页分组展示用） */
export const THEME_LAYOUT_COMPONENT_KEYS: readonly ThemeComponentKey[] = [
  "TitleBar",
  "SideNav",
  "PlayerBar",
  "MediaCard",
  "EmptyState",
  "PageShell",
];

/** 基础控件类组件 */
export const THEME_CONTROL_COMPONENT_KEYS: readonly ThemeComponentKey[] = [
  "Button",
  "IconButton",
  "TextBox",
  "ComboBox",
  "ToggleSwitch",
  "Slider",
  "NumberBox",
];

/** 容器 / 背景类组件 */
export const THEME_SURFACE_COMPONENT_KEYS: readonly ThemeComponentKey[] = [
  "Card",
  "Background",
];

/** 主题组件键的中文说明（设置页 / 文档展示用） */
export const THEME_COMPONENT_LABELS: Record<ThemeComponentKey, string> = {
  TitleBar: "标题栏",
  SideNav: "侧边导航",
  PlayerBar: "播放条",
  MediaCard: "媒体卡片",
  EmptyState: "空状态",
  PageShell: "页面框架（背景 / 内容区）",
  Button: "按钮（主 / 次）",
  IconButton: "图标按钮",
  TextBox: "文本输入框",
  ComboBox: "下拉选择框",
  ToggleSwitch: "开关",
  Slider: "滑杆",
  NumberBox: "数字输入框",
  Card: "卡片容器（设置项 / 内容块）",
  Background: "应用背景层",
};

/**
 * 一套配色下的设计令牌。
 *
 * 键名即 CSS 变量名（可省略 `--wp-` 前缀，应用时会自动补全），
 * 值会以 `style.setProperty` 写到 `<html>` 上；留空则回落到内置 WinUI 令牌。
 * 深浅两套独立定义：`tokens.light` / `tokens.dark` 会分别在
 * `data-theme="light"` / `"dark"` 时应用（跟随系统时按解析结果二选一）。
 */
export type ThemeTokenSet = Record<string, string>;

/** 背景环境层（壁纸 / 模糊 / 噪点 / 暗角 / 颜色滤镜） */
export interface ThemeAppearance {
  /** 壁纸：远程 URL、data URI，或相对主题包的路径（如 `assets/bg.jpg`） */
  wallpaper?: string;
  /** 壁纸模糊半径（px，0–80） */
  wallpaperBlur?: number;
  /** 壁纸不透明度（0–1，默认 1） */
  wallpaperOpacity?: number;
  /** 壁纸在 `--wp-base` 之上的混合模式（CSS mix-blend-mode） */
  wallpaperBlend?: string;
  /** 壁纸填充方式，默认 cover */
  wallpaperSize?: "cover" | "contain" | "auto";
  /** 噪点纹理强度（0–1，0 表示不显示） */
  noise?: number;
  /** 暗角强度（0–1，0 表示不显示） */
  vignette?: number;
  /** 覆盖整层的颜色滤镜（CSS background 值，如 `linear-gradient(...)` 或 rgba） */
  overlay?: string;
  /** 是否让内容层半透明以透出壁纸（默认 true） */
  translucentSurfaces?: boolean;
  /** 窗口背景是否透明（用于让壁纸铺满；默认 true） */
  transparentBackground?: boolean;
}

/** 布局 / 手感类覆盖：直接影响 WinUI 令牌的派生值 */
export interface ThemeDensity {
  /** 全局圆角缩放（0–3，1 = 内置值） */
  radiusScale?: number;
  /** 界面密度（0.75–1.5，1 = 内置值），影响间距与控件高度 */
  scale?: number;
  /** 行高 / 控件紧凑模式（在 scale 之外额外压缩列表行） */
  compact?: boolean;
  /** 字体族（CSS font-family 值） */
  fontFamily?: string;
  /** 标题字体族（缺省同 fontFamily） */
  fontDisplay?: string;
  /** 全局字重缩放（0.9–1.2） */
  fontScale?: number;
  /** 动效速度倍数（0.5–2，越大越慢） */
  motionScale?: number;
  /** 动效缓动曲线（CSS timing-function） */
  easing?: string;
}

/** 主题清单（theme.json） */
export interface ThemeManifest {
  /** 唯一 ID，仅允许 [a-z0-9._-] */
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  author?: string;
  homepage?: string;
  /** 预览图（相对包内路径 / 远程 URL） */
  preview?: string;
  /** 标签，用于市场筛选 */
  tags?: string[];
  /** 深浅两套令牌 */
  tokens?: { light?: ThemeTokenSet; dark?: ThemeTokenSet };
  /** 背景环境层 */
  appearance?: ThemeAppearance;
  /** 布局 / 字体 / 动效覆盖 */
  density?: ThemeDensity;
  /** 全局 CSS 文件（相对包内路径） */
  css?: string;
  /** 组件覆盖：键为 THEME_COMPONENT_KEYS，值为相对包内的 .vue 路径 */
  components?: Partial<Record<ThemeComponentKey, string>>;
  /** 额外的 CSS 变量（不区分主题，直接写到 :root） */
  variables?: Record<string, string>;
}

/** 已安装主题条目（对应 Rust `theme_list`） */
export interface ThemeEntry {
  id: string;
  manifest: ThemeManifest;
  path: string;
}

/** 主题市场索引里的单个主题 */
export interface ThemeMarketEntry {
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** 预览图（相对索引地址的相对路径或绝对 URL） */
  preview?: string;
  /** 主题包 zip 直链 */
  url: string;
  homepage?: string;
  tags?: string[];
  /** 由索引提供者的版本号（仅展示用，真实版本以安装后的 theme.json 为准） */
  version?: string;
  /** 来源市场名（前端补全） */
  sourceName?: string;
}

/** 主题市场索引（theme-index.json） */
export interface ThemeMarketIndex {
  name?: string;
  themes?: ThemeMarketEntry[];
}

/** 主题运行时状态（store 内部使用） */
export interface AppliedTheme {
  /** 当前生效主题 id；空串表示内置默认 WinUI 外观 */
  id: string;
  /** 当前生效主题的清单（内置默认时为 undefined） */
  manifest?: ThemeManifest;
}
