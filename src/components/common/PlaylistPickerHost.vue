<script setup lang="ts">
/**
 * 「添加到歌单」选择器宿主（全局唯一实例，挂在 App.vue）
 * 通过 openPlaylistPicker(track) 打开，本地歌单 + 各插件的平台个人歌单可选
 */
import { ref, watch } from "vue";
import { ContentDialog } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import { useTrackMetaStore } from "@/stores/trackMeta";
import { toast } from "@/services/toast";
import { closePlaylistPicker, playlistPickerState } from "@/services/playlistPicker";
import { trackTitle } from "@/types/player";

/** 歌单选项（本地歌单 + 各插件的平台个人歌单） */
interface PlaylistOption {
  key: string;
  name: string;
  meta: string;
  /** 歌单封面（本地歌单无自定义封面时取首曲封面；空歌单为空串） */
  cover: string;
  kind: "local" | "remote";
  playlistId: string;
  sourceId?: string;
}

interface PickerDialogRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

const library = useLibraryStore();
const plugins = usePluginsStore();
const trackMeta = useTrackMetaStore();

const dialogRef = ref<PickerDialogRef | null>(null);
const pickerLoading = ref(false);
const pickerBusy = ref(false);
const pickerOptions = ref<PlaylistOption[]>([]);

watch(
  () => playlistPickerState.visible,
  async (visible) => {
    if (!visible) {
      dialogRef.value?.Hide();
      return;
    }
    const track = playlistPickerState.track;
    if (!track) return;
    pickerOptions.value = library.playlists.map((p) => ({
      key: `local:${p.id}`,
      name: p.name,
      meta: p.trackCount ? `${p.trackCount} 首 · 本地` : "本地歌单",
      cover: p.cover ?? "",
      kind: "local",
      playlistId: String(p.id),
    }));
    pickerLoading.value = plugins.records.some(
      (r) => r.enabled && plugins.hasCapability(r, "myPlaylists"),
    );
    pickerBusy.value = false;

    const shown = dialogRef.value?.ShowAsync();
    // 平台歌单实时拉取（单个插件失败不影响本地歌单可选）
    try {
      const groups = await plugins.getUserPlaylistsAll();
      const remoteOptions: PlaylistOption[] = [];
      for (const group of groups) {
        for (const p of group.result ?? []) {
          // 系统歌单（pinned，如网易云「每日日推」）不接受手动添加，不列进选择器
          if (p.pinned) continue;
          remoteOptions.push({
            key: `${group.record.entry.id}:${p.id}`,
            name: p.name,
            meta: [
              group.record.entry.manifest.name,
              p.trackCount ? `${p.trackCount} 首` : "",
            ]
              .filter(Boolean)
              .join(" · "),
            cover: p.cover ?? "",
            kind: "remote",
            playlistId: p.id,
            sourceId: group.record.entry.id,
          });
        }
      }
      pickerOptions.value = [...pickerOptions.value, ...remoteOptions];
    } finally {
      pickerLoading.value = false;
    }
    await shown;
    // 用户点「取消」关闭对话框时，把状态同步回去
    if (playlistPickerState.visible) closePlaylistPicker();
  },
);

async function pickPlaylist(option: PlaylistOption) {
  const track = playlistPickerState.track;
  if (!track || pickerBusy.value) return;
  pickerBusy.value = true;
  try {
    if (option.kind === "local") {
      await library.addTracksToPlaylist(Number(option.playlistId), [track]);
    } else if (option.sourceId) {
      await plugins.addToUserPlaylist(option.sourceId, option.playlistId, track.id);
    }
    toast(`已添加到「${option.name}」`, "success");
    closePlaylistPicker();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    pickerBusy.value = false;
  }
}
</script>

<template>
  <ContentDialog ref="dialogRef" Title="添加到歌单" CloseButtonText="取消">
    <div class="picker">
      <div v-if="playlistPickerState.track" class="picker-track ellipsis">
        {{ trackTitle(trackMeta.decorate(playlistPickerState.track)) }}
      </div>
      <div v-if="pickerLoading" class="picker-hint">正在加载平台歌单…</div>
      <div v-else-if="!pickerOptions.length" class="picker-hint">还没有可用的歌单</div>
      <div v-else class="picker-list">
        <button
          v-for="option in pickerOptions"
          :key="option.key"
          class="picker-item"
          :disabled="pickerBusy"
          @click="pickPlaylist(option)"
        >
          <span class="picker-cover" :class="{ empty: !option.cover }">
            <CachedImage v-if="option.cover" :src="option.cover" alt="" />
            <span v-else class="wp-icon picker-icon">&#xF4EE;</span>
          </span>
          <span class="picker-name ellipsis">{{ option.name }}</span>
          <span class="picker-meta ellipsis">{{ option.meta }}</span>
        </button>
      </div>
    </div>
  </ContentDialog>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 320px;
}

.picker-track {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.picker-hint {
  font-size: 13px;
  color: var(--wp-text-secondary);
  padding: var(--space-lg) 0;
}

.picker-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  /* 行高放大后一屏能看到的条数减少，列表区同步放宽（对话框自身会滚动） */
  max-height: 380px;
  overflow-y: auto;
}

/* 整行都是点击区：48px 高、封面 38px，避免列表密集时点错歌单 */
.picker-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  height: 48px;
  padding: 0 var(--space-lg);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  font: inherit;
  color: var(--wp-text-primary);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard);
}

.picker-item:hover:not(:disabled) {
  background: var(--wp-card-hover);
}

.picker-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.picker-icon {
  font-size: 18px;
  color: var(--wp-text-secondary);
  flex: none;
}

/* 歌单封面缩略图：固定方形，占位图标在其中居中（:deep 穿透到 CachedImage 的 img） */
.picker-cover {
  width: 38px;
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
  background: var(--wp-control-fill-secondary);
}

.picker-cover :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.picker-cover.empty {
  background: transparent;
}

.picker-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
}

.picker-meta {
  flex: none;
  max-width: 45%;
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------- 移动端 ---------------------------------- */
/* 对话框 teleport 到 body，命中不到 .app-shell 下的触摸尺寸规则，用 html.is-mobile
   兜住（main.ts 挂在 <html> 上）。桌面 48px 的行高在拇指下仍偏小，这里放到 56px，
   封面与字号一起提上去，列表最大高度也放宽——底部面板本身有 86vh 可用。 */
html.is-mobile .picker {
  gap: var(--space-md);
}

html.is-mobile .picker-track {
  font-size: 13px;
}

html.is-mobile .picker-hint {
  padding: var(--space-xl) 0;
  font-size: 14px;
}

html.is-mobile .picker-list {
  /* 扣掉标题 / 曲目行 / 按钮区之后能留给列表的空间 */
  max-height: min(56vh, 520px);
  gap: var(--space-sm);
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html.is-mobile .picker-item {
  height: 56px;
  gap: var(--space-lg);
  border-radius: var(--radius-md);
}

/* 触摸端不用粘滞 hover，改用 :active 反馈 */
html.is-mobile .picker-item:hover:not(:disabled) {
  background: transparent;
}

html.is-mobile .picker-item:active:not(:disabled) {
  background: var(--wp-card-hover);
}

html.is-mobile .picker-icon {
  font-size: 20px;
}

html.is-mobile .picker-cover {
  width: 44px;
  height: 44px;
  border-radius: 7px;
}

html.is-mobile .picker-name {
  font-size: 16px;
}

html.is-mobile .picker-meta {
  font-size: 13px;
  max-width: 40%;
}
</style>
