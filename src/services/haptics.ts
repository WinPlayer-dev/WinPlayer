/**
 * 触感反馈（震动）。
 *
 * 基于 WebView 的 navigator.vibrate()，不引入原生插件：
 * - 仅在移动端生效（桌面端直接 no-op，避免影响鼠标交互）
 * - 可在设置中关闭（settings.hapticsEnabled）
 * - 所有调用都吞掉异常：部分 WebView 在无权限 / 无马达时会抛错
 */

import { useIsMobile } from "@/composables/useIsMobile";

/** 桌面端一律不震动（即便浏览器提供了 vibrate） */
const mobile = useIsMobile();
const supported =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** 用户开关；默认开启，由设置同步 */
let enabled = true;

/** 由设置同步开关状态 */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function isHapticsEnabled(): boolean {
  return enabled;
}

function vibrate(pattern: number | number[]): void {
  if (!mobile || !enabled || !supported) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 忽略：无马达 / 无权限 / 非安全上下文 */
  }
}

/** 轻触：切换类操作（点赞、播放模式、标签切换） */
export function hapticTap(): void {
  vibrate(10);
}

/** 中等反馈：长按唤起菜单、触发下拉刷新 */
export function hapticImpact(): void {
  vibrate(18);
}

/** 成功反馈：点赞成功、加入歌单等 */
export function hapticSuccess(): void {
  vibrate([12, 32, 18]);
}
