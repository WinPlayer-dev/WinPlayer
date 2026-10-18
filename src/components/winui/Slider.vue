<script setup lang="ts">
/**
 * WinUI 滑杆（Slider）
 *
 * 按 WinUI 3 规范实现：
 * - 4px 圆角轨道：未填充段为 ControlStrongFillColorDefault，已填充段为强调色；
 * - 滑块 = 20px 实心圆外圈（ControlSolidFillColorDefault + 1px 浮起描边）套 11px 强调色内点；
 *   悬停时内点放大到 15px（外圈只剩 2.5px），按住时收回 11px 并换成按下强调色；
 * - 按住拖动时在滑块上方弹出数值小窗（ThumbToolTipValueConverter）。
 *
 * 支持横 / 纵两个方向，属性 / 事件命名沿用 XAML 风格：Value / update:Value、
 * ThumbToolTipValueConverter 等。
 *
 * 说明：使用指针事件 + setPointerCapture 自行实现拖动，避免浏览器原生 range
 * 在 WebView2 上方向 / 样式难以完全对齐 WinUI。
 */
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** 当前值 */
    Value?: number;
    /** 最小值 */
    Minimum?: number;
    /** 最大值 */
    Maximum?: number;
    /** 步长（吸附粒度） */
    StepFrequency?: number;
    /** 键盘小步长 */
    SmallChange?: number;
    /** 键盘大步长 */
    LargeChange?: number;
    /** 方向 */
    Orientation?: "Horizontal" | "Vertical";
    /** 是否可用 */
    IsEnabled?: boolean;
    /** 拖动时是否显示数值气泡 */
    IsThumbToolTipEnabled?: boolean;
    /** 气泡文本转换器（可选） */
    ThumbToolTipValueConverter?: (value: number) => string;
  }>(),
  {
    Value: 0,
    Minimum: 0,
    Maximum: 100,
    StepFrequency: 1,
    SmallChange: 1,
    LargeChange: 10,
    Orientation: "Horizontal",
    IsEnabled: true,
    IsThumbToolTipEnabled: true,
  },
);

const emit = defineEmits<{ "update:Value": [value: number] }>();

const rootRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

const vertical = computed(() => props.Orientation === "Vertical");
const range = computed(() => props.Maximum - props.Minimum);

/** 当前位置比例（0~1） */
const ratio = computed(() => {
  if (range.value <= 0) return 0;
  return Math.min(1, Math.max(0, (props.Value - props.Minimum) / range.value));
});

const percent = computed(() => ratio.value * 100);

const fillStyle = computed(() =>
  vertical.value ? { height: `${percent.value}%` } : { width: `${percent.value}%` },
);

const thumbStyle = computed(() =>
  vertical.value ? { bottom: `${percent.value}%` } : { left: `${percent.value}%` },
);

const tooltipStyle = computed(() =>
  vertical.value
    ? { bottom: `${percent.value}%`, left: "calc(100% + 8px)" }
    : {
        // 贴近两端时把气泡夹在轨道内，避免溢出
        left: `clamp(30px, ${percent.value}%, calc(100% - 30px))`,
        bottom: "calc(50% + 14px)",
      },
);

const tooltipText = computed(() => {
  if (props.ThumbToolTipValueConverter) return props.ThumbToolTipValueConverter(props.Value);
  return Number.isInteger(props.Value) ? String(props.Value) : props.Value.toFixed(2);
});

/** 吸附到步长并夹在 [Minimum, Maximum] */
function snap(value: number): number {
  const step = props.StepFrequency > 0 ? props.StepFrequency : 0.01;
  const snapped = Math.round((value - props.Minimum) / step) * step + props.Minimum;
  return Math.min(props.Maximum, Math.max(props.Minimum, Number(snapped.toFixed(6))));
}

/** 由指针位置换算目标值 */
function valueFromPointer(event: PointerEvent): number {
  const el = rootRef.value;
  if (!el) return props.Value;
  const rect = el.getBoundingClientRect();
  const ratioRaw = vertical.value
    ? 1 - (event.clientY - rect.top) / rect.height
    : (event.clientX - rect.left) / rect.width;
  const clamped = Math.min(1, Math.max(0, ratioRaw));
  return snap(props.Minimum + clamped * range.value);
}

function onPointerDown(event: PointerEvent): void {
  if (!props.IsEnabled || event.button !== 0) return;
  event.preventDefault();
  rootRef.value?.focus();
  try {
    rootRef.value?.setPointerCapture(event.pointerId);
  } catch {
    /* 某些指针类型不支持捕获，忽略即可 */
  }
  dragging.value = true;
  emit("update:Value", valueFromPointer(event));
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  emit("update:Value", valueFromPointer(event));
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    rootRef.value?.releasePointerCapture(event.pointerId);
  } catch {
    /* 未捕获时释放会抛错，忽略 */
  }
  emit("update:Value", valueFromPointer(event));
}

function onPointerCancel(): void {
  dragging.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.IsEnabled) return;
  let next = props.Value;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      next += props.SmallChange;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next -= props.SmallChange;
      break;
    case "PageUp":
      next += props.LargeChange;
      break;
    case "PageDown":
      next -= props.LargeChange;
      break;
    case "Home":
      next = props.Minimum;
      break;
    case "End":
      next = props.Maximum;
      break;
    default:
      return;
  }
  event.preventDefault();
  emit("update:Value", snap(next));
}
</script>

<template>
  <div
    ref="rootRef"
    class="wp-slider"
    :class="{ 'is-vertical': vertical, 'is-disabled': !props.IsEnabled, 'is-dragging': dragging }"
    :tabindex="props.IsEnabled ? 0 : -1"
    role="slider"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    :aria-valuemin="props.Minimum"
    :aria-valuemax="props.Maximum"
    :aria-valuenow="props.Value"
    :aria-disabled="!props.IsEnabled"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @keydown="onKeydown"
  >
    <div class="wp-slider-rail" />
    <div class="wp-slider-fill" :style="fillStyle" />
    <div class="wp-slider-thumb" :style="thumbStyle">
      <div class="wp-slider-outer-thumb">
        <div class="wp-slider-inner-thumb" />
      </div>
    </div>

    <div
      v-if="dragging && props.IsThumbToolTipEnabled"
      class="wp-slider-tooltip"
      :style="tooltipStyle"
    >
      {{ tooltipText }}
    </div>
  </div>
</template>

<style scoped>
.wp-slider {
  position: relative;
  display: block;
  width: 100%;
  height: 32px;
  touch-action: none;
  cursor: pointer;
  outline-offset: 1px;
}

.wp-slider.is-disabled {
  cursor: default;
}

.wp-slider:focus-visible {
  outline: 2px solid var(--wp-text-primary);
  border-radius: var(--radius-sm);
}

/* ---------------- 轨道 ---------------- */
.wp-slider-rail {
  position: absolute;
  border-radius: 2px;
  background: var(--wp-control-fill-strong);
}

.wp-slider:not(.is-vertical) .wp-slider-rail {
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
}

.wp-slider.is-vertical .wp-slider-rail {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 4px;
  transform: translateX(-50%);
}

.wp-slider-fill {
  position: absolute;
  border-radius: 2px;
  background: var(--wp-accent);
}

.wp-slider:not(.is-vertical) .wp-slider-fill {
  left: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
}

.wp-slider.is-vertical .wp-slider-fill {
  bottom: 0;
  left: 50%;
  width: 4px;
  transform: translateX(-50%);
}

/* ---------------- 滑块 ---------------- */
.wp-slider-thumb {
  position: absolute;
  width: 20px;
  height: 20px;
}

.wp-slider:not(.is-vertical) .wp-slider-thumb {
  top: 50%;
  transform: translate(-50%, -50%);
}

.wp-slider.is-vertical .wp-slider-thumb {
  left: 50%;
  transform: translate(-50%, 50%);
}

/* 外圈：实心圆 + 1px 浮起描边（底边稍深，向上渐浅） */
.wp-slider-outer-thumb {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 10px;
  background:
    linear-gradient(var(--wp-control-solid), var(--wp-control-solid)) padding-box,
    var(--wp-control-elevation-border) border-box;
}

.wp-slider-inner-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--wp-accent);
  transition:
    width var(--duration-fast) var(--ease-standard),
    height var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

/* 悬停：内点放大到 14px，外圈只剩 3px */
.wp-slider:hover:not(.is-disabled) .wp-slider-inner-thumb {
  width: 14px;
  height: 14px;
  background: var(--wp-accent-hover);
}

/* 按住：内点收回 10px，换成按下强调色 */
.wp-slider.is-dragging:not(.is-disabled) .wp-slider-inner-thumb {
  width: 10px;
  height: 10px;
  background: var(--wp-accent-active);
}

/* 禁用 */
.wp-slider.is-disabled .wp-slider-rail {
  opacity: 0.5;
}

.wp-slider.is-disabled .wp-slider-fill,
.wp-slider.is-disabled .wp-slider-inner-thumb {
  background: var(--wp-text-disabled);
}

/* ---------------- 数值小窗 ---------------- */
.wp-slider-tooltip {
  position: absolute;
  z-index: 5;
  padding: 3px 8px 4px;
  border-radius: var(--radius-sm);
  background: var(--wp-flyout-acrylic);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid var(--wp-flyout-stroke);
  box-shadow: var(--shadow-flyout);
  color: var(--wp-text-primary);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}

.wp-slider:not(.is-vertical) .wp-slider-tooltip {
  transform: translateX(-50%);
}

.wp-slider.is-vertical .wp-slider-tooltip {
  transform: translateY(50%);
}
</style>
