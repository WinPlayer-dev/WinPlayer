/**
 * 窗口状态记忆（尺寸 / 位置 / 最大化）：仅 Tauri 桌面端有意义。
 *
 * 实际的读写都在 Rust 侧（src-tauri/src/window_state.rs）：启动时自动还原，
 * 之后在拖动 / 缩放 / 最大化时防抖落盘，无需前端参与。这里只负责把
 * 「记住窗口大小与位置」设置项同步给 Rust，以及提供「重置」入口。
 *
 * 非 Tauri 环境（浏览器里跑 vite dev）所有函数安全 no-op。
 */

import { invoke } from "@tauri-apps/api/core";
import { useIsMobile } from "@/composables/useIsMobile";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** 移动端窗口由系统管理，不做记忆 */
const onDesktop = !useIsMobile();

/** 同步「记住窗口大小与位置」开关（关闭后不再写盘，已有存档保留） */
export async function setWindowStateEnabled(enabled: boolean): Promise<void> {
  if (!inTauri || !onDesktop) return;
  try {
    await invoke("window_state_set_enabled", { enabled });
  } catch (error) {
    console.warn("[window-state] 同步开关失败：", error);
  }
}

/** 是否已有窗口状态存档（"暂无记录" / "已记住"） */
export async function hasSavedWindowState(): Promise<boolean> {
  if (!inTauri || !onDesktop) return false;
  try {
    return await invoke<boolean>("window_state_saved");
  } catch {
    return false;
  }
}

/** 清空存档并把窗口恢复成默认尺寸并居中 */
export async function resetWindowState(): Promise<void> {
  if (!inTauri || !onDesktop) return;
  await invoke("window_state_reset");
}
