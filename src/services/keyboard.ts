/**
 * 移动端软键盘适配。
 *
 * 背景：WebView 里键盘弹起时，不同布局模式对页面的影响完全不同，
 * 而项目此前没有做任何处理（全局搜不到 visualViewport）：
 *
 * - **adjustResize**（Android 常见）：窗口高度被压缩，页面跟着变矮。
 *   内容本身不会被遮挡，**不需要**再补任何留白。
 * - **adjustPan**（含 iOS WebView）：窗口尺寸不变，只是把可视区向上平移，
 *   页面底部有一段被键盘盖住。位于其后的输入框怎么滚都露不出来，
 *   必须给滚动容器补等量底部留白。
 *
 * 因此判定分两步，用**基线高度**（无键盘时的视口高度）做参照：
 *
 *     resizeShrink = baseline − window.innerHeight      // 窗口变矮 → adjustResize
 *     panShrink    = baseline − 可视区底边                // 只是被遮盖 → adjustPan
 *
 * - adjustResize：两者同时变大，按 resizeShrink 判定，补白取 0；
 * - adjustPan：resizeShrink 为 0，补白取 panShrink。
 *
 * 基线取「遇到过的最大窗口高度」，横竖屏切换（宽高互换）时重置。
 * 地址栏收起也会让视口变高，但幅度远小于 KEYBOARD_MIN_HEIGHT，不会误判。
 *
 * 产出：
 * - `<html class="keyboard-open">`：键盘弹起期间供 CSS 使用；
 * - `--keyboard-inset`：**需要额外补的**底部留白（adjustResize 下为 0）。
 */

/** 键盘高度小于该值视为噪声（地址栏抖动、滚动导致的可视区微变） */
const KEYBOARD_MIN_HEIGHT = 120;
/** 输入框与可视区底边之间希望保留的间隙 */
const SAFE_GAP = 24;
/** 键盘弹出动画结束后再校正一次的延时（毫秒） */
const SETTLE_DELAYS = [120, 360];

let installed = false;
let open = false;
/** 无键盘时的视口高度基线 */
let baseline = 0;
/** 上一次的视口宽度，用于识别横竖屏切换 */
let lastWidth = 0;
let rafId: number | null = null;
const timers: number[] = [];

function visualViewport(): VisualViewport | null {
  return window.visualViewport ?? null;
}

/** 可视区底边在窗口坐标系中的位置 */
function visibleBottom(): number {
  const viewport = visualViewport();
  if (!viewport) return window.innerHeight;
  return viewport.height + viewport.offsetTop;
}

/**
 * 需要额外补的底部留白（px）。
 * adjustResize 下窗口已经变矮，返回 0；只有 adjustPan 才需要补。
 */
export function keyboardInset(): number {
  if (!installed) return 0;
  const resizeShrink = Math.max(0, baseline - window.innerHeight);
  // adjustResize：窗口已经变矮，页面自己就收窄了，不能再补白
  if (resizeShrink >= KEYBOARD_MIN_HEIGHT) return 0;
  const panShrink = Math.max(0, baseline - visibleBottom());
  // 低于阈值的高度是地址栏抖动 / 滚动引起的可视区微变，不是键盘
  if (panShrink < KEYBOARD_MIN_HEIGHT) return 0;
  return Math.round(panShrink);
}

/** 键盘是否处于打开状态（两种布局模式都算） */
export function isKeyboardOpen(): boolean {
  return open;
}

/** 从元素向上找到第一个可滚动的祖先容器 */
function findScroller(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function isTextEntry(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  // 单选 / 复选 / 按钮类输入不会弹出键盘
  return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(element.type);
}

/**
 * 确保正在输入的控件完整落在可视区内。
 * 只滚动最近的滚动容器（页面 / 对话框内容区），不做整页 scrollIntoView，
 * 避免把用户正在看的上下文位置整个换掉。
 */
function ensureFocusedVisible(): void {
  if (!open) return;
  const active = document.activeElement;
  if (!isTextEntry(active)) return;

  const overlap = active.getBoundingClientRect().bottom - visibleBottom() + SAFE_GAP;
  if (overlap <= 0) return;

  const scroller = findScroller(active);
  if (scroller) scroller.scrollTop += overlap;
  else window.scrollBy(0, overlap);
}

function clearTimers(): void {
  while (timers.length) {
    const id = timers.pop();
    if (id !== undefined) window.clearTimeout(id);
  }
}

/** 键盘状态稳定后（弹出动画结束）再校正一次布局 */
function scheduleSettle(): void {
  clearTimers();
  for (const delay of SETTLE_DELAYS) {
    timers.push(window.setTimeout(ensureFocusedVisible, delay));
  }
}

/** 横竖屏切换：宽高互换，旧基线失效，按当前高度重建 */
function syncBaseline(): void {
  const width = window.innerWidth;
  if (width !== lastWidth) {
    lastWidth = width;
    baseline = window.innerHeight;
    return;
  }
  // 只在「当前确实没有键盘」时校准基线，且取窗口高度与可视区底边中较小的那个：
  // 键盘弹起期间窗口会变矮（adjustResize），此时把窗口高度记成基线，
  // 键盘收起后就再也检测不到下一次键盘。
  if (open) return;
  const candidate = Math.min(window.innerHeight, visibleBottom());
  if (candidate > baseline) baseline = candidate;
}

function apply(): void {
  syncBaseline();

  const resizeShrink = Math.max(0, baseline - window.innerHeight);
  const panShrink = Math.max(0, baseline - visibleBottom());
  const nextOpen = Math.max(resizeShrink, panShrink) >= KEYBOARD_MIN_HEIGHT;
  const inset = keyboardInset();
  const root = document.documentElement;

  if (nextOpen !== open) {
    open = nextOpen;
    root.classList.toggle("keyboard-open", open);
    // 键盘刚弹起才需要重新定位；收起后把输入框留在原位
    if (open) scheduleSettle();
    else clearTimers();
  }

  root.style.setProperty("--keyboard-inset", `${nextOpen ? inset : 0}px`);
}

function onViewportChange(): void {
  // resize / scroll 会在键盘动画的每一帧触发，合并到下一帧统一处理
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    apply();
  });
}

function onFocusIn(): void {
  // 聚焦后 visualViewport 可能还没更新，这里先同步一次，settle 定时器再兜底
  window.setTimeout(() => {
    apply();
    ensureFocusedVisible();
  }, 0);
}

/**
 * 安装键盘适配（仅移动端调用，桌面端不安装）。
 * 重复调用无副作用。
 */
export function installKeyboardInset(): void {
  if (installed) return;
  const viewport = visualViewport();
  if (!viewport) return; // 极老的 WebView：保持原状，不做任何假设
  installed = true;
  baseline = window.innerHeight;
  lastWidth = window.innerWidth;

  viewport.addEventListener("resize", onViewportChange);
  viewport.addEventListener("scroll", onViewportChange);
  document.addEventListener("focusin", onFocusIn);
  // 键盘收起后焦点可能仍在输入框上，此时不需要再滚动
  document.addEventListener("focusout", onViewportChange);
  apply();
}

/** 卸载监听并复原（应用退出 / 热重载时调用） */
export function uninstallKeyboardInset(): void {
  if (!installed) return;
  installed = false;
  const viewport = visualViewport();
  viewport?.removeEventListener("resize", onViewportChange);
  viewport?.removeEventListener("scroll", onViewportChange);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onViewportChange);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearTimers();
  open = false;
  const root = document.documentElement;
  root.classList.remove("keyboard-open");
  root.style.removeProperty("--keyboard-inset");
}
