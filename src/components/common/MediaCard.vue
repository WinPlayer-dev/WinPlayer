<script setup lang="ts">
/**
 * 媒体卡片（歌单 / 专辑 / 歌手）——可被主题替换。
 *
 * 分发层：有主题覆盖时渲染主题组件，否则渲染内置实现（MediaCardBase.vue）。
 * 两边 props 契约完全一致，主题可以只改视觉，也可以整块换成自己的卡片结构。
 *
 * 用 themeSlot 而不是直接读覆盖表，是为了带上错误边界：主题组件渲染出错时
 * 只让这张卡片回退到内置样式，不会拖垮整个列表。
 */
import MediaCardBase from "@/components/common/MediaCardBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";
import type { UnifiedAlbum, UnifiedArtist, UnifiedPlaylist } from "@/types/plugin";

defineProps<{
  kind: "playlist" | "album" | "artist";
  playlist?: UnifiedPlaylist;
  album?: UnifiedAlbum;
  artist?: UnifiedArtist;
}>();

const ThemedMediaCard = themeSlot("MediaCard", MediaCardBase);
</script>

<template>
  <ThemedMediaCard :kind="kind" :playlist="playlist" :album="album" :artist="artist" />
</template>
