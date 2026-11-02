/**
 * 「自定义歌曲信息」编辑框的打开状态。
 *
 * 与其它全局弹窗一致（见 services/playlistPicker.ts）：状态放模块里，
 * 宿主组件 `TrackMetaEditorHost.vue` 在 App.vue 挂一份，任何地方
 * 调 `openTrackMetaEditor(track)` 即可打开。
 */

import { reactive } from "vue";
import type { UnifiedTrack } from "@/types/plugin";

interface TrackMetaEditorState {
  visible: boolean;
  /** 正在编辑的曲目（原始曲目，不是装饰后的） */
  track: UnifiedTrack | null;
}

export const trackMetaEditorState = reactive<TrackMetaEditorState>({
  visible: false,
  track: null,
});

export function openTrackMetaEditor(track: UnifiedTrack): void {
  trackMetaEditorState.track = track;
  trackMetaEditorState.visible = true;
}

export function closeTrackMetaEditor(): void {
  trackMetaEditorState.visible = false;
  // 曲目引用留着无妨：下次打开会被覆盖，提前清空反而会让关闭动画里闪一下空表单
}
