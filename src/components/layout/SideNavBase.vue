<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ContentDialog, TextBox } from "@/components/winui";
import { useLibraryStore, type LocalPlaylist } from "@/stores/library";
import { usePluginsStore, type AggregatedSourceResult } from "@/stores/plugins";
import { useDownloadsStore } from "@/stores/downloads";
import { openContextMenu, type ContextMenuItem } from "@/services/contextMenu";
import { openImportDialog } from "@/services/playlistIO";
import type { UnifiedPlaylist } from "@/types/plugin";

const router = useRouter();
const route = useRoute();
const library = useLibraryStore();
const plugins = usePluginsStore();
const downloads = useDownloadsStore();

/** ContentDialog 通过 ShowAsync() 打开（库没有 IsOpen prop） */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const createDialogRef = ref<DialogRef | null>(null);
const newPlaylistName = ref("");
const newPlaylistDescription = ref("");

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

/* ------------------------------ 歌单右键菜单（重命名 / 删除） ------------------------------ */

interface RenameDialogRef {
  ShowAsync: () => Promise<string>;
}

const renameDialogRef = ref<RenameDialogRef | null>(null);
const deleteDialogRef = ref<RenameDialogRef | null>(null);
const menuPlaylist = ref<LocalPlaylist | null>(null);
const renameValue = ref("");

function openPlaylistMenu(playlist: LocalPlaylist, event: MouseEvent) {
  const items: ContextMenuItem[] = [
    {
      key: "rename",
      label: "重命名歌单",
      icon: "&#xF66A;",
      action: () => openRenameDialog(playlist),
    },
    {
      key: "delete",
      label: "删除歌单",
      icon: "&#xF34D;",
      danger: true,
      action: () => openDeleteDialog(playlist),
    },
  ];
  openContextMenu(event, items);
}

async function openRenameDialog(playlist: LocalPlaylist) {
  menuPlaylist.value = playlist;
  renameValue.value = playlist.name;
  const result = await renameDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await library.renamePlaylist(playlist.id, renameValue.value);
}

async function openDeleteDialog(playlist: LocalPlaylist) {
  menuPlaylist.value = playlist;
  const result = await deleteDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await library.deletePlaylist(playlist.id);
  // 正在浏览被删除的歌单时跳走
  if (route.name === "playlist" && route.params.id === String(playlist.id)) {
    void router.replace({ name: "liked" });
  }
}

/* 滑动选中药丸（WinUI NavigationView 风格） */

/* ------------------------------ 平台歌单分组 ------------------------------ */

/** 存在启用的个人歌单插件时才展示该分组 */
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

/** 侧边栏直接列出各插件平台的个人歌单 */
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

/** 同步失败（多为未登录/登录过期）的插件，供分组内提示 */
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

function isPlatformActive(item: PlatformNavItem): boolean {
  return (
    route.name === "sourcePlaylist" &&
    route.params.source === item.sourceId &&
    route.params.id === item.playlistId
  );
}

onMounted(() => void loadPlatformPlaylists());

/* 插件安装/启停/配置变化后重新同步（配置变更会重建沙箱） */
watch(
  () => plugins.records,
  () => void loadPlatformPlaylists(),
  { deep: true },
);
const scrollPill = ref({ top: 0, visible: false });
const footerPill = ref({ top: 0, visible: false });
const pillsReady = ref(false);

function updatePill(container: Element | null, pill: typeof scrollPill): void {
  if (!container) return;
  const active = container.querySelector<HTMLElement>(".nav-item.active");
  if (!active) {
    pill.value.visible = false;
    return;
  }
  pill.value = { top: active.offsetTop, visible: true };
}

function updatePills(): void {
  updatePill(document.querySelector(".sidenav-scroll"), scrollPill);
  updatePill(document.querySelector(".nav-footer"), footerPill);
}

/** 定位样式：offset 用于强调胶囊相对药丸的垂直居中偏移（(36-16)/2 = 10px） */
function pillStyle(pill: { top: number; visible: boolean }, offset = 0) {
  return {
    top: `${pill.top + offset}px`,
    opacity: pill.visible ? "1" : "0",
    transition: pillsReady.value ? undefined : "none",
  };
}

/** 解除初始定位的 transition:none。
 * rAF 在页面不可见（窗口最小化/被完全遮挡）时不会触发，会导致
 * transition:none 永久残留、导航时药丸瞬移，故加 setTimeout 兜底。 */
function markPillsReady(): void {
  if (pillsReady.value) return;
  pillsReady.value = true;
}

onMounted(() => {
  void nextTick(() => {
    updatePills();
    requestAnimationFrame(markPillsReady);
    window.setTimeout(markPillsReady, 320);
  });
});

watch(
  () => [route.fullPath, library.playlists.length, platformItems.value.length],
  async () => {
    await nextTick();
    updatePills();
  },
);

function isActive(name: string): boolean {
  return route.name === name;
}
</script>

<template>
  <nav class="sidenav">
    <div class="sidenav-scroll">
      <span class="nav-pill" :style="pillStyle(scrollPill)" aria-hidden="true" />
      <span class="nav-accent" :style="pillStyle(scrollPill, 10)" aria-hidden="true" />
      <ul class="nav-list">
        <li>
          <router-link :to="{ name: 'recommend' }" class="nav-item" :class="{ active: isActive('recommend') }">
            <span class="wp-icon nav-icon">&#xF481;</span>
            <span class="nav-label">推荐</span>
          </router-link>
        </li>
        <li>
          <router-link :to="{ name: 'liked' }" class="nav-item" :class="{ active: isActive('liked') }">
            <span class="wp-icon nav-icon">&#xF47A;</span>
            <span class="nav-label">我喜欢的音乐</span>
            <span v-if="library.liked.length" class="nav-badge">{{ library.liked.length }}</span>
          </router-link>
        </li>
        <li>
          <router-link :to="{ name: 'history' }" class="nav-item" :class="{ active: isActive('history') }">
            <span class="wp-icon nav-icon">&#xF2A1;</span>
            <span class="nav-label">最近播放</span>
          </router-link>
        </li>
        <li>
          <router-link :to="{ name: 'offline' }" class="nav-item" :class="{ active: isActive('offline') }">
            <span class="wp-icon nav-icon">&#xF151;</span>
            <span class="nav-label">离线音乐</span>
            <span v-if="downloads.downloadedCount" class="nav-badge">{{ downloads.downloadedCount }}</span>
          </router-link>
        </li>
      </ul>

      <div class="nav-section-header">
        <span class="nav-section-title">歌单</span>
        <span class="add-buttons">
          <button class="add-button" title="导入歌单（.json / .m3u8）" @click="openImportDialog">
            <span class="wp-icon">&#xF3B3;</span>
          </button>
          <button class="add-button" title="新建歌单" @click="openCreateDialog">
            <span class="wp-icon">&#xF10A;</span>
          </button>
        </span>
      </div>

      <ul class="nav-list">
        <li v-for="playlist in library.playlists" :key="playlist.id">
          <router-link
            :to="{ name: 'playlist', params: { id: playlist.id } }"
            class="nav-item"
            :class="{ active: route.name === 'playlist' && route.params.id === String(playlist.id) }"
            :title="playlist.name"
            @contextmenu="openPlaylistMenu(playlist, $event)"
          >
            <span class="wp-icon nav-icon">&#xF4EE;</span>
            <span class="nav-label ellipsis">{{ playlist.name }}</span>
            <span v-if="playlist.trackCount" class="nav-badge">{{ playlist.trackCount }}</span>
          </router-link>
        </li>
        <li v-if="!library.playlists.length" class="nav-empty">还没有歌单，点击 + 创建</li>
      </ul>

      <template v-if="hasMyPlaylistsPlugin">
        <div class="nav-section-header">
          <span class="nav-section-title">平台歌单</span>
          <button
            class="add-button"
            :class="{ spinning: platformLoading }"
            title="同步平台歌单"
            @click="loadPlatformPlaylists"
          >
            <span class="wp-icon">&#xF191;</span>
          </button>
        </div>

        <ul class="nav-list">
          <li v-for="item in platformItems" :key="item.key">
            <router-link
              :to="{
                name: 'sourcePlaylist',
                params: { source: item.sourceId, id: item.playlistId },
                query: { mine: '1' },
              }"
              class="nav-item"
              :class="{ active: isPlatformActive(item) }"
              :title="item.name"
            >
              <span class="wp-icon nav-icon">&#xF4EE;</span>
              <span class="nav-label ellipsis">{{ item.name }}</span>
            </router-link>
          </li>
          <li v-for="group in platformErrors" :key="`err:${group.record.entry.id}`" class="nav-empty">
            {{ group.record.entry.manifest.name }}：{{ group.error }}
          </li>
          <li v-if="!platformItems.length && !platformErrors.length" class="nav-empty">
            {{ platformLoading ? "正在同步…" : "暂无平台歌单" }}
          </li>
        </ul>
      </template>
    </div>

    <div class="nav-footer">
      <span class="nav-pill" :style="pillStyle(footerPill)" aria-hidden="true" />
      <span class="nav-accent" :style="pillStyle(footerPill, 10)" aria-hidden="true" />
      <ul class="nav-list">
        <li>
          <router-link :to="{ name: 'plugins' }" class="nav-item" :class="{ active: isActive('plugins') }">
            <span class="wp-icon nav-icon">&#xF137;</span>
            <span class="nav-label">插件管理</span>
          </router-link>
        </li>
        <li>
          <router-link :to="{ name: 'settings' }" class="nav-item" :class="{ active: isActive('settings') }">
            <span class="wp-icon nav-icon">&#xF6AA;</span>
            <span class="nav-label">设置</span>
          </router-link>
        </li>
      </ul>
    </div>

    <ContentDialog
      ref="createDialogRef"
      Title="新建歌单"
      PrimaryButtonText="创建"
      CloseButtonText="取消"
    >
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
      PrimaryButtonText="保存"
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
      Title="删除歌单"
      :Content="`删除后无法恢复，确定要删除歌单「${menuPlaylist?.name ?? ''}」吗？`"
      PrimaryButtonText="删除"
      CloseButtonText="取消"
    />
  </nav>
</template>

<style scoped>
.sidenav {
  display: flex;
  flex-direction: column;
  background: var(--wp-layer);
  border-right: 1px solid var(--wp-divider);
  padding: var(--space-md) var(--space-md) var(--space-md) var(--space-md);
}

.sidenav-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  position: relative;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  height: 36px;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-sm);
  color: var(--wp-text-primary);
  font-size: 14px;
  text-decoration: none;
  position: relative;
  z-index: 1;
  transition: color var(--duration-fast) var(--ease-standard);
}

.nav-item:hover {
  color: var(--wp-text-primary);
  text-decoration: none;
}

/* 选中药丸：在两个容器（滚动区/底栏）内滑动切换，由 JS 定位 top */
.nav-pill {
  position: absolute;
  left: 0;
  right: 0;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--wp-card-active);
  z-index: 0;
  pointer-events: none;
  transition:
    top 300ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 200ms var(--ease-standard);
}

/* 左侧蓝色强调胶囊：与药丸同源定位（top + 10px 垂直居中），随选中项滑动 */
.nav-accent {
  position: absolute;
  left: 0;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--wp-accent);
  z-index: 1;
  pointer-events: none;
  transition:
    top 300ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 200ms var(--ease-standard);
}

.nav-footer {
  flex: none;
  position: relative;
  padding-top: var(--space-md);
  border-top: 1px solid var(--wp-divider);
}

  /* 强调胶囊由 .nav-accent 绝对定位并参与滑动（不再使用逐项 ::before，避免瞬移） */

.nav-icon {
  font-size: 18px;
  width: 22px;
  text-align: center;
  flex: none;
}

.nav-label {
  flex: 1;
  min-width: 0;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-badge {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  flex: none;
}

.nav-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xl) var(--space-lg) var(--space-sm) var(--space-lg);
}

.nav-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text-secondary);
}

/* 导入 + 新建两个并列的小按钮 */
.add-buttons {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.add-button {
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
  transition: background var(--duration-fast) var(--ease-standard);
}

.add-button:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

/* 同步按钮：同步中图标旋转 */
.add-button.spinning .wp-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.nav-empty {
  padding: var(--space-md) var(--space-lg);
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-md) 0;
}
</style>
