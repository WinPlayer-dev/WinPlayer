/**
 * 预览环境共享装置（仅开发期使用）。
 *
 * 两个预览入口（theme-preview / settings-preview）都需要：
 * 1. 一个最小的 Tauri 宿主桩——组件里的 `getCurrentWindow()` 与 `invoke()`
 *    缺任何一项都会让 setup 抛错，进而卸载整棵组件树；
 * 2. 用**与生产一致**的编译管线装载内置 MD3 主题。
 *
 * 抽到这里是为了避免两处维护、逐渐漂移。
 */
import { ensureMduiLoaded } from "@/services/mduiLoader";
import { compileThemeComponent } from "@/services/themeRuntime";
import { resolveThemeModule, setThemeHostContext } from "@/services/themeModules";
import { setActiveThemeId } from "@/services/themeAssets";
import { clearThemeComponentOverrides, setThemeComponentOverride } from "@/components/theme/themeSlot";
import type { ThemeComponentKey, ThemeManifest } from "@/types/theme";

/** 安装 Tauri 宿主桩 */
export function installHarnessStubs(): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> };
  w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ ?? {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    invoke: async (cmd: string) => {
      if (cmd.includes("listen") || cmd.includes("plugin:event|listen")) return 0;
      if (cmd.includes("is_maximized")) return false;
      if (cmd.includes("plugin:event|unlisten")) return null;
      return null;
    },
    transformCallback: (callback?: unknown) => {
      const id = Math.floor(Math.random() * 1e9);
      (window as unknown as Record<string | number, unknown>)[`_${id}`] = callback;
      return id;
    },
    convertFileSrc: (path: string) => path,
  };

  // 事件插件内部计数器：缺了会在组件卸载时抛 unregisterListener
  const w2 = window as unknown as {
    __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: (event: string, id: number) => void };
  };
  w2.__TAURI_EVENT_PLUGIN_INTERNALS__ = w2.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {
    unregisterListener: () => {},
  };
}

/** 内置主题的全部源码文件（构建期以 ?raw 打进包） */
async function loadBuiltinFiles(): Promise<Record<string, string>> {
  const glob = import.meta.glob("../themes/md3/**/*", {
    query: "?raw",
    import: "default",
  }) as Record<string, () => Promise<string>>;
  const table: Record<string, string> = {};
  await Promise.all(
    Object.entries(glob).map(async ([path, load]) => {
      table[path.slice("../themes/md3/".length)] = await load();
    }),
  );
  return table;
}

/** 解析清单并注入主题令牌 + 全局 CSS */
function applyThemeStyles(manifest: ThemeManifest, files: Record<string, string>): void {
  const declarations = (set?: Record<string, string>) =>
    Object.entries(set ?? {})
      .map(([key, value]) => `  ${key.startsWith("--") ? key : `--wp-${key}`}: ${value};`)
      .join("\n");

  const tokens = manifest.tokens ?? {};
  const css = [
    `:root[data-theme="light"] {\n${declarations(tokens.light)}\n}`,
    `:root[data-theme="dark"] {\n${declarations(tokens.dark)}\n}`,
    files["theme.css"] ?? "",
  ].join("\n");

  let style = document.getElementById("harness-theme-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "harness-theme-style";
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/**
 * 装载内置 MD3 主题：编译全部组件并注册覆盖。
 * 返回组件编译错误列表（为空表示全部成功）。
 */
export async function mountBuiltinTheme(): Promise<string[]> {
  const errors: string[] = [];
  await ensureMduiLoaded();

  const files = await loadBuiltinFiles();
  const manifest = JSON.parse(files["theme.json"]) as ThemeManifest;
  applyThemeStyles(manifest, files);

  const cache = new Map();
  const compiling = new Set<string>();
  const readFile = async (path: string) => files[path] ?? null;

  setActiveThemeId(manifest.id);
  setThemeHostContext({
    manifest,
    asset: (path) => (path ? `/${path}` : undefined),
    scheme: () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    setScheme: (value) => {
      if (value === "system") return;
      document.documentElement.dataset.theme = value;
    },
  });

  clearThemeComponentOverrides();

  for (const [key, path] of Object.entries(manifest.components ?? {})) {
    const source = await readFile(String(path));
    if (!source) {
      errors.push(`${key}: 找不到 ${path}`);
      continue;
    }
    try {
      const compiled = await compileThemeComponent(key, source, {
        path: String(path),
        readFile,
        resolveModule: resolveThemeModule,
        cache,
        compiling,
      });
      setThemeComponentOverride(key as ThemeComponentKey, compiled.component);
    } catch (error) {
      errors.push(`${key}: ${error}`);
    }
  }

  // 组件 <style> 注入（含相对依赖编译出来的样式）
  const css = [...cache.values()].map((item) => item.css).join("\n");
  let style = document.getElementById("harness-component-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "harness-component-style";
    document.head.appendChild(style);
  }
  style.textContent = css;

  // 主题自绘背景时给 <html> 打标记（与 stores/themes.ts 行为一致）
  if (manifest.components?.Background) {
    document.documentElement.dataset.themeBackground = "custom";
  } else {
    delete document.documentElement.dataset.themeBackground;
  }

  const failures = errors.length ? errors : [];
  if (failures.length) console.error("[harness] 主题组件编译失败：", failures);
  return failures;
}
