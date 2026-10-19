<script setup lang="ts">
/**
 * WinUI 开关（ToggleSwitch）
 *
 * 按 WinUI 3 规范实现：
 * - 轨道 40×20、圆角 10、1px 描边；
 *   关闭态：中性强描边 + ControlAltFillColorSecondary 底；打开态：强调色填充；
 * - 滑块 12px：悬停放大到 14px（+2px），按住变为 17×14 的椭圆（WinUI Pressed 形状）；
 *   滑块位移 20px，动效为缓出（ControlFastOutSlowInKeySpline）。
 * 事件沿用 XAML 风格：Toggled 回调参数带 IsOn 字段。
 */
const props = withDefaults(
  defineProps<{
    /** 是否开启 */
    IsOn?: boolean;
    /** 是否可用 */
    IsEnabled?: boolean;
  }>(),
  { IsOn: false, IsEnabled: true },
);

const emit = defineEmits<{ Toggled: [event: { IsOn: boolean }] }>();

function toggle(): void {
  if (!props.IsEnabled) return;
  emit("Toggled", { IsOn: !props.IsOn });
}
</script>

<template>
  <button
    type="button"
    role="switch"
    class="wp-toggle-switch"
    :class="{ 'is-on': props.IsOn, 'is-disabled': !props.IsEnabled }"
    :aria-checked="props.IsOn"
    :disabled="!props.IsEnabled"
    @click="toggle"
  >
    <span class="wp-toggle-switch-root">
      <span class="wp-toggle-switch-track" />
      <span class="wp-toggle-switch-knob">
        <span class="wp-toggle-switch-thumb" />
      </span>
    </span>
  </button>
</template>

<style scoped>
.wp-toggle-switch {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.wp-toggle-switch.is-disabled {
  cursor: default;
  opacity: 0.5;
}

/* 40×20 的控件本体，滑块容器以此定位（位移 20px） */
.wp-toggle-switch-root {
  position: relative;
  display: block;
  width: 40px;
  height: 20px;
}

/* ---------------- 轨道 ---------------- */
.wp-toggle-switch-track {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 1px solid var(--wp-control-stroke-strong);
  border-radius: 10px;
  background: var(--wp-control-alt-fill-secondary);
  transition:
    background-color var(--duration-control-fast) var(--ease-fast-out-slow-in),
    border-color var(--duration-control-fast) var(--ease-fast-out-slow-in);
}

.wp-toggle-switch.is-on .wp-toggle-switch-track {
  background: var(--wp-accent);
  border-color: transparent;
}

/* ---------------- 滑块 ---------------- */
.wp-toggle-switch-knob {
  position: absolute;
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  transform: translateX(0);
  transition: transform var(--duration-control-fast) var(--ease-fast-out-slow-in);
}

.wp-toggle-switch.is-on .wp-toggle-switch-knob {
  transform: translateX(20px);
}

.wp-toggle-switch-thumb {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--wp-text-secondary);
  transform: translate(-50%, -50%);
  transition:
    width var(--duration-control-fast) var(--ease-fast-out-slow-in),
    height var(--duration-control-fast) var(--ease-fast-out-slow-in),
    background-color var(--duration-control-fast) var(--ease-fast-out-slow-in);
}

.wp-toggle-switch.is-on .wp-toggle-switch-thumb {
  background: var(--wp-text-on-accent);
}

/* 悬停：圆点 +2px（关闭态描边加深、滑块变主文本色；打开态底色换成 hover 强调色） */
.wp-toggle-switch:not(.is-disabled):hover .wp-toggle-switch-thumb {
  width: 14px;
  height: 14px;
}

.wp-toggle-switch:not(.is-disabled):hover:not(.is-on) .wp-toggle-switch-track {
  border-color: var(--wp-text-primary);
  background: var(--wp-control-alt-fill-tertiary);
}

.wp-toggle-switch:not(.is-disabled):hover:not(.is-on) .wp-toggle-switch-thumb {
  background: var(--wp-text-primary);
}

.wp-toggle-switch:not(.is-disabled):hover.is-on .wp-toggle-switch-track {
  background: var(--wp-accent-hover);
}

/* 按住：滑块拉成 17×14 椭圆（关闭态右偏 1.5px、打开态左偏 1.5px），动效瞬断 */
.wp-toggle-switch:not(.is-disabled):active .wp-toggle-switch-knob,
.wp-toggle-switch:not(.is-disabled):active .wp-toggle-switch-thumb {
  transition: none;
}

.wp-toggle-switch:not(.is-disabled):active .wp-toggle-switch-thumb {
  width: 17px;
  height: 14px;
  border-radius: 7px;
}

.wp-toggle-switch:not(.is-disabled):active:not(.is-on) .wp-toggle-switch-track {
  border-color: var(--wp-control-stroke-strong);
  background: var(--wp-control-alt-fill-quarternary);
}

.wp-toggle-switch:not(.is-disabled):active:not(.is-on) .wp-toggle-switch-thumb {
  background: var(--wp-text-primary);
  transform: translate(-50%, -50%) translateX(1.5px);
}

.wp-toggle-switch:not(.is-disabled):active.is-on .wp-toggle-switch-track {
  background: var(--wp-accent-active);
  border-color: var(--wp-control-stroke-secondary);
}

.wp-toggle-switch:not(.is-disabled):active.is-on .wp-toggle-switch-thumb {
  background: var(--wp-text-on-accent);
  transform: translate(-50%, -50%) translateX(-1.5px);
}

/* WinUI 焦点视觉仅用于键盘导航 */
.wp-toggle-switch:focus-visible {
  outline: 2px solid var(--wp-text-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
</style>
