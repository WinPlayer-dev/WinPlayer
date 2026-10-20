/**
 * 系统级全局快捷键桥接（桌面端）。
 *
 * Rust 侧（src-tauri/src/global_shortcuts.rs）用 tauri-plugin-global-shortcut
 * 注册系统热键，命中后：
 * - 「播放 / 暂停」直接驱动原生引擎，WebView 未就绪也有效；
 * - 「上一首 / 下一首」复用托盘的 `app://tray-action` 事件，走前端切歌逻辑；
 * - 无论哪个动作，都会广播 `app://global-hotkey`，前端据此屏蔽同一次按键的
 *   应用内处理（避免窗口在前台时切两次歌）。
 *
 * 本模块只负责把绑定推给 Rust 并回传注册结果；应用内快捷键仍在 stores/shortcuts。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBinding } from "@/services/shortcuts";
import type { GlobalShortcutMap, ShortcutActionId, ShortcutBinding } from "@/types/shortcut";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 全局热键命中事件（Rust → 前端） */
const EVENT_GLOBAL_HOTKEY = "app://global-hotkey";

/** 一次注册的结果 */
export interface GlobalShortcutStatus {
  /** 动作 ID（playPause / prev / next） */
  action: string;
  /** 组合键文本 */
  accelerator: string;
  /** 是否注册成功（被占用时为 false） */
  registered: boolean;
  /** 失败原因 */
  error: string | null;
}

/** 命中事件载荷 */
interface GlobalHotkeyPayload {
  action: string;
  at: number;
}

/** 全局热键动作 → 应用内动作（用于把「播放 / 暂停」映射到播放器） */
const GLOBAL_TO_LOCAL: Record<string, ShortcutActionId | "playPause"> = {
  playPause: "playPause",
  prev: "prev",
  next: "next",
};

/** 最近一次全局热键命中的时间戳（毫秒），用于屏蔽同一按键的应用内处理 */
let lastHitAt = 0;
let lastHitAction: string | null = null;

/** 应用内快捷键处理时调用：判断这次按键是否刚被全局热键处理过 */
export function consumeGlobalHit(action: ShortcutActionId): boolean {
  if (!lastHitAction) return false;
  const expires = lastHitAt + 400;
  if (Date.now() > expires) {
    lastHitAction = null;
    return false;
  }
  // 全局键与本地键可能不是同一个动作（例如用户把全局「下一首」设成 Ctrl+Alt+→，
  // 而应用内「下一首」也是 Ctrl+→）：只有当被按下的组合键确实等于当前绑定、
  // 且全局动作与之对应时才算重复，这里由调用方传入匹配到的动作 ID 判断。
  if (GLOBAL_TO_LOCAL[lastHitAction] !== action) return false;
  lastHitAction = null;
  return true;
}

/**
 * 把全局快捷键绑定推给 Rust 重建注册表。
 *
 * 只注册有绑定的项；绑定文本用 `formatBinding`（与设置页展示一致），
 * Rust 侧负责把 `Win` / `←` 这些写法换成系统 accelerator。
 */
export async function applyGlobalShortcuts(
  map: GlobalShortcutMap,
): Promise<GlobalShortcutStatus[]> {
  if (!inTauri) return [];
  const bindings: Record<string, string> = {};
  for (const [action, binding] of Object.entries(map)) {
    const text = binding ? formatBinding(binding as ShortcutBinding) : "";
    if (text) bindings[action] = text;
  }
  try {
    return await invoke<GlobalShortcutStatus[]>("global_shortcut_apply", { bindings });
  } catch (error) {
    console.warn("[global-shortcut] 注册失败：", error);
    return [];
  }
}

/** 查询当前实际生效的全局热键 */
export async function globalShortcutStatus(): Promise<GlobalShortcutStatus[]> {
  if (!inTauri) return [];
  try {
    return await invoke<GlobalShortcutStatus[]>("global_shortcut_status");
  } catch {
    return [];
  }
}

/** 订阅全局热键命中事件（应用启动时调用一次） */
export async function initGlobalShortcutEvents(): Promise<() => void> {
  if (!inTauri) return () => {};
  const unlisten = await listen<GlobalHotkeyPayload>(EVENT_GLOBAL_HOTKEY, (event) => {
    lastHitAt = Date.now();
    lastHitAction = event.payload?.action ?? null;
  });
  return unlisten;
}
