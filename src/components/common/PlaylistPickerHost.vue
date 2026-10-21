<script setup lang="ts">
/**
 * 「添加到歌单」选择器宿主（全局唯一实例，挂在 App.vue）
 * 通过 openPlaylistPicker(track) 打开，本地歌单 + 各插件的平台个人歌单可选
 */
import { ref, watch } from "vue";
import { ContentDialog } from "@/components/winui";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/services/toast";
import { closePlaylistPicker, playlistPickerState } from "@/services/playlistPicker";
import { trackTitle } from "@/types/player";

/** 歌单选项（本地歌单 + 各插件的平台个人歌单） */
interface PlaylistOption {
  key: string;
  name: string;
  meta: string;
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
        {{ trackTitle(playlistPickerState.track) }}
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
          <span class="wp-icon picker-icon">&#xF4EE;</span>
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
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 36px;
  padding: 0 var(--space-md);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
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
  font-size: 14px;
  color: var(--wp-text-secondary);
  flex: none;
}

.picker-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
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
</style>
