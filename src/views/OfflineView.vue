<script setup lang="ts">
/**
 * 离线音乐页：展示已下载到本地的曲库。
 *
 * - 按下载来源分组（歌单 / 专辑 / 歌手 / 我喜欢 / 单曲）；
 * - 顶部展示进行中的下载任务（含进度、暂停、移除），随时掌握队列状态；
 * - 每行支持播放、在文件夹中显示、导出到指定目录、移除；
 * - 文件被外部删除时标记为「失效」，可一键清理。
 */
import { computed, onMounted, ref } from "vue";
import { ContentDialog } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import { useDownloadsStore, type DownloadGroup, type OfflineSong } from "@/stores/downloads";
import { usePlayerStore } from "@/stores/player";
import { useIsMobile } from "@/composables/useIsMobile";
import { useLongPress } from "@/composables/useLongPress";
import { useRefreshable } from "@/composables/useRefreshable";
import { openContextMenu, openContextMenuAt, type ContextMenuItem } from "@/services/contextMenu";
import { copyText } from "@/services/clipboard";
import { toast } from "@/services/toast";
import { formatDuration, trackArtist, trackTitle } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

const downloads = useDownloadsStore();
const player = usePlayerStore();
const isMobile = useIsMobile();

/** 展示用分组：同一首歌可同时出现在其来源的多个分组里 */
interface OfflineSection {
  key: string;
  name: string;
  sub: string;
  songs: OfflineSong[];
  tracks: UnifiedTrack[];
}

/** 可将来源分组归入的展示桶（单曲下载 / 未分类 聚合为固定分区） */
function bucketOf(group: DownloadGroup): { key: string; name: string; sub: string; weight: number } {
  switch (group.kind) {
    case "liked":
      return { key: "liked", name: "我喜欢的音乐", sub: "喜欢", weight: 0 };
    case "playlist":
      return {
        key: `playlist:${group.sourceId ?? ""}:${group.id ?? ""}`,
        name: group.name || "歌单",
        sub: "歌单",
        weight: 1,
      };
    case "album":
      return {
        key: `album:${group.sourceId ?? ""}:${group.id ?? ""}`,
        name: group.name || "专辑",
        sub: "专辑",
        weight: 2,
      };
    case "artist":
      return {
        key: `artist:${group.sourceId ?? ""}:${group.id ?? ""}`,
        name: group.name || "歌手",
        sub: "歌手",
        weight: 3,
      };
    default:
      return { key: "single", name: "单曲下载", sub: "单曲", weight: 8 };
  }
}

const visibleSongs = computed(() => downloads.songs.filter((song) => !song.missing));

const sections = computed<OfflineSection[]>(() => {
  const map = new Map<string, OfflineSection & { weight: number }>();
  for (const song of visibleSongs.value) {
    const groups: DownloadGroup[] = song.groups.length
      ? song.groups
      : [{ kind: "single", name: "未分类" }];
    for (const group of groups) {
      const bucket = bucketOf(group);
      let section = map.get(bucket.key);
      if (!section) {
        section = {
          key: bucket.key,
          name: bucket.name,
          sub: bucket.sub,
          songs: [],
          tracks: [],
          weight: bucket.weight,
        };
        map.set(bucket.key, section);
      }
      section.songs.push(song);
      section.tracks.push(song.track);
    }
  }
  return [...map.values()].sort((a, b) => a.weight - b.weight || b.songs.length - a.songs.length);
});

const activeTasks = computed(() => downloads.activeTasks);

/** 当前播放曲目键（用于高亮） */
function trackKey(track: UnifiedTrack): string {
  return `${track.sourceId ?? ""}:${track.id}`;
}

const currentKey = computed(() =>
  player.currentTrack ? trackKey(player.currentTrack) : "",
);

function isPlaying(song: OfflineSong): boolean {
  return Boolean(currentKey.value) && currentKey.value === trackKey(song.track);
}

/* ------------------------------ 播放 ------------------------------ */

function playSection(section: OfflineSection, index: number): void {
  if (section.tracks.length) void player.playTracks(section.tracks, index);
}

function onRowClick(section: OfflineSection, index: number): void {
  if (isMobile) playSection(section, index);
}

function playAll(): void {
  if (downloads.offlineTracks.length) void player.playTracks(downloads.offlineTracks, 0);
}

function shufflePlay(): void {
  const tracks = downloads.offlineTracks;
  if (tracks.length) void player.playTracks(tracks, Math.floor(Math.random() * tracks.length));
}

/* ------------------------------ 行操作 ------------------------------ */

async function reveal(song: OfflineSong): Promise<void> {
  await downloads.reveal(song);
}

async function exportSong(song: OfflineSong): Promise<void> {
  await downloads.exportSong(song);
}

/** 需要确认的待删除项 */
const pendingDelete = ref<OfflineSong | null>(null);
interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const deleteDialogRef = ref<DialogRef | null>(null);

async function askDelete(song: OfflineSong): Promise<void> {
  pendingDelete.value = song;
  const result = await deleteDialogRef.value?.ShowAsync();
  if (result !== "Primary" || !pendingDelete.value) {
    pendingDelete.value = null;
    return;
  }
  await downloads.deleteSong(pendingDelete.value);
  pendingDelete.value = null;
}

function menuItems(song: OfflineSong): ContextMenuItem[] {
  return [
    {
      key: "play",
      label: "播放",
      icon: "&#xF610;",
      filled: true,
      action: () => void player.playTrack(song.track, downloads.offlineTracks),
    },
    {
      key: "reveal",
      label: "在文件夹中显示",
      icon: "&#xF42F;",
      action: () => void reveal(song),
    },
    {
      key: "export",
      label: "导出到…",
      icon: "&#xF680;",
      action: () => void exportSong(song),
    },
    {
      key: "copy-name",
      label: "复制歌曲名",
      icon: "&#xF32C;",
      action: () => copyText(song.track.name, "歌曲名"),
    },
    {
      key: "delete",
      label: "从离线音乐移除",
      icon: "&#xF34D;",
      danger: true,
      action: () => void askDelete(song),
    },
  ];
}

/** 桌面端右键菜单 */
function openRowMenu(song: OfflineSong, event: MouseEvent): void {
  if (isMobile) return;
  openContextMenu(event, menuItems(song));
}

/** 移动端长按菜单 */
const longPress = useLongPress();

function onRowPointerDown(event: PointerEvent, song: OfflineSong): void {
  longPress.start(event, (point) => openContextMenuAt(point.x, point.y, menuItems(song)));
}

/* ------------------------------ 失效清理 ------------------------------ */

async function cleanMissing(): Promise<void> {
  const count = await downloads.cleanMissing();
  toast(count ? `已清理 ${count} 条失效记录` : "没有可清理的记录", "success");
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(() => void downloads.refreshMissing());
useRefreshable(() => downloads.refreshMissing());
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <div class="wp-page-header">
      <div class="header-cover">
        <span class="wp-icon">&#xF151;</span>
      </div>
      <div class="header-meta">
        <h1 class="wp-page-title">离线音乐</h1>
        <div class="header-sub">
          {{ downloads.downloadedCount }} 首 · {{ downloads.formatBytes(downloads.totalSize) }}
          <template v-if="downloads.missingCount">
            · <span class="missing-hint">{{ downloads.missingCount }} 个文件已丢失</span>
          </template>
        </div>
      </div>
      <div class="header-actions">
        <button class="wp-accent-button" :disabled="!downloads.offlineTracks.length" @click="playAll">
          <span class="wp-icon filled">&#xF610;</span>播放全部
        </button>
        <button class="wp-standard-button" :disabled="!downloads.offlineTracks.length" @click="shufflePlay">
          <span class="wp-icon">&#xEF37;</span>随机播放
        </button>
      </div>
    </div>

    <!-- 进行中的下载任务 -->
    <section v-if="activeTasks.length" class="task-section">
      <h2 class="wp-section-title">正在下载</h2>
      <ul class="task-list">
        <li v-for="task in activeTasks" :key="task.id" class="task-row">
          <span class="task-status wp-icon" :class="{ paused: task.status === 'paused' }">
            {{ task.status === "downloading" ? "&#xF151;" : "&#xF610;" }}
          </span>
          <div class="task-main">
            <div class="task-title ellipsis">{{ trackTitle(task.track) }}</div>
            <div class="task-progress">
              <div
                class="task-progress-fill"
                :style="{
                  width: task.total > 0 ? `${Math.round((task.downloaded / task.total) * 100)}%` : '0%',
                }"
              />
            </div>
          </div>
          <span class="task-text">
            {{
              task.status === "paused"
                ? "已暂停"
                : task.total > 0
                  ? `${downloads.formatBytes(task.downloaded)} / ${downloads.formatBytes(task.total)}`
                  : "排队中"
            }}
          </span>
          <button
            v-if="task.status === 'downloading'"
            class="task-action"
            title="暂停"
            @click="downloads.pauseTask(task.id)"
          >
            <span class="wp-icon filled">&#xF610;</span>
          </button>
          <button
            v-else-if="task.status === 'paused'"
            class="task-action"
            title="继续"
            @click="downloads.resumeTask(task.id)"
          >
            <span class="wp-icon filled">&#xF5AC;</span>
          </button>
          <button class="task-action" title="移除" @click="downloads.removeTask(task.id)">
            <span class="wp-icon">&#xF36A;</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- 失效文件提示 -->
    <div v-if="downloads.missingCount" class="missing-banner">
      <span class="wp-icon missing-icon">&#xE7BA;</span>
      <span class="missing-text">
        有 {{ downloads.missingCount }} 个已下载文件不在了（可能被移动或删除），它们不会出现在下方列表。
      </span>
      <button class="wp-standard-button small" @click="cleanMissing">清理记录</button>
    </div>

    <template v-if="sections.length">
      <section v-for="section in sections" :key="section.key" class="offline-section">
        <h2 class="wp-section-title">
          {{ section.name }}
          <span class="section-sub">{{ section.sub }} · {{ section.songs.length }} 首</span>
        </h2>

        <div class="offline-list">
          <div
            v-for="(song, index) in section.songs"
            :key="`${song.sourceId}:${song.trackId}`"
            class="offline-row"
            :class="{ playing: isPlaying(song) }"
            @click="onRowClick(section, index)"
            @dblclick="playSection(section, index)"
            @contextmenu="openRowMenu(song, $event)"
            @pointerdown="onRowPointerDown($event, song)"
            @pointermove="longPress.move"
            @pointerup="longPress.end"
            @pointercancel="longPress.end"
            @pointerleave="longPress.end"
          >
            <span class="col-index">
              <span v-if="isPlaying(song)" class="wp-icon filled index-playing">&#xF5AC;</span>
              <span v-else class="index-number">{{ index + 1 }}</span>
            </span>
            <CachedImage v-if="song.track.cover" :src="song.track.cover" class="row-cover" />
            <span v-else class="row-cover row-cover-placeholder">
              <span class="wp-icon">&#xE852;</span>
            </span>
            <span class="col-title">
              <span class="title-text ellipsis">{{ trackTitle(song.track) }}</span>
              <span v-if="song.hasLyrics" class="lyric-badge" title="含歌词">LRC</span>
            </span>
            <span class="col-artist ellipsis">{{ trackArtist(song.track) }}</span>
            <span class="col-size">{{ downloads.formatBytes(song.size) }}</span>
            <span class="col-duration">{{ formatDuration(song.track.duration) }}</span>
            <span class="col-actions">
              <button class="row-action" title="在文件夹中显示" @click.stop="reveal(song)">
                <span class="wp-icon">&#xF42F;</span>
              </button>
              <button class="row-action" title="导出到…" @click.stop="exportSong(song)">
                <span class="wp-icon">&#xF680;</span>
              </button>
              <button class="row-action danger" title="从离线音乐移除" @click.stop="askDelete(song)">
                <span class="wp-icon">&#xF34D;</span>
              </button>
            </span>
          </div>
        </div>
      </section>
    </template>

    <EmptyState
      v-else-if="!activeTasks.length"
      icon="&#xF151;"
      title="还没有离线音乐"
      description="在歌曲上右键（移动端长按）选择「下载到本地」，或在歌单 / 专辑 / 我喜欢的音乐页点击「缓存全部」，下载后的歌曲可离线播放。"
    />

    <ContentDialog
      ref="deleteDialogRef"
      :Title="`移除「${pendingDelete ? trackTitle(pendingDelete.track) : ''}」`"
      PrimaryButtonText="移除"
      CloseButtonText="取消"
    >
      <p class="delete-tip">将从设备中删除该音频文件（含歌词），此操作不可撤销。</p>
    </ContentDialog>
  </div>
</template>

<style scoped>
.header-cover {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--wp-accent), var(--wp-accent-active));
  color: var(--wp-text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  flex: none;
  box-shadow: var(--shadow-card);
}

.header-meta {
  flex: 1;
  min-width: 0;
}

.header-sub {
  font-size: 13px;
  color: var(--wp-text-secondary);
  margin-top: var(--space-sm);
}

.missing-hint {
  color: var(--wp-danger);
}

.header-actions {
  display: flex;
  gap: var(--space-md);
}

.small {
  height: 26px;
  font-size: 12px;
  padding: 0 12px;
}

/* ---------------- 进行中的任务 ---------------- */
.task-section {
  margin-bottom: var(--space-2xl);
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-md);
  background: var(--wp-card);
  margin-bottom: var(--space-sm);
}

.task-status {
  flex: none;
  font-size: 15px;
  color: var(--wp-accent);
}

.task-status.paused {
  color: var(--wp-text-tertiary);
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: 13px;
}

.task-progress {
  height: 3px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--wp-accent);
  transition: width 0.2s linear;
}

.task-text {
  flex: none;
  font-size: 12px;
  color: var(--wp-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.task-action {
  width: 28px;
  height: 28px;
  flex: none;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.task-action:hover {
  background: var(--wp-card-active);
  color: var(--wp-text-primary);
}

/* ---------------- 失效提示 ---------------- */
.missing-banner {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  margin-bottom: var(--space-2xl);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-md);
  background: var(--wp-card);
}

.missing-icon {
  flex: none;
  font-size: 16px;
  color: var(--wp-danger);
}

.missing-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* ---------------- 离线列表 ---------------- */
.offline-section {
  margin-bottom: var(--space-2xl);
}

.offline-section .wp-section-title {
  margin: 0 0 var(--space-md) var(--space-sm);
}

.section-sub {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-text-tertiary);
  margin-left: var(--space-md);
}

.offline-list {
  display: flex;
  flex-direction: column;
}

.offline-row {
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

.offline-row:hover {
  background: var(--wp-card-hover);
}

.offline-row.playing .title-text {
  color: var(--wp-accent);
}

.col-index {
  width: 32px;
  flex: none;
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 12px;
}

.index-playing {
  color: var(--wp-accent);
  font-size: 12px;
}

.row-cover {
  width: 32px;
  height: 32px;
  border-radius: 3px;
  object-fit: cover;
  flex: none;
}

.row-cover-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-tertiary);
  font-size: 15px;
}

.col-title {
  flex: 2;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.title-text {
  flex: 0 1 auto;
  min-width: 0;
}

.lyric-badge {
  flex: none;
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
  border: 1px solid var(--wp-text-tertiary);
  border-radius: 3px;
  color: var(--wp-text-tertiary);
  font-weight: 600;
  letter-spacing: 0.5px;
}

.col-artist {
  flex: 1.4;
  min-width: 0;
  color: var(--wp-text-secondary);
}

.col-size {
  width: 72px;
  flex: none;
  text-align: right;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.col-duration {
  width: 48px;
  flex: none;
  text-align: right;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.col-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 96px;
  flex: none;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.offline-row:hover .col-actions {
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

.row-action.danger:hover {
  color: var(--wp-danger);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-tip {
  margin: 0;
  font-size: 13px;
  color: var(--wp-text-secondary);
}

/* ---------------- 移动端 ---------------- */
.wp-page.is-mobile .header-cover {
  width: 64px;
  height: 64px;
  font-size: 28px;
}

.wp-page.is-mobile .header-actions {
  flex: 1 1 100%;
  margin-top: var(--space-md);
}

.wp-page.is-mobile .offline-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "cover title actions"
    "cover artist actions";
  column-gap: var(--space-md);
  row-gap: 2px;
  align-items: center;
  height: auto;
  min-height: 60px;
  padding: var(--space-md) var(--space-sm);
}

.wp-page.is-mobile .col-index,
.wp-page.is-mobile .col-size,
.wp-page.is-mobile .col-duration {
  display: none;
}

.wp-page.is-mobile .row-cover {
  grid-area: cover;
  align-self: center;
  width: 44px;
  height: 44px;
}

.wp-page.is-mobile .col-title {
  grid-area: title;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.wp-page.is-mobile .title-text {
  font-size: 14px;
  font-weight: 600;
}

.wp-page.is-mobile .col-artist {
  grid-area: artist;
  font-size: 12px;
}

.wp-page.is-mobile .col-actions {
  grid-area: actions;
  opacity: 1;
  width: auto;
}
</style>
