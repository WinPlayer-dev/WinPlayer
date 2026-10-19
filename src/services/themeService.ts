/**
 * 主题服务：安装 / 加载 / 校验 / 编译主题包。
 *
 * 主题包是 zip（或开发时的目录），由 Rust 端解压到 `<app_data>/themes/<id>/`，
 * 本模块负责把清单里的相对路径读出来、编译 Vue 组件、收集所有需要注入的 CSS。
 * 具体的「应用 / 卸载」逻辑在 stores/themes.ts。
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CompiledThemeComponent } from "@/services/themeRuntime";
import { resolveThemeModule, themeModuleCatalog } from "@/services/themeModules";
import { themeAssetUrl } from "@/services/themeAssets";
import { ensureMduiLoaded } from "@/services/mduiLoader";
import {
  builtinThemeEntries,
  isBuiltinTheme,
  readBuiltinText,
} from "@/services/builtinThemes";
import {
  THEME_API_VERSION,
  THEME_COMPONENT_KEYS,
  type ThemeComponentKey,
  type ThemeEntry,
  type ThemeManifest,
} from "@/types/theme";

/** 主题包加载结果 */
export interface LoadedTheme {
  id: string;
  manifest: ThemeManifest;
  /** 包内全局 CSS（可能为空串） */
  globalCss: string;
  /** 组件 <style> 编译结果（含依赖组件），可能为空串 */
  componentCss: string;
  /** 编译好的组件覆盖 */
  components: Partial<Record<ThemeComponentKey, CompiledThemeComponent>>;
  /** 组件编译失败信息（键为组件名）；失败项不会应用，其余照常 */
  componentErrors: Partial<Record<ThemeComponentKey, string>>;
}

/** 列出全部主题：内置主题（打进包里的）在前，已安装的第三方主题在后 */
export async function listThemes(): Promise<ThemeEntry[]> {
  const [builtin, installed] = await Promise.all([
    builtinThemeEntries(),
    invoke<ThemeEntry[]>("theme_list").catch(() => [] as ThemeEntry[]),
  ]);
  const installedIds = new Set(installed.map((entry) => entry.id));
  return [...builtin.filter((entry) => !installedIds.has(entry.id)), ...installed];
}

/**
 * 读取主题包内文本资源；不存在返回 null。
 *
 * 内置主题没有磁盘目录，其内容在构建期已打进来，因此先查内置文件表，
 * 再回退到 Rust 端的已安装主题目录。
 */
export async function readThemeText(id: string, path: string): Promise<string | null> {
  if (isBuiltinTheme(id)) {
    const text = await readBuiltinText(id, path);
    if (text !== null) return text;
  }
  return invoke<string | null>("theme_read_text", { id, path }).catch(() => null);
}

/** 从本地文件选择器安装 .zip（或目录） */
export async function installThemeFromDialog(): Promise<ThemeEntry | null> {
  const path = await open({
    multiple: false,
    directory: false,
    title: "选择主题包（.zip）",
    filters: [{ name: "WinPlayer 主题包", extensions: ["zip"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return invoke<ThemeEntry>("theme_install_from_path", { src: path });
}

/** 从 URL 安装主题包（GitHub 系地址自动走镜像） */
export async function installThemeFromUrl(
  url: string,
  githubMirror: string,
): Promise<ThemeEntry> {
  return invoke<ThemeEntry>("theme_install_from_url", { url, mirror: githubMirror });
}

/** 卸载主题 */
export async function removeTheme(id: string): Promise<void> {
  await invoke("theme_remove", { id });
}

/** 把任意路径解析成主题包内可访问的资源地址 */
export function resolveThemeAsset(themeId: string, path?: string | null): string | undefined {
  return themeAssetUrl(themeId, path);
}

/** 清单字段校验：给主题作者明确、可行动的报错 */
export function validateManifest(manifest: ThemeManifest): string[] {
  const problems: string[] = [];
  if (!manifest.id) problems.push("缺少 id");
  if (!manifest.name) problems.push("缺少 name");
  if (!manifest.version) problems.push("缺少 version（建议语义化版本，如 1.0.0）");
  if (!manifest.apiVersion) {
    problems.push("缺少 apiVersion");
  } else if (manifest.apiVersion > THEME_API_VERSION) {
    problems.push(
      `apiVersion ${manifest.apiVersion} 高于当前宿主支持的 ${THEME_API_VERSION}，可能无法正常工作`,
    );
  }
  for (const key of Object.keys(manifest.components ?? {})) {
    if (!(THEME_COMPONENT_KEYS as readonly string[]).includes(key)) {
      problems.push(
        `components.${key} 不是可覆盖的组件（可用：${THEME_COMPONENT_KEYS.join(" / ")}）`,
      );
    }
  }
  return problems;
}

/**
 * 加载主题包：读取全局 CSS、编译所有组件（含组件间的相对路径依赖）。
 *
 * 单个组件编译失败不会让整包失败——其余组件与令牌照常生效，
 * 失败原因回传给 UI 展示（主题作者绝大多数时候是语法写错了）。
 */
export async function loadTheme(entry: ThemeEntry): Promise<LoadedTheme> {
  const manifest = entry.manifest;
  const id = entry.id;

  let globalCss = "";
  if (manifest.css) {
    globalCss = (await readThemeText(id, manifest.css).catch(() => null)) ?? "";
  }

  const components: Partial<Record<ThemeComponentKey, CompiledThemeComponent>> = {};
  const componentErrors: Partial<Record<ThemeComponentKey, string>> = {};
  /** 组件内 <style> 编译结果（按组件聚合后注入一张表） */
  let componentCss = "";

  // 编译器体积较大（约 800KB），只有主题真的带组件时才按需加载
  if (Object.keys(manifest.components ?? {}).length) {
    const [{ compileThemeComponent }] = await Promise.all([
      import("@/services/themeRuntime"),
      // 主题组件可能用 <mdui-*>：先把自定义元素与图标字体注册好，避免首帧渲染成空标签/文字
      ensureMduiLoaded().catch((error) => {
        console.warn("MDUI 组件库加载失败，主题中的 mdui 组件将不可用", error);
      }),
    ]);

    // 同一主题内共享缓存：PageShell 依赖的 TitleBar / PlayerBar 只编译一次
    const cache = new Map<string, CompiledThemeComponent>();
    const compiling = new Set<string>();
    const readFile = async (path: string) => readThemeText(id, path);

    for (const key of THEME_COMPONENT_KEYS) {
      const path = manifest.components?.[key];
      if (!path) continue;
      try {
        const source = await readFile(path);
        if (!source) {
          componentErrors[key] = `主题包内找不到 ${path}`;
          continue;
        }
        const compiled = await compileThemeComponent(key, source, {
          path,
          readFile,
          resolveModule: resolveThemeModule,
          cache,
          compiling,
        });
        components[key] = compiled;
      } catch (error) {
        componentErrors[key] = error instanceof Error ? error.message : String(error);
      }
    }

    // 依赖组件（未被 manifest 直接列出、但被 PageShell 等引用）的样式也要注入，
    // 否则它们的 scoped 规则不会生效。
    const collected = new Set<string>();
    for (const compiled of cache.values()) {
      if (!compiled.css.trim() || collected.has(compiled.css)) continue;
      collected.add(compiled.css);
      componentCss += `${compiled.css}\n`;
    }
  }

  return { id, manifest, globalCss, componentCss, components, componentErrors };
}

/** 主题是否带可执行组件代码（用于安装/启用前的安全提示） */
export function hasExecutableComponents(manifest: ThemeManifest): boolean {
  return Object.keys(manifest.components ?? {}).length > 0;
}

/** 可用宿主模块清单（设置页「开发」区块展示，方便主题作者对照） */
export { themeModuleCatalog };
