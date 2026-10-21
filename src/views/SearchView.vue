<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePluginsStore } from "@/stores/plugins";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import PlaylistCard from "@/components/common/PlaylistCard.vue";
import MediaCard from "@/components/common/MediaCard.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { ProgressRing } from "@/components/winui";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import type { SearchResult, UnifiedAlbum, UnifiedArtist, UnifiedPlaylist, UnifiedTrack } from "@/types/plugin";
import WpButton from "@/components/theme/WpButton.vue";

const route = useRoute();
const router = useRouter();
const plugins = usePluginsStore();
const player = usePlayerStore();
const settings = useSettingsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

type TabType = "song" | "playlist" | "album" | "artist";
/** 请求粒度：单曲 / 歌单共用一次「基础搜索」，专辑 / 歌手各自一次请求 */
type SearchScope = "basic" | "album" | "artist";
/** 「全部」聚合源的特殊 key（与插件 id 区分） */
const AGGREGATE_KEY = "all";

const keyword = ref("");
/** 真正发出请求的关键词：与输入框解耦，边打字边改不会清掉已有结果 */
const searchedKeyword = ref("");
const searched = ref(false);
const activeType = ref<TabType>("song");
const activeSource = ref<string>(AGGREGATE_KEY);

/** 类型 → 结果字段 */
const FIELD_OF: Record<TabType, "songs" | "playlists" | "albums" | "artists"> = {
  song: "songs",
  playlist: "playlists",
  album: "albums",
  artist: "artists",
};

/** 类型 → 请求粒度 */
const SCOPE_OF: Record<TabType, SearchScope> = {
  song: "basic",
  playlist: "basic",
  album: "album",
  artist: "artist",
};

const TYPE_TABS: { key: TabType; label: string; empty: string }[] = [
  { key: "song", label: "单曲", empty: "没有找到相关单曲" },
  { key: "playlist", label: "歌单", empty: "没有找到相关歌单" },
  { key: "album", label: "专辑", empty: "没有找到相关专辑" },
  { key: "artist", label: "歌手", empty: "没有找到相关歌手" },
];

interface SourceResult {
  id: string;
  name: string;
  result: SearchResult | null;
  error?: string;
}

/** 一次请求的结果（来源可能是一个插件，也可能是全部插件） */
interface LoadEntry {
  status: "loading" | "done";
  sources: SourceResult[];
  /** 整次请求抛错时的兜底错误 */
  error?: string;
}

/**
 * 结果缓存：key = 来源 + 请求粒度 + 关键词。
 *
 * 同一关键词下，来回切 Tab 直接复用，不再发请求；换关键词 / 下拉刷新才全部作废。
 * 单曲与歌单共用 basic 这一条缓存，所以两者互切是零请求的。
 */
const cache = reactive<Record<string, LoadEntry>>({});
/** 搜索代次：每次换关键词 +1，迟到的旧响应直接丢弃 */
let generation = 0;

/** 支持搜索的插件源（已启用 + 声明 search 能力）；歌曲信息源置顶 */
const searchSources = computed(() => {
  const list = plugins.enabledRecords.filter((record) => plugins.hasCapability(record, "search"));
  const preferred = settings.trackSourceId;
  if (!preferred) return list;
  // sort 稳定：非优先来源保持原有顺序
  return [...list].sort(
    (a, b) =>
      (a.entry.id === preferred ? 0 : 1) - (b.entry.id === preferred ? 0 : 1),
  );
});

/** 一级 Tab：可选「全部」 + 各插件；只有一个搜索源时「全部」没有意义，不显示 */
const sourceTabs = computed(() => {
  const tabs: { key: string; name: string }[] = [];
  if (settings.aggregateSearch && searchSources.value.length > 1) {
    tabs.push({ key: AGGREGATE_KEY, name: "全部" });
  }
  for (const record of searchSources.value) {
    tabs.push({ key: record.entry.id, name: record.entry.manifest.name });
  }
  return tabs;
});

const isAggregateView = computed(() => activeSource.value === AGGREGATE_KEY);

const activeSourceName = computed(
  () => sourceTabs.value.find((tab) => tab.key === activeSource.value)?.name ?? "全部",
);

const searchPlaceholder = computed(() => {
  if (searchSources.value.length === 1) {
    return `在 ${searchSources.value[0]?.entry.manifest.name ?? "插件"} 中搜索`;
  }
  if (isAggregateView.value) return "输入关键词，同时检索所有已启用的插件源";
  return `在 ${activeSourceName.value} 中搜索`;
});

const currentKey = computed(() =>
  cacheKey(activeSource.value, SCOPE_OF[activeType.value], searchedKeyword.value),
);

const currentEntry = computed<LoadEntry | null>(() => cache[currentKey.value] ?? null);
const loading = computed(() => currentEntry.value?.status === "loading");

function cacheKey(source: string, scope: SearchScope, keywordValue: string): string {
  // 用不可见分隔符，避免插件 id 里出现分隔符导致 key 冲突
  return `${source}\u0000${scope}\u0000${keywordValue}`;
}

/** 交错合并多个来源的列表（A1、B1、A2、B2…），聚合视图用 */
function interleave<T>(lists: T[][]): T[] {
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);
  const merged: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) merged.push(item);
    }
  }
  return merged;
}

/** 取某个请求结果里的某一类数据；聚合视图交错排列，单插件视图直接拼接 */
function mergeField<T>(
  entry: LoadEntry | null,
  field: "songs" | "playlists" | "albums" | "artists",
  aggregate: boolean,
): T[] {
  if (!entry) return [];
  const lists = entry.sources.map((source) => (source.result?.[field] ?? []) as T[]);
  return aggregate ? interleave(lists) : lists.flat();
}

const songs = computed(() =>
  mergeField<UnifiedTrack>(currentEntry.value, "songs", isAggregateView.value),
);
const playlists = computed(() =>
  mergeField<UnifiedPlaylist>(currentEntry.value, "playlists", isAggregateView.value),
);
const albums = computed(() =>
  mergeField<UnifiedAlbum>(currentEntry.value, "albums", isAggregateView.value),
);
const artists = computed(() =>
  mergeField<UnifiedArtist>(currentEntry.value, "artists", isAggregateView.value),
);

/** 当前卡片网格 Tab 的结果（歌单 / 专辑 / 歌手三选一） */
const gridItems = computed<unknown[]>(() => {
  if (activeType.value === "playlist") return playlists.value;
  if (activeType.value === "album") return albums.value;
  return artists.value;
});

/** 某个类型 Tab 的结果数：没搜过 / 正在搜时为 null（不显示角标，避免闪 0） */
function countOf(type: TabType): number | null {
  const entry = cache[cacheKey(activeSource.value, SCOPE_OF[type], searchedKeyword.value)];
  if (!entry || entry.status !== "done") return null;
  return mergeField(entry, FIELD_OF[type], isAggregateView.value).length;
}

const errors = computed(() => {
  const entry = currentEntry.value;
  if (!entry) return [];
  const list = entry.error ? [entry.error] : [];
  return list.concat(
    entry.sources.filter((source) => source.error).map((source) => `${source.name}：${source.error}`),
  );
});

const activeEmptyText = computed(
  () => TYPE_TABS.find((tab) => tab.key === activeType.value)?.empty ?? "没有找到相关内容",
);

/**
 * 加载某个「来源 + 类型」：已经有缓存（进行中或已完成）就直接跳过，
 * 所以来回切 Tab 不会重复发请求。
 */
async function load(sourceKey: string, type: TabType, force = false): Promise<void> {
  const keywordValue = searchedKeyword.value;
  if (!keywordValue) return;
  const scope = SCOPE_OF[type];
  const key = cacheKey(sourceKey, scope, keywordValue);
  if (!force && cache[key]) return;

  const ids =
    sourceKey === AGGREGATE_KEY
      ? searchSources.value.map((record) => record.entry.id)
      : [sourceKey];
  // 插件还没加载完时不要缓存空结果，等列表就绪会重新触发
  if (!ids.length) return;

  cache[key] = { status: "loading", sources: [] };
  const ticket = generation;
  try {
    const results = await plugins.searchSources(ids, keywordValue, scope === "basic" ? undefined : scope);
    if (ticket !== generation) return;
    cache[key] = {
      status: "done",
      sources: results.map((item) => ({
        id: item.record.entry.id,
        name: item.record.entry.manifest.name,
        result: item.result,
        error: item.error,
      })),
    };
  } catch (error) {
    if (ticket !== generation) return;
    cache[key] = {
      status: "done",
      sources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 清空所有缓存并作废旧请求 */
function resetCache(): void {
  generation += 1;
  for (const key of Object.keys(cache)) delete cache[key];
}

async function search(keywordValue: string): Promise<void> {
  const trimmed = keywordValue.trim();
  if (!trimmed) return;
  resetCache();
  searched.value = true;
  searchedKeyword.value = trimmed;
  // 每次新搜索都回到第一个 Tab（不记忆上次停留位置）
  activeSource.value = sourceTabs.value[0]?.key ?? AGGREGATE_KEY;
  activeType.value = "song";
  await load(activeSource.value, activeType.value);
}

function playAll(): void {
  if (songs.value.length) void player.playTracks(songs.value, 0);
}

/* ------------------------------ 事件与侦听 ------------------------------ */

// 切来源或切类型：懒加载那一刻需要的数据
watch([activeSource, activeType], () => void load(activeSource.value, activeType.value));

/**
 * 来源 Tab 会随「插件启停 / 聚合开关 / 歌曲信息源」变化：
 * 当前来源失效时回落到第一个；来源集合变了就强制重拉当前视图（避免拿到旧集合的结果）。
 */
watch(
  sourceTabs,
  (tabs) => {
    if (!tabs.length) {
      activeSource.value = AGGREGATE_KEY;
      return;
    }
    if (!tabs.some((tab) => tab.key === activeSource.value)) {
      activeSource.value = tabs[0]?.key ?? AGGREGATE_KEY;
      return;
    }
    if (searched.value) void load(activeSource.value, activeType.value, true);
  },
  { immediate: true },
);

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

function submit(): void {
  const trimmed = keyword.value.trim();
  if (!trimmed) return;
  void router.replace({ path: "/search", query: { q: trimmed } });
}

/** 键盘回车提交：输入法组词过程中（isComposing）不触发，避免半截词就搜索 */
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;
  submit();
}

/** 热门搜索词 */
const hotKeywords = ref<string[]>([]);

function pickKeyword(word: string): void {
  keyword.value = word;
  submit();
}

onMounted(() => {
  if (!route.query.q && searchSources.value.length) {
    void plugins.getHotKeywords().then((words) => {
      hotKeywords.value = words;
      // 移动端不预填，改为展示热门词胶囊，点击即搜；桌面端保持原有预填行为
      if (words.length && !keyword.value && !isMobile) keyword.value = words[0] ?? "";
    });
  }
});

// 下拉刷新：作废缓存后重拉当前视图（不跳 Tab）
useRefreshable(() => {
  if (!searchedKeyword.value) return;
  resetCache();
  return load(activeSource.value, activeType.value);
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
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :placeholder="searchPlaceholder"
          @keydown.enter="onEnter"
        />
        <button v-if="keyword" class="search-clear" title="清空" @click="keyword = ''">
          <span class="wp-icon">&#xF36A;</span>
        </button>
      </div>
      <WpButton :disabled="!keyword.trim() || loading" @click="submit" variant="accent">搜索</WpButton>
    </div>

    <!-- 移动端热门搜索词：点击即搜 -->
    <div v-if="isMobile && !searched && hotKeywords.length" class="hot-keywords">
      <span class="hot-label">热门搜索</span>
      <button v-for="word in hotKeywords" :key="word" class="hot-chip" @click="pickKeyword(word)">
        {{ word }}
      </button>
    </div>

    <EmptyState
      v-if="!searchSources.length"
      icon="&#xF137;"
      title="没有可用的搜索来源"
      description="搜索页会为每个启用了搜索能力的插件生成一个 Tab，请先在插件管理中安装并启用插件。"
    >
      <WpButton @click="router.push('/plugins')" variant="accent">前往插件管理</WpButton>
    </EmptyState>

    <template v-else>
      <!-- 一级 Tab：来源（「全部」聚合 + 各插件），只有一个来源时不显示 -->
      <div v-if="sourceTabs.length > 1" class="source-tabs" role="tablist" aria-label="搜索来源">
        <button
          v-for="tab in sourceTabs"
          :key="tab.key"
          class="source-tab"
          :class="{ active: activeSource === tab.key }"
          role="tab"
          :aria-selected="activeSource === tab.key"
          @click="activeSource = tab.key"
        >
          {{ tab.name }}
        </button>
      </div>

      <template v-if="searched">
        <!-- 二级 Tab：类型 -->
        <div class="tabs">
          <button
            v-for="tab in TYPE_TABS"
            :key="tab.key"
            class="tab"
            :class="{ active: activeType === tab.key }"
            @click="activeType = tab.key"
          >
            {{ tab.label }}<span v-if="countOf(tab.key) !== null" class="tab-count">{{ countOf(tab.key) }}</span>
          </button>
          <button v-if="activeType === 'song' && songs.length" class="tab-action" @click="playAll">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </button>
        </div>

        <div v-if="loading" class="loading-wrap">
          <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
          <span class="loading-text">正在搜索{{ isAggregateView ? "所有插件源" : activeSourceName }}…</span>
        </div>

        <template v-else>
          <!-- 单曲 -->
          <div v-if="activeType === 'song'">
            <div v-if="!songs.length" class="no-result">{{ activeEmptyText }}</div>
            <SongTable
              v-else
              :tracks="songs"
              :show-source="isAggregateView"
            />
          </div>

          <!-- 歌单 / 专辑 / 歌手：卡片网格（卡片本身会标注来源） -->
          <div v-else class="media-grid">
            <template v-if="activeType === 'playlist'">
              <PlaylistCard
                v-for="playlist in playlists"
                :key="`${playlist.sourceId}:${playlist.id}`"
                :playlist="playlist"
              />
            </template>

            <template v-else-if="activeType === 'album'">
              <MediaCard
                v-for="album in albums"
                :key="`${album.sourceId}:${album.id}`"
                kind="album"
                :album="album"
              />
            </template>

            <template v-else>
              <MediaCard
                v-for="artist in artists"
                :key="`${artist.sourceId}:${artist.id}`"
                kind="artist"
                :artist="artist"
              />
            </template>

            <div v-if="!gridItems.length" class="no-result">{{ activeEmptyText }}</div>
          </div>

          <p v-if="errors.length" class="tab-errors">{{ errors.join("；") }}</p>
        </template>
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

/* 一级 Tab：来源胶囊，横向滚动（移动端插件多也不换行） */
.source-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.source-tabs::-webkit-scrollbar {
  display: none;
}

.source-tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  height: 30px;
  padding: 0 var(--space-lg);
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--wp-control-fill);
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.source-tab:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.source-tab.active {
  background: var(--wp-accent-light);
  border-color: var(--wp-accent-light);
  color: var(--wp-accent);
  font-weight: 600;
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
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  flex: none;
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
  flex: none;
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

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-md);
}

/* 「没有结果」要跨整行居中，不然只占一格 */
.media-grid .no-result {
  grid-column: 1 / -1;
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
