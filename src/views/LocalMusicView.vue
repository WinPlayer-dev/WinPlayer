<script setup lang="ts">
/**
 * 本地音乐曲库页 —— 内置播放源「本地音乐」的浏览入口。
 *
 * 曲目 / 专辑 / 歌手三个视图共用 `stores/localMusic` 的同一份索引：
 * 专辑与歌手卡片直接跳现有的详情页（`/album/builtin.local/:id`、
 * `/artist/builtin.local/:id`），详情页数据由内置源宿主从同一份索引派生，
 * 不额外抓取网络资源。
 */
import { computed, onMounted, ref } from "vue";
import EmptyState from "@/components/common/EmptyState.vue";
import MediaCard from "@/components/common/MediaCard.vue";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import WpButton from "@/components/theme/WpButton.vue";
import { TextBox } from "@/components/winui";
import { useIsMobile } from "@/composables/useIsMobile";
import { usePlayerStore } from "@/stores/player";
import { LOCAL_MUSIC_SOURCE_ID, toUnifiedTrack, useLocalMusicStore } from "@/stores/localMusic";
import { toast } from "@/services/toast";
import type { UnifiedAlbum, UnifiedArtist } from "@/types/plugin";

const localMusic = useLocalMusicStore();
const player = usePlayerStore();
const isMobile = useIsMobile();

type LibraryView = "tracks" | "albums" | "artists";

const VIEWS: { key: LibraryView; label: string }[] = [
  { key: "tracks", label: "曲目" },
  { key: "albums", label: "专辑" },
  { key: "artists", label: "歌手" },
];

const view = ref<LibraryView>("tracks");
const keyword = ref("");
/** 文件夹管理面板是否展开 */
const managing = ref(false);

/** 按 歌手 → 专辑 → 碟号 → 音轨号 排序，与专辑/歌手的展示顺序保持一致 */
const sortedTracks = computed(() =>
  [...localMusic.tracks].sort((a, b) => {
    const artist = (a.albumArtist || a.artist).localeCompare(b.albumArtist || b.artist, "zh-Hans-CN");
    if (artist !== 0) return artist;
    const album = a.album.localeCompare(b.album, "zh-Hans-CN");
    if (album !== 0) return album;
    if (a.discNo !== b.discNo) return a.discNo - b.discNo;
    if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
    return a.fileName.localeCompare(b.fileName);
  }),
);

/** 关键词过滤后的曲目（多关键词 AND，覆盖标题/文件名/歌手/专辑） */
const filteredTracks = computed(() => {
  const words = keyword.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const rows = words.length
    ? sortedTracks.value.filter((track) => {
        const haystack =
          `${track.title} ${track.fileName} ${track.artist} ${track.album} ${track.albumArtist}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
    : sortedTracks.value;
  return rows.map(toUnifiedTrack);
});

/** 专辑卡片数据（与 getAlbum 派生出的详情同源） */
const albums = computed<UnifiedAlbum[]>(() =>
  localMusic.albumGroups.map((group) => ({
    id: group.id,
    name: group.name,
    cover: group.cover || undefined,
    artistNames: [group.artist],
    artistIds: [group.artist],
    trackCount: group.tracks.length,
    sourceId: LOCAL_MUSIC_SOURCE_ID,
  })),
);

/** 歌手卡片数据 */
const artists = computed<UnifiedArtist[]>(() =>
  localMusic.artistGroups.map((group) => ({
    id: group.id,
    name: group.name,
    avatar: group.cover || undefined,
    songCount: group.tracks.length,
    sourceId: LOCAL_MUSIC_SOURCE_ID,
  })),
);

function countOf(key: LibraryView): number {
  if (key === "albums") return localMusic.albumCount;
  if (key === "artists") return localMusic.artistCount;
  return localMusic.trackCount;
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
  const added = await localMusic.addFolders();
  if (added) {
    toast(`已添加 ${added} 个文件夹`, "success");
    managing.value = true;
  }
}

async function removeFolder(folder: string): Promise<void> {
  await localMusic.removeFolder(folder);
  toast("已移除文件夹及其曲库记录", "success");
}

async function rescan(): Promise<void> {
  await localMusic.scan();
  if (!localMusic.scanning) toast(`扫描完成，共 ${localMusic.trackCount} 首`, "success");
}

onMounted(async () => {
  if (!localMusic.loaded) await localMusic.load();
});
</script>

<template>
  <div class="wp-page local-page" :class="{ mobile: isMobile }">
    <MobilePageHeader />
    <div class="wp-page-header">
      <div class="header-cover">
        <span class="wp-icon">&#xE8B7;</span>
      </div>
      <div class="header-meta">
        <h1 class="wp-page-title">本地音乐</h1>
        <div class="header-sub">
          {{ localMusic.trackCount }} 首 · {{ localMusic.albumCount }} 张专辑 ·
          {{ localMusic.artistCount }} 位歌手
          <template v-if="localMusic.scanning"> · 正在扫描…</template>
        </div>
      </div>
      <div class="header-actions">
        <WpButton :disabled="!filteredTracks.length" @click="playAll" variant="accent">
          <span class="wp-icon filled">&#xF610;</span>播放全部
        </WpButton>
        <WpButton :disabled="!filteredTracks.length" @click="shufflePlay" variant="standard">
          <span class="wp-icon">&#xEF37;</span>随机播放
        </WpButton>
      </div>
    </div>

    <!-- 还没有文件夹：引导添加 -->
    <EmptyState
      v-if="!localMusic.folders.length"
      icon="&#xE8B7;"
      title="还没有添加音乐文件夹"
      description="添加本机文件夹后会自动扫描其中的音频文件（含子文件夹），读取标签、内嵌封面与同名 SRT / LRC 歌词。"
    >
      <WpButton variant="accent" @click="addFolders">添加文件夹</WpButton>
    </EmptyState>

    <template v-else>
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
          PlaceholderText="搜索本地曲库（标题 / 歌手 / 专辑）"
          @update:Text="keyword = String($event ?? '')"
        />
        <div class="toolbar-actions">
          <WpButton
            class="small"
            :disabled="localMusic.scanning"
            variant="standard"
            @click="rescan"
          >
            {{ localMusic.scanning ? "扫描中…" : "重新扫描" }}
          </WpButton>
          <WpButton class="small" variant="standard" @click="addFolders">添加文件夹</WpButton>
          <WpButton class="small" variant="standard" @click="managing = !managing">
            {{ managing ? "收起文件夹" : "管理文件夹" }}
          </WpButton>
        </div>
      </div>

      <!-- 文件夹管理 -->
      <div v-if="managing" class="folder-panel">
        <div v-for="folder in localMusic.folders" :key="folder" class="folder-row">
          <span class="wp-icon folder-icon">&#xE8B7;</span>
          <span class="folder-path" :title="folder">{{ folder }}</span>
          <span class="folder-count">{{ localMusic.folderCounts.get(folder) ?? 0 }} 首</span>
          <button class="folder-remove" @click="removeFolder(folder)">移除</button>
        </div>
      </div>

      <!-- 曲目 -->
      <SongTable
        v-if="view === 'tracks'"
        :tracks="filteredTracks"
        :empty-text="keyword ? '没有匹配的曲目' : '曲库还是空的，试试重新扫描'"
      />

      <!-- 专辑 -->
      <div v-else-if="view === 'albums'" class="media-grid">
        <MediaCard v-for="album in albums" :key="album.id" kind="album" :album="album" />
        <div v-if="!albums.length" class="empty-hint">曲库里还没有专辑</div>
      </div>

      <!-- 歌手 -->
      <div v-else class="media-grid">
        <MediaCard v-for="artist in artists" :key="artist.id" kind="artist" :artist="artist" />
        <div v-if="!artists.length" class="empty-hint">曲库里还没有歌手</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
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

.local-page.mobile .library-toolbar {
  flex-wrap: wrap;
  gap: var(--space-md);
}

.local-page.mobile .search-box {
  width: 100%;
  max-width: 100%;
  order: 3;
}

.local-page.mobile .toolbar-actions {
  margin-left: 0;
  flex-wrap: wrap;
}

.local-page.mobile .media-grid {
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
}

.local-page.mobile .folder-row {
  flex-wrap: wrap;
  row-gap: 2px;
}

.local-page.mobile .folder-path {
  flex: 1 1 100%;
  order: 3;
  white-space: normal;
  word-break: break-all;
}
</style>
