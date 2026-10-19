/**
 * 主题系统状态与生效逻辑。
 *
 * 一个主题的「生效」由四层叠加而成，顺序固定、互不干扰：
 *
 * 1. **令牌**：把 `manifest.tokens[light|dark]` 与 `density` 折算成 CSS 变量，
 *    写进一张动态 `<style>`（`:root[data-theme="light"] { … }`），
 *    因此「跟随系统」切到另一套配色时自动跟随，无需重新应用主题；
 * 2. **全局 CSS**：主题包里的 theme.css，原样注入（同样带 data-theme-style 标记）；
 * 3. **环境层**：壁纸 / 模糊 / 噪点 / 暗角，由 ThemeBackdrop 读取 appearance 渲染；
 * 4. **组件覆盖**：编译好的 .vue 注册进 themeSlot 注册表，替换内置组件。
 *
 * 卸载 / 切回默认时按相反顺序清理，保证不残留任何样式与组件。
 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getSetting, setSetting } from "@/services/db";
import { httpFetchJson } from "@/services/proxy";
import { applyGithubMirror, resolveAssetUrl } from "@/services/githubMirror";
import {
  hasExecutableComponents,
  installThemeFromDialog,
  installThemeFromUrl,
  listThemes,
  loadTheme,
  removeTheme,
  resolveThemeAsset,
  validateManifest,
  type LoadedTheme,
} from "@/services/themeService";
import { removeAllThemeStyles } from "@/services/themeStyles";
import {
  brokenComponentKeys,
  clearThemeComponentOverrides,
  setThemeComponentOverride,
  themedComponentKeys,
} from "@/components/theme/themeSlot";
import {
  getActiveThemeId,
  setActiveThemeId,
} from "@/services/themeAssets";
import { setThemeHostContext } from "@/services/themeModules";
import { toast } from "@/services/toast";
import { useSettingsStore } from "@/stores/settings";
import {
  THEME_COMPONENT_KEYS,
  type ThemeAppearance,
  type ThemeComponentKey,
  type ThemeDensity,
  type ThemeEntry,
  type ThemeManifest,
  type ThemeMarketEntry,
  type ThemeMarketIndex,
} from "@/types/theme";

/** 官方内置主题市场源：默认值，可在设置中替换或追加 */
export const OFFICIAL_THEME_MARKET_SOURCE = {
  name: "官方主题市场",
  url: "https://raw.githubusercontent.com/WinPlayer-dev/plugin-market/main/theme-index.json",
};

/** 内置默认主题（WinUI 原生气质，无任何覆盖） */
export const DEFAULT_THEME_ID = "";

/** 动态令牌样式表 id */
const TOKEN_STYLE_ID = "wp-theme-tokens";
/** 全局 CSS 样式表 id */
const GLOBAL_STYLE_ID = "wp-theme-global";

/** 主题可改写的令牌键前缀：不限于此，任意 --wp-* 都会被写入 */
const TOKEN_PREFIX = "--wp-";

/** 圆角令牌的基准值（与 styles/tokens.css 保持一致） */
const RADIUS_BASE: Record<string, number> = {
  "--radius-sm": 4,
  "--radius-md": 7,
  "--radius-lg": 8,
  "--radius-xl": 12,
};

/** 间距令牌基准值 */
const SPACE_BASE: Record<string, number> = {
  "--space-xs": 2,
  "--space-sm": 4,
  "--space-md": 8,
  "--space-lg": 12,
  "--space-xl": 16,
  "--space-2xl": 24,
  "--space-3xl": 32,
};

/** 布局尺寸基准值 */
const LAYOUT_BASE: Record<string, number> = {
  "--titlebar-height": 48,
  "--sidenav-width": 232,
  "--playerbar-height": 92,
};

/** 动效时长基准值（毫秒） */
const DURATION_BASE: Record<string, number> = {
  "--duration-fast": 120,
  "--duration-normal": 200,
  "--duration-slow": 350,
  "--duration-control-fast": 167,
};

/** 数值四舍五入到 0.5px 精度，避免缩放后出现 7.0000001px 这类脏值 */
function round(value: number): number {
  return Math.round(value * 2) / 2;
}

/** 缩放一组 px 基准值 */
function scalePx(base: Record<string, number>, factor: number): string[] {
  return Object.entries(base)
    .filter(([, value]) => value > 0)
    .map(([token, value]) => `  ${token}: ${round(value * factor)}px;`);
}

/** 归一化令牌名：允许省略 `--wp-` / `--` 前缀 */
function normalizeTokenName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("--")) return trimmed;
  if (trimmed.startsWith(TOKEN_PREFIX)) return trimmed;
  return `${TOKEN_PREFIX}${trimmed}`;
}

/** 把令牌对象整理成 CSS 声明行 */
function tokenDeclarations(tokens: Record<string, string> | undefined): string {
  if (!tokens) return "";
  return Object.entries(tokens)
    .map(([key, value]) => {
      const name = normalizeTokenName(key);
      if (!name || value === undefined || value === null) return "";
      return `  ${name}: ${String(value)};`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 把 density 折算成令牌覆盖。
 *
 * 主题作者只写相对倍数（如 `"radiusScale": 2`），宿主按内置基准值换算成绝对
 * px 值写入：不依赖 `var()` 自引用，也不会在中途解析出非法值。
 */
function densityDeclarations(density: ThemeDensity | undefined): string {
  if (!density) return "";
  const lines: string[] = [];
  const radiusScale = density.radiusScale;
  if (radiusScale !== undefined && radiusScale !== 1) {
    lines.push(...scalePx(RADIUS_BASE, radiusScale));
  }
  const scale = density.scale;
  if (scale !== undefined && scale !== 1) {
    lines.push(...scalePx(SPACE_BASE, scale));
    lines.push(...scalePx(LAYOUT_BASE, scale));
  }
  const motionScale = density.motionScale;
  if (motionScale !== undefined && motionScale !== 1) {
    lines.push(...scalePx(DURATION_BASE, motionScale).map((line) => line.replace("px", "ms")));
  }
  if (density.compact) {
    // 紧凑模式：行高与控件高度收敛，列表一屏能多看几行
    lines.push("  --row-height: 32px;");
    lines.push("  --control-height: 28px;");
  }
  if (density.fontFamily) lines.push(`  --font-family-display: ${density.fontFamily};`);
  if (density.fontDisplay) lines.push(`  --font-family-title: ${density.fontDisplay};`);
  if (density.fontScale !== undefined && density.fontScale !== 1) {
    lines.push(`  --font-scale: ${density.fontScale};`);
  }
  if (density.easing) {
    lines.push(`  --ease-standard: ${density.easing};`);
    lines.push(`  --ease-decelerate: ${density.easing};`);
  }
  return lines.join("\n");
}

/** 组装整张令牌样式表（深浅两套各一段 + 不区分主题的额外变量） */
function buildTokenStyle(manifest: ThemeManifest): string {
  const tokens = manifest.tokens ?? {};
  const density = densityDeclarations(manifest.density);
  const blocks: string[] = [];

  const extraVars = tokenDeclarations(manifest.variables);

  const lightBody = [tokenDeclarations(tokens.light), density].filter(Boolean).join("\n");
  const darkBody = [tokenDeclarations(tokens.dark), density].filter(Boolean).join("\n");

  if (lightBody) blocks.push(`:root[data-theme="light"] {\n${lightBody}\n}`);
  // 首屏 data-theme 尚未写入时也按浅色兜底，避免先闪一下默认皮肤
  if (lightBody) blocks.push(`:root:not([data-theme]) {\n${lightBody}\n}`);
  if (darkBody) blocks.push(`:root[data-theme="dark"] {\n${darkBody}\n}`);
  if (extraVars) blocks.push(`:root {\n${extraVars}\n}`);

  return blocks.join("\n\n");
}

/** 主题市场条目 → 展示用（补全预览图绝对地址、来源市场名） */
function normalizeMarketEntry(
  entry: ThemeMarketEntry,
  source: { name: string; url: string },
  mirror: string,
): ThemeMarketEntry {
  return {
    ...entry,
    sourceName: source.name,
    preview: entry.preview
      ? applyGithubMirror(resolveAssetUrl(source.url, entry.preview), mirror)
      : undefined,
    url: entry.url,
  };
}

export const useThemesStore = defineStore("themes", () => {
  const settingsStore = useSettingsStore();

  /** 已安装主题 */
  const installed = ref<ThemeEntry[]>([]);
  /** 当前生效主题 id（空串 = 内置默认） */
  const activeId = ref<string>(DEFAULT_THEME_ID);
  /** 当前生效主题的完整加载结果 */
  const activeTheme = ref<LoadedTheme | null>(null);
  /** 正在切换/加载 */
  const applying = ref(false);
  /** 已安装清单是否已加载 */
  const loaded = ref(false);
  /** 最近一次应用失败信息 */
  const lastError = ref("");
  /** 组件编译失败详情（组件名 → 原因） */
  const componentErrors = ref<Partial<Record<ThemeComponentKey, string>>>({});
  /**
   * 运行时渲染失败的组件（渲染时抛错 → 已自动回退内置实现）。
   * 与编译错误分开：编译错误在应用主题时就已知，运行时报错只有真正渲染才暴露。
   */
  const runtimeErrors = ref<Array<{ key: ThemeComponentKey; message: string }>>([]);

  /** 用户添加的主题市场源（官方源始终在最前，不可删除） */
  const marketSources = ref<Array<{ name: string; url: string }>>([]);
  /** 主题市场条目缓存 */
  const marketEntries = ref<ThemeMarketEntry[]>([]);
  const marketLoading = ref(false);
  /** 记住“已确认过安全提示”的主题 id，避免每次切换都弹窗 */
  const acknowledgedThemes = ref<string[]>([]);

  const appearance = computed<ThemeAppearance | null>(
    () => activeTheme.value?.manifest.appearance ?? null,
  );
  const density = computed<ThemeDensity | null>(() => activeTheme.value?.manifest.density ?? null);
  const manifest = computed<ThemeManifest | null>(() => activeTheme.value?.manifest ?? null);
  const hasTheme = computed(() => Boolean(activeTheme.value));

  /** 主题是否自带可执行组件（UI 用来显示「含组件」标记） */
  const activeHasComponents = computed(
    () => Object.keys(activeTheme.value?.manifest.components ?? {}).length > 0,
  );

  /** 已安装主题里被覆盖的组件名清单 */
  const activeComponentKeys = computed<ThemeComponentKey[]>(() =>
    themedComponentKeys(),
  );

  function findInstalled(id: string): ThemeEntry | undefined {
    return installed.value.find((entry) => entry.id === id);
  }

  /** 解析主题包资源（供 ThemeBackdrop / 主题组件使用） */
  function resolveAsset(path?: string | null): string | undefined {
    const id = activeId.value || getActiveThemeId();
    if (!id) return path ?? undefined;
    return resolveThemeAsset(id, path);
  }

  /* ------------------------------ 持久化 ------------------------------ */

  async function persistState(): Promise<void> {
    await setSetting("themes.activeId", activeId.value);
    await setSetting("themes.acknowledged", acknowledgedThemes.value);
  }

  async function loadMarketSources(): Promise<void> {
    const sources = await getSetting<Array<{ name: string; url: string }>>(
      "settings.themeMarketSources",
      [],
    );
    marketSources.value = Array.isArray(sources) ? sources : [];
  }

  async function setMarketSources(value: Array<{ name: string; url: string }>): Promise<void> {
    marketSources.value = value;
    await setSetting("settings.themeMarketSources", value);
  }

  /** 全部市场源：官方内置源固定首位，后接用户自建源（按 url 去重） */
  function allMarketSources(): Array<{ name: string; url: string }> {
    const rest = marketSources.value.filter(
      (source) => source.url !== OFFICIAL_THEME_MARKET_SOURCE.url,
    );
    return [OFFICIAL_THEME_MARKET_SOURCE, ...rest];
  }

  /* ------------------------------ 应用 / 卸载 ------------------------------ */

  /** 把主题令牌 + 全局 CSS + 组件样式写进 DOM（用动态 <style>，便于整体替换） */
  function mountStyles(theme: LoadedTheme): void {
    const tokenCss = buildTokenStyle(theme.manifest);
    writeStyleSheet(TOKEN_STYLE_ID, tokenCss);
    // 全局 CSS 与组件 scoped 样式分开两张表：前者可能很大，后者随组件切换增减
    writeStyleSheet(GLOBAL_STYLE_ID, theme.globalCss);
    writeStyleSheet(GLOBAL_STYLE_ID + "-components", theme.componentCss);
  }

  function writeStyleSheet(id: string, css: string): void {
    let element = document.getElementById(id) as HTMLStyleElement | null;
    if (!css.trim()) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement("style");
      element.id = id;
      element.dataset.themeStyle = "1";
      document.head.appendChild(element);
    }
    element.textContent = css;
  }

  /** 清掉主题注入的一切：样式、组件覆盖、宿主上下文、背景属性 */
  function teardown(): void {
    removeAllThemeStyles();
    clearThemeComponentOverrides();
    setThemeHostContext(null);
    setActiveThemeId("");
    const root = document.documentElement;
    delete root.dataset.themeSurface;
    delete root.dataset.themeBackground;
    const style = root.style;
    for (const name of [
      "--theme-wallpaper",
      "--theme-wallpaper-blur",
      "--theme-wallpaper-opacity",
      "--theme-wallpaper-size",
      "--theme-wallpaper-blend",
      "--theme-noise",
      "--theme-noise-opacity",
      "--theme-vignette-opacity",
      "--theme-overlay",
    ]) {
      style.removeProperty(name);
    }
  }

  /** 主题要求内容层半透明时给 <html> 打标记（样式见 styles/theme.css） */
  function applySurfaceFlags(theme: LoadedTheme | null): void {
    const root = document.documentElement;
    const appearanceConfig = theme?.manifest.appearance;
    if (appearanceConfig && appearanceConfig.translucentSurfaces !== false) {
      root.dataset.themeSurface = "translucent";
    } else {
      delete root.dataset.themeSurface;
    }
    root.style.setProperty(
      "--theme-transparent-background",
      appearanceConfig?.transparentBackground === false ? "0" : "1",
    );

    /**
     * 主题覆盖了 components.Background 时，说明它要自己画背景；
     * 此时应用外壳必须让出底色，否则 MDUI 的背景层会被 --wp-base 盖住。
     */
    if (theme?.manifest.components?.Background) {
      root.dataset.themeBackground = "custom";
    } else {
      delete root.dataset.themeBackground;
    }
  }

  /**
   * 应用主题：加载 → 令牌/CSS → 组件 → 背景，任一步失败都回退到默认外观。
   */
  async function applyTheme(id: string, options: { silent?: boolean } = {}): Promise<boolean> {
    applying.value = true;
    lastError.value = "";
    componentErrors.value = {};
    try {
      if (!id) {
        teardown();
        applySurfaceFlags(null);
        activeId.value = DEFAULT_THEME_ID;
        activeTheme.value = null;
        await persistState();
        return true;
      }

      const entry = findInstalled(id);
      if (!entry) throw new Error(`未找到主题「${id}」，可能已被卸载`);

      const problems = validateManifest(entry.manifest);
      const fatal = problems.filter((p) => !p.includes("高于当前宿主支持"));
      if (fatal.length) throw new Error(`主题清单有误：${fatal.join("；")}`);

      const theme = await loadTheme(entry);
      teardown();

      mountStyles(theme);
      applySurfaceFlags(theme);

      for (const key of THEME_COMPONENT_KEYS) {
        const compiled = theme.components[key];
        if (compiled) setThemeComponentOverride(key, compiled.component);
      }

      setActiveThemeId(id);
      setThemeHostContext({
        manifest: theme.manifest,
        asset: (path) => resolveThemeAsset(id, path),
        scheme: () =>
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        setScheme: (scheme) => void settingsStore.setTheme(scheme),
      });

      activeId.value = id;
      activeTheme.value = theme;
      componentErrors.value = theme.componentErrors;
      runtimeErrors.value = brokenComponentKeys();

      const failed = Object.keys(theme.componentErrors);
      if (failed.length) {
        lastError.value = `以下组件未生效：${failed.join("、")}`;
        if (!options.silent) toast(lastError.value, "error");
      } else if (!options.silent) {
        toast(`已应用主题「${theme.manifest.name}」`, "success");
      }

      await persistState();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      teardown();
      applySurfaceFlags(null);
      activeId.value = DEFAULT_THEME_ID;
      activeTheme.value = null;
      if (!options.silent) toast(`应用主题失败：${message}`, "error");
      await persistState();
      return false;
    } finally {
      applying.value = false;
    }
  }

  /* ------------------------------ 安装 / 卸载 ------------------------------ */

  async function loadInstalled(): Promise<void> {
    try {
      installed.value = await listThemes();
      loaded.value = true;
    } catch (error) {
      console.error("加载主题列表失败", error);
      toast(`加载主题列表失败: ${error}`, "error");
    }
  }

  /** 安装本地主题包（.zip / 目录），成功后自动应用 */
  async function installFromDialog(): Promise<boolean> {
    try {
      const entry = await installThemeFromDialog();
      if (!entry) return false;
      await loadInstalled();
      acknowledgedThemes.value = acknowledgedThemes.value.filter((id) => id !== entry.id);
      await applyTheme(entry.id, { silent: true });
      toast(`主题「${entry.manifest.name}」安装成功`, "success");
      return true;
    } catch (error) {
      toast(`安装主题失败: ${error}`, "error");
      return false;
    }
  }

  /** 从 URL 安装主题包，成功后自动应用 */
  async function installFromUrl(url: string): Promise<boolean> {
    try {
      const entry = await installThemeFromUrl(url, settingsStore.githubMirror);
      await loadInstalled();
      acknowledgedThemes.value = acknowledgedThemes.value.filter((id) => id !== entry.id);
      await applyTheme(entry.id, { silent: true });
      toast(`主题「${entry.manifest.name}」安装成功`, "success");
      return true;
    } catch (error) {
      toast(`安装主题失败: ${error}`, "error");
      return false;
    }
  }

  /** 卸载主题：正在使用时先切回默认外观 */
  async function uninstall(id: string): Promise<void> {
    const entry = findInstalled(id);
    try {
      if (activeId.value === id) await applyTheme(DEFAULT_THEME_ID, { silent: true });
      await removeTheme(id);
      await loadInstalled();
      acknowledgedThemes.value = acknowledgedThemes.value.filter((item) => item !== id);
      await persistState();
      toast(`主题「${entry?.manifest.name ?? id}」已卸载`, "success");
    } catch (error) {
      toast(`卸载主题失败: ${error}`, "error");
    }
  }

  /* ------------------------------ 主题市场 ------------------------------ */

  /** 拉取所有市场源的索引并合并（GitHub 系地址自动走镜像） */
  async function fetchMarketEntries(): Promise<ThemeMarketEntry[]> {
    marketLoading.value = true;
    try {
      const mirror = settingsStore.githubMirror;
      const results = await Promise.allSettled(
        allMarketSources().map(async (source) => {
          const index = await httpFetchJson<ThemeMarketIndex>(
            applyGithubMirror(source.url, mirror),
            15_000,
          );
          return (index.themes ?? []).map((entry) =>
            normalizeMarketEntry(entry, source, mirror),
          );
        }),
      );

      const entries: ThemeMarketEntry[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          entries.push(...result.value);
        } else {
          failures.push(
            `${allMarketSources()[index]?.name ?? index}：${String(result.reason)}`,
          );
        }
      });

      if (failures.length && !entries.length) {
        throw new Error(failures.join("；"));
      }

      // 同一 id 只保留第一条（官方源优先）
      const seen = new Set<string>();
      marketEntries.value = entries.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
      return marketEntries.value;
    } finally {
      marketLoading.value = false;
    }
  }

  /** 市场条目在当前设备上的状态 */
  function marketStatus(entry: ThemeMarketEntry): "none" | "installed" | "updatable" {
    const local = findInstalled(entry.id);
    if (!local) return "none";
    if (!entry.version) return "installed";
    return compareVersions(entry.version, local.manifest.version ?? "0") > 0
      ? "updatable"
      : "installed";
  }

  /* ------------------------------ 初始化 ------------------------------ */

  /** 启动时调用：加载已安装列表并恢复上次的主题 */
  async function init(): Promise<void> {
    await loadInstalled();
    await loadMarketSources();
    activeId.value = await getSetting<string>("themes.activeId", DEFAULT_THEME_ID);
    acknowledgedThemes.value = await getSetting<string[]>("themes.acknowledged", []);
    if (activeId.value) {
      const ok = await applyTheme(activeId.value, { silent: true });
      if (!ok) {
        // 主题被删 / 损坏：静默回退默认外观，不打扰用户
        console.warn("恢复上次主题失败：", lastError.value);
      }
    }
  }

  /** 主题含可执行代码时，是否需要先向用户确认 */
  function needsAcknowledgement(id: string): boolean {
    const entry = findInstalled(id);
    if (!entry) return false;
    if (!hasExecutableComponents(entry.manifest)) return false;
    return !acknowledgedThemes.value.includes(id);
  }

  async function acknowledge(id: string): Promise<void> {
    if (acknowledgedThemes.value.includes(id)) return;
    acknowledgedThemes.value = [...acknowledgedThemes.value, id];
    await persistState();
  }

  // 跟随系统配色切换时，重新给文档根节点打标记（令牌由 CSS 选择器自动切换）
  watch(
    () => settingsStore.theme,
    () => {
      if (!activeTheme.value) return;
      // 触发一次背景层重算：appearance 可能依赖当前配色（如 overlay 用 CSS 变量）
      document.documentElement.dataset.themeSurface =
        activeTheme.value.manifest.appearance?.translucentSurfaces === false
          ? "solid"
          : "translucent";
    },
  );

  return {
    installed,
    activeId,
    activeTheme,
    applying,
    loaded,
    lastError,
    componentErrors,
    runtimeErrors,
    marketSources,
    marketEntries,
    marketLoading,
    appearance,
    density,
    manifest,
    hasTheme,
    activeHasComponents,
    activeComponentKeys,
    resolveAsset,
    init,
    loadInstalled,
    applyTheme,
    installFromDialog,
    installFromUrl,
    uninstall,
    fetchMarketEntries,
    marketStatus,
    setMarketSources,
    loadMarketSources,
    needsAcknowledgement,
    acknowledge,
    findInstalled,
    allMarketSources,
  };
});

/** 逐段比较点分版本号：a>b 返回正数 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
