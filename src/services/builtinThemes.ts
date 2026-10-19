/**
 * 随应用发布的「内置主题」。
 *
 * 主题以普通源码树的形式放在 `src/themes/<id>/`（theme.json + CSS + 组件），
 * 通过 Vite 的 `?raw` 在构建期整体打进来：既不需要联网安装，也不会多一个
 * Rust 侧的解压步骤，还让内置主题与第三方主题走**完全相同**的加载与编译路径
 * （这是它作为「主题开发范本」的价值）。
 *
 * 代价是内置主题的文件会被计入首屏包体——因此这里按需加载：
 * 只有用户真的选中内置主题时，才 `import()` 对应目录。
 */

import type { ThemeEntry, ThemeManifest } from "@/types/theme";

/** 内置主题的源码文件表：相对路径 → 文本内容 */
export type BuiltinThemeFiles = Record<string, string>;

/** 内置主题注册项 */
export interface BuiltinThemeDescriptor {
  id: string;
  /** 显示名（与 theme.json 一致，仅用于列表占位） */
  name: string;
  description?: string;
  /** 懒加载该主题的全部文件 */
  load: () => Promise<BuiltinThemeFiles>;
}

/**
 * 把 `import.meta.glob` 的结果包装成「相对路径 → 文本」的加载器。
 *
 * glob 的 key 形如 `../themes/md3/theme.json`，这里裁掉固定前缀，
 * 得到与第三方主题包内一致的相对路径（`theme.json` / `components/PlayerBar.vue`）。
 */
function rawLoader(
  modules: Record<string, () => Promise<unknown>>,
  prefix: string,
): () => Promise<BuiltinThemeFiles> {
  return async () => {
    const files: BuiltinThemeFiles = {};
    await Promise.all(
      Object.entries(modules).map(async ([path, load]) => {
        const relative = path.slice(prefix.length);
        const content = await load();
        files[relative] = typeof content === "string" ? content : String(content ?? "");
      }),
    );
    return files;
  };
}

/**
 * 内置主题清单。
 *
 * 新增内置主题只需：在 src/themes/ 下放主题目录，然后在这里加一行
 * （glob 模式已按目录名收敛，不需要为每个文件写 import）。
 */
export const BUILTIN_THEMES: BuiltinThemeDescriptor[] = [
  {
    id: "com.winplayer.theme.md3",
    name: "Material You",
    description: "基于 MDUI 的 Material Design 3 主题：导航轨、药丸按钮、FAB 播放键与动态取色",
    load: rawLoader(
      import.meta.glob("../themes/md3/**/*", { query: "?raw", import: "default" }),
      "../themes/md3/",
    ),
  },
];

/** 内置主题的 manifest 缓存（避免重复解析） */
const manifestCache = new Map<string, ThemeManifest>();

/** 内置主题的完整文件缓存 */
const filesCache = new Map<string, BuiltinThemeFiles>();

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some((theme) => theme.id === id);
}

/** 读取内置主题的文件表（含缓存） */
export async function loadBuiltinFiles(id: string): Promise<BuiltinThemeFiles | null> {
  const cached = filesCache.get(id);
  if (cached) return cached;
  const descriptor = BUILTIN_THEMES.find((theme) => theme.id === id);
  if (!descriptor) return null;
  const files = await descriptor.load();
  filesCache.set(id, files);
  return files;
}

/** 读取内置主题清单 */
export async function loadBuiltinManifest(id: string): Promise<ThemeManifest | null> {
  const cached = manifestCache.get(id);
  if (cached) return cached;
  const files = await loadBuiltinFiles(id);
  const text = files?.["theme.json"];
  if (!text) return null;
  try {
    const manifest = JSON.parse(text) as ThemeManifest;
    manifestCache.set(id, manifest);
    return manifest;
  } catch (error) {
    console.error(`内置主题 ${id} 的 theme.json 解析失败`, error);
    return null;
  }
}

/**
 * 列出内置主题条目。
 *
 * 返回的 `path` 为空串（没有磁盘目录），`readThemeText` 会优先命中这里，
 * 因此上层代码（主题 store / 加载器）不需要区分内置与已安装主题。
 */
export async function builtinThemeEntries(): Promise<ThemeEntry[]> {
  const entries: ThemeEntry[] = [];
  for (const descriptor of BUILTIN_THEMES) {
    const manifest = await loadBuiltinManifest(descriptor.id);
    if (manifest) entries.push({ id: descriptor.id, manifest, path: "" });
  }
  return entries;
}

/** 内置主题里某个文件的文本内容 */
export async function readBuiltinText(id: string, path: string): Promise<string | null> {
  const files = await loadBuiltinFiles(id);
  if (!files) return null;
  const normalized = path.replace(/^\.\//, "").replace(/\\/g, "/");
  return files[normalized] ?? null;
}
