<script setup lang="ts">
/**
 * 按钮——可被主题整体替换。
 *
 * 宿主里按钮长期以 `class="wp-accent-button"` 形式散落在各页面；
 * 这个组件把「按钮」抽象出来：主题覆盖 `Button` 后，所有通过它渲染的按钮
 * 都会换成主题实现（例如 MD3 的 filled / tonal / outlined 三态）。
 *
 * 用法与普通 button 一致，额外提供 `variant`：
 * - `accent`（默认）：主操作，对应 .wp-accent-button
 * - `standard`：次操作，对应 .wp-standard-button
 *
 * 对外暴露 `focus()`：对话框需要用它在打开时聚焦到主按钮，
 * 无论当前渲染的是内置 button 还是主题组件都能正确聚焦。
 */
import { computed, ref } from "vue";
import { getThemeComponentOverride } from "@/components/theme/themeSlot";

const props = withDefaults(
  defineProps<{
    variant?: "accent" | "standard";
    disabled?: boolean;
    /** 供主题实现区分尺寸（宿主常用 small 变体） */
    size?: "normal" | "small";
    danger?: boolean;
  }>(),
  { variant: "accent", disabled: false, size: "normal", danger: false },
);

/** 主题覆盖（响应式：切换主题后按钮外观立即跟着变） */
const override = computed(() => getThemeComponentOverride("Button"));

const classes = computed(() => [
  props.variant === "accent" ? "wp-accent-button" : "wp-standard-button",
  props.size === "small" ? "small" : "",
  props.danger ? "danger" : "",
]);

const rootRef = ref<unknown>(null);

/**
 * 聚焦到按钮。
 *
 * 内置实现直接是 HTMLButtonElement；主题实现可能是自定义元素或组件实例，
 * 因此依次尝试 `$el`、元素本身与 `focus()` 方法。
 */
function focus(): void {
  const target = rootRef.value as
    | (HTMLElement & { $el?: HTMLElement; focus?: () => void })
    | null;
  if (!target) return;
  const element = (target.$el ?? target) as HTMLElement | undefined;
  if (element && typeof element.focus === "function") {
    element.focus();
    return;
  }
  if (typeof target.focus === "function") target.focus();
}

defineExpose({ focus });
</script>

<template>
  <!-- 有主题覆盖：把契约（variant / size / danger / disabled + 插槽）交给主题实现 -->
  <component
    :is="override"
    v-if="override"
    ref="rootRef"
    :variant="variant"
    :size="size"
    :danger="danger"
    :disabled="disabled"
  >
    <slot />
  </component>

  <!-- 无覆盖：内置实现，保留原有 class 语义（不引入额外 DOM 层级） -->
  <button v-else ref="rootRef" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
