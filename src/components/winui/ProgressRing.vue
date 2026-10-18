<script setup lang="ts">
/**
 * WinUI 进度环（ProgressRing）
 *
 * SVG 环形动画：细灰色轨道 + 强调色弧段一边旋转一边伸缩，
 * 视觉对齐 WinUI 3 的 ProgressRing。属性命名沿用 XAML 风格。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 是否显示（false 时不渲染） */
    IsActive?: boolean;
    /** 不确定模式（循环旋转动画；确定模式仅显示轨道） */
    IsIndeterminate?: boolean;
    /** 直径（px） */
    Width?: number;
    /** 直径（px） */
    Height?: number;
  }>(),
  { IsActive: true, IsIndeterminate: true, Width: 32, Height: 32 },
);

const size = computed(() => ({ width: `${props.Width}px`, height: `${props.Height}px` }));
</script>

<template>
  <span
    v-if="IsActive"
    class="wp-progress-ring"
    :style="size"
    role="progressbar"
    :aria-busy="IsIndeterminate"
  >
    <svg class="wp-progress-ring-svg" viewBox="0 0 52 52" :class="{ spinning: IsIndeterminate }">
      <circle class="wp-progress-ring-track" cx="26" cy="26" r="22" />
      <circle v-if="IsIndeterminate" class="wp-progress-ring-indicator" cx="26" cy="26" r="22" />
    </svg>
  </span>
</template>

<style scoped>
.wp-progress-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.wp-progress-ring-svg {
  width: 100%;
  height: 100%;
  transform-origin: 50% 50%;
}

.wp-progress-ring-svg.spinning {
  animation: wp-progress-ring-rotate 2s linear infinite;
}

.wp-progress-ring-track {
  fill: none;
  stroke: var(--wp-control-stroke-secondary);
  stroke-width: 4;
}

.wp-progress-ring-indicator {
  fill: none;
  stroke: var(--wp-accent);
  stroke-width: 4;
  stroke-linecap: round;
  /* 周长 2πr ≈ 138.2：可见弧段约 1/4，其余留白 */
  stroke-dasharray: 35 104;
  animation: wp-progress-ring-dash 1.5s var(--ease-standard) infinite;
}

@keyframes wp-progress-ring-rotate {
  to {
    transform: rotate(360deg);
  }
}

@keyframes wp-progress-ring-dash {
  0% {
    stroke-dasharray: 1 137;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 62 137;
    stroke-dashoffset: -18;
  }
  100% {
    stroke-dasharray: 1 137;
    stroke-dashoffset: -137;
  }
}
</style>
