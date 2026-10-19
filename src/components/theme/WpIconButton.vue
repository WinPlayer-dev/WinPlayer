<script setup lang="ts">
/**
 * 图标按钮——可被主题整体替换。
 *
 * 与 WpButton 同一套思路：把 `class="wp-icon-button"` 的裸按钮抽象成组件，
 * 主题覆盖 `IconButton` 后，标题栏、播放条、工具栏里的图标按钮会统一换皮。
 */
import { computed } from "vue";
import { getThemeComponentOverride } from "@/components/theme/themeSlot";

const props = withDefaults(
  defineProps<{
    /** 是否处于激活态（选中/开关打开） */
    active?: boolean;
    disabled?: boolean;
  }>(),
  { active: false, disabled: false },
);

const classes = computed(() => ["wp-icon-button", props.active ? "active" : ""]);
</script>

<template>
  <component
    :is="getThemeComponentOverride('IconButton')"
    v-if="getThemeComponentOverride('IconButton')"
    :active="active"
    :disabled="disabled"
  >
    <slot />
  </component>

  <button v-else :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
