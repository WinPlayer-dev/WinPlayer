<script setup lang="ts">
/**
 * 标题栏——可被主题替换。
 *
 * 分发层：有主题覆盖时渲染主题组件，否则渲染内置实现（TitleBarBase.vue）。
 * 无 props：主题组件同样不能依赖外部传参，需要的数据都从 store 取。
 */
import TitleBarBase from "@/components/layout/TitleBarBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

const ThemedTitleBar = themeSlot("TitleBar", TitleBarBase);
</script>

<template>
  <ThemedTitleBar />
</template>
