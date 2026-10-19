<script setup lang="ts">
/**
 * 侧边导航——可被主题替换。
 *
 * 分发层：有主题覆盖时渲染主题组件，否则渲染内置实现（SideNavBase.vue）。
 * 主题可以只改样式，也可以整体换成 MD3 Navigation Drawer / Rail；
 * 歌单数据、右键菜单等能力通过 store 自行获取（契约见文档）。
 */
import SideNavBase from "@/components/layout/SideNavBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

const ThemedSideNav = themeSlot("SideNav", SideNavBase);
</script>

<template>
  <ThemedSideNav />
</template>
