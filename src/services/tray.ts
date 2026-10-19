/**
 * 系统托盘桥接（仅 Windows 桌面）。
 *
 * 前端与 Rust 侧托盘（src-tauri/src/tray.rs + commands/tray.rs）的双向通道：
 *
 * - Rust → 前端：
 *   - `app://visibility`（bool）——窗口隐藏/恢复，驱动后台优化模式；
 *   - `app://tray-action`（"next" | "previous"）——托盘菜单切歌。播放/暂停
 *     由 Rust 直接驱动原生引擎（不经过 WebView），无需前端处理。
 * - 前端 → Rust（invoke）：
 *   - `tray_set_close_behavior` —— 把「关闭行为」设置同步给关闭拦截；
 *   - `tray_set_tooltip` —— 切歌后把「歌名」同步到托盘图标悬浮提示；
 *   - `tray_quit` —— 退出应用（前端「退出」入口用）。
 *
 * 非 Windows 平台：所有函数安全 no-op，不产生无效 invoke。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { watch, type WatchStopHandle } from "vue";
import { setAppHidden } from "@/services/backgroundMode";
import { useIsWindows } from "@/composables/useIsMobile";
import type { UnifiedTrack } from "@/types/plugin";
import type { CloseBehavior } from "@/stores/settings";

/** Rust → 前端事件名（见 src-tauri/src/tray.rs） */
const VISIBILITY_EVENT = "app://visibility";
const ACTION_EVENT = "app://tray-action";

/** 非 Tauri 环境降级 */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const onWindows = useIsWindows();

/** 服务需要的播放器能力（避免反向依赖 store 造成循环引用） */
export interface TrayPlayer {
  readonly currentTrack: UnifiedTrack | null;
  readonly playing: boolean;
  next(): Promise<void>;
  prev(): Promise<void>;
}

let player: TrayPlayer | null = null;
let started = false;
let stopWatch: WatchStopHandle | null = null;
let stopVisibility: (() => void) | null = null;
let stopAction: (() => void) | null = null;

/** 把「关闭行为」同步给 Rust 关闭拦截（设置加载与变更时调用） */
export async function setCloseBehavior(behavior: CloseBehavior): Promise<void> {
  if (!inTauri || !onWindows) return;
  try {
    await invoke("tray_set_close_behavior", { behavior });
  } catch (error) {
    console.warn("[tray] 同步关闭行为失败：", error);
  }
}

/** 更新托盘 tooltip 为「歌名」（空/无曲目时回落为应用名） */
async function syncTooltip(track: UnifiedTrack | null): Promise<void> {
  if (!inTauri || !onWindows) return;
  const title = track?.name?.trim() ?? "";
  try {
    await invoke("tray_set_tooltip", { text: title });
  } catch (error) {
    console.warn("[tray] 更新托盘提示失败：", error);
  }
}

/** 退出应用（用于托盘/设置里的退出入口） */
export async function quitToTrayQuit(): Promise<void> {
  if (!inTauri) return;
  try {
    await invoke("tray_quit");
  } catch (error) {
    console.warn("[tray] 退出失败：", error);
  }
}

/**
 * 初始化托盘桥接（应用启动时调用一次）：
 * 注册可见性/切歌事件监听，并跟随曲目变化刷新托盘提示。
 */
export async function initTray(target: TrayPlayer): Promise<void> {
  player = target;
  if (started || !inTauri || !onWindows) return;
  started = true;

  // Rust 主动广播窗口显示/隐藏：驱动后台优化模式（首选，远胜于依赖
  // WebView 的 visibilitychange——窗口被 hide() 时不保证触发）
  stopVisibility = await listen<boolean>(VISIBILITY_EVENT, (event) => {
    setAppHidden(!event.payload);
  });

  // 托盘菜单「上一首 / 下一首」：与界面按钮同源，走前端切歌逻辑
  stopAction = await listen<string>(ACTION_EVENT, (event) => {
    const targetPlayer = player;
    if (!targetPlayer) return;
    if (event.payload === "next") void targetPlayer.next();
    else if (event.payload === "previous") void targetPlayer.prev();
  });

  // 曲目 / 播放状态变化 → 刷新托盘提示（工具提示只显示歌名即可，简洁）
  stopWatch = watch(
    [() => target.currentTrack?.name, () => target.playing],
    ([name]) => void syncTooltip(name ? target.currentTrack : null),
    { immediate: true },
  );
}

/** 卸载托盘桥接 */
export function disposeTray(): void {
  stopWatch?.();
  stopWatch = null;
  void stopVisibility?.();
  stopVisibility = null;
  void stopAction?.();
  stopAction = null;
  started = false;
  player = null;
}