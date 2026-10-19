/**
 * 主题包内资源（壁纸 / 字体 / 图片）的地址解析。
 *
 * 主题包装在应用数据目录里，前端通过 Rust 注册的自定义协议读取：
 * `themeasset://<themeId>/<relativePath>`，在 Windows / Android 的 WebView2
 * 下实际形式为 `http://themeasset.localhost/<themeId>/<relativePath>`
 * （与 cachedimg 协议同一套机制）。远程 URL 与 data URI 原样返回。
 */

/** 自定义协议虚拟域名（与 src-tauri/src/commands/themes.rs 保持一致） */
const ASSET_ORIGIN = "http://themeasset.localhost/";

/** 是否为可直接使用的外部地址 */
function isExternal(path: string): boolean {
  return /^(https?:|data:|blob:|file:|themeasset:|about:)/i.test(path);
}

/** 把主题包内相对路径转成可访问的 URL；外部地址与空值原样返回 */
export function themeAssetUrl(themeId: string, path?: string | null): string | undefined {
  if (!path) return undefined;
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  if (isExternal(trimmed)) return trimmed;
  const normalized = trimmed.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
  return `${ASSET_ORIGIN}${encodeURIComponent(themeId)}/${normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/** 判断资源是否为「随主题包发布」（需要走主题资源协议） */
export function isThemeLocalAsset(path?: string | null): boolean {
  if (!path) return false;
  return !isExternal(path.trim());
}

/**
 * 当前生效主题 id 的可变快照。
 *
 * 提供给主题组件的虚拟模块 `@theme/host`：组件里写
 * `asset("assets/bg.jpg")` 即可拿到当前主题包内的资源地址，无需硬编码主题 id。
 * 由 themes store 在应用/卸载主题时更新（不参与响应式，避免额外依赖）。
 */
let activeThemeId = "";

export function setActiveThemeId(id: string): void {
  activeThemeId = id;
}

export function getActiveThemeId(): string {
  return activeThemeId;
}

/** 供主题组件调用：解析当前主题包内的资源路径 */
export function activeThemeAsset(path?: string | null): string | undefined {
  if (!path) return undefined;
  return themeAssetUrl(activeThemeId, path);
}
