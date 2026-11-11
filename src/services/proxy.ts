/**
 * 网络代理服务：主线程发起的跨域请求（如插件市场索引）
 * 同样经由 Rust 后端转发，避免 CORS 限制。
 */

import { invoke } from "@tauri-apps/api/core";
import { t } from "@/i18n";

export interface HttpFetchSpec {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  responseType?: "text" | "base64";
  timeoutMs?: number;
}

export interface HttpFetchResult {
  status: number;
  ok: boolean;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
}

/** 经 Rust 后端代理的原始 HTTP 请求 */
export async function httpFetch(spec: HttpFetchSpec): Promise<HttpFetchResult> {
  return invoke<HttpFetchResult>("http_fetch", { spec });
}

/** 代理请求并解析 JSON（失败抛错） */
export async function httpFetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const result = await httpFetch({ url, method: "GET", responseType: "text", timeoutMs });
  if (!result.ok) {
    throw new Error(`HTTP ${result.status} ${result.statusText}`.trim());
  }
  try {
    return JSON.parse(result.body ?? "") as T;
  } catch {
    throw new Error(t("errors.network.invalidJson"));
  }
}
