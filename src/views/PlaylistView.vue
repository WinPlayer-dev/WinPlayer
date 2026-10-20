<script setup lang="ts">
/**
 * 歌单详情页
 *
 * 两条路径共用一套页面结构：
 * - 本地歌单：/playlist/:id        数据来自 library（SQLite）
 * - 插件歌单：/playlist/:source/:id 数据来自 plugins.getPlaylistDetail()
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ContentDialog, ProgressRing, TextBox } from "@/components/winui";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useDownloadsStore } from "@/stores/downloads";
import { pluginDisplayName, usePluginsStore } from "@/stores/plugins";
import { toast } from "@/services/toast";
import { getCachedData, setCachedData } from "@/services/cache";
import SongTable from "@/components/common/SongTable.vue";
import TrackListToolbar from "@/components/common/TrackListToolbar.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { useRefreshable } from "@/composables/useRefreshable";
import { useTrackList, trackIdentity } from "@/composables/useTrackList";
import type { PlaylistDetail, UnifiedTrack } from "@/types/plugin";
import WpButton from "@/components/theme/WpButton.vue";

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const player = usePlayerStore();
const plugins = usePluginsStore();
const downloads = useDownloadsStore();
/** 移动端判定：用于挂 .is-mobile 类，切换移动端布局 */
const isMobile = useIsMobile();

/** 插件来源歌单：路由名固定为 sourcePlaylist，多带一段 source */
const isRemote = computed(() => route.name === "sourcePlaylist");
const sourceId = computed(() => (typeof route.params.source === "string" ? route.params.source : ""));
const sourceName = computed(() =>
  sourceId.value ? pluginDisplayName(plugins.records, sourceId.value) : "",
);

/**
 * 平台个人歌单（query.mine=1 标记，来自平台歌单页）：
 * 来源插件声明 myPlaylists 能力时，允许增删歌曲。
 */
const isMine = computed(() => {
  if (!isRemote.value || route.query.mine !== "1" || !sourceId.value) return false;
  const record = plugins.records.find((r) => r.entry.id === sourceId.value);
  return Boolean(record?.enabled && plugins.hasCapability(record, "myPlaylists"));
});

const playlistId = ref(0);
const remote = ref<PlaylistDetail | null>(null);
const tracks = ref<UnifiedTrack[]>([]);
const loading = ref(false);
const loadError = ref("");
const renameValue = ref("");
/** 简介是否展开（默认折叠两行，避免长简介撑爆头部） */
const descExpanded = ref(false);

/* ------------------------------ 搜索 + 排序 ------------------------------ */

/** 搜索 + 排序：按当前的 tracks 派生，刷新后自动重算 */
const {
  query: queryText,
  sortKey,
  tracks: visibleTracks,
  filtering,
  toolbarProps,
  clearQuery,
} = useTrackList(() => tracks.value);

/** ContentDialog 通过 ShowAsync() 打开（库没有 IsOpen prop） */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const renameDialogRef = ref<DialogRef | null>(null);
const deleteDialogRef = ref<DialogRef | null>(null);

const localPlaylist = () => library.playlists.find((item) => item.id === playlistId.value);

/** 两种来源归一成一个头部视图模型，模板只写一份 */
const header = computed(() => {
  if (isRemote.value) {
    const detail = remote.value;
    if (!detail) return null;
    const parts = [`${detail.trackCount ?? tracks.value.length} 首`];
    if (detail.creator) parts.unshift(detail.creator);
    return { cover: detail.cover, name: detail.name, sub: parts.join(" · "), description: detail.description };
  }
  const item = localPlaylist();
  if (!item) return null;
  return {
    cover: item.cover,
    name: item.name,
    sub: `${item.trackCount ?? tracks.value.length} 首`,
    description: item.description,
  };
});

/** 缓存展示中（后台刷新在线数据），出错时不打扰已显示的缓存内容 */
const fromCache = ref(false);

async function loadRemote(source: string, id: string) {
  // 先渲染缓存内容，再后台拉取在线数据更新
  const cached = await getCachedData<PlaylistDetail>(`playlist.${source}.${id}`);
  if (cached?.data) {
    remote.value = cached.data;
    tracks.value = cached.data.tracks ?? [];
    fromCache.value = true;
  }

  if (!cached) loading.value = true;
  try {
    const detail = await plugins.getPlaylistDetail(source, id);
    if (!detail) {
      if (!cached) loadError.value = "插件没有返回这个歌单的内容";
      return;
    }
    remote.value = detail;
    tracks.value = detail.tracks ?? [];
    fromCache.value = false;
    void setCachedData(`playlist.${source}.${id}`, detail);
  } catch (error) {
    if (!cached) loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function loadLocal(id: number) {
  loading.value = true;
  try {
    tracks.value = await library.getPlaylistTracks(id);
  } finally {
    loading.value = false;
  }
}

async function loadRoute() {
  loadError.value = "";
  remote.value = null;
  tracks.value = [];
  fromCache.value = false;
  descExpanded.value = false;

  if (isRemote.value) {
    const source = String(route.params.source ?? "");
    const id = String(route.params.id ?? "");
    if (!source || !id) {
      void router.replace("/");
      return;
    }
    await loadRemote(source, id);
    return;
  }

  const id = Number(route.params.id);
  if (Number.isFinite(id) && id > 0) {
    playlistId.value = id;
    renameValue.value = localPlaylist()?.name ?? "";
    await loadLocal(id);
  } else {
    void router.replace("/");
  }
}

watch(() => route.fullPath, () => void loadRoute(), { immediate: true });

// 下拉刷新：重新拉取歌单详情
useRefreshable(loadRoute);

function playAll() {
  if (visibleTracks.value.length) void player.playTracks(visibleTracks.value, 0);
}

function shufflePlay() {
  const current = visibleTracks.value;
  if (current.length) {
    void player.playTracks(current, Math.floor(Math.random() * current.length));
  }
}

/** 缓存全部到本地（已下载的自动跳过），并记录来源歌单用于离线分组；只缓存当前筛选结果 */
function downloadAll() {
  if (!visibleTracks.value.length) return;
  const name = header.value?.name ?? "歌单";
  if (isRemote.value) {
    void downloads.enqueue(visibleTracks.value, [
      { kind: "playlist", sourceId: sourceId.value, id: String(route.params.id ?? ""), name },
    ]);
  } else {
    void downloads.enqueue(visibleTracks.value, [
      { kind: "playlist", id: String(playlistId.value), name },
    ]);
  }
}

async function onRemove(track: UnifiedTrack) {
  // 平台个人歌单：调用插件把歌曲从平台歌单移除，成功后重新拉取
  if (isMine.value && sourceId.value) {
    try {
      await plugins.removeFromUserPlaylist(sourceId.value, String(route.params.id), track.id);
      toast(`已从「${header.value?.name ?? "歌单"}」移除`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    await loadRemote(sourceId.value, String(route.params.id));
    return;
  }
  await library.removeTrackFromPlaylist(playlistId.value, track);
  await loadLocal(playlistId.value);
}

/* ------------------------------ 拖拽排序 ------------------------------ */

/** 只有本地自建歌单可以拖拽排序（插件歌单的顺序由平台维护） */
const canReorder = computed(() => !isRemote.value);

/**
 * 拖拽落位：把 from 处的曲目移到 to 处。
 *
 * 注意不能直接用 `visibleTracks` 的下标写库——它可能是搜索 / 排序后的视图，
 * 与数据库里的 position 顺序不一致。这里只操作「无搜索、无自定义排序」时的
 * 全量顺序，其余情况先提示用户切回默认视图（避免产生看不懂的库内顺序）。
 */
async function onReorder(from: number, to: number): Promise<void> {
  if (from === to) return;
  if (queryText.value.trim() || sortKey.value !== "default") {
    toast("请先在默认顺序下调整曲目位置（清空搜索并选择「默认顺序」）", "info");
    return;
  }
  const ordered = [...tracks.value];
  const [moved] = ordered.splice(from, 1);
  if (!moved) return;
  ordered.splice(to, 0, moved);
  await library.reorderPlaylistTracks(
    playlistId.value,
    ordered.map((track) => trackIdentity(track)),
  );
  await loadLocal(playlistId.value);
}

async function openRename() {
  renameValue.value = localPlaylist()?.name ?? "";
  const result = await renameDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await library.renamePlaylist(playlistId.value, renameValue.value);
}

async function openDelete() {
  const result = await deleteDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await library.deletePlaylist(playlistId.value);
  void router.replace("/liked");
}
</script>

<template>
  <div class="wp-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader />
    <template v-if="header">
      <div class="wp-page-header">
        <div class="header-cover">
          <CachedImage v-if="header.cover" :src="header.cover" class="cover-img" />
          <span v-else class="wp-icon">&#xE852;</span>
        </div>
        <div class="header-meta">
          <h1 class="wp-page-title">{{ header.name }}</h1>
          <div class="header-sub">
            {{ header.sub }}
            <span v-if="header.description && !isMobile" class="header-desc-inline">
              · {{ header.description }}
            </span>
          </div>
          <div v-if="header.description && isMobile" class="header-desc-wrap">
            <p class="header-desc" :class="{ expanded: descExpanded }">{{ header.description }}</p>
            <WpButton class="small desc-toggle" @click="descExpanded = !descExpanded" variant="standard">
              {{ descExpanded ? "收起" : "展开简介" }}
            </WpButton>
          </div>
          <div class="header-sub-actions">
            <template v-if="!isRemote">
              <WpButton class="small" @click="openRename" variant="standard">
                <span class="wp-icon">&#xF3DE;</span>重命名
              </WpButton>
              <WpButton class="small danger" @click="openDelete" variant="standard">
                <span class="wp-icon">&#xF34D;</span>删除歌单
              </WpButton>
            </template>
            <span v-else class="source-badge">
              来自 {{ sourceName }}<template v-if="fromCache"> · 缓存内容，正在更新…</template>
            </span>
          </div>
        </div>
        <div class="header-actions">
          <WpButton :disabled="!visibleTracks.length" @click="playAll" variant="accent">
            <span class="wp-icon filled">&#xF610;</span>播放全部
          </WpButton>
          <WpButton :disabled="!visibleTracks.length" @click="shufflePlay" variant="standard">
            <span class="wp-icon">&#xEF37;</span>随机播放
          </WpButton>
          <WpButton :disabled="!visibleTracks.length" @click="downloadAll" variant="standard">
            <span class="wp-icon">&#xF151;</span>
          </WpButton>
        </div>
      </div>

      <div v-if="loading" class="loading-wrap">
        <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
        <span class="loading-text">正在加载歌单…</span>
      </div>

      <EmptyState
        v-else-if="loadError"
        icon="&#xF3F2;"
        title="歌单加载失败"
        :description="loadError"
      >
        <WpButton @click="router.back()" variant="standard">返回</WpButton>
      </EmptyState>

      <template v-else>
        <TrackListToolbar v-bind="toolbarProps" />

        <SongTable
          v-if="visibleTracks.length"
          :tracks="visibleTracks"
          :show-source="!isRemote"
          :removable="!isRemote || isMine"
          :reorderable="canReorder"
          @remove="onRemove"
          @reorder="onReorder"
        />

        <EmptyState
          v-else-if="filtering"
          icon="&#xF4A3;"
          title="没有匹配的歌曲"
          :description="`「${queryText}」在这个歌单里没有找到。试试歌名、歌手或专辑名的一部分。`"
        >
          <WpButton @click="clearQuery" variant="standard">清空搜索</WpButton>
        </EmptyState>

        <EmptyState
          v-else
          icon="&#xF4EE;"
          title="歌单还是空的"
          :description="
            isRemote
              ? '这个歌单暂时没有可展示的歌曲，可能是插件没有登录或内容受地区限制。'
              : '在搜索结果或喜欢的音乐里，把歌曲添加到这个歌单吧。'
          "
        />
      </template>
    </template>

    <ContentDialog
      ref="renameDialogRef"
      Title="重命名歌单"
      PrimaryButtonText="保存"
      CloseButtonText="取消"
    >
      <div class="dialog-form">
        <TextBox
          :Text="renameValue"
          PlaceholderText="歌单名称"
          :MaxLength="50"
          @update:Text="renameValue = String($event ?? '')"
        />
      </div>
    </ContentDialog>

    <ContentDialog
      ref="deleteDialogRef"
      Title="删除歌单"
      Content="删除后无法恢复，确定要删除这个歌单吗？"
      PrimaryButtonText="删除"
      CloseButtonText="取消"
    />
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

/* 桌面端：简介作为一行内联文本跟随数量显示（保持原有排版） */
.header-desc-inline {
  display: inline;
  word-break: break-all;
}

/* 手机端：简介默认折叠两行，避免长文本撑爆头部 */
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
  word-break: break-word;
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
  flex-wrap: wrap;
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

.dialog-form {
  padding: var(--space-md) 0;
}
</style>
