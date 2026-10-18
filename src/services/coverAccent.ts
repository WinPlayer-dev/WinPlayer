/**
 * 跟随封面取色的动态强调色（可选设置，默认关闭）。
 *
 * 复用图片磁盘缓存、不额外联网：把当前播放封面的原图 URL 交给 Rust 端，
 * 在已落盘的缓存封面上提取主色；前端把主色换算成一组强调色变量内联覆盖
 * 到 :root，关闭开关或取色失败时移除覆盖、回退主题默认强调色。
 */

import { invoke } from "@tauri-apps/api/core";
import { resolveImgUrl } from "@/services/imageCache";

/** 由封面取色覆盖的强调色变量（与 tokens.css 中的定义一一对应） */
const ACCENT_VARS = [
  "--wp-accent",
  "--wp-accent-hover",
  "--wp-accent-active",
  "--wp-accent-light",
  "--wp-accent-text",
] as const;

/** 清除封面取色覆盖，恢复主题默认强调色 */
export function clearAccent(): void {
  const style = document.documentElement.style;
  for (const name of ACCENT_VARS) style.removeProperty(name);
}

/**
 * 从封面提取主色并应用；enabled=false 或无封面时清除覆盖。
 * 主色提取仅查磁盘缓存（不联网），未命中返回 null 时保持现状。
 */
export async function refreshAccentFromCover(
  cover: string | null | undefined,
  enabled: boolean,
): Promise<void> {
  if (!enabled || !cover) {
    clearAccent();
    return;
  }
  const url = resolveImgUrl(cover);
  const hex = url ? await extractColor(url) : null;
  if (hex) applyAccent(hex);
}

/** 提取主色；封面没落盘（如「图片缓存」已关闭）时先预取进缓存再取一次 */
async function extractColor(url: string): Promise<string | null> {
  const first = await invoke<string | null>("cover_dominant_color", { url }).catch(() => null);
  if (first) return first;
  const prefetched = await invoke("image_cache_prefetch", { url })
    .then(() => true)
    .catch(() => false);
  if (!prefetched) return null;
  return invoke<string | null>("cover_dominant_color", { url }).catch(() => null);
}

/** 把主色换算成整套强调色变量：hover/active 依亮暗主题做亮/暗偏移 */
function applyAccent(hex: string): void {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    clearAccent();
    return;
  }
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark";
  // 亮色主题下 hover/active 变亮（参考 WinUI 默认色阶），暗色主题下变暗
  const dir = dark ? -1 : 1;
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const text = luminance > 0.55 ? "#000000" : "#ffffff";
  const style = root.style;
  style.setProperty("--wp-accent", hex);
  style.setProperty("--wp-accent-hover", shiftLightness(hex, 0.07 * dir));
  style.setProperty("--wp-accent-active", shiftLightness(hex, 0.14 * dir));
  style.setProperty("--wp-accent-light", `rgba(${r}, ${g}, ${b}, ${dark ? 0.14 : 0.1})`);
  style.setProperty("--wp-accent-text", text);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

/** 亮度偏移（delta 为 HSL 亮度增量，正亮负暗），返回 #rrggbb */
function shiftLightness(hex: string, delta: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(...rgb);
  const [r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, l + delta)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
