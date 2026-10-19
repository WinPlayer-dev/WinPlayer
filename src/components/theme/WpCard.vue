<script setup lang="ts">
/**
 * 卡片容器——可被主题替换。
 *
 * 宿主的设置项、内容块长期使用 `class="settings-card"` / `card-*` 这套类名；
 * 这里把它抽象成组件，主题覆盖 `Card` 后就能用 MDUI 的 `<mdui-card>` 之类的
 * 容器整体替换（MD3 的 elevated / filled / outlined 三态）。
 *
 * 契约：
 * - `variant`：`row`（默认，左文右控件的横向行）/ `column`（整行内容纵向堆叠）
 * - 默认插槽：卡片内容（调用方自行使用 `.card-content` / `.card-header` 等类名）
 */
import { computed } from "vue";
import { getThemeComponentOverride } from "@/components/theme/themeSlot";

const props = withDefaults(
  defineProps<{
    variant?: "row" | "column";
  }>(),
  { variant: "row" },
);

const classes = computed(() => [
  "settings-card",
  props.variant === "column" ? "column" : "",
]);
</script>

<template>
  <component
    :is="getThemeComponentOverride('Card')"
    v-if="getThemeComponentOverride('Card')"
    :variant="variant"
  >
    <slot />
  </component>

  <div v-else :class="classes">
    <slot />
  </div>
</template>
