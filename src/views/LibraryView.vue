<script setup lang="ts">
/**
 * 内置播放源曲库页（`/library/:source`，`/local` 是它的旧入口）。
 *
 * 曲目 / 专辑 / 歌手三个视图共用「来源自己那份索引」：本地音乐来自
 * `stores/localMusic`，WebDAV 来自 `stores/webdav`。两个 store 的曲目结构与
 * 分组规则完全一致（`services/libraryIndex`），因此这里只做一层适配，
 * 不复制两套页面。专辑与歌手卡片直接跳现有的详情页
 * （`/album/<sourceId>/:id`、`/artist/<sourceId>/:id`），详情数据由内置源宿主
 * 从同一份索引派生，不额外抓取网络资源。
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import EmptyState from "@/components/common/EmptyState.vue";
import MediaCard from "@/components/common/MediaCard.vue";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import WpButton from "@/components/theme/WpButton.vue";
import { TextBox } from "@/components/winui";
import { useIsMobile } from "@/composables/useIsMobile";
import { useSongListLayout } from "@/composables/useSongListLayout";
import { useI18n } from "@/i18n";
import { builtinSourceDef } from "@/services/builtinSources";
import {
  albumGroupToUnified,
  artistGroupToUnified,
  filterLibraryTracks,
  libraryTrackToUnified,
  type LibraryAlbumGroup,
  type LibraryArtistGroup,
  type LibraryTrack,
} from "@/services/libraryIndex";
import { toast } from "@/services/toast";
import { usePlayerStore } from "@/stores/player";
import { LOCAL_MUSIC_SOURCE_ID, useLocalMusicStore } from "@/stores/localMusic";
import { WEBDAV_SOURCE_ID, useWebdavStore } from "@/stores/webdav";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const player = usePlayerStore();
const isMobile = useIsMobile();
/** 云端布局（设置 → 外观 → 布局）：只有在手机端选中时生效 */
const cloudLayout = useSongListLayout();
const localMusic = useLocalMusicStore();
const webdav = useWebdavStore();

/** 当前曲库对应的内置源（默认本地音乐，兼容旧的 `/local` 入口） */
const sourceId = computed(() => String(route.params.source || LOCAL_MUSIC_SOURCE_ID));
const isLocal = computed(() => sourceId.value === LOCAL_MUSIC_SOURCE_ID);
const isWebdav = computed(() => sourceId.value === WEBDAV_SOURCE_ID);
const def = computed(() => builtinSourceDef(sourceId.value));


type LibraryView = "tracks" | "albums" | "artists";

const VIEWS: { key: LibraryView; label: string }[] = [
  { key: "tracks", label: t("library.library.viewTracks") },
  { key: "albums", label: t("library.library.viewAlbums") },
  { key: "artists", label: t("library.library.viewArtists") },
];

const view = ref<LibraryView>("tracks");
const keyword = ref("");
/** 文件夹管理面板是否展开（仅本地音乐） */
const managing = ref(false);

/** 两个 store 的共用视图模型：页面其余部分只认这套字段 */
const lib = computed(() => {
  if (isLocal.value) {
    return {
      tracks: localMusic.tracks as LibraryTrack[],
      albumGroups: localMusic.albumGroups as LibraryAlbumGroup[],
      artistGroups: localMusic.artistGroups as LibraryArtistGroup[],
      trackCount: localMusic.trackCount,
      albumCount: localMusic.albumCount,
      artistCount: localMusic.artistCount,
      scanning: localMusic.scanning,
      lastScanAt: localMusic.lastScanAt,
      folders: localMusic.folders as string[],
      folderCounts: localMusic.folderCounts as Map<string, number>,
      load: () => localMusic.load(),
      scan: () => localMusic.scan(),
      addFolders: (() => localMusic.addFolders()) as (() => Promise<number>) | null,
      removeFolder: ((folder: string) => localMusic.removeFolder(folder)) as
        | ((folder: string) => Promise<void>)
        | null,
      /** 有可用的数据源（本地音乐永远可用，只是曲库可能为空） */
      ready: true,
      emptyTitle: t("library.library.empty.localTitle"),
      emptyDescription: t("library.library.empty.localDescription"),
      placeholder: t("library.library.search.localPlaceholder"),
      searchTip: t("library.library.search.emptyTip"),
    };
  }

  return {
    tracks: webdav.tracks as LibraryTrack[],
    albumGroups: webdav.albumGroups as LibraryAlbumGroup[],
    artistGroups: webdav.artistGroups as LibraryArtistGroup[],
    trackCount: webdav.trackCount,
    albumCount: webdav.albumCount,
    artistCount: webdav.artistCount,
    scanning: webdav.scanning,
    lastScanAt: webdav.lastScanAt,
    folders: [] as string[],
    folderCounts: new Map<string, number>(),
    load: () => webdav.load(),
    scan: () => webdav.scan(),
    addFolders: null,
    removeFolder: null,
    ready: webdav.configured,
    emptyTitle: webdav.configured
      ? t("library.library.empty.webdavEmptyTitle")
      : t("library.library.empty.webdavUnconfiguredTitle"),
    emptyDescription: webdav.configured
      ? t("library.library.empty.webdavEmptyDescription")
      : t("library.library.empty.webdavUnconfiguredDescription"),
    placeholder: t("library.library.search.remotePlaceholder"),
    searchTip: t("library.library.search.emptyTip"),
  };
});

/** 曲目列表：多关键词过滤 + 歌手/专辑/碟号/音轨号排序 */
const filteredTracks = computed(() => {
  const rows = filterLibraryTracks(lib.value.tracks, keyword.value);
  return [...rows]
    .sort((a, b) => {
      const artist = (a.albumArtist || a.artist).localeCompare(
        b.albumArtist || b.artist,
        "zh-Hans-CN",
      );
      if (artist !== 0) return artist;
      const album = a.album.localeCompare(b.album, "zh-Hans-CN");
      if (album !== 0) return album;
      if (a.discNo !== b.discNo) return a.discNo - b.discNo;
      if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
      return a.fileName.localeCompare(b.fileName);
    })
    .map((track) => libraryTrackToUnified(track, sourceId.value));
});

/** 专辑卡片数据（与 getAlbum 派生出的详情同源） */
const albums = computed(() =>
  lib.value.albumGroups.map((group) => albumGroupToUnified(group, sourceId.value)),
);

/** 歌手卡片数据 */
const artists = computed(() =>
  lib.value.artistGroups.map((group) => artistGroupToUnified(group, sourceId.value)),
);

function countOf(key: LibraryView): number {
  if (key === "albums") return lib.value.albumCount;
  if (key === "artists") return lib.value.artistCount;
  return lib.value.trackCount;
}

/* ------------------------------ 播放 ------------------------------ */

function playAll(): void {
  if (filteredTracks.value.length) void player.playTracks(filteredTracks.value, 0);
}

function shufflePlay(): void {
  const tracks = filteredTracks.value;
  if (tracks.length) void player.playTracks(tracks, Math.floor(Math.random() * tracks.length));
}

/* ------------------------------ 文件夹与扫描 ------------------------------ */

async function addFolders(): Promise<void> {
  if (!lib.value.addFolders) return;
  const added = await lib.value.addFolders();
  if (added) {
    toast(t("library.library.toast.foldersAdded", { count: added }), "success");
    managing.value = true;
  }
}

async function removeFolder(folder: string): Promise<void> {
  if (!lib.value.removeFolder) return;
  await lib.value.removeFolder(folder);
  toast(t("library.library.toast.folderRemoved"), "success");
}

async function rescan(): Promise<void> {
  await lib.value.scan();
  if (lib.value.scanning) return;
  if (isWebdav.value && webdav.error) {
    toast(webdav.error, "error");
    return;
  }
  toast(t("library.library.toast.scanCompleted", { count: lib.value.trackCount }), "success");
}

function openSourceConfig(): void {
  void router.push({ name: "plugins", query: { tab: "builtin" } });
}

onMounted(async () => {
  // 未知来源（手改地址栏）：回到本地音乐，避免展示一个名字都没有的空白曲库
  if (!def.value) {
    void router.replace({ name: "local" });
    return;
  }
  await lib.value.load();
});
</script>

<template>
  <div class="wp-page library-page" :class="{ mobile: isMobile, 'cloud-layout': cloudLayout }">
    <MobilePageHeader />
    <div class="wp-page-header">
      <div class="header-cover" :style="{ background: def?.accent }">
        <span class="wp-icon">{{ def?.icon }}</span>
      </div>
      <div class="header-meta">
        <h1 class="wp-page-title">{{ isWebdav ? webdav.displayName : def?.name || t("library.library.title") }}</h1>
        <div class="header-sub">
          {{
            t("library.library.subtitle", {
              tracks: lib.trackCount,
              albums: lib.albumCount,
              artists: lib.artistCount,
            })
          }}
          <template v-if="lib.scanning"> · {{ t("library.library.scanning") }}</template>
        </div>
      </div>
      <div class="header-actions">
        <WpButton :disabled="!filteredTracks.length" @click="playAll" variant="accent">
          <span class="wp-icon filled">&#xF610;</span>{{ t("library.shared.playAll") }}
        </WpButton>
        <WpButton :disabled="!filteredTracks.length" @click="shufflePlay" variant="standard">
          <span class="wp-icon">&#xEF37;</span>{{ t("common.action.shuffle") }}
        </WpButton>
      </div>
    </div>

    <!-- 还没准备好：本地音乐缺文件夹 / WebDAV 未配置 -->
    <EmptyState v-if="!lib.ready" :icon="def?.icon || '&#xF419;'" :title="lib.emptyTitle" :description="lib.emptyDescription">
      <WpButton v-if="isLocal" variant="accent" @click="addFolders">{{ t("library.library.action.addFolder") }}</WpButton>
      <WpButton v-else variant="accent" @click="openSourceConfig">{{ t("library.library.action.configureWebdav") }}</WpButton>
    </EmptyState>

    <EmptyState
      v-else-if="isLocal && !lib.folders.length"
      icon="&#xF419;"
      :title="t('library.library.empty.localTitle')"
      :description="lib.emptyDescription"
    >
      <WpButton variant="accent" @click="addFolders">{{ t("library.library.action.addFolder") }}</WpButton>
    </EmptyState>

    <template v-else>
      <!-- 云端布局：白色圆角面板（桌面端 / 默认布局时只是个普通容器） -->
      <div class="list-panel">
        <!-- 工具栏：视图切换 + 搜索 + 操作 -->
      <div class="library-toolbar">
        <div class="view-switch">
          <button
            v-for="item in VIEWS"
            :key="item.key"
            class="view-button"
            :class="{ active: view === item.key }"
            @click="view = item.key"
          >
            {{ item.label }}<span class="view-count">{{ countOf(item.key) }}</span>
          </button>
        </div>
        <TextBox
          class="search-box"
          :Text="keyword"
          :PlaceholderText="lib.placeholder"
          @update:Text="keyword = String($event ?? '')"
        />
        <div class="toolbar-actions">
          <WpButton class="small" :disabled="lib.scanning" variant="standard" @click="rescan">
            {{ lib.scanning ? t("library.library.action.rescanning") : t("library.library.action.rescan") }}
          </WpButton>
          <template v-if="lib.addFolders">
            <WpButton class="small" variant="standard" @click="addFolders">{{ t("library.library.action.addFolder") }}</WpButton>
            <WpButton class="small" variant="standard" @click="managing = !managing">
              {{ managing ? t("library.library.action.collapseFolders") : t("library.library.action.manageFolders") }}
            </WpButton>
          </template>
        </div>
      </div>

      <!-- 文件夹管理（仅本地音乐） -->
      <div v-if="managing && lib.folders.length" class="folder-panel">
        <div v-for="folder in lib.folders" :key="folder" class="folder-row">
          <span class="wp-icon folder-icon">&#xF419;</span>
          <span class="folder-path" :title="folder">{{ folder }}</span>
          <span class="folder-count">{{ t("common.unit.track", { count: lib.folderCounts.get(folder) ?? 0 }) }}</span>
          <button class="folder-remove" @click="removeFolder(folder)">{{ t("common.action.remove") }}</button>
        </div>
      </div>

      <!-- 曲目 -->
      <SongTable
        v-if="view === 'tracks'"
        :tracks="filteredTracks"
        :empty-text="keyword ? t('library.library.empty.noMatch') : lib.searchTip"
      />

      <!-- 专辑 -->
      <div v-else-if="view === 'albums'" class="media-grid">
        <MediaCard v-for="album in albums" :key="album.id" kind="album" :album="album" />
        <div v-if="!albums.length" class="empty-hint">{{ t("library.library.empty.noAlbums") }}</div>
      </div>

        <!-- 歌手 -->
        <div v-else class="media-grid">
          <MediaCard v-for="artist in artists" :key="artist.id" kind="artist" :artist="artist" />
          <div v-if="!artists.length" class="empty-hint">{{ t("library.library.empty.noArtists") }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.header-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-lg);
  flex: none;
  color: #fff;
}

.header-cover .wp-icon {
  font-size: 34px;
  color: #fff;
}

.header-sub {
  font-size: 13px;
  color: var(--wp-text-secondary);
}

/* 工具栏：视图切换靠左、搜索居中、操作靠右；窄屏整行换行 */
.library-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);
}

.view-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--wp-control-fill-secondary);
  flex: none;
}

.view-button {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.view-button:hover {
  color: var(--wp-text-primary);
}

.view-button.active {
  background: var(--wp-card);
  color: var(--wp-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.view-count {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  font-weight: 400;
}

.search-box {
  width: 280px;
  max-width: 280px;
  flex: none;
}

.toolbar-actions {
  display: flex;
  gap: var(--space-md);
  margin-left: auto;
}

.small {
  height: 28px;
  font-size: 12px;
  padding: 0 12px;
}

/* 文件夹管理面板 */
.folder-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--space-xl);
  padding: var(--space-lg);
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
}

.folder-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
  font-size: 12px;
}

.folder-icon {
  font-size: 15px;
  color: var(--wp-text-secondary);
  flex: none;
}

.folder-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  color: var(--wp-text-tertiary);
  flex: none;
}

.folder-remove {
  flex: none;
  border: none;
  background: transparent;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.folder-remove:hover {
  color: var(--wp-danger);
  background: var(--wp-card-hover);
}

/* 专辑 / 歌手卡片网格 */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-lg);
}

.empty-hint {
  grid-column: 1 / -1;
  padding: var(--space-3xl);
  text-align: center;
  font-size: 13px;
  color: var(--wp-text-tertiary);
}

/* ------------------------------ 移动端 ------------------------------ */

.library-page.mobile .library-toolbar {
  flex-wrap: wrap;
  gap: var(--space-md);
}

.library-page.mobile .search-box {
  width: 100%;
  max-width: 100%;
  order: 3;
}

.library-page.mobile .toolbar-actions {
  margin-left: 0;
  flex-wrap: wrap;
}

.library-page.mobile .media-grid {
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
}

.library-page.mobile .folder-row {
  flex-wrap: wrap;
  row-gap: 2px;
}

.library-page.mobile .folder-path {
  flex: 1 1 100%;
  order: 3;
  white-space: normal;
  word-break: break-all;
}
</style>
