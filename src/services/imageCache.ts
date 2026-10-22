/**
 * 图片缓存 URL 改写。
 *
 * http(s) 图片地址统一改写为自定义协议 `cachedimg://`（Windows/WebView2 下
 * 实际访问形式为 http://cachedimg.localhost/），由 Rust 端处理：磁盘缓存命中
 * 直接读取，未命中时下载、压缩并落盘。因此改写后的 URL 始终显示缓存内容。
 * data: 等非网络地址原样透传。
 *
 * 设置中「缓存项」关闭图片缓存时，不再改写，直接返回原图地址直连加载。
 */

import { useSettingsStore } from "@/stores/settings";

/** 当前策略下是否允许图片磁盘缓存 */
export function isImageCacheEnabled(): boolean {
  const policy = useSettingsStore().cachePolicy;
  return policy === "both" || policy === "images";
}

/**
 * 应用内部自定义协议的虚拟域名：它们由 Rust 端本地提供内容，
 * **不能**改写为 `cachedimg`（缓存代理只会去网络上抓，必然 404）。
 */
const INTERNAL_HOST_PATTERN = /^https?:\/\/(cachedimg|localcover|themeasset)\.localhost\//i;

export function cachedImgUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) return url;
  if (INTERNAL_HOST_PATTERN.test(url)) return url;
  if (!isImageCacheEnabled()) return url;
  return `http://cachedimg.localhost/?src=${encodeURIComponent(url)}`;
}

/**
 * [`cachedImgUrl`](./index) 的逆变换：还原缓存改写前的原始 http(s) 地址。
 *
 * `cachedimg.localhost` 是 Rust 自定义协议的虚拟域名，只在 WebView 内部有效，
 * 系统媒体控件（Windows SMTC / Android 媒体通知）的原生下载走不了，需要拿原图。
 * 非 cache 改写地址（原图 / data: / 相对路径）原样返回；空值返回 null。
 */
export function resolveImgUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = /^http:\/\/cachedimg\.localhost\/\?src=(.+)$/i.exec(url);
  if (match) {
    try {
      const source = decodeURIComponent(match[1]);
      if (/^https?:\/\//i.test(source)) return source;
    } catch {
      // decodeURIComponent 失败则按原样返回
    }
  }
  return url;
}
