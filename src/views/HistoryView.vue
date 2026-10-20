<script setup lang="ts">
/**
 * 最近播放（播放历史）。
 *
 * 数据来自 stores/history（SQLite 的 play_history 表），两个视图共用一页：
 * - 「最近播放」：按最近播放时间倒序；
 * - 「最常听」：按累计播放次数倒序，次数相同看最近播放。
 * 两种视图都可以再叠加页内搜索与排序（TrackListToolbar）。
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ContentDialog } from "@/components/winui";
import SongTable from "@/components/common/SongTable.vue";
import TrackListToolbar from "@/components/common/TrackListToolbar.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import WpButton from "@/components/theme/WpButton.vue";
import { useHistoryStore } from "@/stores/history";
import { usePlayerStore } from "@/stores/player";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import { useTrackList, trackIdentity } from "@/composables/useTrackList";
import { formatDuration } from "@/types/player";
import { toast } from "@/services/toast";
import type { UnifiedTrack } from "@/types/plugin";

const router = useRouter();
const history = useHistoryStore();
const player = usePlayerStore();
const isMobile = useIsMobile();

/** 视图：最近播放 / 最常听 */
const view = ref<"recent" | "most">("recent");

/** 当前视图的数据源 */
const sourceEntries = computed(() =>
  view.value === "recent" ? history.recent : history.mostPlayed,
);

/** 添加时间（这里用最近播放时间）映射，供「添加时间」排序复用 */
const playedAt = computed(
  () => new Map(history.entries.map((entry) => [trackIdentity(entry.track), entry.lastPlayed])),
);

const { query, tracks: visibleTracks, filtering, toolbarProps, clearQuery } = useTrackList(
  () => sourceEntries.value.map((entry) => entry.track),
  { addedAt: () => playedAt.value, defaultSort: "default" },
);

/** 头部统计：曲目数 + 累计播放次数 */
const totals = computed(() => {
  const entries = history.entries;
  return {
    tracks: entries.length,
    plays: entries.reduce((sum, entry) => sum + entry.playCount, 0),
    duration: entries.reduce((sum, entry) => sum + (entry.track.duration ?? 0), 0),
  };
});

/** 切换视图时清空搜索，避免"切过去发现是空的" */
function switchView(next: "recent" | "most"): void {
  if (view.value === next) return;
  view.value = next;
  clearQuery();
}

onMounted(() => {
  // 直接进入本页时可能尚未加载（App.vue 的首屏加载是并行的）
  if (!history.loaded) void history.load();
});

// 下拉刷新：重新读历史
useRefreshable(() => history.load());

function playAll(): void {
  if (visibleTracks.value.length) void player.playTracks(visibleTracks.value, 0);
}

function shufflePlay(): void {
  const list = visibleTracks.value;
  if (list.length) void player.playTracks(list, Math.floor(Math.random() * list.length));
}

/** 把当前列表全部加入播放队列 */
function addAllToQueue(): void {
  if (visibleTracks.value.length) player.addToQueue(visibleTracks.value);
}

/* ------------------------------ 清空历史 ------------------------------ */

interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const clearDialogRef = ref<DialogRef | null>(null);

async function clearHistory(): Promise<void> {
  const result = await clearDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await history.clear();
  toast("播放历史已清空", "success");
}

/** 从历史中移除单曲 */
async function onRemove(track: UnifiedTrack): Promise<void> {
  await history.removeEntry(track);
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />

    <template v-if="history.entries.length">
      <div class="wp-page-header">
        <div class="header-cover">
          <span class="wp-icon filled">&#xF2A1;</span>
        </div>
        <div class="header-meta">
          <h1 class="wp-page-title">最近播放</h1>
          <div class="header-sub">
            {{ totals.tracks }} 首 · 累计播放 {{ totals.plays }} 次 · 共
            {{ formatDuration(totals.duration) }}
          </div>
        </div>
        <div class="header-actions">
          <WpButton @click="playAll" variant="accent">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </WpButton>
          <WpButton @click="shufflePlay" variant="standard">
            <span class="wp-icon">&#xEF37;</span>随机播放
          </WpButton>
          <WpButton @click="addAllToQueue" variant="standard">
            <span class="wp-icon">&#xF10A;</span>加入队列
          </WpButton>
          <WpButton @click="clearHistory" variant="standard" class="danger-button">
            <span class="wp-icon">&#xF34D;</span>清空
          </WpButton>
        </div>
      </div>

      <!-- 视图切换：最近播放 / 最常听 -->
      <div class="view-tabs" role="tablist" aria-label="历史视图">
        <button
          class="view-tab"
          :class="{ active: view === 'recent' }"
          role="tab"
          :aria-selected="view === 'recent'"
          @click="switchView('recent')"
        >
          最近播放
        </button>
        <button
          class="view-tab"
          :class="{ active: view === 'most' }"
          role="tab"
          :aria-selected="view === 'most'"
          @click="switchView('most')"
        >
          最常听
        </button>
      </div>

      <TrackListToolbar v-bind="toolbarProps" />

      <SongTable
        v-if="visibleTracks.length"
        :tracks="visibleTracks"
        :show-source="true"
        :show-play-count="true"
        removable
        @remove="onRemove"
      />

      <EmptyState
        v-else-if="filtering"
        icon="&#xF4A3;"
        title="没有匹配的歌曲"
        :description="`「${query}」在播放历史里没有找到。试试歌名、歌手或专辑名的一部分。`"
      >
        <WpButton @click="clearQuery" variant="standard">清空搜索</WpButton>
      </EmptyState>
    </template>

    <EmptyState
      v-else
      icon="&#xF2A1;"
      title="还没有播放记录"
      description="播放过的歌曲会自动出现在这里，按最近播放与播放次数排列，方便找回之前听过的东西。"
    >
      <WpButton @click="router.push('/')" variant="accent">去发现音乐</WpButton>
    </EmptyState>

    <ContentDialog
      ref="clearDialogRef"
      Title="清空播放历史"
      Content="清空后播放次数与最近播放记录都会丢失，但不会影响歌单与喜欢的音乐。确定继续吗？"
      PrimaryButtonText="清空"
      CloseButtonText="取消"
    />
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

.header-actions {
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
}

/* 清空属于破坏性操作：与主操作区分开 */
.danger-button {
  color: var(--wp-danger);
}

/* 视图切换：与设置页 Tab 一致的轻量形态 */
.view-tabs {
  display: flex;
  gap: var(--space-sm);
  padding: 0 var(--space-lg) var(--space-md);
}

.view-tab {
  height: 30px;
  padding: 0 var(--space-lg);
  border: 1px solid var(--wp-control-stroke);
  border-radius: 15px;
  background: transparent;
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.view-tab:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.view-tab.active {
  border-color: transparent;
  background: var(--wp-accent);
  color: var(--wp-text-on-accent);
  font-weight: 600;
}

/* 移动端：头部动作折行，封面缩小 */
@media (max-width: 720px) {
  .header-cover {
    width: 64px;
    height: 64px;
    font-size: 28px;
  }

  .header-actions {
    width: 100%;
    margin-top: var(--space-md);
  }

  .view-tabs {
    padding: 0 var(--space-md) var(--space-sm);
  }
}
</style>
