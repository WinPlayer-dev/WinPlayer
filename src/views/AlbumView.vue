<script setup lang="ts">
/**
 * 专辑详情页：/album/:source/:id
 *
 * 数据来自插件的 getAlbum（能力：album），返回专辑信息 + 完整曲目。
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { ProgressRing } from "@/components/winui";
import { usePlayerStore } from "@/stores/player";
import { pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import SongTable from "@/components/common/SongTable.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import type { AlbumDetail, UnifiedTrack } from "@/types/plugin";

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const plugins = usePluginsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

const sourceId = computed(() => String(route.params.source ?? ""));
const sourceName = computed(() => pluginDisplayName(plugins.records, sourceId.value));

const album = ref<AlbumDetail | null>(null);
const tracks = ref<UnifiedTrack[]>([]);
const loading = ref(true);
const loadError = ref("");
const descExpanded = ref(false);

async function load(source: string, id: string) {
  loading.value = true;
  loadError.value = "";
  album.value = null;
  tracks.value = [];
  descExpanded.value = false;
  try {
    const detail = await plugins.getAlbumDetail(source, id);
    if (!detail) {
      loadError.value = "插件没有返回这张专辑的内容";
      return;
    }
    album.value = detail;
    tracks.value = detail.tracks ?? [];
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
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

// 下拉刷新：重新拉取专辑详情
useRefreshable(() => load(String(route.params.source ?? ""), String(route.params.id ?? "")));

/** 发行时间：2012年8月10日 */
const publishText = computed(() => {
  const time = album.value?.publishTime;
  if (!time || !Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
});

/** 头部副信息：歌手链接 + 发行时间 */
const subText = computed(() => {
  const parts: string[] = [];
  if (publishText.value) parts.push(publishText.value);
  if (album.value?.subType) parts.push(album.value.subType);
  if (album.value?.company) parts.push(album.value.company);
  return parts.join(" · ");
});

const artists = computed(() => {
  const detail = album.value;
  if (!detail) return [];
  const names = detail.artistNames ?? [];
  const ids = detail.artistIds ?? [];
  return names.map((name, index) => ({ name, target: artistTarget(ids[index]) }));
});

function artistTarget(id?: string): RouteLocationRaw | null {
  if (!id || !sourceId.value) return null;
  return { name: "artist", params: { source: sourceId.value, id } };
}

function go(target: RouteLocationRaw) {
  void router.push(target);
}

function playAll() {
  if (tracks.value.length) void player.playTracks(tracks.value, 0);
}

function shufflePlay() {
  if (tracks.value.length) {
    void player.playTracks(tracks.value, Math.floor(Math.random() * tracks.value.length));
  }
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <template v-if="album">
      <div class="wp-page-header">
        <div class="header-cover">
          <CachedImage v-if="album.cover" :src="album.cover" class="cover-img" />
          <span v-else class="wp-icon">&#xE852;</span>
        </div>
        <div class="header-meta">
          <h1 class="wp-page-title">{{ album.name }}</h1>
          <div class="header-sub">
            <template v-for="(artist, index) in artists" :key="`${artist.name}-${index}`">
              <span v-if="index" class="sep"> · </span>
              <button
                v-if="artist.target"
                class="artist-link"
                :title="`查看歌手「${artist.name}」`"
                @click="go(artist.target!)"
              >
                {{ artist.name }}
              </button>
              <span v-else>{{ artist.name }}</span>
            </template>
            <span v-if="subText"> · {{ subText }}</span>
          </div>
          <div v-if="album.description" class="header-desc-wrap">
            <p class="header-desc" :class="{ expanded: descExpanded }">{{ album.description }}</p>
            <button class="wp-standard-button small desc-toggle" @click="descExpanded = !descExpanded">
              {{ descExpanded ? "收起" : "展开简介" }}
            </button>
          </div>
          <div class="header-sub-actions">
            <span class="source-badge">来自 {{ sourceName }} · {{ tracks.length }} 首</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="wp-accent-button" :disabled="!tracks.length" @click="playAll">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </button>
          <button class="wp-standard-button" :disabled="!tracks.length" @click="shufflePlay">
            <span class="wp-icon">&#xEF37;</span>随机播放
          </button>
        </div>
      </div>

      <div v-if="loading" class="loading-wrap">
        <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
        <span class="loading-text">正在加载专辑…</span>
      </div>

      <EmptyState v-else-if="loadError" icon="&#xF3F2;" title="专辑加载失败" :description="loadError">
        <button class="wp-standard-button" @click="router.back()">返回</button>
      </EmptyState>

      <SongTable v-else-if="tracks.length" :tracks="tracks" :show-source="false" />

      <EmptyState
        v-else
        icon="&#xE010;"
        title="这张专辑还没有曲目"
        description="可能是插件没有登录，或该专辑在当前地区不可用。"
      />
    </template>
  </div>
</template>

<style scoped>
.header-cover {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-lg);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  flex: none;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.artist-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--wp-text-secondary);
  cursor: pointer;
  border-radius: 3px;
}

.artist-link:hover {
  color: var(--wp-text-primary);
  text-decoration: underline;
}

.sep {
  color: var(--wp-text-tertiary);
}

/* 简介默认折叠，避免长文本把头部撑得过高 */
.header-desc-wrap {
  margin-top: var(--space-md);
  max-width: 720px;
}

.header-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wp-text-tertiary);
  white-space: pre-line;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.header-desc.expanded {
  -webkit-line-clamp: unset;
  display: block;
  max-height: 260px;
  overflow-y: auto;
}

.desc-toggle {
  height: 24px;
  font-size: 11px;
  padding: 0 10px;
  margin-top: var(--space-sm);
}

.header-sub-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-md);
}

.source-badge {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.small {
  height: 26px;
  font-size: 12px;
  padding: 0 12px;
}

.header-actions {
  display: flex;
  gap: var(--space-md);
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
</style>
