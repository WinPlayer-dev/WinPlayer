<script setup lang="ts">
/**
 * 空状态占位——可被主题替换。
 *
 * 分发层：主题覆盖时用主题组件，否则用内置实现（EmptyStateBase.vue）。
 * 插槽原样透传（调用方会在默认插槽里放操作按钮）。
 */
import EmptyStateBase from "@/components/common/EmptyStateBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

defineProps<{
  icon?: string;
  title: string;
  description?: string;
}>();

const ThemedEmptyState = themeSlot("EmptyState", EmptyStateBase);
</script>

<template>
  <ThemedEmptyState :icon="icon" :title="title" :description="description">
    <slot />
  </ThemedEmptyState>
</template>
