/** 轻量 Toast 通知 */

import { reactive } from "vue";

export interface ToastItem {
  id: number;
  message: string;
  type: "info" | "success" | "error";
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });

let counter = 0;

export function toast(
  message: string,
  type: ToastItem["type"] = "info",
  duration?: number,
): void {
  counter += 1;
  const item: ToastItem = { id: counter, message, type };
  state.items.push(item);
  // 错误信息通常较长，停留更久以便完整阅读
  const actual = duration ?? (type === "error" ? 6500 : 3200);
  window.setTimeout(() => {
    const index = state.items.findIndex((t) => t.id === item.id);
    if (index >= 0) state.items.splice(index, 1);
  }, actual);
}

/**
 * 手动收掉一条 Toast（长任务用：先弹「正在导入…」，结束后原地替换成结果）。
 * id 无效时静默忽略。
 */
export function dismissToast(id: number): void {
  const index = state.items.findIndex((t) => t.id === id);
  if (index >= 0) state.items.splice(index, 1);
}

/**
 * 打开一条不自动消失的 Toast，返回它的 id（配合 [`dismissToast`] 收尾）。
 * 用于导入 / 导出这类耗时操作，避免用户以为卡住了。
 */
export function toastSticky(message: string, type: ToastItem["type"] = "info"): number {
  counter += 1;
  state.items.push({ id: counter, message, type });
  return counter;
}

export function useToasts(): ToastItem[] {
  return state.items;
}
