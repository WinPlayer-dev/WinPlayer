<script setup lang="ts">
/**
 * WinUI 进度条（ProgressBar）
 *
 * 按 Microsoft WinUI 3 规范实现：4px 高的圆角轨道 + 强调色填充；
 * IsIndeterminate 时切换为往返滑动的循环动画。属性命名沿用 XAML 风格，
 * 与项目此前的调用保持一致。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 当前值 */
    Value?: number;
    /** 最小值 */
    Minimum?: number;
    /** 最大值 */
    Maximum?: number;
    /** 不确定模式（循环动画，忽略 Value） */
    IsIndeterminate?: boolean;
  }>(),
  { Value: 0, Minimum: 0, Maximum: 100, IsIndeterminate: false },
);

/** 已填充比例（0~100） */
const percent = computed(() => {
  const range = props.Maximum - props.Minimum;
  if (range <= 0) return 0;
  const ratio = (props.Value - props.Minimum) / range;
  return Math.min(1, Math.max(0, ratio)) * 100;
});
</script>

<template>
  <div
    class="wp-progress-bar"
    role="progressbar"
    :aria-valuemin="Minimum"
    :aria-valuemax="Maximum"
    :aria-valuenow="IsIndeterminate ? undefined : Value"
    :aria-busy="IsIndeterminate"
  >
    <div v-if="IsIndeterminate" class="wp-progress-bar-indeterminate" />
    <div v-else class="wp-progress-bar-fill" :style="{ width: `${percent}%` }" />
  </div>
</template>

<style scoped>
.wp-progress-bar {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
}

.wp-progress-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--wp-accent);
  transition: width var(--duration-normal) var(--ease-standard);
}

.wp-progress-bar-indeterminate {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  border-radius: inherit;
  background: var(--wp-accent);
  animation: wp-progress-indeterminate 2s var(--ease-standard) infinite;
}

@keyframes wp-progress-indeterminate {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(260%);
  }
}
</style>
