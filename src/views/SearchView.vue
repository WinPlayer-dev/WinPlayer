<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePluginsStore } from "@/stores/plugins";
import { usePlayerStore } from "@/stores/player";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import PlaylistCard from "@/components/common/PlaylistCard.vue";
import MediaCard from "@/components/common/MediaCard.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { ProgressRing } from "@/components/winui";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import type { SearchResult, UnifiedAlbum, UnifiedArtist, UnifiedPlaylist, UnifiedTrack } from "@/types/plugin";

const route = useRoute();
const router = useRouter();
const plugins = usePluginsStore();
const player = usePlayerStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

type TabType = "song" | "playlist" | "album" | "artist";
/** 专辑 / 歌手这两个 Tab 是按需拉取的，只有点开时才发请求 */
type LazyTabType = "album" | "artist";

const keyword = ref("");
const activeTab = ref<TabType>("song");
const loading = ref(false);
const searched = ref(false);

interface SourceResult {
  id: string;
  name: string;
  result: SearchResult | null;
  error?: string;
}

const sourceResults = ref<SourceResult[]>([]);
const lazyResults = ref<Partial<Record<LazyTabType, SourceResult[]>>>({});
/** 记录每个懒加载 Tab 已经为哪个关键词取过结果，换关键词时重新拉取 */
const lazyLoadedFor = ref<Partial<Record<LazyTabType, string>>>({});

const allSongs = computed<UnifiedTrack[]>(() =>
  sourceResults.value.flatMap((source) => source.result?.songs ?? []),
);

const allPlaylists = computed<UnifiedPlaylist[]>(() =>
  sourceResults.value.flatMap((source) => source.result?.playlists ?? []),
);

const allAlbums = computed<UnifiedAlbum[]>(() =>
  (lazyResults.value.album ?? []).flatMap((source) => source.result?.albums ?? []),
);

const allArtists = computed<UnifiedArtist[]>(() =>
  (lazyResults.value.artist ?? []).flatMap((source) => source.result?.artists ?? []),
);

/** 当前 Tab 各来源的失败信息（懒加载 Tab 是平铺网格，用一行汇总代替分组标题） */
const activeErrors = computed(() => {
  const sources = activeTab.value === "song" || activeTab.value === "playlist"
    ? sourceResults.value
    : (lazyResults.value[activeTab.value as LazyTabType] ?? []);
  return sources.filter((source) => source.error).map((source) => `${source.name}：${source.error}`);
});

async function search(keywordValue: string) {
  const trimmed = keywordValue.trim();
  if (!trimmed) return;
  searched.value = true;
  loading.value = true;
  sourceResults.value = [];
  lazyResults.value = {};
  lazyLoadedFor.value = {};
  try {
    const results = await plugins.searchAll(trimmed);
    sourceResults.value = results.map((item) => ({
      id: item.record.entry.id,
      name: item.record.entry.manifest.name,
      result: item.result,
      error: item.error,
    }));
  } finally {
    loading.value = false;
  }
  void ensureTab(activeTab.value);
}

/** 首次切到专辑/歌手 Tab 时才去搜，结果按关键词缓存，来回切换不重复请求 */
async function ensureTab(tab: TabType) {
  if (tab !== "album" && tab !== "artist") return;
  const trimmed = keyword.value.trim();
  if (!trimmed || !searched.value || lazyLoadedFor.value[tab] === trimmed) return;

  lazyLoadedFor.value[tab] = trimmed;
  loading.value = true;
  try {
    const results = await plugins.searchByType(trimmed, tab);
    lazyResults.value[tab] = results.map((item) => ({
      id: item.record.entry.id,
      name: item.record.entry.manifest.name,
      result: item.result,
      error: item.error,
    }));
  } finally {
    loading.value = false;
  }
}

function playAll() {
  if (allSongs.value.length) void player.playTracks(allSongs.value, 0);
}

watch(activeTab, (tab) => void ensureTab(tab));

watch(
  () => route.query.q,
  (value) => {
    if (typeof value === "string" && value) {
      keyword.value = value;
      void search(value);
    }
  },
  { immediate: true },
);

function submit() {
  const trimmed = keyword.value.trim();
  if (!trimmed) return;
  void router.replace({ path: "/search", query: { q: trimmed } });
}

/** 键盘回车提交：输入法组词过程中（isComposing）不触发，避免半截词就搜索 */
function onEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  submit();
}

/** 热门搜索词 */
const hotKeywords = ref<string[]>([]);

function pickKeyword(word: string) {
  keyword.value = word;
  submit();
}

onMounted(() => {
  if (!route.query.q && plugins.enabledRecords.length) {
    void plugins.getHotKeywords().then((words) => {
      hotKeywords.value = words;
      // 移动端不预填，改为展示热门词胶囊，点击即搜；桌面端保持原有预填行为
      if (words.length && !keyword.value && !isMobile) keyword.value = words[0] ?? "";
    });
  }
});

// 下拉刷新：以当前关键词重搜
useRefreshable(() => {
  const trimmed = keyword.value.trim();
  if (trimmed) return search(trimmed);
});
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <div class="wp-page-header search-header">
      <h1 class="wp-page-title">搜索</h1>
      <div class="search-field">
        <span class="wp-icon search-icon">&#xF690;</span>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          enterkeyhint="search"
          inputmode="search"
          autocomplete="off"
          placeholder="输入关键词，同时检索所有已启用的插件源"
          @keydown.enter="onEnter"
        />
        <button v-if="keyword" class="search-clear" title="清空" @click="keyword = ''">
          <span class="wp-icon">&#xF36A;</span>
        </button>
      </div>
      <button class="wp-accent-button" :disabled="!keyword.trim() || loading" @click="submit">搜索</button>
    </div>

    <!-- 移动端热门搜索词：点击即搜 -->
    <div v-if="isMobile && !searched && hotKeywords.length" class="hot-keywords">
      <span class="hot-label">热门搜索</span>
      <button v-for="word in hotKeywords" :key="word" class="hot-chip" @click="pickKeyword(word)">
        {{ word }}
      </button>
    </div>

    <EmptyState
      v-if="!plugins.enabledRecords.length"
      icon="&#xF137;"
      title="没有可用的搜索来源"
      description="聚合搜索会同时检索所有启用了搜索能力的插件，请先在插件管理中安装并启用插件。"
    >
      <button class="wp-accent-button" @click="router.push('/plugins')">前往插件管理</button>
    </EmptyState>

    <template v-else>
      <div v-if="loading" class="loading-wrap">
        <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
        <span class="loading-text">正在搜索 {{ sourceResults.length ? "" : "所有启用的插件源" }}…</span>
      </div>

      <template v-else-if="searched">
        <!-- 类型标签页 -->
        <div class="tabs">
          <button
            class="tab"
            :class="{ active: activeTab === 'song' }"
            @click="activeTab = 'song'"
          >
            单曲<span class="tab-count">{{ allSongs.length }}</span>
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'playlist' }"
            @click="activeTab = 'playlist'"
          >
            歌单<span class="tab-count">{{ allPlaylists.length }}</span>
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'album' }"
            @click="activeTab = 'album'"
          >
            专辑<span v-if="lazyResults.album" class="tab-count">{{ allAlbums.length }}</span>
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'artist' }"
            @click="activeTab = 'artist'"
          >
            歌手<span v-if="lazyResults.artist" class="tab-count">{{ allArtists.length }}</span>
          </button>
          <button v-if="activeTab === 'song' && allSongs.length" class="tab-action" @click="playAll">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </button>
        </div>

        <!-- 单曲：按来源分组 -->
        <div v-if="activeTab === 'song'">
          <div v-if="!sourceResults.length" class="no-result">没有找到相关单曲</div>
          <section v-for="source in sourceResults" :key="source.id" class="source-group">
            <h3 class="group-title">
              {{ source.name }}
              <span v-if="source.error" class="group-error">加载失败：{{ source.error }}</span>
              <span v-else-if="source.result?.songs?.length" class="group-count">
                {{ source.result.songs.length }} 首
              </span>
            </h3>
            <SongTable
              v-if="source.result?.songs?.length"
              :tracks="source.result.songs"
              :show-source="false"
            />
          </section>
        </div>

        <!-- 歌单 / 专辑 / 歌手：卡片网格（平铺，卡片本身会标注来源） -->
        <div v-else class="media-grid">
          <template v-if="activeTab === 'playlist'">
            <PlaylistCard
              v-for="playlist in allPlaylists"
              :key="`${playlist.sourceId}:${playlist.id}`"
              :playlist="playlist"
            />
            <div v-if="!allPlaylists.length" class="no-result">没有找到相关歌单</div>
          </template>

          <template v-else-if="activeTab === 'album'">
            <MediaCard
              v-for="album in allAlbums"
              :key="`${album.sourceId}:${album.id}`"
              kind="album"
              :album="album"
            />
            <div v-if="!allAlbums.length" class="no-result">没有找到相关专辑</div>
          </template>

          <template v-else>
            <MediaCard
              v-for="artist in allArtists"
              :key="`${artist.sourceId}:${artist.id}`"
              kind="artist"
              :artist="artist"
            />
            <div v-if="!allArtists.length" class="no-result">没有找到相关歌手</div>
          </template>
        </div>

        <p v-if="activeErrors.length" class="tab-errors">{{ activeErrors.join("；") }}</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.search-header {
  gap: var(--space-lg);
}

.search-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 36px;
  padding: 0 var(--space-lg);
  background: var(--wp-control-fill);
  border: 1px solid transparent;
  border-bottom-color: var(--wp-control-stroke-secondary);
  border-radius: var(--radius-sm);
  max-width: 560px;
}

.search-field:focus-within {
  background: var(--wp-layer-solid);
  border-bottom: 2px solid var(--wp-accent);
}

.search-icon {
  color: var(--wp-text-secondary);
  font-size: 14px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text-primary);
  font-size: 14px;
  font-family: inherit;
  user-select: text;
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: 80px 0;
  color: var(--wp-text-secondary);
}

.loading-text,
.no-result {
  font-size: 13px;
}

.no-result {
  padding: var(--space-3xl) 0;
  color: var(--wp-text-tertiary);
  text-align: center;
}

.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  border-bottom: 1px solid var(--wp-divider);
  margin-bottom: var(--space-lg);
}

.tab {
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 14px;
  padding: var(--space-md) var(--space-lg);
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.tab:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.tab.active {
  color: var(--wp-text-primary);
  font-weight: 600;
}

.tab.active::after {
  content: "";
  position: absolute;
  left: var(--space-lg);
  right: var(--space-lg);
  bottom: 0;
  height: 3px;
  border-radius: 2px;
  background: var(--wp-accent);
}

.tab-count {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  background: var(--wp-control-fill-secondary);
  border-radius: 8px;
  padding: 1px 6px;
}

.tab-action {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--wp-accent);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.tab-action:hover {
  background: var(--wp-card-hover);
}

.source-group {
  margin-bottom: var(--space-2xl);
}

.group-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 var(--space-md) var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.group-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-text-tertiary);
}

.group-error {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-danger);
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-md);
}

.tab-errors {
  margin: var(--space-lg) 0 0;
  font-size: 12px;
  color: var(--wp-danger);
}

.search-clear {
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--wp-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.search-clear:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.hot-keywords {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.hot-label {
  font-size: 13px;
  color: var(--wp-text-tertiary);
}

.hot-chip {
  border: none;
  border-radius: 999px;
  background: var(--wp-control-fill);
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 13px;
  padding: var(--space-md) var(--space-xl);
  min-height: 36px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.hot-chip:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.hot-chip:active {
  background: var(--wp-card-active);
}
</style>
