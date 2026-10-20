/** 键盘快捷键设置：可配置动作的绑定与全局按键处理（持久化于 SQLite settings 表） */

import { defineStore } from "pinia";
import { ref } from "vue";
import { getSetting, setSetting } from "@/services/db";
import {
  isEditableTarget,
  isInteractiveTarget,
  isPlainSpace,
  isShortcutBinding,
  matchesBinding,
} from "@/services/shortcuts";
import {
  GLOBAL_SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS,
  VOLUME_STEP,
  defaultGlobalShortcutMap,
  defaultShortcutMap,
  type GlobalShortcutActionId,
  type GlobalShortcutMap,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutMap,
} from "@/types/shortcut";
import {
  applyGlobalShortcuts,
  consumeGlobalHit,
  initGlobalShortcutEvents,
  type GlobalShortcutStatus,
} from "@/services/globalShortcuts";
import { usePlayerStore } from "./player";

/** 设置表键名 */
const SETTING_KEY = "settings.shortcuts";
/** 全局快捷键相关设置（开关 + 绑定 + 是否已初始化过的标记） */
const GLOBAL_ENABLED_KEY = "settings.globalShortcutsEnabled";
const GLOBAL_BINDINGS_KEY = "settings.globalShortcuts";

export const useShortcutsStore = defineStore("shortcuts", () => {
  const bindings = ref<ShortcutMap>(defaultShortcutMap());
  /** 是否正在录制：录制期间全局监听让位于设置页的录制控件 */
  const capturing = ref(false);

  /** 系统级全局快捷键是否启用（仅桌面端；移动端恒为 false） */
  const globalEnabled = ref(true);
  /** 全局快捷键绑定（null 表示该项不注册） */
  const globalBindings = ref<GlobalShortcutMap>(defaultGlobalShortcutMap());
  /** Rust 侧返回的注册结果：哪些组合键真的生效了 */
  const globalStatus = ref<GlobalShortcutStatus[]>([]);

  /** 全局热键事件监听清理函数 */
  let disposeGlobalEvents: (() => void) | null = null;

  /**
   * 这次按键是否落在某个「已成功注册」的全局热键上。
   *
   * 依赖事件通知去重会有时序问题（Rust 广播到 WebView 走 IPC，可能晚于
   * WebView 自己的 keydown），所以这里用「同一次按键必然同时匹配」这一
   * 确定事实做兜底：命中已生效的全局热键就交给 Rust 处理，应用内不再重复。
   * 注册失败的项不算（否则两边都不响应，按键等于失效）。
   */
  function matchesRegisteredGlobal(event: KeyboardEvent): boolean {
    if (!globalEnabled.value) return false;
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      const binding = globalBindings.value[action.id];
      if (!binding) continue;
      if (!statusFor(action.id)?.registered) continue;
      if (matchesBinding(event, binding)) return true;
    }
    return false;
  }

  /* ------------------------------ 持久化 ------------------------------ */

  async function load(): Promise<void> {
    const saved = await getSetting<Partial<Record<ShortcutActionId, unknown>>>(SETTING_KEY, {});
    const map = defaultShortcutMap();
    for (const action of SHORTCUT_ACTIONS) {
      if (!(action.id in saved)) continue;
      const value = saved[action.id];
      // null 表示用户显式清除；非法值回退到默认绑定
      if (value === null) map[action.id] = null;
      else if (isShortcutBinding(value)) map[action.id] = value;
    }
    bindings.value = map;

    // 全局快捷键：开关 + 绑定，读到后推给 Rust 重建注册表
    globalEnabled.value = await getSetting<boolean>(GLOBAL_ENABLED_KEY, true);
    const savedGlobal = await getSetting<Partial<Record<GlobalShortcutActionId, unknown>>>(
      GLOBAL_BINDINGS_KEY,
      {},
    );
    const globalMap = defaultGlobalShortcutMap();
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      if (!(action.id in savedGlobal)) continue;
      const value = savedGlobal[action.id];
      if (value === null) globalMap[action.id] = null;
      else if (isShortcutBinding(value)) globalMap[action.id] = value;
    }
    globalBindings.value = globalMap;
    await syncGlobalShortcuts();
  }

  /** 把当前全局快捷键状态推给 Rust（开关关闭时传空表 → 全部注销） */
  async function syncGlobalShortcuts(): Promise<void> {
    if (!globalEnabled.value) {
      globalStatus.value = await applyGlobalShortcuts(
        Object.fromEntries(
          GLOBAL_SHORTCUT_ACTIONS.map((action) => [action.id, null]),
        ) as GlobalShortcutMap,
      );
      return;
    }
    globalStatus.value = await applyGlobalShortcuts(globalBindings.value);
  }

  /** 订阅 Rust 的全局热键命中事件（应用启动时调用一次） */
  async function initGlobalEvents(): Promise<void> {
    if (disposeGlobalEvents) return;
    disposeGlobalEvents = await initGlobalShortcutEvents();
  }

  /** 开关系统级全局快捷键 */
  async function setGlobalEnabled(value: boolean): Promise<void> {
    globalEnabled.value = value;
    await setSetting(GLOBAL_ENABLED_KEY, value);
    await syncGlobalShortcuts();
  }

  /** 设置某个全局动作的组合键 */
  async function setGlobalBinding(
    id: GlobalShortcutActionId,
    binding: ShortcutBinding,
  ): Promise<void> {
    globalBindings.value = { ...globalBindings.value, [id]: binding };
    await setSetting(GLOBAL_BINDINGS_KEY, globalBindings.value);
    await syncGlobalShortcuts();
  }

  /** 清除某个全局动作的组合键（不再注册该系统热键） */
  async function clearGlobalBinding(id: GlobalShortcutActionId): Promise<void> {
    if (globalBindings.value[id] === null) return;
    globalBindings.value = { ...globalBindings.value, [id]: null };
    await setSetting(GLOBAL_BINDINGS_KEY, globalBindings.value);
    await syncGlobalShortcuts();
  }

  /** 全局快捷键恢复默认 */
  async function resetGlobalDefaults(): Promise<void> {
    globalBindings.value = defaultGlobalShortcutMap();
    await setSetting(GLOBAL_BINDINGS_KEY, globalBindings.value);
    await syncGlobalShortcuts();
  }

  /** 某动作的注册状态（未启用时为 undefined） */
  function statusFor(id: GlobalShortcutActionId): GlobalShortcutStatus | undefined {
    if (!globalEnabled.value) return undefined;
    return globalStatus.value.find((item) => item.action === id);
  }

  async function persist(): Promise<void> {
    await setSetting(SETTING_KEY, bindings.value);
  }

  /** 设置某动作的绑定 */
  async function setBinding(id: ShortcutActionId, binding: ShortcutBinding): Promise<void> {
    bindings.value = { ...bindings.value, [id]: binding };
    await persist();
  }

  /** 清除某动作的绑定 */
  async function clearBinding(id: ShortcutActionId): Promise<void> {
    if (bindings.value[id] === null) return;
    bindings.value = { ...bindings.value, [id]: null };
    await persist();
  }

  /** 全部恢复为默认绑定 */
  async function resetToDefaults(): Promise<void> {
    bindings.value = defaultShortcutMap();
    await persist();
  }

  /** 切换录制态（由设置页录制控件调用） */
  function setCapturing(value: boolean): void {
    capturing.value = value;
  }

  /* ------------------------------ 按键处理 ------------------------------ */

  /** 命中绑定则返回动作 ID；数组顺序即优先级，允许冲突时先注册者先匹配 */
  function actionForEvent(event: KeyboardEvent): ShortcutActionId | null {
    for (const action of SHORTCUT_ACTIONS) {
      const binding = bindings.value[action.id];
      if (binding && matchesBinding(event, binding)) return action.id;
    }
    return null;
  }

  /** 执行动作 */
  function runAction(action: ShortcutActionId): void {
    const player = usePlayerStore();
    switch (action) {
      case "prev":
        void player.prev();
        break;
      case "next":
        void player.next();
        break;
      case "volumeUp":
        void player.setVolume(player.volume + VOLUME_STEP);
        break;
      case "volumeDown":
        void player.setVolume(player.volume - VOLUME_STEP);
        break;
      case "cycleMode":
        player.cycleMode();
        break;
    }
  }

  /** 全局键盘处理（由 ShortcutHost 在 window 上挂载） */
  function handleKeydown(event: KeyboardEvent): void {
    // 录制中：交给设置页的录制控件处理
    if (capturing.value) return;
    // 可编辑区域：不拦截，保留输入与光标移动等原生行为
    if (isEditableTarget(event.target)) return;
    // 命中已生效的全局热键：交给 Rust 处理，避免前台时执行两次
    if (matchesRegisteredGlobal(event)) return;

    const action = actionForEvent(event);
    if (action) {
      // 刚被系统级全局热键处理过（窗口在前台时同一次按键两边都会收到）：
      // 这里直接放行，避免切两次歌
      if (consumeGlobalHit(action)) return;
      // 音量允许长按连续调整，其余动作忽略自动重复以免连续切歌 / 切模式
      if (event.repeat && action !== "volumeUp" && action !== "volumeDown") return;
      event.preventDefault();
      runAction(action);
      return;
    }

    // 内置、不可设置的快捷键：空格播放 / 暂停（仅窗口在前台时生效）
    if (isPlainSpace(event)) {
      if (event.repeat) return;
      // 焦点在按钮等控件上时保留其原生空格行为（如激活按钮）
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      void usePlayerStore().togglePlay();
    }
  }

  return {
    bindings,
    capturing,
    globalEnabled,
    globalBindings,
    globalStatus,
    load,
    setBinding,
    clearBinding,
    resetToDefaults,
    setCapturing,
    initGlobalEvents,
    setGlobalEnabled,
    setGlobalBinding,
    clearGlobalBinding,
    resetGlobalDefaults,
    statusFor,
    actionForEvent,
    handleKeydown,
  };
});
