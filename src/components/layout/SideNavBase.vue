<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ContentDialog, TextBox } from "@/components/winui";
import { useLibraryStore, type LocalPlaylist } from "@/stores/library";
import { usePluginsStore, type AggregatedSourceResult } from "@/stores/plugins";
import { useDownloadsStore } from "@/stores/downloads";
import { useRecorderStore } from "@/stores/recorder";
import { useSettingsStore } from "@/stores/settings";
import { openContextMenu, type ContextMenuItem } from "@/services/contextMenu";
import { openImportDialog } from "@/services/playlistIO";
import { toast } from "@/services/toast";
import { isTrackDrag, readDraggedTracks, trackDragState } from "@/services/trackDrag";
import type { UnifiedPlaylist } from "@/types/plugin";

const router = useRouter();
const route = useRoute();
const library = useLibraryStore();
const plugins = usePluginsStore();
const downloads = useDownloadsStore();
const recorder = useRecorderStore();
const settings = useSettingsStore();

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
  pinned: boolean;
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
        pinned: Boolean(p.pinned),
      });
    }
  }
  // 插件可用 pinned 把系统歌单（如网易云「每日日推」）固定到整组最上方；
  // sort 是稳定排序，未置顶的条目仍保持「插件顺序 + 平台顺序」
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned));
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
/* ------------------------------ 拖拽歌曲到歌单 ------------------------------ */
/*
 * 曲目列表把歌曲拖到侧边栏即可加入歌单：
 * - 我喜欢的音乐：未收藏的曲目直接喜欢（已在里面的不会因此被取消）；
 * - 本地歌单：写 SQLite（内部按曲目键去重）；
 * - 平台歌单：调用插件 addToUserPlaylist，仅接受同来源曲目，系统歌单（pinned）不可写。
 *
 * 拖拽期间整组列表微亮，悬停条目高亮并显示落点提示；拖到侧栏上下边缘自动滚动。
 */

const scrollEl = ref<HTMLElement | null>(null);
/** 当前悬停的可投放条目 key（`liked` / `local:<id>` / `<sourceId>:<playlistId>`） */
const dropKey = ref("");
/** 投放处理中：避免同一次松手被重复处理 */
const dropBusy = ref(false);

let autoScrollRaf = 0;
let autoScrollSpeed = 0;

function autoScrollStep(): void {
  autoScrollRaf = 0;
  const el = scrollEl.value;
  if (!el || !autoScrollSpeed) return;
  const before = el.scrollTop;
  el.scrollTop = before + autoScrollSpeed;
  // 已经到顶/到底就不再空转（保持 speed，指针离开边缘后会被重新计算）
  if (el.scrollTop !== before) autoScrollRaf = requestAnimationFrame(autoScrollStep);
}

/** 按指针位置换算滚动速度：越靠边越快，中间区域为 0 */
function updateAutoScroll(clientY: number): void {
  const el = scrollEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const EDGE = 56;
  let speed = 0;
  if (clientY < rect.top + EDGE) {
    speed = -Math.min(16, Math.max(3, Math.round((rect.top + EDGE - clientY) / 3)));
  } else if (clientY > rect.bottom - EDGE) {
    speed = Math.min(16, Math.max(3, Math.round((clientY - (rect.bottom - EDGE)) / 3)));
  }
  autoScrollSpeed = speed;
  if (speed && !autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScrollStep);
}

function stopAutoScroll(): void {
  autoScrollSpeed = 0;
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
}

function resetDropState(): void {
  dropKey.value = "";
  stopAutoScroll();
}

/** 条目 dragover：接受投放并高亮 */
function onItemDragOver(key: string, event: DragEvent): void {
  if (!isTrackDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  if (!dropBusy.value) dropKey.value = key;
  updateAutoScroll(event.clientY);
}

/** 条目 dragleave：只有真正离开条目（而不是在子元素间移动）才撤销高亮 */
function onItemDragLeave(key: string, event: DragEvent): void {
  const current = event.currentTarget as HTMLElement | null;
  const next = event.relatedTarget as Node | null;
  if (current && next && current.contains(next)) return;
  if (dropKey.value === key) dropKey.value = "";
}

/** 列表容器 dragover：条目之间的空白也算可投放区（并驱动自动滚动） */
function onContainerDragOver(event: DragEvent): void {
  if (!isTrackDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  // 指针落在条目之间的空白（或不可投放的导航项）时撤掉残留高亮；
  // 可投放条目带 data-drop-key，它们自己的 dragover 会先把 dropKey 设好
  const target = event.target as Element | null;
  if (!target?.closest?.("[data-drop-key]")) dropKey.value = "";
  updateAutoScroll(event.clientY);
}

/** 丢在条目之间：吞掉默认行为，避免 WebView 把拖拽内容当链接/文本打开 */
function onContainerDrop(event: DragEvent): void {
  if (!isTrackDrag(event)) return;
  event.preventDefault();
  resetDropState();
}

/** 拖到「我喜欢的音乐」：只补写没收藏过的，避免误取消 */
async function dropOnLiked(event: DragEvent): Promise<void> {
  const tracks = readDraggedTracks(event);
  resetDropState();
  if (!tracks.length || dropBusy.value) return;
  dropBusy.value = true;
  try {
    const fresh = tracks.filter((track) => !library.isLiked(track));
    if (!fresh.length) {
      toast("这些歌曲已经在「我喜欢的音乐」中", "info");
      return;
    }
    for (const track of fresh) await library.toggleLike(track);
    if (fresh.length > 1) toast(`已喜欢 ${fresh.length} 首歌曲`, "success");
  } finally {
    dropBusy.value = false;
  }
}

/** 拖到本地歌单 */
async function dropOnLocal(playlist: LocalPlaylist, event: DragEvent): Promise<void> {
  const tracks = readDraggedTracks(event);
  resetDropState();
  if (!tracks.length || dropBusy.value) return;
  dropBusy.value = true;
  try {
    const added = await library.addTracksToPlaylist(playlist.id, tracks);
    if (added) toast(`已添加 ${added} 首到「${playlist.name}」`, "success");
    else toast(`「${playlist.name}」中已有这些歌曲`, "info");
  } finally {
    dropBusy.value = false;
  }
}

/** 拖到平台歌单：只有同来源曲目能加，系统歌单（pinned）只读 */
async function dropOnPlatform(item: PlatformNavItem, event: DragEvent): Promise<void> {
  const tracks = readDraggedTracks(event);
  resetDropState();
  if (!tracks.length || dropBusy.value) return;

  if (item.pinned) {
    toast(`「${item.name}」由平台自动生成，不支持手动添加歌曲`, "error");
    return;
  }
  const record = plugins.records.find((r) => r.entry.id === item.sourceId);
  if (!record?.enabled || !plugins.hasCapability(record, "myPlaylists")) {
    toast("该平台歌单不支持添加歌曲", "error");
    return;
  }
  const sameSource = tracks.filter((track) => track.sourceId === item.sourceId);
  if (!sameSource.length) {
    toast(`只能把「${item.sourceName}」的歌曲添加到该平台的歌单`, "error");
    return;
  }

  dropBusy.value = true;
  let added = 0;
  let lastError = "";
  try {
    for (const track of sameSource) {
      try {
        await plugins.addToUserPlaylist(item.sourceId, item.playlistId, track.id);
        added += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    dropBusy.value = false;
  }
  if (added) toast(`已添加 ${added} 首到「${item.name}」`, "success");
  else toast(lastError || `添加到「${item.name}」失败`, "error");
}

/** 拖拽结束后统一收尾（拖到窗口外松手时 dragover 不会再触发） */
watch(
  () => trackDragState.active,
  (active) => {
    if (!active) resetDropState();
  },
);

onUnmounted(stopAutoScroll);

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
    <div
      ref="scrollEl"
      class="sidenav-scroll"
      @dragover="onContainerDragOver"
      @drop="onContainerDrop"
    >
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
          <router-link
            :to="{ name: 'liked' }"
            class="nav-item"
            :class="{ active: isActive('liked'), 'drop-target': dropKey === 'liked' }"
            data-drop-key="liked"
            @dragover="onItemDragOver('liked', $event)"
            @dragleave="onItemDragLeave('liked', $event)"
            @drop.prevent.stop="dropOnLiked($event)"
          >
            <span class="wp-icon nav-icon">&#xF47A;</span>
            <span class="nav-label">我喜欢的音乐</span>
            <span v-if="dropKey === 'liked'" class="drop-hint">松手收藏</span>
            <span v-else-if="library.liked.length" class="nav-badge">{{ library.liked.length }}</span>
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
        <!-- 录音棚（实验性）：设置里可以关掉入口，录音中的红点跟随入口一起隐藏 -->
        <li v-if="settings.studioEnabled">
          <router-link :to="{ name: 'studio' }" class="nav-item" :class="{ active: isActive('studio') }">
            <span class="wp-icon nav-icon">&#xE7FA;</span>
            <span class="nav-label">录音棚</span>
            <span v-if="recorder.recording" class="nav-badge recording-badge" title="正在录音" />
          </router-link>
        </li>
      </ul>

      <div class="nav-section-header">
        <span class="nav-section-title">歌单</span>
        <span class="add-buttons">
          <button class="add-button" title="导入歌单（.json / .m3u8）" @click="openImportDialog">
            <span class="wp-icon">&#xF15A;</span>
          </button>
          <button class="add-button" title="新建歌单" @click="openCreateDialog">
            <span class="wp-icon">&#xF10A;</span>
          </button>
        </span>
      </div>

      <ul class="nav-list" :class="{ 'drop-zone': trackDragState.active && library.playlists.length }">
        <li v-for="playlist in library.playlists" :key="playlist.id">
          <router-link
            :to="{ name: 'playlist', params: { id: playlist.id } }"
            class="nav-item"
            :class="{
              active: route.name === 'playlist' && route.params.id === String(playlist.id),
              'drop-target': dropKey === `local:${playlist.id}`,
            }"
            :title="playlist.name"
            :data-drop-key="`local:${playlist.id}`"
            @contextmenu="openPlaylistMenu(playlist, $event)"
            @dragover="onItemDragOver(`local:${playlist.id}`, $event)"
            @dragleave="onItemDragLeave(`local:${playlist.id}`, $event)"
            @drop.prevent.stop="dropOnLocal(playlist, $event)"
          >
            <span class="wp-icon nav-icon">&#xF4EE;</span>
            <span class="nav-label ellipsis">{{ playlist.name }}</span>
            <span v-if="dropKey === `local:${playlist.id}`" class="drop-hint">松手添加</span>
            <span v-else-if="playlist.trackCount" class="nav-badge">{{ playlist.trackCount }}</span>
          </router-link>
        </li>
        <li v-if="!library.playlists.length" class="nav-empty">
          {{ trackDragState.active ? "还没有歌单，点 + 新建后就能拖进来" : "还没有歌单，点击 + 创建" }}
        </li>
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

        <ul class="nav-list" :class="{ 'drop-zone': trackDragState.active && platformItems.length }">
          <li v-for="item in platformItems" :key="item.key">
            <router-link
              :to="{
                name: 'sourcePlaylist',
                params: { source: item.sourceId, id: item.playlistId },
                query: { mine: '1' },
              }"
              class="nav-item"
              :class="{ active: isPlatformActive(item), 'drop-target': dropKey === item.key }"
              :title="item.name"
              :data-drop-key="item.key"
              @dragover="onItemDragOver(item.key, $event)"
              @dragleave="onItemDragLeave(item.key, $event)"
              @drop.prevent.stop="dropOnPlatform(item, $event)"
            >
              <span class="wp-icon nav-icon">&#xF4EE;</span>
              <span class="nav-label ellipsis">{{ item.name }}</span>
              <span v-if="dropKey === item.key" class="drop-hint">松手添加</span>
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
            <span class="nav-label">播放源管理</span>
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
/* 录音中的红点：不做数字角标，避免和下载/收藏计数混淆 */
.nav-badge.recording-badge {
  width: 8px;
  height: 8px;
  min-width: 8px;
  padding: 0;
  border-radius: 50%;
  background: var(--wp-danger);
  animation: rec-pulse 1.2s ease-in-out infinite;
}

@keyframes rec-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

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

/* ------------------------------ 拖拽投放态 ------------------------------ */

/* 拖动曲目时，可投放的歌单分组整体微亮（提示"这里可以放"） */
.nav-list.drop-zone {
  background: var(--wp-accent-light);
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 1px var(--wp-accent-light);
}

/* 悬停中的目标条目：强调色描边 + 高亮，明确"松手就落在这" */
.nav-item.drop-target {
  background: var(--wp-accent-light);
  box-shadow: inset 0 0 0 1px var(--wp-accent);
  color: var(--wp-accent);
}

.nav-item.drop-target .nav-icon {
  color: var(--wp-accent);
}

/* 落点提示胶囊：临时替换右侧的计数徽标 */
.drop-hint {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-accent);
  color: var(--wp-accent-text);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
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
