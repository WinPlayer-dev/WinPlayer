/** 「添加到歌单」选择器（全局共享对话框） */

import { computed, reactive, type ComputedRef } from "vue";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import type { UnifiedTrack } from "@/types/plugin";

interface PlaylistPickerState {
  visible: boolean;
  track: UnifiedTrack | null;
}

export const playlistPickerState = reactive<PlaylistPickerState>({
  visible: false,
  track: null,
});

export function openPlaylistPicker(track: UnifiedTrack): void {
  playlistPickerState.track = track;
  playlistPickerState.visible = true;
}

export function closePlaylistPicker(): void {
  playlistPickerState.visible = false;
  playlistPickerState.track = null;
}

/**
 * 「添加到歌单」入口是否该显示：本地歌单非空，或某个启用中的插件支持平台个人歌单。
 * 歌曲行、播放条「更多」、全屏歌词页「更多」共用同一判定，避免各入口口径不一致。
 * 必须在组件 setup 期调用（内部要解析 store）。
 */
export function useCanAddToPlaylist(): ComputedRef<boolean> {
  const library = useLibraryStore();
  const plugins = usePluginsStore();
  return computed(
    () =>
      library.playlists.length > 0 ||
      plugins.records.some((r) => r.enabled && plugins.hasCapability(r, "myPlaylists")),
  );
}
