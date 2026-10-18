<script setup lang="ts">
/**
 * 歌手详情页：/artist/:source/:id
 *
 * 头部是大头像 + 渐变遮罩的 banner（和歌单/专辑的 96px 头部区分开），
 * 下方依次是热门歌曲与专辑列表，专辑列表滚动到底自动翻页。
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ProgressRing } from "@/components/winui";
import { usePlayerStore } from "@/stores/player";
import { pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import MediaCard from "@/components/common/MediaCard.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import type { UnifiedAlbum, UnifiedArtist, UnifiedTrack } from "@/types/plugin";

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const plugins = usePluginsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

const sourceId = computed(() => String(route.params.source ?? ""));
const artistId = computed(() => String(route.params.id ?? ""));
const sourceName = computed(() => pluginDisplayName(plugins.records, sourceId.value));

const artist = ref<UnifiedArtist | null>(null);
const hotTracks = ref<UnifiedTrack[]>([]);
const loading = ref(true);
const loadError = ref("");

const albums = ref<UnifiedAlbum[]>([]);
const albumPage = ref(1);
const albumHasMore = ref(true);
const albumsLoading = ref(false);

/** 滚动加载用的哨兵元素（模板函数 ref） */
const sentinel = ref<HTMLElement | null>(null);
let sentinelVisible = false;
const observer = new IntersectionObserver((entries) => {
  sentinelVisible = entries.some((entry) => entry.isIntersecting);
  if (sentinelVisible) void loadMoreAlbums();
});

watch(sentinel, (el, previous) => {
  if (previous) observer.unobserve(previous);
  if (el) observer.observe(el);
});
onUnmounted(() => observer.disconnect());

async function load(source: string, id: string) {
  loading.value = true;
  loadError.value = "";
  artist.value = null;
  hotTracks.value = [];
  albums.value = [];
  albumPage.value = 1;
  albumHasMore.value = true;
  try {
    const detail = await plugins.getArtistDetail(source, id);
    if (!detail) {
      loadError.value = "插件没有返回这个歌手的信息";
      return;
    }
    artist.value = detail;
    hotTracks.value = detail.hotTracks ?? [];
    await loadMoreAlbums();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function loadMoreAlbums() {
  if (albumsLoading.value || !albumHasMore.value || !artist.value) return;
  albumsLoading.value = true;
  try {
    const result = await plugins.getArtistAlbums(sourceId.value, artistId.value, albumPage.value);
    if (!result || !result.albums?.length) {
      albumHasMore.value = false;
      return;
    }
    albums.value.push(...result.albums);
    albumHasMore.value = result.hasMore ?? false;
    albumPage.value += 1;
  } catch (error) {
    console.error("加载歌手专辑失败", error);
    albumHasMore.value = false;
  } finally {
    albumsLoading.value = false;
    // 哨兵仍在视口内（一屏没填满）就继续翻，否则由 IntersectionObserver 触发
    if (sentinelVisible && albumHasMore.value) void loadMoreAlbums();
  }
}

watch(
  () => route.fullPath,
  () => {
    const source = String(route.params.source ?? "");
    const id = String(route.params.id ?? "");
    if (!source || !id) {
      void router.replace("/");
      return;
    }
    void load(source, id);
  },
  { immediate: true },
);

// 下拉刷新：重新拉取歌手详情
useRefreshable(() => load(sourceId.value, artistId.value));

/** banner 背景：拿歌手头像铺满，叠一层向下变深的遮罩保证文字可读 */
const bannerStyle = computed(() => {
  const url = artist.value?.avatar;
  return url ? { backgroundImage: `url("${url}")` } : {};
});

const countText = computed(() => {
  const parts: string[] = [];
  if (artist.value?.songCount) parts.push(`${artist.value.songCount} 首歌曲`);
  if (artist.value?.albumCount) parts.push(`${artist.value.albumCount} 张专辑`);
  return parts.join(" · ");
});

const aliasText = computed(() => (artist.value?.alias ?? []).filter(Boolean).join(" / "));

function playAll() {
  if (hotTracks.value.length) void player.playTracks(hotTracks.value, 0);
}

function shufflePlay() {
  if (hotTracks.value.length) {
    void player.playTracks(hotTracks.value, Math.floor(Math.random() * hotTracks.value.length));
  }
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <template v-if="artist">
      <div class="artist-banner" :class="{ 'no-avatar': !artist.avatar }" :style="bannerStyle">
        <div class="banner-scrim"></div>
        <div class="banner-content">
          <div class="banner-avatar-wrap">
            <CachedImage v-if="artist.avatar" :src="artist.avatar" class="banner-avatar" />
            <span v-else class="wp-icon banner-avatar-placeholder">&#xF5BE;</span>
          </div>
          <div class="banner-meta">
            <h1 class="banner-title">{{ artist.name }}</h1>
            <div v-if="countText || aliasText" class="banner-sub">
              <span v-if="countText">{{ countText }}</span>
              <span v-if="countText && aliasText" class="sep"> · </span>
              <span v-if="aliasText">{{ aliasText }}</span>
            </div>
            <p v-if="artist.briefDesc" class="banner-desc">{{ artist.briefDesc }}</p>
            <div class="banner-source">来自 {{ sourceName }}</div>
          </div>
          <div class="banner-actions">
            <button class="wp-accent-button" :disabled="!hotTracks.length" @click="playAll">
              <span class="wp-icon filled">&#xF610;</span>播放热门歌曲
            </button>
            <button class="wp-standard-button" :disabled="!hotTracks.length" @click="shufflePlay">
              <span class="wp-icon">&#xEF37;</span>随机播放
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading-wrap">
        <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
        <span class="loading-text">正在加载歌手…</span>
      </div>

      <EmptyState v-else-if="loadError" icon="&#xF3F2;" title="歌手页加载失败" :description="loadError">
        <button class="wp-standard-button" @click="router.back()">返回</button>
      </EmptyState>

      <template v-else>
        <section class="content-section">
          <h2 class="wp-section-title">热门歌曲</h2>
          <SongTable v-if="hotTracks.length" :tracks="hotTracks" :show-source="false" />
          <p v-else class="section-empty">插件没有返回热门歌曲。</p>
        </section>

        <section class="content-section">
          <h2 class="wp-section-title">专辑</h2>
          <div v-if="albums.length" class="album-grid">
            <MediaCard v-for="album in albums" :key="`${album.sourceId}:${album.id}`" kind="album" :album="album" />
          </div>
          <p v-else-if="!albumsLoading" class="section-empty">插件没有返回这位歌手的专辑。</p>

          <div ref="sentinel" class="load-sentinel">
            <div v-if="albumsLoading" class="loading-wrap compact">
              <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="24" :Height="24" />
            </div>
            <p v-else-if="!albumHasMore && albums.length" class="section-empty">没有更多专辑了</p>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.artist-banner {
  position: relative;
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--wp-control-fill-secondary) center 30% / cover no-repeat;
  box-shadow: var(--shadow-card);
  margin-bottom: var(--space-2xl);
}

.banner-scrim {
  position: absolute;
  inset: 0;
  /* 无论明暗色主题都往下压暗，保证白色文字始终可读 */
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.62) 100%);
}

.banner-content {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--space-xl);
  min-height: 220px;
  padding: var(--space-2xl);
}

.banner-avatar-wrap {
  flex: none;
}

.banner-avatar {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(255, 255, 255, 0.35);
  box-shadow: var(--shadow-card);
  display: block;
}

.banner-avatar-placeholder {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.12);
  border: 3px solid rgba(255, 255, 255, 0.35);
}

.banner-meta {
  flex: 1;
  min-width: 0;
  color: #fff;
}

.banner-title {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.banner-sub {
  margin-top: var(--space-sm);
  font-size: 13px;
  color: rgba(255, 255, 255, 0.86);
}

.sep {
  color: rgba(255, 255, 255, 0.5);
}

.banner-desc {
  margin: var(--space-md) 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.72);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  max-width: 640px;
}

.banner-source {
  margin-top: var(--space-md);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

.banner-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.content-section {
  margin-bottom: var(--space-2xl);
}

.content-section .wp-section-title {
  margin: 0 0 var(--space-md) var(--space-sm);
}

.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-md);
}

.section-empty {
  margin: 0;
  padding: var(--space-xl) var(--space-sm);
  font-size: 13px;
  color: var(--wp-text-tertiary);
}

.load-sentinel {
  min-height: 1px;
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: 80px 0;
  color: var(--wp-text-secondary);
}

.loading-wrap.compact {
  padding: var(--space-xl) 0;
}

.loading-text {
  font-size: 13px;
}
</style>
