/**
 * 主题组件可用的「宿主模块表」。
 *
 * 主题里的 `<script setup>` 写 `import { usePlayerStore } from "@/stores/player"`，
 * 编译后会被改写成对模块表的访问。只有下表列出的模块可以被导入——这是主题的
 * 唯一能力边界（约束的是误用与越权，不构成安全沙箱：主题代码运行在主渲染进程）。
 *
 * 加新模块时请遵守两条：
 * 1. 只暴露与「展示 / 交互」相关的 API，不要暴露文件系统或原生命令；
 * 2. 在 docs/THEME-DEVELOPMENT.md 的「可用模块」表格里补一行。
 */

import * as Vue from "vue";
import * as VueRouter from "vue-router";
// 无边框窗口的窗口控制（最小化 / 最大化 / 关闭 / 拖动区）：主题接管骨架后必须自己提供
import * as TauriWindow from "@tauri-apps/api/window";
import { openContextMenu, openContextMenuAt } from "@/services/contextMenu";
import { toast } from "@/services/toast";
import {
  PLAYBACK_RATES,
  PLAY_MODE_LABEL,
  createQueueUid,
  formatDuration,
  formatRate,
  formatTime,
  playModeIcon,
  trackArtist,
  trackTitle,
} from "@/types/player";
import {
  THEME_COMPONENT_LABELS,
  type ThemeAppearance,
  type ThemeDensity,
  type ThemeManifest,
} from "@/types/theme";
import { activeThemeAsset, getActiveThemeId } from "@/services/themeAssets";

/** 内置 winui 控件（主题可以直接复用，不必重造轮子） */
import * as WinUI from "@/components/winui";

/** 主题可能复用的宿主组件（Base = 不含主题分发的内置实现，避免递归） */
import MediaCardBase from "@/components/common/MediaCardBase.vue";
import EmptyStateBase from "@/components/common/EmptyStateBase.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import WpCard from "@/components/theme/WpCard.vue";
import QueuePanel from "@/components/layout/QueuePanel.vue";
import LyricsPanel from "@/components/layout/LyricsPanel.vue";
import DownloadPanel from "@/components/layout/DownloadPanel.vue";
import TitleBarBase from "@/components/layout/TitleBarBase.vue";
import SideNavBase from "@/components/layout/SideNavBase.vue";
import PlayerBarBase from "@/components/layout/PlayerBarBase.vue";
import PageShellBase from "@/components/layout/PageShell.vue";
import TextBoxBase from "@/components/winui/TextBoxBase.vue";
import ComboBoxBase from "@/components/winui/ComboBoxBase.vue";
import ToggleSwitchBase from "@/components/winui/ToggleSwitchBase.vue";
import SliderBase from "@/components/winui/SliderBase.vue";
import NumberBoxBase from "@/components/winui/NumberBoxBase.vue";
import { usePlayerStore } from "@/stores/player";
import { trackKey, useLibraryStore } from "@/stores/library";
import {
  DEFAULT_DOWNLOAD_NAME_TEMPLATE,
  DEFAULT_SOURCE_SEARCH_FORMAT,
  useSettingsStore,
} from "@/stores/settings";
import { OFFICIAL_MARKET_SOURCE, pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import { useDownloadsStore } from "@/stores/downloads";
import { useIsAndroid, useIsMobile, useIsWindows } from "@/composables/useIsMobile";
import { useLongPress } from "@/composables/useLongPress";

/** 主题宿主上下文：由 themes store 在应用主题时注入 */
export interface ThemeHostContext {
  /** 当前主题清单 */
  manifest: ThemeManifest;
  /** 解析主题包内资源 */
  asset: (path?: string | null) => string | undefined;
  /** 当前解析出的配色（跟随系统时是实际生效的那个） */
  scheme: () => "light" | "dark";
  /** 切换深浅配色偏好（等价于设置里的「主题」下拉） */
  setScheme: (scheme: "light" | "dark" | "system") => void;
}

let hostContext: ThemeHostContext | null = null;

/** 由 themes store 注入；切换主题时更新 */
export function setThemeHostContext(context: ThemeHostContext | null): void {
  hostContext = context;
}

function requireContext(): ThemeHostContext {
  if (!hostContext) throw new Error("主题运行时上下文尚未初始化");
  return hostContext;
}

/**
 * 宿主模块表：键是 import 说明符，值是模块导出对象。
 *
 * 同时接受 `@/xxx` 与 `@theme/xxx` 两套写法（后者语义更清晰，推荐主题作者使用）。
 */
const MODULES: Record<string, Record<string, unknown>> = {
  vue: Vue as unknown as Record<string, unknown>,
  "vue-router": VueRouter as unknown as Record<string, unknown>,

  "@/stores/player": { usePlayerStore },
  "@/stores/library": { useLibraryStore, trackKey },
  "@/stores/settings": {
    useSettingsStore,
    DEFAULT_SOURCE_SEARCH_FORMAT,
    DEFAULT_DOWNLOAD_NAME_TEMPLATE,
  },
  "@/stores/plugins": { usePluginsStore, pluginDisplayName, OFFICIAL_MARKET_SOURCE },
  "@/stores/downloads": { useDownloadsStore },

  "@/services/toast": { toast },
  // 主题若想自己实现窗口按钮 / 监听窗口事件，需要这两项
  "@tauri-apps/api/window": TauriWindow as unknown as Record<string, unknown>,
  "@/services/contextMenu": { openContextMenu, openContextMenuAt },
  "@/types/player": {
    formatDuration,
    formatTime,
    trackTitle,
    trackArtist,
    PLAY_MODE_LABEL,
    playModeIcon,
    PLAYBACK_RATES,
    formatRate,
    createQueueUid,
  },
  "@/types/theme": { THEME_COMPONENT_LABELS },

  "@/components/winui": WinUI as unknown as Record<string, unknown>,
  "@/components/common/CachedImage.vue": { default: CachedImage },
  // 卡片容器：主题实现 Card 时通常需要复用宿主的 WpCard 分发层
  "@/components/theme/WpCard.vue": { default: WpCard },

  // 内置的浮动面板：主题重写播放条时通常需要原样带上它们，
  // 否则「队列 / 歌词 / 下载」三个按钮点了没反应。
  "@/components/layout/QueuePanel.vue": { default: QueuePanel },
  "@/components/layout/LyricsPanel.vue": { default: LyricsPanel },
  "@/components/layout/DownloadPanel.vue": { default: DownloadPanel },

  // 内置实现的「原件」：主题想「包一层再改一点」时可以直接复用它们，
  // 注意这些是 Base 版本，不含主题分发逻辑，因此不会递归。
  "@/components/common/MediaCardBase.vue": { default: MediaCardBase },
  "@/components/common/EmptyStateBase.vue": { default: EmptyStateBase },
  "@/components/layout/TitleBarBase.vue": { default: TitleBarBase },
  "@/components/layout/SideNavBase.vue": { default: SideNavBase },
  "@/components/layout/PlayerBarBase.vue": { default: PlayerBarBase },
  "@/components/layout/PageShellBase.vue": { default: PageShellBase },
  "@/components/winui/TextBoxBase.vue": { default: TextBoxBase },
  "@/components/winui/ComboBoxBase.vue": { default: ComboBoxBase },
  "@/components/winui/ToggleSwitchBase.vue": { default: ToggleSwitchBase },
  "@/components/winui/SliderBase.vue": { default: SliderBase },
  "@/components/winui/NumberBoxBase.vue": { default: NumberBoxBase },

  "@/composables/useIsMobile": { useIsMobile, useIsWindows, useIsAndroid },
  "@/composables/useLongPress": { useLongPress },

  // 主题自己的运行时工具（推荐写法）
  "@theme/host": {
    asset: activeThemeAsset,
    themeId: getActiveThemeId,
    scheme: () => requireContext().scheme(),
    setScheme: (value: "light" | "dark" | "system") => requireContext().setScheme(value),
    manifest: () => requireContext().manifest,
  },
  "@theme/assets": { asset: activeThemeAsset, themeId: getActiveThemeId },

  // 常用组合：一次拿到色板 / 布局 / 系统判断，减少主题里的样板代码
  "@theme/ui": {
    currentThemeScheme: () => requireContext().scheme(),
    setScheme: (value: "light" | "dark" | "system") => requireContext().setScheme(value),
    manifest: () => requireContext().manifest,
  },
};

/** 解析主题组件的 import；返回 null 表示不允许 */
export function resolveThemeModule(specifier: string): Record<string, unknown> | null {
  const normalized = specifier.trim();
  const direct = MODULES[normalized];
  if (direct) return direct;
  // 允许 `vue/dist/...` 这类明确指向 vue 的写法
  if (normalized.startsWith("vue/")) return MODULES.vue;
  return null;
}

/** 可用模块清单（文档与报错提示复用） */
export function themeModuleCatalog(): string[] {
  return Object.keys(MODULES).sort();
}

/** 当前生效主题的清单（供宿主 UI 展示） */
export function currentThemeManifest(): ThemeManifest | null {
  return hostContext?.manifest ?? null;
}

/** 当前实际配色（跟随系统时是解析后的结果） */
export function currentThemeScheme(): "light" | "dark" {
  return hostContext?.scheme() ?? "light";
}

/** 切换配色偏好（主题里做深色切换按钮时可复用） */
export function setThemeScheme(value: "light" | "dark" | "system"): void {
  hostContext?.setScheme(value);
}

/** 当前生效主题的外观设置 */
export function currentThemeAppearance(): ThemeAppearance | null {
  return hostContext?.manifest.appearance ?? null;
}

/** 当前生效主题的密度设置 */
export function currentThemeDensity(): ThemeDensity | null {
  return hostContext?.manifest.density ?? null;
}
