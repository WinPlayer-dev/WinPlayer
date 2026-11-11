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
import { useSongListLayout } from "@/composables/useSongListLayout";
import { useRefreshable } from "@/composables/useRefreshable";
import { useTrackList, trackIdentity } from "@/composables/useTrackList";
import { useI18n } from "@/i18n";
import WpButton from "@/components/theme/WpButton.vue";

const router = useRouter();
const { t } = useI18n();
const library = useLibraryStore();
const player = usePlayerStore();
const downloads = useDownloadsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();
/** 云端布局（设置 → 外观 → 布局）：只有在手机端选中时生效 */
const cloudLayout = useSongListLayout();

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
    void downloads.enqueue(visibleTracks.value, [
      { kind: "liked", name: t("library.liked.title") },
    ]);
  }
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile, 'cloud-layout': cloudLayout }">
    <MobilePageHeader />
    <template v-if="library.liked.length">
      <div class="wp-page-header">
        <div class="header-cover">
          <span class="wp-icon filled">&#xF47E;</span>
        </div>
        <div class="header-meta">
          <h1 class="wp-page-title">{{ t("library.liked.title") }}</h1>
          <div class="header-sub">{{ t("common.unit.track", { count: library.liked.length }) }}</div>
        </div>
        <div class="header-actions with-cache">
          <WpButton @click="playAll" variant="accent">
            <span class="wp-icon filled">&#xF610;</span>{{ t("library.shared.playAll") }}
          </WpButton>
          <WpButton @click="shufflePlay" variant="standard">
            <span class="wp-icon">&#xEF37;</span>{{ t("common.action.shuffle") }}
          </WpButton>
          <WpButton
            class="cache-all-button"
            :title="t('library.shared.cacheAll')"
            :aria-label="t('library.shared.cacheAll')"
            @click="downloadAll"
            variant="standard"
          >
            <span class="wp-icon">&#xF151;</span>
          </WpButton>
        </div>
      </div>

      <div class="list-panel">
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
          :title="t('library.shared.noMatchingSongs')"
          :description="t('library.liked.noMatchDescription', { keyword: query })"
        >
          <WpButton @click="clearQuery" variant="standard">{{ t("components.trackToolbar.clearSearch") }}</WpButton>
        </EmptyState>
      </div>
    </template>

    <EmptyState
      v-else
      icon="&#xF47A;"
      :title="t('library.liked.empty.title')"
      :description="t('library.liked.empty.description')"
    >
      <WpButton @click="router.push('/')" variant="accent">{{ t("library.shared.discoverMusic") }}</WpButton>
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
