<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { usePluginsStore, type AggregatedSourceResult, type PluginRecord } from "@/stores/plugins";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { openContextMenu, openContextMenuAt, type ContextMenuItem } from "@/services/contextMenu";
import { useLongPress } from "@/composables/useLongPress";
import { openPlaylistPicker } from "@/services/playlistPicker";
import { copyText } from "@/services/clipboard";
import { trackArtist, trackTitle } from "@/types/player";
import type { RecommendResult, UnifiedTrack } from "@/types/plugin";
import { getCachedData, setCachedData } from "@/services/cache";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import PlaylistCard from "@/components/common/PlaylistCard.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import { ProgressRing } from "@/components/winui";

const router = useRouter();
const plugins = usePluginsStore();
const player = usePlayerStore();
const library = useLibraryStore();
const isMobile = useIsMobile();

const loading = ref(false);
/** 展示模型：缓存与在线共用的精简结构（不含易过时的插件运行时对象） */
interface SectionView {
  sourceId: string;
  name: string;
  result: RecommendResult;
}
const sections = ref<SectionView[]>([]);
const errors = ref<Array<{ record: PluginRecord; error: string }>>([]);
/** 初始内容来自缓存（后台刷新在线数据） */
const fromCache = ref(false);

const CACHE_KEY = "recommend";

/** 在线拉取推荐：仅当有成功结果时替换内容并写缓存，全部失败时保留已有（缓存）内容 */
async function load(): Promise<void> {
  loading.value = true;
  errors.value = [];
  try {
    const results = await plugins.recommendAll();
    const ok: SectionView[] = results
      .filter((r): r is AggregatedSourceResult<RecommendResult> & { result: RecommendResult } => !!r.result)
      .map((r) => ({ sourceId: r.record.entry.id, name: r.record.entry.manifest.name, result: r.result }));
    errors.value = results
      .filter((r) => r.error)
      .map((r) => ({ record: r.record, error: r.error as string }));
    if (ok.length) {
      sections.value = ok;
      fromCache.value = false;
      void setCachedData(CACHE_KEY, ok);
    }
  } finally {
    loading.value = false;
  }
}

/** 挂载时先渲染缓存内容，再后台刷新在线数据 */
async function loadWithCache(): Promise<void> {
  const cached = await getCachedData<SectionView[]>(CACHE_KEY);
  if (cached?.data?.length) {
    sections.value = cached.data;
    fromCache.value = true;
  } else {
    loading.value = true;
  }
  await load();
}

// 下拉刷新：重新拉取推荐
useRefreshable(load);

function playFromSource(section: SectionView, index: number) {
  const songs = section.result.songs ?? [];
  if (songs.length) void player.playTracks(songs, index);
}

/** 移动端单击卡片即播放（桌面端仍保持双击播放） */
function onSongClick(section: SectionView, index: number) {
  if (isMobile) playFromSource(section, index);
}

/* ------------------------------ 歌曲卡片右键菜单 ------------------------------ */

const canAddToPlaylist = computed(
  () =>
    library.playlists.length > 0 ||
    plugins.records.some((r) => r.enabled && plugins.hasCapability(r, "myPlaylists")),
);

/** 推荐歌曲菜单项：添加到歌单 / 添加到喜欢 / 复制歌曲名 / 复制歌曲别名 */
function songMenuItems(song: UnifiedTrack): ContextMenuItem[] {
  const liked = library.isLiked(song);
  const items: ContextMenuItem[] = [];
  if (canAddToPlaylist.value) {
    items.push({
      key: "playlist",
      label: "添加到歌单",
      icon: "&#xF4EE;",
      action: () => openPlaylistPicker(song),
    });
  }
  items.push({
    key: "like",
    label: liked ? "取消喜欢" : "添加到喜欢",
    icon: liked ? "&#xF47E;" : "&#xF47A;",
    filled: liked,
    action: () => library.toggleLike(song),
  });
  items.push({
    key: "copy-name",
    label: "复制歌曲名",
    icon: "&#xF32C;",
    action: () => copyText(song.name, "歌曲名"),
  });
  const alias = song.alias;
  if (alias) {
    items.push({
      key: "copy-alias",
      label: "复制歌曲别名",
      icon: "&#xF32C;",
      action: () => copyText(alias, "歌曲别名"),
    });
  }
  return items;
}

/** 推荐歌曲右键菜单（桌面端） */
function openSongMenu(song: UnifiedTrack, event: MouseEvent) {
  // 移动端无鼠标右键，交给长按手势
  if (isMobile) return;
  openContextMenu(event, songMenuItems(song));
}

/** 移动端长按：在触摸点弹出歌曲菜单 */
const longPress = useLongPress();

function onSongPointerDown(event: PointerEvent, song: UnifiedTrack) {
  longPress.start(event, (point) => openContextMenuAt(point.x, point.y, songMenuItems(song)));
}

onMounted(loadWithCache);
</script>

<template>
  <div class="wp-page recommend-page" :class="{ 'is-mobile': isMobile }">
    <div class="wp-page-header">
      <h1 class="wp-page-title">推荐</h1>
      <button class="wp-standard-button" :disabled="loading" @click="load">
        <span class="wp-icon">&#xF13E;</span>刷新
      </button>
    </div>

    <!-- 移动端搜索入口：点击进入整页搜索（桌面端搜索在标题栏） -->
    <div v-if="isMobile" class="mobile-search" @click="router.push({ name: 'search' })">
      <span class="wp-icon mobile-search-icon">&#xF690;</span>
      <span class="mobile-search-placeholder">搜索音乐、歌单</span>
    </div>

    <!-- 无可用插件 -->
    <EmptyState
      v-if="!plugins.enabledRecords.length"
      icon="&#xF137;"
      title="还没有可用的播放源"
      description="WinPlayer 的音乐完全来自插件。前往插件管理安装一个播放源插件，或从市场添加。"
    >
      <button class="wp-accent-button" @click="router.push('/plugins')">前往插件管理</button>
    </EmptyState>

    <div v-else-if="loading" class="loading-wrap">
      <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
      <span class="loading-text">正在获取各来源的推荐…</span>
    </div>

    <template v-else>
      <p v-if="fromCache" class="cache-hint">以下为缓存内容，正在更新为最新…</p>

      <div v-if="errors.length" class="error-list">
        <p v-for="item in errors" :key="item.record.entry.id" class="error-item">
          「{{ item.record.entry.manifest.name }}」加载失败：{{ item.error }}
        </p>
      </div>

      <EmptyState
        v-if="!sections.length && !errors.length"
        icon="&#xE852;"
        title="暂无推荐内容"
        description="已启用的插件没有提供推荐，试试搜索或稍后再来。"
      />

      <section v-for="section in sections" :key="section.sourceId" class="source-section">
        <h2 class="wp-section-title">
          {{ section.name }}
          <span class="section-sub">的推荐</span>
        </h2>

        <div v-if="section.result.playlists?.length" class="card-row">
          <PlaylistCard v-for="playlist in section.result.playlists" :key="playlist.id" :playlist="playlist" />
        </div>

        <div v-if="section.result.songs?.length" class="song-grid">
          <div
            v-for="(song, index) in section.result.songs.slice(0, 12)"
            :key="song.id"
            class="song-card"
            @click="onSongClick(section, index)"
            @dblclick="playFromSource(section, index)"
            @contextmenu="openSongMenu(song, $event)"
            @pointerdown="onSongPointerDown($event, song)"
            @pointermove="longPress.move"
            @pointerup="longPress.end"
            @pointercancel="longPress.end"
            @pointerleave="longPress.end"
          >
            <div class="song-cover">
              <CachedImage v-if="song.cover" :src="song.cover" class="cover-img" />
              <span v-else class="wp-icon cover-placeholder">&#xE852;</span>
              <button class="song-play" title="播放" @click.stop="playFromSource(section, index)">
                <span class="wp-icon filled">&#xF610;</span>
              </button>
            </div>
            <div class="song-name ellipsis">{{ trackTitle(song) }}</div>
            <div class="song-artist ellipsis">{{ trackArtist(song) }}</div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mobile-search {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 38px;
  margin-bottom: var(--space-xl);
  padding: 0 var(--space-lg);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill);
  border: 1px solid var(--wp-control-stroke-secondary);
  color: var(--wp-text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.mobile-search-icon {
  font-size: 13px;
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: 80px 0;
  color: var(--wp-text-secondary);
}

.loading-text {
  font-size: 13px;
}

.error-list {
  margin-bottom: var(--space-xl);
}

.error-item {
  margin: 0 0 var(--space-sm) 0;
  font-size: 12px;
  color: var(--wp-danger);
}

.source-section {
  margin-bottom: var(--space-3xl);
}

.section-sub {
  font-size: 13px;
  font-weight: 400;
  color: var(--wp-text-secondary);
  margin-left: var(--space-md);
}

.cache-hint {
  margin: 0 0 var(--space-md) 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.card-row {
  display: flex;
  gap: var(--space-md);
  overflow-x: auto;
  padding-bottom: var(--space-sm);
  margin: 0 calc(-1 * var(--space-md));
}

.song-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-lg);
  margin-top: var(--space-lg);
}

.song-card {
  padding: var(--space-md);
  border-radius: var(--radius-lg);
  cursor: default;
  transition: background var(--duration-fast) var(--ease-standard);
}

.song-card:hover {
  background: var(--wp-card-hover);
}

.song-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-md);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  font-size: 32px;
  color: var(--wp-text-tertiary);
}

.song-play {
  position: absolute;
  right: var(--space-md);
  bottom: var(--space-md);
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--wp-accent);
  color: var(--wp-text-on-accent);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-fast) var(--ease-decelerate),
    transform var(--duration-fast) var(--ease-decelerate);
}

.song-card:hover .song-play {
  opacity: 1;
  transform: translateY(0);
}

/* 触摸端没有 hover：播放按钮常显，否则移动端看不到入口 */
@media (hover: none) {
  .song-play {
    opacity: 1;
    transform: none;
  }
}

.song-name {
  font-size: 13px;
  font-weight: 600;
}

.song-artist {
  font-size: 12px;
  color: var(--wp-text-secondary);
  margin-top: 2px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
