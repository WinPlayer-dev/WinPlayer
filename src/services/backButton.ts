/**
 * Android 返回键统一分发。
 *
 * `onBackButtonPress` 一旦注册就会接管系统默认行为（默认是直接退出 Activity），
 * 所以整个应用只在 App.vue 注册一次；页面 / 浮层通过 registerBackInterceptor
 * 插入自己的处理层，按「后注册先执行」的顺序逐层消费。
 */

import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";
import type { Router } from "vue-router";

/** 返回 true 表示本层已经消费掉这次返回，不再向下传递 */
export type BackInterceptor = () => boolean | Promise<boolean>;

const interceptors: BackInterceptor[] = [];

/**
 * 注册一层返回拦截，返回注销函数。
 * 后注册的层先执行（页面内对话框晚于全局菜单挂载，因此先于菜单被关闭）。
 */
export function registerBackInterceptor(fn: BackInterceptor): () => void {
  interceptors.push(fn);
  return () => {
    const index = interceptors.indexOf(fn);
    if (index >= 0) interceptors.splice(index, 1);
  };
}

/**
 * 当前是否还有上一页。
 * 用 router 自己的 history 实例读游标（createWebHashHistory 的 state.back），
 * 比直接读 window.history.state 可靠：后者在 WebView 里可能被首帧的
 * replaceState 覆盖成不含 back 的对象。null 表示栈底（冷启动 / 通知直达）。
 */
export function canGoHistoryBack(router: Router): boolean {
  return router.options.history.state.back != null;
}

/** 返回上一页；没有历史记录时回首页，避免直接退出应用 */
export function navigateBack(router: Router): void {
  if (canGoHistoryBack(router)) router.back();
  else void router.replace("/");
}

/** 连按两次返回才退出应用的时间窗口（毫秒） */
const EXIT_WINDOW = 2000;

let listener: PluginListener | null = null;
let lastBackAt = 0;

async function dispatch(router: Router, onExitHint: () => void): Promise<void> {
  // 由内到外逐层询问：浮层 → 页面 → 路由
  for (let index = interceptors.length - 1; index >= 0; index -= 1) {
    try {
      if (await interceptors[index]?.()) return;
    } catch (error) {
      console.warn("[back] 拦截器执行失败", error);
    }
  }

  // 页面栈还有上一页：直接回去（与系统手势的直觉一致）
  if (canGoHistoryBack(router)) {
    router.back();
    return;
  }

  // 已在栈底：连按两次才退出，避免误触关掉正在后台播放的音乐
  const now = Date.now();
  if (now - lastBackAt < EXIT_WINDOW) {
    lastBackAt = 0;
    await exit(0);
    return;
  }
  lastBackAt = now;
  onExitHint();
}

/** 安装全局返回键监听（仅移动端、只调用一次） */
export async function installBackButton(router: Router, onExitHint: () => void): Promise<void> {
  if (listener) return;
  try {
    listener = await onBackButtonPress(() => void dispatch(router, onExitHint));
  } catch {
    /* 非 Android 平台 / 非 Tauri 环境：不支持返回键，忽略 */
  }
}

/** 卸载监听（应用退出时调用） */
export async function uninstallBackButton(): Promise<void> {
  const current = listener;
  listener = null;
  lastBackAt = 0;
  try {
    await current?.unregister();
  } catch {
    /* 忽略：监听可能已随 WebView 一起销毁 */
  }
}
