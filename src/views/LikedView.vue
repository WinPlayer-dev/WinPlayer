<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useDownloadsStore } from "@/stores/downloads";
import SongTable from "@/components/common/SongTable.vue";
import TrackListToolbar from "@/components/common/TrackListToolbar.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import { useTrackList, trackIdentity } from "@/composables/useTrackList";
import WpButton from "@/components/theme/WpButton.vue";

const router = useRouter();
const library = useLibraryStore();
const player = usePlayerStore();
const downloads = useDownloadsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

// 下拉刷新：重新读取喜欢的音乐
useRefreshable(() => library.loadAll());

/** 收藏时间映射：「添加时间」排序用（liked 已按 liked_at 降序，这里只是转成 map） */
const likedAt = computed(
  () => new Map(library.liked.map((row) => [trackIdentity(row.track), row.likedAt])),
);

/* ------------------------------ 搜索 + 排序 ------------------------------ */

const {
  query,
  tracks: visibleTracks,
  toolbarProps,
  clearQuery,
} = useTrackList(() => library.likedTracks, {
  addedAt: () => likedAt.value,
  // 默认按添加时间倒序：新收藏的排在最前，和未加搜索时的观感一致
  defaultSort: "added",
  defaultDescending: true,
});

function playAll() {
  if (visibleTracks.value.length) void player.playTracks(visibleTracks.value, 0);
}

function shufflePlay() {
  const current = visibleTracks.value;
  if (current.length) void player.playTracks(current, Math.floor(Math.random() * current.length));
}

/** 缓存全部到本地（已下载的自动跳过）；只缓存当前筛选结果 */
function downloadAll() {
  if (visibleTracks.value.length) {
    void downloads.enqueue(visibleTracks.value, [{ kind: "liked", name: "我喜欢的音乐" }]);
  }
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <template v-if="library.liked.length">
      <div class="wp-page-header">
        <div class="header-cover">
          <span class="wp-icon filled">&#xF47E;</span>
        </div>
        <div class="header-meta">
          <h1 class="wp-page-title">我喜欢的音乐</h1>
          <div class="header-sub">{{ library.liked.length }} 首</div>
        </div>
        <div class="header-actions">
          <WpButton @click="playAll" variant="accent">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </WpButton>
          <WpButton @click="shufflePlay" variant="standard">
            <span class="wp-icon">&#xEF37;</span>随机播放
          </WpButton>
          <WpButton @click="downloadAll" variant="standard">
            <span class="wp-icon">&#xF151;</span>
          </WpButton>
        </div>
      </div>

      <TrackListToolbar v-bind="toolbarProps" />

      <SongTable
        v-if="visibleTracks.length"
        :tracks="visibleTracks"
        :show-source="true"
        @remove="(track) => library.toggleLike(track)"
      />

      <EmptyState
        v-else
        icon="&#xF4A3;"
        title="没有匹配的歌曲"
        :description="`「${query}」在喜欢的音乐里没有找到。试试歌名、歌手或专辑名的一部分。`"
      >
        <WpButton @click="clearQuery" variant="standard">清空搜索</WpButton>
      </EmptyState>
    </template>

    <EmptyState
      v-else
      icon="&#xF47A;"
      title="还没有喜欢的音乐"
      description="浏览搜索结果或推荐，点击歌曲行的心形按钮即可收藏。"
    >
      <WpButton @click="router.push('/')" variant="accent">去发现音乐</WpButton>
    </EmptyState>
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
}
</style>
