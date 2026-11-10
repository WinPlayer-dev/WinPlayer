/**
 * 列表自动对齐：让「当前项」始终停在容器的固定比例位置上。
 * - 面板打开或当前项变化时自动对齐
 * - 用户手动滚动后暂停，停止滚动一段时间后自动回正
 */
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

export interface AutoCenterOptions {
  /** 滚动容器 */
  container: Ref<HTMLElement | null>;
  /** 目标项选择器（相对容器查找，可命中嵌套元素） */
  itemSelector: string;
  /** 当前项下标；返回 -1 表示暂无目标 */
  getIndex: () => number;
  /** 面板是否处于激活（可见）状态；未激活时不滚动 */
  isActive: () => boolean;
  /**
   * 当前项应该落在容器高度上的哪个比例（0 = 顶部、0.5 = 正中、1 = 底部），默认 0.5。
   * 用函数而不是数值：设置里改「靠上 / 居中 / 靠下」后要能重新对齐。
   */
  getAnchor?: () => number;
  /**
   * 平滑滚动的时长（毫秒），默认 480。
   *
   * 浏览器的 `scrollTo({behavior:"smooth"})` 时长是写死的、各引擎还不一致，
   * 想按设置调快慢只能自己做补间 —— 见下面的 `animateTo`。
   */
  getDuration?: () => number;
  /**
   * 补间曲线（输入 0~1、输出 0~1），默认 ease-out cubic。
   * 与 CSS 里的缓动选项共用同一个形状，滚动和行过渡才不会一个快一个慢。
   */
  getEasing?: () => (t: number) => number;
  /**
   * 对齐时测到的尺寸回传（单位：px）。
   *
   * 歌词区拿它算「边缘渐隐带要多宽」：渐隐带是容器级的 `mask`，
   * 一旦比「当前行上沿到容器顶」的距离还宽，就会把高亮行的上半截压暗
   * （长句折行时最明显）。容器自己不知道哪一行是高亮行，只能由这里报上去。
   */
  onMeasure?: (info: { itemHeight: number; containerHeight: number }) => void;
  /** 手动滚动停止后自动回正的延迟（毫秒），默认 3000 */
  resumeDelay?: number;
  /**
   * 挂载时若已处于激活状态，是否立刻居中一次。
   *
   * 给「一打开就是可见」的场景用（例如桌面沉浸页：组件挂载时 `isActive` 恒为 true，
   * 没有 false→true 的变化，不 immediate 的话首屏会停在列表顶部）。
   */
  immediate?: boolean;
}

/** 平滑滚动默认时长（毫秒），设置里的「滚动速度」按倍数缩放它 */
export const SCROLL_DURATION_BASE = 480;

export function useAutoCenter(options: AutoCenterOptions): void {
  const {
    container,
    itemSelector,
    getIndex,
    isActive,
    getAnchor,
    getDuration,
    getEasing,
    onMeasure,
    resumeDelay = 3000,
    immediate = false,
  } = options;

  /** 程序化滚动截止时间戳 */
  let programmaticUntil = 0;
  /** 用户手动滚动后是否暂停自动居中 */
  let paused = false;
  let resumeTimer: number | undefined;
  /** 进行中的补间动画 */
  let rafId = 0;

  /**
   * 自己做补间而不是用 `scrollTo({behavior:"smooth"})`：
   * 后者的时长由引擎决定、无法调速，「歌词滚动速度」这个设置就落不了地。
   * 曲线用 ease-out cubic —— 起步利落、收尾柔和，跨多行滚动也不拖沓。
   */
  function animateTo(el: HTMLElement, to: number, duration: number, easing: (t: number) => number): void {
    cancelAnimationFrame(rafId);
    const from = el.scrollTop;
    const delta = to - from;
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      el.scrollTop = from + delta * easing(progress);
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  /** 上一次回传的尺寸，避免同一个值反复触发下游更新 */
  let lastMeasured = { itemHeight: 0, containerHeight: 0 };

  /** 把这次测到的尺寸报给调用方（尺寸没变就不报） */
  function measure(targetRect: DOMRect, containerHeight: number): void {
    if (!onMeasure) return;
    const changed =
      Math.abs(targetRect.height - lastMeasured.itemHeight) > 1 ||
      Math.abs(containerHeight - lastMeasured.containerHeight) > 1;
    if (!changed) return;
    lastMeasured = { itemHeight: targetRect.height, containerHeight };
    onMeasure(lastMeasured);
  }

  /** 把当前项滚到容器的锚点位置（默认垂直居中） */
  function center(behavior: "auto" | "smooth"): void {
    const el = container.value;
    const index = getIndex();
    if (!el || index < 0) return;
    const target = el.querySelectorAll<HTMLElement>(itemSelector)[index];
    if (!target) return;
    const anchor = Math.min(1, Math.max(0, getAnchor?.() ?? 0.5));
    // 用相对容器的视口坐标计算，避免受 offsetParent 影响（容器未必是定位祖先）
    const elRect = el.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    // 尺寸要先报出去：即使这次不需要滚动（已经对齐），渐隐带也得跟着行高更新
    measure(targetRect, el.clientHeight);
    const aligned =
      el.scrollTop + (targetRect.top - elRect.top) - (el.clientHeight * anchor - targetRect.height / 2);
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const top = Math.min(Math.max(0, aligned), max);
    if (Math.abs(top - el.scrollTop) < 1) return;

    // 关掉系统动效时直接跳，别跟用户对着干
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (behavior === "auto" || reduceMotion) {
      cancelAnimationFrame(rafId);
      programmaticUntil = Date.now() + 120;
      el.scrollTop = top;
      return;
    }

    const duration = Math.max(80, getDuration?.() ?? 480);
    const easing = getEasing?.() ?? ((t: number) => 1 - Math.pow(1 - t, 3));
    programmaticUntil = Date.now() + duration + 120;
    animateTo(el, top, duration, easing);
  }

  function onScroll(): void {
    if (Date.now() < programmaticUntil) return; // 自身滚动，忽略
    paused = true;
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      paused = false;
      if (isActive()) void nextTick(() => center("smooth"));
    }, resumeDelay);
  }

  /**
   * 视口尺寸变化后重新居中。
   *
   * 窗口变高 / 变矮 / 旋转屏幕时，容器高度和 `vh` 内边距都会变，原来的
   * scrollTop 就不在中心了（用户看到的就是「当前行突然偏上或偏下」）。
   * 防抖到尺寸稳定后再算，避免拖动窗口边角时每帧都滚。
   */
  let resizeTimer: number | undefined;

  function onResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (isActive()) void nextTick(() => center("auto"));
    }, 140);
  }

  window.addEventListener("resize", onResize, { passive: true });

  // 容器挂载 / 卸载时绑定滚动监听
  watch(
    container,
    (el, prev) => {
      prev?.removeEventListener("scroll", onScroll);
      el?.addEventListener("scroll", onScroll, { passive: true });
    },
    { immediate: true, flush: "post" },
  );

  watch(
    () => [isActive(), getIndex(), getAnchor?.() ?? 0.5] as const,
    async ([active], old) => {
      if (!active) return;
      const justOpened = !old?.[0];
      if (justOpened) {
        // 面板重新打开：清除暂停状态并清掉挂起的回正定时器
        paused = false;
        window.clearTimeout(resumeTimer);
      } else if (paused) {
        return; // 用户正在手动浏览，暂不打扰
      }
      await nextTick();
      center(justOpened ? "auto" : "smooth");
    },
    { flush: "post", immediate },
  );

  onBeforeUnmount(() => {
    container.value?.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    cancelAnimationFrame(rafId);
    window.clearTimeout(resumeTimer);
    window.clearTimeout(resizeTimer);
  });
}
