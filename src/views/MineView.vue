<script setup lang="ts">
/**
 * 「我的」页（移动端）：头像（插件提供）+ 我喜欢的音乐 + 所有歌单
 * - 本地歌单：右上角新建，长按弹出菜单（播放全部 / 重命名 / 删除）
 * - 平台歌单：来自启用 myPlaylists 能力的插件，可手动同步
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ContentDialog, PersonPicture, TextBox } from "@/components/winui";
import { useLibraryStore, type LocalPlaylist } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useDownloadsStore } from "@/stores/downloads";
import { useHistoryStore } from "@/stores/history";
import { pluginDisplayName, usePluginsStore, type AggregatedSourceResult, type AppAvatar } from "@/stores/plugins";
import { openContextMenuAt } from "@/services/contextMenu";
import { openImportDialog } from "@/services/playlistIO";
import { useRefreshable } from "@/composables/useRefreshable";
import type { UnifiedPlaylist } from "@/types/plugin";
import CachedImage from "@/components/common/CachedImage.vue";

const router = useRouter();
const library = useLibraryStore();
const player = usePlayerStore();
const plugins = usePluginsStore();
const downloads = useDownloadsStore();
const history = useHistoryStore();

/* ------------------------------ 头像（插件能力） ------------------------------ */

const avatar = ref<AppAvatar | null>(null);

const avatarUrl = computed(() => avatar.value?.image ?? "");
const avatarTitle = computed(() => {
  if (!avatar.value) return "未登录任何插件账户";
  const name = pluginDisplayName(plugins.records, avatar.value.sourceId);
  const label = avatar.value.label?.trim();
  return [label, name].filter(Boolean).join(" · ") || "账户";
});

async function loadAvatar() {
  try {
    avatar.value = await plugins.getAvatar();
  } catch {
    avatar.value = null;
  }
}

/** 插件安装/启停/配置变化后重新取头像（配置变更会重建沙箱） */
watch(
  () => plugins.records,
  () => void loadAvatar(),
  { deep: true },
);

/* ------------------------------ 平台歌单（与 SideNav 同源） ------------------------------ */

const hasMyPlaylistsPlugin = computed(() =>
  plugins.records.some((r) => r.enabled && plugins.hasCapability(r, "myPlaylists")),
);

interface PlatformNavItem {
  key: string;
  sourceId: string;
  playlistId: string;
  name: string;
  sourceName: string;
}

const platformGroups = ref<AggregatedSourceResult<UnifiedPlaylist[]>[]>([]);
const platformLoading = ref(false);

const platformItems = computed<PlatformNavItem[]>(() => {
  const items: PlatformNavItem[] = [];
  for (const group of platformGroups.value) {
    for (const p of group.result ?? []) {
      items.push({
        key: `${group.record.entry.id}:${p.id}`,
        sourceId: group.record.entry.id,
        playlistId: p.id,
        name: p.name,
        sourceName: group.record.entry.manifest.name,
      });
    }
  }
  return items;
});

const platformErrors = computed(() =>
  platformGroups.value.filter((g) => g.error && !(g.result?.length ?? 0)),
);

async function loadPlatformPlaylists() {
  if (!hasMyPlaylistsPlugin.value) {
    platformGroups.value = [];
    return;
  }
  platformLoading.value = true;
  try {
    platformGroups.value = await plugins.getUserPlaylistsAll();
  } finally {
    platformLoading.value = false;
  }
}

onMounted(() => {
  void loadAvatar();
  void loadPlatformPlaylists();
  // 最近播放的计数徽标：直接进本页时历史可能还没加载完
  if (!history.loaded) void history.load();
});

// 下拉刷新：重新读取头像与平台歌单
useRefreshable(async () => {
  await Promise.all([loadAvatar(), loadPlatformPlaylists(), history.load()]);
});

/* ------------------------------ 新建 / 重命名 / 删除 ------------------------------ */

/** ContentDialog 通过 ShowAsync() 打开（库没有 IsOpen prop） */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}

const createDialogRef = ref<DialogRef | null>(null);
const renameDialogRef = ref<DialogRef | null>(null);
const deleteDialogRef = ref<DialogRef | null>(null);

const newPlaylistName = ref("");
const newPlaylistDescription = ref("");
const renameTarget = ref<LocalPlaylist | null>(null);
const renameValue = ref("");
const deleteTarget = ref<LocalPlaylist | null>(null);

async function openCreateDialog() {
  newPlaylistName.value = "";
  newPlaylistDescription.value = "";
  const result = await createDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  const playlist = await library.createPlaylist(newPlaylistName.value, newPlaylistDescription.value);
  if (playlist) {
    void router.push({ name: "playlist", params: { id: playlist.id } });
  }
}

/* ------------------------------ 长按菜单 ------------------------------ */

let pressTimer: number | null = null;
let pressPoint = { x: 0, y: 0 };
let longPressFired = false;

function cancelPress() {
  if (pressTimer !== null) {
    window.clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function onItemTouchStart(event: TouchEvent, playlist: LocalPlaylist) {
  const touch = event.touches[0];
  if (!touch) return;
  pressPoint = { x: touch.clientX, y: touch.clientY };
  longPressFired = false;
  cancelPress();
  pressTimer = window.setTimeout(() => {
    pressTimer = null;
    longPressFired = true;
    openPlaylistMenu(pressPoint.x, pressPoint.y, playlist);
  }, 500);
}

function onItemTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || pressTimer === null) return;
  if (
    Math.abs(touch.clientX - pressPoint.x) > 10 ||
    Math.abs(touch.clientY - pressPoint.y) > 10
  ) {
    cancelPress();
  }
}

function onItemTouchEnd() {
  cancelPress();
}

async function playPlaylist(playlist: LocalPlaylist) {
  const tracks = await library.getPlaylistTracks(playlist.id);
  if (tracks.length) void player.playTracks(tracks, 0);
}

function openPlaylistMenu(x: number, y: number, playlist: LocalPlaylist) {
  openContextMenuAt(x, y, [
    {
      key: "play",
      label: "播放全部",
      icon: "&#xF610;",
      filled: true,
      action: () => playPlaylist(playlist),
    },
    {
      key: "rename",
      label: "重命名",
      icon: "&#xF3DE;",
      action: () => openRenameDialog(playlist),
    },
    {
      key: "delete",
      label: "删除歌单",
      icon: "&#xF34D;",
      danger: true,
      action: () => openDeleteDialog(playlist),
    },
  ]);
}

async function openRenameDialog(playlist: LocalPlaylist) {
  renameTarget.value = playlist;
  renameValue.value = playlist.name;
  const result = await renameDialogRef.value?.ShowAsync();
  if (result !== "Primary" || !renameTarget.value) return;
  await library.renamePlaylist(renameTarget.value.id, renameValue.value);
  renameTarget.value = null;
}

async function openDeleteDialog(playlist: LocalPlaylist) {
  deleteTarget.value = playlist;
  const result = await deleteDialogRef.value?.ShowAsync();
  if (result !== "Primary" || !deleteTarget.value) return;
  await library.deletePlaylist(deleteTarget.value.id);
  deleteTarget.value = null;
}

function onPlaylistClick(playlist: LocalPlaylist) {
  // 长按菜单触发后的合成 click 不导航
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  void router.push({ name: "playlist", params: { id: playlist.id } });
}
</script>

<template>
  <div class="wp-page mine-page">
    <!-- 头像 -->
    <div class="profile">
      <div class="avatar-wrap">
        <CachedImage v-if="avatarUrl" :src="avatarUrl" class="avatar-image" />
        <PersonPicture v-else DisplayName="音" :Width="72" :Height="72" FontSize="30" />
      </div>
      <div class="profile-meta">
        <div class="profile-title">{{ avatarTitle }}</div>
        <div class="profile-sub">头像由已登录的插件提供</div>
      </div>
    </div>

    <!-- 我喜欢的音乐 -->
    <button class="liked-entry" @click="router.push({ name: 'liked' })">
      <span class="wp-icon liked-icon">&#xF47A;</span>
      <span class="liked-label">我喜欢的音乐</span>
      <span v-if="library.liked.length" class="liked-badge">{{ library.liked.length }}</span>
      <span class="wp-icon liked-chevron">&#xF2B1;</span>
    </button>

    <!-- 最近播放 -->
    <button class="liked-entry history-entry" @click="router.push({ name: 'history' })">
      <span class="wp-icon liked-icon">&#xF2A1;</span>
      <span class="liked-label">最近播放</span>
      <span v-if="history.entries.length" class="liked-badge">
        {{ history.entries.length }} 首
      </span>
      <span class="wp-icon liked-chevron">&#xF2B1;</span>
    </button>

    <!-- 离线音乐 -->
    <button class="liked-entry offline-entry" @click="router.push({ name: 'offline' })">
      <span class="wp-icon liked-icon">&#xF151;</span>
      <span class="liked-label">离线音乐</span>
      <span v-if="downloads.downloadedCount" class="liked-badge">{{ downloads.downloadedCount }} 首</span>
      <span class="wp-icon liked-chevron">&#xF2B1;</span>
    </button>

    <!-- 本地歌单 -->
    <div class="section-header">
      <span class="section-title">歌单</span>
      <span v-if="library.playlists.length" class="section-count">{{ library.playlists.length }}</span>
      <span class="add-buttons">
        <button class="add-button" title="导入歌单（.json / .m3u8）" @click="openImportDialog">
          <span class="wp-icon">&#xF3B3;</span>
        </button>
        <button class="add-button" title="新建歌单" @click="openCreateDialog">
          <span class="wp-icon">&#xF10A;</span>
        </button>
      </span>
    </div>

    <ul class="playlist-list">
      <li v-for="playlist in library.playlists" :key="playlist.id">
        <button
          class="playlist-item"
          @click="onPlaylistClick(playlist)"
          @touchstart.passive="onItemTouchStart($event, playlist)"
          @touchmove.passive="onItemTouchMove($event)"
          @touchend="onItemTouchEnd"
          @touchcancel="onItemTouchEnd"
        >
          <span class="wp-icon playlist-icon">&#xF4EE;</span>
          <span class="playlist-name ellipsis">{{ playlist.name }}</span>
          <span v-if="playlist.trackCount" class="playlist-badge">{{ playlist.trackCount }}</span>
        </button>
      </li>
      <li v-if="!library.playlists.length" class="list-empty">还没有歌单，点击 + 创建</li>
    </ul>

    <!-- 平台歌单 -->
    <template v-if="hasMyPlaylistsPlugin">
      <div class="section-header">
        <span class="section-title">平台歌单</span>
        <button
          class="add-button"
          :class="{ spinning: platformLoading }"
          title="同步平台歌单"
          @click="loadPlatformPlaylists"
        >
          <span class="wp-icon">&#xF191;</span>
        </button>
      </div>

      <ul class="playlist-list">
        <li v-for="item in platformItems" :key="item.key">
          <button
            class="playlist-item"
            @click="
              router.push({
                name: 'sourcePlaylist',
                params: { source: item.sourceId, id: item.playlistId },
                query: { mine: '1' },
              })
            "
          >
            <span class="wp-icon playlist-icon">&#xF4EE;</span>
            <span class="playlist-name ellipsis">{{ item.name }}</span>
            <span class="playlist-source">{{ item.sourceName }}</span>
          </button>
        </li>
        <li v-for="group in platformErrors" :key="`err:${group.record.entry.id}`" class="list-empty">
          {{ group.record.entry.manifest.name }}：{{ group.error }}
        </li>
        <li v-if="!platformItems.length && !platformErrors.length" class="list-empty">
          {{ platformLoading ? "正在同步…" : "暂无平台歌单" }}
        </li>
      </ul>
    </template>

    <ContentDialog ref="createDialogRef" Title="新建歌单" PrimaryButtonText="创建" CloseButtonText="取消">
      <div class="dialog-form">
        <TextBox
          :Text="newPlaylistName"
          PlaceholderText="歌单名称"
          :MaxLength="50"
          @update:Text="newPlaylistName = String($event ?? '')"
        />
        <TextBox
          :Text="newPlaylistDescription"
          PlaceholderText="歌单简介（可选）"
          :MaxLength="200"
          @update:Text="newPlaylistDescription = String($event ?? '')"
        />
      </div>
    </ContentDialog>

    <ContentDialog
      ref="renameDialogRef"
      Title="重命名歌单"
      PrimaryButtonText="确定"
      CloseButtonText="取消"
    >
      <div class="dialog-form">
        <TextBox
          :Text="renameValue"
          PlaceholderText="歌单名称"
          :MaxLength="50"
          @update:Text="renameValue = String($event ?? '')"
        />
      </div>
    </ContentDialog>

    <ContentDialog
      ref="deleteDialogRef"
      :Title="`删除歌单「${deleteTarget?.name ?? ''}」`"
      PrimaryButtonText="删除"
      CloseButtonText="取消"
    >
      <p class="delete-tip">歌单内的歌曲记录将一并删除，此操作不可撤销。</p>
    </ContentDialog>
  </div>
</template>

<style scoped>
.mine-page {
  padding-left: var(--space-xl);
  padding-right: var(--space-xl);
}

/* ---------------- 头像 ---------------- */
.profile {
  display: flex;
  align-items: center;
  gap: var(--space-xl);
  padding: var(--space-lg) 0 var(--space-2xl);
}

.avatar-wrap {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  overflow: hidden;
  flex: none;
  background: var(--wp-control-fill-secondary);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.profile-title {
  font-size: 18px;
  font-weight: 600;
}

.profile-sub {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  margin-top: 4px;
}

/* ---------------- 喜欢入口 ---------------- */
.liked-entry {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  height: 56px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-md);
  background: var(--wp-layer);
  color: var(--wp-text-primary);
  font: inherit;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.liked-entry:active {
  background: var(--wp-card-active);
}

/* 三个并列入口：从第二个起与上一个留出间距 */
.history-entry,
.offline-entry {
  margin-top: var(--space-sm);
}

.liked-icon {
  font-size: 18px;
  color: var(--wp-accent);
}

.liked-label {
  flex: 1;
  text-align: left;
  font-size: 14px;
  font-weight: 600;
}

.liked-badge {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.liked-chevron {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* ---------------- 分区 ---------------- */
.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-2xl) var(--space-sm) var(--space-md);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.section-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

/* 导入 + 新建两个并列的小按钮 */
.add-buttons {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.add-button {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard);
}

.add-button:active {
  background: var(--wp-card-active);
}

.add-button.spinning .wp-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------------- 歌单列表 ---------------- */
.playlist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.playlist-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  height: 48px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-primary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.playlist-item:active {
  background: var(--wp-card-active);
}

.playlist-icon {
  font-size: 16px;
  color: var(--wp-text-secondary);
  flex: none;
}

.playlist-name {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.playlist-badge {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  flex: none;
}

.playlist-source {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  flex: none;
}

.list-empty {
  padding: var(--space-md) var(--space-lg);
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-md) 0;
}

.delete-tip {
  margin: 0;
  font-size: 13px;
  color: var(--wp-text-secondary);
}
</style>
