import { onBeforeUnmount } from "vue";
import { hapticImpact } from "@/services/haptics";

/**
 * 触摸长按手势。
 *
 * 移动端没有鼠标右键，用长按替代 contextmenu：
 * - 只响应非鼠标指针，桌面端（鼠标）行为完全不受影响
 * - 长按触发后浏览器仍会补发 click、甚至弹出系统上下文菜单，这里在捕获阶段
 *   一并拦截；但放行菜单自身（.ctx-menu）内部的点击，避免挡住用户选择菜单项
 *
 * 用法（每个实例可服务同组件的多个元素，通过回调在按下时绑定上下文）：
 * ```ts
 * const lp = useLongPress();
 * // @pointerdown="lp.start($event, () => openMenuAt(x, y))"
 * // @pointermove="lp.move" @pointerup="lp.end" @pointercancel="lp.end" @pointerleave="lp.end"
 * ```
 */

export interface LongPressPoint {
  x: number;
  y: number;
}

export type LongPressTrigger = (point: LongPressPoint) => void;

export interface LongPressOptions {
  /** 判定为长按的时长（毫秒），默认 500 */
  delay?: number;
  /** 允许的手指移动容差（像素），超过则取消长按，默认 10 */
  tolerance?: number;
}

export interface LongPressController {
  /** 在 pointerdown 时调用，并传入本次长按要执行的动作 */
  start: (event: PointerEvent, trigger: LongPressTrigger) => void;
  move: (event: PointerEvent) => void;
  end: () => void;
}

/** 长按后误触发抑制的持续窗口（毫秒）：覆盖浏览器补发的 click 与系统菜单 */
const SUPPRESS_WINDOW = 700;

export function useLongPress(options: LongPressOptions = {}): LongPressController {
  const delay = options.delay ?? 500;
  const tolerance = options.tolerance ?? 10;

  let timer: number | null = null;
  let originX = 0;
  let originY = 0;
  let armed = false;
  let disarmTimer: number | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  /* ------------------------------ 误触发抑制 ------------------------------ */

  function shouldPass(event: Event): boolean {
    const target = event.target;
    return target instanceof Element && target.closest(".ctx-menu") !== null;
  }

  function swallow(event: Event): void {
    if (shouldPass(event)) return;
    event.stopPropagation();
    event.preventDefault();
  }

  function disarm(): void {
    if (!armed) return;
    armed = false;
    if (disarmTimer !== null) {
      window.clearTimeout(disarmTimer);
      disarmTimer = null;
    }
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("contextmenu", swallow, true);
  }

  function armSuppression(): void {
    if (armed) return;
    armed = true;
    window.addEventListener("click", swallow, true);
    window.addEventListener("contextmenu", swallow, true);
    disarmTimer = window.setTimeout(disarm, SUPPRESS_WINDOW);
  }

  /* ------------------------------ 手势 ------------------------------ */

  function start(event: PointerEvent, trigger: LongPressTrigger): void {
    // 鼠标（含桌面端、带触控板的二合一设备）交给原生 contextmenu
    if (event.pointerType === "mouse") return;
    clearTimer();
    originX = event.clientX;
    originY = event.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      armSuppression();
      hapticImpact();
      trigger({ x: originX, y: originY });
    }, delay);
  }

  function move(event: PointerEvent): void {
    if (timer === null) return;
    if (
      Math.abs(event.clientX - originX) > tolerance ||
      Math.abs(event.clientY - originY) > tolerance
    ) {
      clearTimer();
    }
  }

  function end(): void {
    clearTimer();
  }

  onBeforeUnmount(() => {
    clearTimer();
    disarm();
  });

  return { start, move, end };
}
