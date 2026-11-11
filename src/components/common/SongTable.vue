<script setup lang="ts">
/**
 * 歌曲列表（WinUI ListView 风格）
 */
import { computed, ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
// 词条里存的是中文字面量：props 默认值在 setup 外求值，所以这里额外引一个模块级 t
import { t as translate, useI18n } from "@/i18n";
import { useIsMobile } from "@/composables/useIsMobile";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import { useDownloadsStore } from "@/stores/downloads";
import { useHistoryStore } from "@/stores/history";
import { useTrackMetaStore } from "@/stores/trackMeta";
import { openContextMenu, openContextMenuAt, type ContextMenuItem } from "@/services/contextMenu";
import { openTrackMetaEditor } from "@/services/trackMetaEditor";
import { useLongPress } from "@/composables/useLongPress";
import CachedImage from "@/components/common/CachedImage.vue";
import { openPlaylistPicker, useCanAddToPlaylist } from "@/services/playlistPicker";
import { startTrackDrag, endTrackDrag } from "@/services/trackDrag";
import { copyText } from "@/services/clipboard";
import { canUploadToCloud, uploadTrackToCloud } from "@/services/cloudUpload";
import { formatDuration, trackTitle } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

const props = withDefaults(
  defineProps<{
    tracks: UnifiedTrack[];
    /** 是否显示来源列（聚合场景） */
    showSource?: boolean;
    /** 列表操作：remove / 无 */
    removable?: boolean;
    emptyText?: string;
    /** 是否允许拖拽排序（自建歌单详情页开启） */
    reorderable?: boolean;
    /** 是否显示播放次数列（历史页 / 常听页开启） */
    showPlayCount?: boolean;
  }>(),
  {
    showSource: false,
    removable: false,
    emptyText: translate("components.empty.noSongs"),
    reorderable: false,
    showPlayCount: false,
  },
);

const emit = defineEmits<{
  remove: [track: UnifiedTrack];
  /** 拖拽排序：把 from 位置的曲目移动到 to 位置（数组下标） */
  reorder: [from: number, to: number];
}>();

const { t } = useI18n();
const player = usePlayerStore();
const library = useLibraryStore();
const plugins = usePluginsStore();
const downloads = useDownloadsStore();
const history = useHistoryStore();
const trackMeta = useTrackMetaStore();
const router = useRouter();
/** 移动端判定：决定走卡片式两行布局、单击播放等交互 */
const isMobile = useIsMobile();

/** 歌手/专辑名是否能跳转，取决于插件有没有回传对应的 id */
interface CellLink {
  name: string;
  target: RouteLocationRaw | null;
}

/**
 * 歌手单元格：有 artistId 才做成可点链接。
 *
 * 来源优先取 `artistSourceId`——用户用别的播放源里的歌当模板时，歌手 id 属于
 * 那个源，拿曲目自身的 sourceId 去拼 /artist/:source/:id 会打开错误的页面。
 */
function artistCells(track: UnifiedTrack): CellLink[] {
  const names = track.artists ?? [];
  const ids = track.artistIds ?? [];
  const sourceId = track.artistSourceId ?? track.sourceId;
  return names.map((name, index) => ({
    name,
    target:
      sourceId && ids[index]
        ? { name: "artist", params: { source: sourceId, id: ids[index] } }
        : null,
  }));
}

function albumCell(track: UnifiedTrack): CellLink | null {
  if (!track.album) return null;
  const sourceId = track.albumSourceId ?? track.sourceId;
  return {
    name: track.album,
    target:
      sourceId && track.albumId
        ? { name: "album", params: { source: sourceId, id: track.albumId } }
        : null,
  };
}

const rows = computed(() =>
  props.tracks.map((track, index) => {
    // view 只用于显示（歌名/歌手/专辑/封面可能被用户改过），track 留给播放、
    // 喜欢、加歌单等写操作——写进快照的必须是来源原始信息
    const view = trackMeta.decorate(track);
    return {
      track,
      view,
      index,
      key: `${track.sourceId ?? ""}:${track.id}`,
      liked: library.isLiked(track),
      downloaded: downloads.isDownloaded(track),
      playing: player.currentTrack !== null && `${player.currentTrack.sourceId ?? ""}:${player.currentTrack.id}` === `${track.sourceId ?? ""}:${track.id}`,
      // 演示模式下 pluginDisplayName 会统一返回通用来源名
      sourceName: pluginDisplayName(plugins.records, track.sourceId),
      artists: artistCells(view),
      album: albumCell(view),
      playCount: props.showPlayCount ? history.countOf(track) : 0,
    };
  }),
);

function playRow(index: number) {
  void player.playTracks(props.tracks, index);
}

/** 移动端没有双击，单击整行即播放（桌面端仍保持双击播放） */
function onRowClick(index: number) {
  // 拖拽结束时浏览器仍会补发 click：吞掉它，避免"拖完就播放"
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (isMobile) playRow(index);
}

function go(target: RouteLocationRaw) {
  void router.push(target);
}

/** 歌手/专辑名上双击时只允许跳转，不要顺带触发整行播放 */
function noop() {
  /* 仅用于拦截事件 */
}

async function toggleLike(track: UnifiedTrack) {
  await library.toggleLike(track);
}

function addSingle(track: UnifiedTrack) {
  player.addToQueue([track]);
}

/* ------------------------------ 右键菜单 ------------------------------ */

/** 「添加到歌单」入口是否可用：与播放条「更多」菜单共用同一判定 */
const canAddToPlaylist = useCanAddToPlaylist();

/** 行菜单项：添加到歌单 / 添加到我喜欢 / 移除 / 添加到播放队列 / 复制歌曲名 / 复制歌曲别名 */
function rowMenuItems(track: UnifiedTrack): ContextMenuItem[] {
  const liked = library.isLiked(track);
  const items: ContextMenuItem[] = [];
  if (canAddToPlaylist.value) {
    items.push({
      key: "playlist",
      label: t("components.contextMenu.addToPlaylist"),
      icon: "&#xF4EE;",
      action: () => openPlaylistPicker(track),
    });
  }
  items.push({
    key: "like",
    label: liked ? t("components.contextMenu.unlike") : t("components.contextMenu.like"),
    icon: liked ? "&#xF47E;" : "&#xF47A;",
    filled: liked,
    action: () => library.toggleLike(track),
  });
  items.push({
    key: "queue",
    label: t("components.contextMenu.addToQueue"),
    icon: "&#xF10A;",
    action: () => addSingle(track),
  });
  if (downloads.isDownloaded(track)) {
    items.push({
      key: "download",
      label: t("common.state.downloaded"),
      icon: "&#xF151;",
      disabled: true,
      action: () => {},
    });
  } else {
    items.push({
      key: "download",
      label: t("components.contextMenu.downloadToLocal"),
      icon: "&#xF151;",
      action: () => void downloads.downloadTrack(track),
    });
  }
  if (canUploadToCloud(track)) {
    items.push({
      key: "upload-cloud",
      label: t("components.contextMenu.uploadToCloud"),
      icon: "&#xF2E5;",
      action: () => void uploadTrackToCloud(track),
    });
  }
  if (props.removable) {
    items.push({
      key: "remove",
      label: t("common.action.remove"),
      icon: "&#xF34D;",
      danger: true,
      action: () => emit("remove", track),
    });
  }
  items.push({
    key: "edit-meta",
    label: t("components.contextMenu.editTrackMeta"),
    icon: "&#xF3DE;",
    action: () => openTrackMetaEditor(track),
  });
  items.push({
    key: "copy-name",
    label: t("components.contextMenu.copyTrackName"),
    icon: "&#xF32C;",
    // 复制看到的名字：用户改过名就复制改后的
    action: () =>
      copyText(trackMeta.decorate(track).name, t("components.songTable.copyTrackNameLabel")),
  });
  const alias = track.alias;
  if (alias) {
    items.push({
      key: "copy-alias",
      label: t("components.contextMenu.copyTrackAlias"),
      icon: "&#xF32C;",
      action: () => copyText(alias, t("components.songTable.copyTrackAliasLabel")),
    });
  }
  return items;
}

/** 行右键菜单（桌面端）：在鼠标位置弹出 */
function openRowMenu(track: UnifiedTrack, event: MouseEvent) {
  // 移动端无鼠标右键，交给长按手势，避免与长按重复弹出
  if (isMobile) return;
  openContextMenu(event, rowMenuItems(track));
}

/** 移动端长按：弹出同一套菜单（底部面板标题用歌曲名） */
const longPress = useLongPress();

function onRowPointerDown(event: PointerEvent, track: UnifiedTrack) {
  longPress.start(event, (point) =>
    openContextMenuAt(point.x, point.y, rowMenuItems(track), trackTitle(trackMeta.decorate(track))),
  );
}

/* ------------------------------ 拖拽排序 ------------------------------ */

/**
 * 拖拽排序交互（`reorderable` 打开时生效）：
 * - 桌面端：按住行首的拖拽手柄拖动（HTML5 drag & drop）；
 * - 移动端：按住行的任意位置长拖（pointer 事件），手势位移超过阈值才进入
 *   拖拽态，避免和原有的「长按弹菜单」「单击播放」打架。
 *
 * 两种方式都只在本地维护「拖动中行 / 目标位置」用于渲染反馈，松手后才 emit
 * `reorder`，由页面写库并重新拉取顺序。
 */
const dragFrom = ref(-1);
const dragTo = ref(-1);
const dragging = ref(false);
/** 桌面端正在被拖走的行（key）：不依赖 reorderable，拖到侧边栏加歌单时也淡出 */
const dragKey = ref("");
/** 刚刚完成一次拖拽：吞掉随之而来的补发 click（否则移动端拖完会顺带播放） */
let suppressClick = false;

/** 桌面 HTML5 拖拽：记录起始下标 */
function onNativeDragStart(event: DragEvent, index: number): void {
  if (isMobile) return;
  const track = props.tracks[index];
  if (!track) return;
  // 任何列表的歌曲行都可以拖到侧边栏歌单（桌面端）
  dragKey.value = `${track.sourceId ?? ""}:${track.id}`;
  if (props.reorderable) {
    dragFrom.value = index;
    dragTo.value = index;
    dragging.value = true;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
      // Firefox 需要 setData 才会真正开始拖拽
      event.dataTransfer.setData("text/plain", `${index}`);
    }
  }
  // 放在最后：自定义 MIME + 纯文本落到 trackDrag 里统一写入
  startTrackDrag(event, [track]);
}

function onNativeDragOver(event: DragEvent, index: number): void {
  if (!props.reorderable || dragFrom.value < 0) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragTo.value = index;
}

function onNativeDrop(event: DragEvent, index: number): void {
  if (!props.reorderable) return;
  event.preventDefault();
  finishReorder(index);
}

function onNativeDragEnd(): void {
  // 拖到列表外松手：直接复位，不写库
  resetDrag();
  dragKey.value = "";
  endTrackDrag();
}

function resetDrag(): void {
  dragFrom.value = -1;
  dragTo.value = -1;
  dragging.value = false;
}

/** 提交排序：下标合法且确实变了才 emit */
function finishReorder(toIndex: number): void {
  const from = dragFrom.value;
  resetDrag();
  if (from < 0 || toIndex < 0 || from === toIndex) return;
  suppressClick = true;
  // 兜底：某些平台不补发 click，定时复位避免一直吞点击
  window.setTimeout(() => {
    suppressClick = false;
  }, 400);
  emit("reorder", from, toIndex);
}

/** 移动端长拖：用 pointer 事件 + 位移阈值，与长按菜单区分 */
let touchDragTimer = 0;
let touchDragStartY = 0;
let touchDragFrom = -1;

function onTouchDragDown(event: PointerEvent, index: number): void {
  if (!props.reorderable || event.pointerType === "mouse") return;
  touchDragFrom = index;
  touchDragStartY = event.clientY;
  window.clearTimeout(touchDragTimer);
  // 280ms 后仍按着才进入拖拽候选（与长按菜单的时长错开，避免同时触发）
  touchDragTimer = window.setTimeout(() => {
    if (touchDragFrom !== index) return;
    dragFrom.value = index;
    dragTo.value = index;
    dragging.value = true;
    // 进入拖拽后不再触发长按菜单与单击播放
    longPress.end();
  }, 280);
}

function onTouchDragMove(event: PointerEvent): void {
  if (!props.reorderable || dragFrom.value < 0) return;
  // 用位移换算目标行：每行高度固定 48px（移动端卡片行高见样式）
  const rowHeight = isMobile ? 56 : 48;
  const delta = Math.round((event.clientY - touchDragStartY) / rowHeight);
  const next = Math.min(props.tracks.length - 1, Math.max(0, dragFrom.value + delta));
  dragTo.value = next;
}

function onTouchDragUp(): void {
  window.clearTimeout(touchDragTimer);
  touchDragTimer = 0;
  touchDragFrom = -1;
  if (dragFrom.value < 0) return;
  finishReorder(dragTo.value);
}
</script>

<template>
  <div class="song-table" :class="{ 'is-mobile': isMobile }">
    <div class="table-header">
      <span class="col-index">#</span>
      <span class="col-title">{{ t("common.column.title") }}</span>
      <span class="col-artist">{{ t("components.songTable.columnArtist") }}</span>
      <span class="col-album">{{ t("common.column.album") }}</span>
      <span v-if="showSource" class="col-source">{{ t("common.column.source") }}</span>
      <span v-if="showPlayCount" class="col-plays">{{ t("components.songTable.columnPlayCount") }}</span>
      <span class="col-actions"></span>
      <span class="col-duration">{{ t("common.column.duration") }}</span>
    </div>

    <div v-if="!rows.length" class="table-empty">{{ emptyText }}</div>

    <div
      v-for="(row, index) in rows"
      :key="row.key"
      class="table-row"
      :class="{
        playing: row.playing,
        reorderable: reorderable,
        'drag-source': (dragging && dragFrom === index) || dragKey === row.key,
        'drag-target': dragging && dragTo === index && dragTo !== dragFrom,
      }"
      :draggable="!isMobile"
      @click="onRowClick(index)"
      @dblclick="playRow(index)"
      @contextmenu="openRowMenu(row.track, $event)"
      @pointerdown="onRowPointerDown($event, row.track)"
      @pointermove="longPress.move"
      @pointerup="longPress.end"
      @pointercancel="longPress.end"
      @pointerleave="longPress.end"
      @dragstart="onNativeDragStart($event, index)"
      @dragover="onNativeDragOver($event, index)"
      @drop="onNativeDrop($event, index)"
      @dragend="onNativeDragEnd"
    >
      <span class="col-index">
        <span v-if="row.playing" class="wp-icon filled index-playing">&#xF5AC;</span>
        <span v-else class="index-number">{{ index + 1 }}</span>
        <span class="index-hover wp-icon filled" @click="playRow(index)">&#xF610;</span>
      </span>
      <span class="col-title">
        <!-- 拖拽手柄（仅可排序列表显示）：桌面端直接拖它，移动端同样按它拖动。
             不设 draggable：实际拖动由外层行的 HTML5 拖拽 / 指针手势承担，
             手柄只提供"抓手"的视觉与移动端按住起点。 -->
        <span
          v-if="reorderable"
          class="drag-handle wp-icon"
          :title="t('components.songTable.dragHandle')"
          :aria-label="t('components.songTable.dragHandle')"
          @pointerdown.stop="onTouchDragDown($event, index)"
          @pointermove.stop="onTouchDragMove"
          @pointerup.stop="onTouchDragUp"
          @pointercancel.stop="onTouchDragUp"
          @click.stop
        >&#xE76F;</span>
        <CachedImage v-if="row.view.cover" :src="row.view.cover" class="row-cover" />
        <span v-else-if="isMobile" class="row-cover row-cover-placeholder">
          <span class="wp-icon">&#xE852;</span>
        </span>
        <span class="title-main">
          <span class="title-text ellipsis">{{ trackTitle(row.view) }}</span>
          <span v-if="row.view.alias" class="title-alias ellipsis">（{{ row.view.alias }}）</span>
          <span
            v-if="row.downloaded"
            class="title-downloaded wp-icon"
            :title="t('components.songTable.downloadedToLocal')"
            :aria-label="t('common.state.downloaded')"
          >&#xF151;</span>
        </span>
        <span v-if="row.view.vip" class="title-vip">VIP</span>
      </span>
      <span class="col-artist ellipsis">
        <template v-for="(artist, index) in row.artists" :key="`${artist.name}-${index}`">
          <span v-if="index" class="cell-sep"> / </span>
          <button
            v-if="artist.target"
            class="cell-link"
            :title="t('components.songTable.viewArtist', { name: artist.name })"
            @click.stop="go(artist.target)"
            @dblclick.stop="noop"
          >
            {{ artist.name }}
          </button>
          <span v-else>{{ artist.name }}</span>
        </template>
      </span>
      <span class="col-album ellipsis">
        <button
          v-if="row.album?.target"
          class="cell-link"
          :title="t('components.songTable.viewAlbum', { name: row.album.name })"
          @click.stop="go(row.album.target)"
          @dblclick.stop
        >
          {{ row.album.name }}
        </button>
        <template v-else>{{ row.album?.name ?? "" }}</template>
      </span>
      <span v-if="showSource" class="col-source ellipsis">{{ row.sourceName }}</span>
      <!-- 播放次数：只在历史类列表展示，未播过时留空避免整列都是 0 -->
      <span v-if="showPlayCount" class="col-plays">{{ row.playCount || "" }}</span>
      <span class="col-actions">
        <button
          class="row-action like-action"
          :class="{ liked: row.liked }"
          :title="row.liked ? t('components.contextMenu.unlike') : t('components.contextMenu.like')"
          @click.stop="toggleLike(row.track)"
        >
          <span class="wp-icon" :class="{ filled: row.liked }">{{ row.liked ? "&#xF47E;" : "&#xF47A;" }}</span>
        </button>
        <button
          v-if="canAddToPlaylist"
          class="row-action"
          :title="t('components.contextMenu.addToPlaylist')"
          @click.stop="openPlaylistPicker(row.track)"
        >
          <span class="wp-icon">&#xF4EE;</span>
        </button>
        <button
          class="row-action"
          :title="t('components.contextMenu.addToQueue')"
          @click.stop="addSingle(row.track)"
        >
          <span class="wp-icon">&#xF10A;</span>
        </button>
        <button
          v-if="removable"
          class="row-action danger"
          :title="t('common.action.remove')"
          @click.stop="emit('remove', row.track)"
        >
          <span class="wp-icon">&#xF34D;</span>
        </button>
      </span>
      <span class="col-duration">{{ formatDuration(row.track.duration) }}</span>
    </div>
  </div>
</template>

<style scoped>
.song-table {
  display: flex;
  flex-direction: column;
}

.table-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  height: 36px;
  padding: 0 var(--space-lg);
  border-bottom: 1px solid var(--wp-divider);
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.table-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  height: 48px;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-sm);
  font-size: 13px;
  transition: background var(--duration-fast) var(--ease-standard);
  cursor: default;
}

.table-row:hover {
  background: var(--wp-card-hover);
}

.table-row.playing .title-text {
  color: var(--wp-accent);
}

.table-empty {
  padding: var(--space-3xl);
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 13px;
}

.col-index {
  width: 32px;
  flex: none;
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  position: relative;
}

/* ---------------- 拖拽排序 ---------------- */

/* 手柄：贴在标题列最左侧（序号列右侧），平时低调、悬停行才显形。
   touch-action: none 让移动端按住手柄拖动时不触发页面滚动。 */
.drag-handle {
  flex: none;
  font-size: 15px;
  color: var(--wp-text-tertiary);
  opacity: 0;
  cursor: grab;
  touch-action: none;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.table-row.reorderable:hover .drag-handle,
.table-row.drag-source .drag-handle {
  opacity: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

/* 移动端没有 hover：手柄常显，且给足点击宽度 */
.song-table.is-mobile .drag-handle {
  opacity: 0.5;
  width: 22px;
  margin-left: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 拖动中的源行：淡出，给目标位置让出视觉焦点 */
.table-row.drag-source {
  opacity: 0.45;
}

/* 目标行：顶部画一条强调色落点线 */
.table-row.drag-target {
  box-shadow: inset 0 2px 0 0 var(--wp-accent);
}

.index-hover {
  display: none;
  cursor: pointer;
  color: var(--wp-text-primary);
  font-size: 12px;
}

.table-row:hover .index-number,
.table-row:hover .index-playing {
  display: none;
}

.table-row:hover .index-hover {
  display: inline-block;
}

.index-playing {
  color: var(--wp-accent);
}

.col-title {
  flex: 2;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}

.row-cover {
  width: 32px;
  height: 32px;
  border-radius: 3px;
  object-fit: cover;
  flex: none;
}

.title-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.title-text {
  flex: 0 1 auto;
  min-width: 0;
}

/* 别名用浅一号的字体；宽度不足时先于标题收缩（flex-shrink 更大），保证 VIP 标识始终可见 */
.title-alias {
  flex: 0 999 auto;
  min-width: 0;
  color: var(--wp-text-secondary);
  font-size: 12px;
}

.title-vip {
  flex: none;
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border: 1px solid var(--wp-accent);
  border-radius: 3px;
  color: var(--wp-accent);
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* 「已下载到本地」指示：跟在标题（与别名）之后 */
.title-downloaded {
  flex: none;
  font-size: 12px;
  color: var(--wp-accent);
}

.col-artist {
  flex: 1.4;
  min-width: 0;
  color: var(--wp-text-secondary);
}

.col-album {
  flex: 1.2;
  min-width: 0;
  color: var(--wp-text-secondary);
}

/* 歌手名 / 专辑名：有对应 id 时是可点击的跳转入口 */
.cell-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 3px;
}

.cell-link:hover {
  color: var(--wp-text-primary);
  text-decoration: underline;
}

.cell-sep {
  color: var(--wp-text-tertiary);
}

.col-source {
  flex: 0.8;
  min-width: 0;
  color: var(--wp-text-tertiary);
  font-size: 12px;
}

.col-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 104px;
  flex: none;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.table-row:hover .col-actions {
  opacity: 1;
}

.row-action {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.row-action:hover {
  background: var(--wp-card-active);
  color: var(--wp-text-primary);
}

.row-action.liked {
  color: var(--wp-accent);
  opacity: 1;
}

.row-action.danger:hover {
  color: var(--wp-danger);
}

.col-duration {
  width: 48px;
  flex: none;
  text-align: right;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 播放次数列：与时长列同宽，右对齐等宽数字，便于纵向扫读 */
.col-plays {
  width: 44px;
  flex: none;
  text-align: right;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ------------------------------ 移动端：两行卡片式 ------------------------------ */
/* 左：封面；中：第一行歌名、第二行歌手；右：喜欢按钮。
   隐藏序号 / 专辑 / 来源 / 时长列，单击整行即播放。 */
.song-table.is-mobile .table-header {
  display: none;
}

.song-table.is-mobile {
  gap: 2px;
}

.song-table.is-mobile .table-row {
  display: grid;
  /* 列：封面 | 文本（标题/歌手） | VIP | 操作按钮 */
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  grid-template-areas:
    "cover title vip actions"
    "cover artist .  actions";
  align-items: center;
  column-gap: var(--space-md);
  row-gap: 2px;
  height: auto;
  min-height: 60px;
  padding: var(--space-md) var(--space-sm);
  border-radius: var(--radius-md);
  /* 长列表滚动优化：离屏行跳过布局/绘制，仅保留占位高度（移动端行高固定 60px）。
     auto 关键字让浏览器记住实际尺寸，滚动条与滚动定位依旧准确。 */
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;
}

.song-table.is-mobile .table-row:active {
  background: var(--wp-card-active);
}

.song-table.is-mobile .col-index,
.song-table.is-mobile .col-album,
.song-table.is-mobile .col-source,
.song-table.is-mobile .col-plays,
.song-table.is-mobile .col-duration {
  display: none;
}

/* 让 col-title 的三个子节点（封面 / 标题 / VIP）直接参与外层网格排布，
   封面才能纵跨「标题 + 歌手」两行，与两行文字整体垂直居中。 */
.song-table.is-mobile .col-title {
  display: contents;
}

.song-table.is-mobile .row-cover {
  grid-area: cover;
  align-self: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
}

/* 无封面时用占位块占住位置，保证所有行的标题与歌手左对齐一致 */
.song-table.is-mobile .row-cover-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-tertiary);
  font-size: 18px;
  overflow: hidden;
}

.song-table.is-mobile .title-main {
  grid-area: title;
}

.song-table.is-mobile .title-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}

/* 别名在手机端太占地方，只保留主标题（别名仍可在右键/长按菜单里查看） */
.song-table.is-mobile .title-alias {
  display: none;
}

.song-table.is-mobile .title-vip {
  grid-area: vip;
}

/* 歌手与标题同属第 2 列，天然左对齐 */
.song-table.is-mobile .col-artist {
  grid-area: artist;
  font-size: 12px;
}

.song-table.is-mobile .col-actions {
  grid-area: actions;
  width: auto;
  opacity: 1;
}

.song-table.is-mobile .row-action {
  width: 36px;
  height: 36px;
}

/* 手机端只保留「喜欢」按钮，其余操作走长按菜单，避免挤占空间 */
.song-table.is-mobile .row-action:not(.like-action) {
  display: none;
}
</style>
