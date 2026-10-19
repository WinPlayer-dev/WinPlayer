<script setup lang="ts">
/**
 * 桌面端播放条——可被主题替换。
 *
 * 分发层：有主题覆盖时渲染主题组件，否则渲染内置实现（PlayerBarBase.vue）。
 * 播放状态全部来自 usePlayerStore；主题实现需自行处理进度拖动、
 * 喜欢、队列/歌词/下载面板的互斥（这些都在 base 实现里有完整逻辑）。
 */
import PlayerBarBase from "@/components/layout/PlayerBarBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

const ThemedPlayerBar = themeSlot("PlayerBar", PlayerBarBase);
</script>

<template>
  <ThemedPlayerBar class="app-playerbar" />
</template>
