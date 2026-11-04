/**
 * 演示模式（录屏 / 截图用）
 *
 * 打开后：
 * - 界面上所有播放源名称统一显示成 {@link DEMO_SOURCE_NAME}，不再暴露具体插件；
 * - 歌单 / 平台歌单的入口（侧边栏、我的页、「添加到歌单」菜单与选择器）整体不显示。
 *
 * 只影响「显示」，不改动任何数据：歌单本身、插件、播放链路照常。
 * 状态由 settings store 单向写入（与 haptics 同一套路），services 层不反向依赖 store，
 * 因此任何组件 / 工具函数都能安全地读 {@link demoMode}。
 */

import { ref } from "vue";

/** 演示模式下所有来源统一显示的名字 */
export const DEMO_SOURCE_NAME = "在线音乐";

/** 是否处于演示模式（响应式：模板 / computed 里直接读即可） */
export const demoMode = ref(false);

/** 由 settings store 在加载与切换时调用 */
export function setDemoModeState(value: boolean): void {
  demoMode.value = Boolean(value);
}

/** 把插件名换成演示模式下的通用名（关闭演示模式时原样返回） */
export function demoName(name: string | undefined | null): string {
  if (!demoMode.value) return name ?? "";
  return DEMO_SOURCE_NAME;
}
