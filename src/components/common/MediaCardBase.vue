<script setup lang="ts">
/**
 * 通用媒体卡片（歌单 / 专辑 / 歌手）
 *
 * 三种卡片共用同一套栅格尺寸与 hover 行为，区别只在封面形状和副标题：
 * - 歌单：方形封面，副标题「N 首 · 来源」
 * - 专辑：方形封面，副标题为艺术家名
 * - 歌手：圆形头像，副标题「N 首 · N 张专辑」
 *
 * 点击一律跳转到对应的详情页（插件来源歌单 / 专辑 / 歌手），
 * 没有 sourceId 的条目不提供跳转（保持可点击但无动作）。
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import { useLibraryStore } from "@/stores/library";
import { toast } from "@/services/toast";
import { openContextMenu, openContextMenuAt, type ContextMenuItem } from "@/services/contextMenu";
import { useIsMobile } from "@/composables/useIsMobile";
import { useLongPress } from "@/composables/useLongPress";
import { useSettingsStore } from "@/stores/settings";
import { copyText } from "@/services/clipboard";
import CachedImage from "@/components/common/CachedImage.vue";
import type { UnifiedAlbum, UnifiedArtist, UnifiedPlaylist } from "@/types/plugin";

const props = defineProps<{
  kind: "playlist" | "album" | "artist";
  playlist?: UnifiedPlaylist;
  album?: UnifiedAlbum;
  artist?: UnifiedArtist;
}>();

const router = useRouter();
const plugins = usePluginsStore();
const library = useLibraryStore();
const settings = useSettingsStore();
const isMobile = useIsMobile();

const playlist = computed(() => (props.kind === "playlist" ? props.playlist : undefined));
const album = computed(() => (props.kind === "album" ? props.album : undefined));
const artist = computed(() => (props.kind === "artist" ? props.artist : undefined));

const item = computed(() => playlist.value ?? album.value ?? artist.value);
const sourceId = computed(() => item.value?.sourceId);

// 三种类型的封面字段名不同（歌手是 avatar，其余是 cover），分开取以避免联合类型告警
const cover = computed(() => {
  if (artist.value) return artist.value.avatar ?? "";
  if (album.value) return album.value.cover ?? "";
  return playlist.value?.cover ?? "";
});

const title = computed(() => item.value?.name || "未命名");
const sourceName = computed(() =>
  sourceId.value ? pluginDisplayName(plugins.records, sourceId.value) : "本地",
);

const placeholderIcon = computed(() => (props.kind === "artist" ? "\uE77B" : "\uE8FD"));

const subtitle = computed(() => {
  if (album.value) {
    const names = (album.value.artistNames ?? []).filter(Boolean);
    if (names.length) return names.join(" / ");
    if (album.value.trackCount) return `${album.value.trackCount} 首`;
    return sourceName.value;
  }
  if (artist.value) {
    const parts: string[] = [];
    if (artist.value.songCount) parts.push(`${artist.value.songCount} 首`);
    if (artist.value.albumCount) parts.push(`${artist.value.albumCount} 张专辑`);
    return parts.length ? parts.join(" · ") : sourceName.value;
  }
  const parts: string[] = [];
  if (playlist.value?.trackCount) parts.push(`${playlist.value.trackCount} 首`);
  parts.push(sourceName.value);
  return parts.join(" · ");
});

const tooltip = computed(() => {
  const text = playlist.value?.description ?? album.value?.description ?? artist.value?.briefDesc;
  return text || title.value;
});

const target = computed(() => {
  const source = sourceId.value;
  const id = item.value?.id;
  if (!source || !id) return null;
  if (props.kind === "album") return { name: "album", params: { source, id } };
  if (props.kind === "artist") return { name: "artist", params: { source, id } };
  return { name: "sourcePlaylist", params: { source, id } };
});

function open() {
  if (!target.value) return;
  void router.push(target.value);
}

/* ------------------------------ 歌单右键菜单 ------------------------------ */

/** 把插件来源歌单整体复制为一个本地歌单 */
async function copyToLocal(p: UnifiedPlaylist) {
  if (!p.sourceId) return;
  toast(`正在复制「${p.name}」到本地…`, "info");
  try {
    const detail = await plugins.getPlaylistDetail(p.sourceId, p.id);
    const tracks = detail?.tracks ?? [];
    if (!tracks.length) {
      toast("该歌单没有可复制的歌曲", "error");
      return;
    }
    const created = await library.createPlaylist(detail?.name || p.name);
    if (!created) return;
    const added = await library.addTracksToPlaylist(created.id, tracks);
    toast(`已复制 ${added} 首歌曲到本地歌单「${created.name}」`, "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

/** 歌单卡片菜单项：复制到本地 / 复制歌单名 */
function menuItems(p: UnifiedPlaylist): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (p.sourceId) {
    items.push({
      key: "copy-local",
      label: "复制到本地",
      icon: "&#xF151;",
      action: () => copyToLocal(p),
    });
  }
  items.push({
    key: "copy-name",
    label: "复制歌单名",
    icon: "&#xF32C;",
    action: () => copyText(p.name, "歌单名"),
  });
  return items;
}

/** 歌单卡片右键菜单（桌面端） */
function openMenu(event: MouseEvent) {
  if (isMobile || props.kind !== "playlist" || !playlist.value) return;
  openContextMenu(event, menuItems(playlist.value));
}

/** 移动端长按：弹出歌单菜单（仅歌单卡片有菜单，底部面板标题用歌单名） */
const longPress = useLongPress();

function onPointerDown(event: PointerEvent) {
  if (props.kind !== "playlist" || !playlist.value) return;
  const p = playlist.value;
  longPress.start(event, (point) =>
    openContextMenuAt(point.x, point.y, menuItems(p), p.name),
  );
}
</script>

<template>
  <button
    class="media-card"
    :title="tooltip"
    @click="open"
    @contextmenu="openMenu"
    @pointerdown="onPointerDown"
    @pointermove="longPress.move"
    @pointerup="longPress.end"
    @pointercancel="longPress.end"
    @pointerleave="longPress.end"
  >
    <div class="card-cover" :class="{ round: kind === 'artist' }">
      <!-- 原始比例模式：图片 contain 居中，四周留白由同一张封面的模糊放大层填充 -->
      <CachedImage
        v-if="settings.coverNaturalRatio && cover"
        :src="cover"
        class="cover-blur"
        aria-hidden="true"
      />
      <CachedImage v-if="cover" :src="cover" class="cover-img" />
      <span v-else class="wp-icon cover-placeholder">{{ placeholderIcon }}</span>
    </div>
    <div class="card-name ellipsis">{{ title }}</div>
    <div class="card-sub ellipsis">{{ subtitle }}</div>
  </button>
</template>

<style scoped>
.media-card {
  width: 160px;
  flex: none;
  border: none;
  background: transparent;
  padding: var(--space-md);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  transition:
    background var(--duration-fast) var(--ease-standard),
    transform var(--duration-normal) var(--ease-decelerate);
}

.media-card:hover {
  background: var(--wp-card-hover);
  /* 悬浮抬升：配合封面微放大形成「浮起」感 */
  transform: translateY(-2px);
}

.media-card:active {
  transform: translateY(0) scale(0.98);
}

.card-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  background: var(--wp-control-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: var(--shadow-card);
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    box-shadow var(--duration-normal) var(--ease-standard);
}

/* 悬浮时封面轻微放大并加深投影 */
.media-card:hover .card-cover {
  transform: scale(1.03);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
}

/* 歌手用圆形头像，和方形的歌单/专辑封面区分开 */
.card-cover.round {
  border-radius: 50%;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  font-size: 36px;
  color: var(--wp-text-tertiary);
}

.card-name {
  font-size: 13px;
  font-weight: 600;
}

.card-sub {
  font-size: 11px;
  color: var(--wp-text-secondary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
