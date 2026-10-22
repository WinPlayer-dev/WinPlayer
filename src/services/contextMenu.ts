/** 内嵌右键菜单（替代 WebView 原生菜单） */

import { reactive } from "vue";

export interface ContextMenuItem {
  key: string;
  label: string;
  /** Fluent Icons 码点实体，如 "&#xF4A4;" */
  icon?: string;
  /** 使用 Filled 填充字重的字形（播放/暂停/红心等） */
  filled?: boolean;
  danger?: boolean;
  disabled?: boolean;
  action: () => void | Promise<unknown>;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  /** 移动端底部面板的标题（如歌曲名 / 歌单名）；桌面浮出菜单不显示标题 */
  title: string;
  items: ContextMenuItem[];
}

export const contextMenuState = reactive<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  title: "",
  items: [],
});

/**
 * 在指定坐标打开内嵌菜单（长按等无鼠标事件的触摸场景）
 * @param title 移动端底部面板标题，留空则不显示标题行
 */
export function openContextMenuAt(
  x: number,
  y: number,
  items: ContextMenuItem[],
  title = "",
): void {
  if (!items.length) return;
  contextMenuState.x = x;
  contextMenuState.y = y;
  contextMenuState.title = title;
  contextMenuState.items = items;
  contextMenuState.visible = true;
}

/** 在鼠标位置打开内嵌右键菜单 */
export function openContextMenu(
  event: MouseEvent,
  items: ContextMenuItem[],
  title = "",
): void {
  event.preventDefault();
  openContextMenuAt(event.clientX, event.clientY, items, title);
}

export function closeContextMenu(): void {
  contextMenuState.visible = false;
}
