/**
 * 快捷键工具函数：按键归一化、事件 ↔ 绑定互转、可读文本格式化。
 *
 * 全局按键监听在 ShortcutHost.vue 中挂载，这里只放无副作用的纯函数，
 * 便于设置页录制控件与全局处理共用同一套匹配规则。
 */

import { t } from "@/i18n";
import type { ShortcutBinding } from "@/types/shortcut";

/** 单按修饰键本身不构成有效绑定，需继续等待真实按键 */
const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "altgraph", "capslock"]);

/** 输入法 / 无效按键，录制时忽略 */
const IGNORED_KEYS = new Set(["", "process", "unidentified", "dead", "compose"]);

/** 特殊按键的展示文本 */
const KEY_LABELS: Record<string, string> = {
  space: t("shortcuts.key.space"),
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

/** 归一化 KeyboardEvent.key：空格统一为 "space"，其余转小写 */
export function normalizeKey(key: string): string {
  if (key === " " || key === "Spacebar" || key === "Space") return "space";
  return key.toLowerCase();
}

/** 从键盘事件提取绑定；仅按修饰键或无效按键时返回 null */
export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (MODIFIER_KEYS.has(key) || IGNORED_KEYS.has(key)) return null;
  return {
    key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

/** 键盘事件是否命中给定绑定（要求修饰键完全一致） */
export function matchesBinding(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  return (
    normalizeKey(event.key) === binding.key &&
    event.ctrlKey === binding.ctrl &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt &&
    event.metaKey === binding.meta
  );
}

/** 是否为空格键（且未按任何修饰键） */
export function isPlainSpace(event: KeyboardEvent): boolean {
  return (
    normalizeKey(event.key) === "space" &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey
  );
}

/** 单个按键 → 展示文本 */
export function formatKey(key: string): string {
  const label = KEY_LABELS[key];
  if (label) return label;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** 绑定 → 可读文本，如「Ctrl + ←」「Ctrl + Shift + P」；未绑定时为空串 */
export function formatBinding(binding: ShortcutBinding | null): string {
  if (!binding) return "";
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  if (binding.meta) parts.push("Win");
  parts.push(formatKey(binding.key));
  return parts.join(" + ");
}

/** 焦点是否位于可编辑区域（输入框 / 文本域 / 下拉框 / contenteditable） */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}

/** 焦点是否位于可交互控件（按钮 / 链接等，空格应保留其原生激活行为） */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      "button, a[href], summary, [role='button'], [role='link'], [role='slider'], " +
        "[role='checkbox'], [role='switch'], [role='menuitem'], [role='menuitemcheckbox'], " +
        "[role='menuitemradio'], [role='tab'], [role='option']",
    ) !== null
  );
}

/** 校验从数据库读出的值是否为合法绑定 */
export function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    typeof candidate.ctrl === "boolean" &&
    typeof candidate.shift === "boolean" &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.meta === "boolean"
  );
}
