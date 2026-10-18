<script setup lang="ts">
/**
 * 移动端下拉刷新（全局手势 + 指示器）。
 *
 * 监听 .app-content 上的触摸事件：当主滚动容器（.app-content 的第一个子元素）
 * 处于顶部且继续下拉时接管手势并显示指示器，松手超过阈值就执行当前页面
 * 通过 useRefreshable() 注册的刷新动作。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { runActiveRefresh } from "@/services/pullToRefresh";
import { hapticImpact } from "@/services/haptics";

/** 触发刷新所需的下拉距离（像素） */
const THRESHOLD = 64;
/** 最大下拉距离（像素） */
const MAX = 96;
/** 阻尼系数：手指移动 1px，指示器跟随 0.5px */
const DAMPING = 0.5;

const distance = ref(0);
const refreshing = ref(false);

let startY = 0;
let active = false;
let contentEl: HTMLElement | null = null;

/** 主滚动容器 = .app-content 的第一个元素子节点（与路由组件根节点一致） */
function scroller(): HTMLElement | null {
  if (!contentEl) return null;
  for (const child of Array.from(contentEl.children)) {
    if (child instanceof HTMLElement) return child;
  }
  return null;
}

function onStart(event: TouchEvent): void {
  if (refreshing.value) return;
  const el = scroller();
  const touch = event.touches[0];
  if (!el || !touch || el.scrollTop > 0) {
    active = false;
    return;
  }
  active = true;
  startY = touch.clientY;
  distance.value = 0;
}

function onMove(event: TouchEvent): void {
  if (!active || refreshing.value) return;
  const el = scroller();
  const touch = event.touches[0];
  if (!el || !touch) return;
  const delta = touch.clientY - startY;
  if (delta <= 0 || el.scrollTop > 0) {
    distance.value = 0;
    return;
  }
  distance.value = Math.min(MAX, delta * DAMPING);
  // 在顶部下拉时接管手势，避免触发系统级下拉刷新 / 回弹
  if (event.cancelable) event.preventDefault();
}

async function onEnd(): Promise<void> {
  if (!active) return;
  active = false;
  if (refreshing.value) return;
  if (distance.value < THRESHOLD) {
    distance.value = 0;
    return;
  }
  refreshing.value = true;
  distance.value = THRESHOLD;
  hapticImpact();
  try {
    await runActiveRefresh();
  } finally {
    refreshing.value = false;
    distance.value = 0;
  }
}

onMounted(() => {
  contentEl = document.querySelector<HTMLElement>(".app-content");
  if (!contentEl) return;
  contentEl.addEventListener("touchstart", onStart, { passive: true });
  contentEl.addEventListener("touchmove", onMove, { passive: false });
  contentEl.addEventListener("touchend", onEnd, { passive: true });
  contentEl.addEventListener("touchcancel", onEnd, { passive: true });
});

onUnmounted(() => {
  if (!contentEl) return;
  contentEl.removeEventListener("touchstart", onStart);
  contentEl.removeEventListener("touchmove", onMove);
  contentEl.removeEventListener("touchend", onEnd);
  contentEl.removeEventListener("touchcancel", onEnd);
});

const visible = computed(() => distance.value > 0 || refreshing.value);
const ready = computed(() => distance.value >= THRESHOLD);
/** 未显示时收在状态栏上方（负偏移），下拉时跟随手指 */
const offset = computed(() => (visible.value ? distance.value : -56));
const text = computed(() => {
  if (refreshing.value) return "正在刷新…";
  return ready.value ? "松开刷新" : "下拉刷新";
});
</script>

<template>
  <div
    class="pull-refresh"
    :class="{ visible, refreshing }"
    :style="{ transform: `translate(-50%, ${offset}px)` }"
    aria-hidden="true"
  >
    <span class="wp-icon pull-icon" :class="{ spin: refreshing }">&#xF191;</span>
    <span class="pull-text">{{ text }}</span>
  </div>
</template>

<style scoped>
.pull-refresh {
  position: fixed;
  top: calc(var(--safe-area-top) + var(--space-md));
  left: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 36px;
  padding: 0 var(--space-lg);
  border-radius: 18px;
  background: var(--wp-flyout);
  color: var(--wp-text-secondary);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: var(--shadow-flyout);
  opacity: 0;
  /* 只对透明度做动画；位置跟随手指，不做过渡以免拖拽发涩 */
  transition: opacity var(--duration-fast) var(--ease-standard);
  pointer-events: none;
}

.pull-refresh.visible {
  opacity: 1;
}

.pull-icon {
  font-size: 14px;
}

.pull-icon.spin {
  animation: pull-spin 0.9s linear infinite;
}

@keyframes pull-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
