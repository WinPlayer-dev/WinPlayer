<script setup lang="ts">
/**
 * 歌单导入对话框（全局唯一实例，挂在 App.vue）。
 *
 * 流程：选文件 → 解析（json / m3u8 自动识别）→ 预览摘要 → 选目标歌单
 * （新建，默认用文件名；或合并到已有歌单）→ 需要时跨插件重新搜曲 → 写入。
 *
 * 通过 `openImportDialog()` 触发；导入完成后自动跳到目标歌单。
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ContentDialog } from "@/components/winui";
import WpButton from "@/components/theme/WpButton.vue";
import { toast } from "@/services/toast";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import {
  closeImportDialog,
  importDialogState,
  importPlaylistFile,
  runImport,
  uniquePlaylistName,
  type ImportSummary,
  type ParsedPlaylist,
} from "@/services/playlistIO";

interface DialogRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

const router = useRouter();
const library = useLibraryStore();
const plugins = usePluginsStore();

const dialogRef = ref<DialogRef | null>(null);
/** 解析结果（预览用） */
const parsed = ref<ParsedPlaylist | null>(null);
/** 目标歌单：0 表示新建 */
const targetId = ref(0);
/** 新建歌单名 */
const newName = ref("");
const busy = ref(false);
/** 搜曲进度（0~1；null 表示不在搜曲阶段） */
const progress = ref<number | null>(null);

/** 需要重新搜曲的曲目数（没有 id / 来源插件已卸载） */
const needsResolve = computed(() => {
  if (!parsed.value) return 0;
  const enabled = new Set(plugins.records.filter((r) => r.enabled).map((r) => r.entry.id));
  return parsed.value.tracks.filter(
    (track) => !track.id || !track.sourceId || !enabled.has(track.sourceId),
  ).length;
});

/**
 * 每次打开递增的令牌：用户关掉后立刻又点开时，上一次 `ShowAsync` 的回调
 * 已经作废，不能让它把新对话框顺手关掉。
 */
let openToken = 0;

watch(
  () => importDialogState.visible,
  async (visible) => {
    if (!visible) {
      dialogRef.value?.Hide();
      return;
    }
    const token = ++openToken;
    // 重置状态（每次打开都是全新一次导入）
    parsed.value = null;
    targetId.value = 0;
    newName.value = "";
    busy.value = false;
    progress.value = null;

    const shown = dialogRef.value?.ShowAsync();
    if (!shown) {
      // 组件还没挂载（极早期调用）：把状态退回去，别让 visible 卡在 true，
      // 否则之后每次 openImportDialog() 都看不出变化。
      if (token === openToken) closeImportDialog();
      return;
    }
    await shown;
    if (token !== openToken) return;
    // ContentDialog 只有 ShowAsync / Hide、没有 hide 事件，必须在这里把状态
    // 同步回「已关闭」——否则点「取消」后 visible 仍为 true，下次
    // openImportDialog() 再设 true 时 watch 收不到变化，对话框就打不开了。
    if (importDialogState.visible) closeImportDialog();
  },
);

/** 选择文件并解析（对话框主按钮在第 1 步时是「选择文件」） */
async function pickFile(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await importPlaylistFile();
    if (!result) return; // 用户取消
    if (!result.parsed.tracks.length) throw new Error("文件里没有找到任何歌曲");
    parsed.value = result.parsed;
    // 同名歌单自动加后缀，避免用户无意中把两首歌单建成同一个名字
    newName.value = uniquePlaylistName(result.parsed.name);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy.value = false;
  }
}

/** 开始导入（对话框主按钮在第 2 步时是「导入」） */
async function doImport(): Promise<void> {
  const source = parsed.value;
  if (!source || busy.value) return;
  if (!targetId.value && !newName.value.trim()) {
    toast("歌单名称不能为空", "error");
    return;
  }
  busy.value = true;
  progress.value = needsResolve.value ? 0 : null;
  try {
    const summary: ImportSummary = await runImport(source, {
      targetId: targetId.value || undefined,
      name: newName.value.trim(),
      onProgress: (done, total) => {
        progress.value = total ? done / total : 1;
      },
    });
    const parts = [`新增 ${summary.added} 首`];
    if (summary.duplicated) parts.push(`跳过重复 ${summary.duplicated} 首`);
    if (summary.resolve.resolved) parts.push(`重新搜到 ${summary.resolve.resolved} 首`);
    if (summary.resolve.unresolved) parts.push(`${summary.resolve.unresolved} 首未找到`);
    toast(`${summary.created ? "已导入到新歌单" : "已合并到歌单"}：${parts.join("，")}`, "success");
    closeImportDialog();
    if (summary.playlist) {
      void router.push({ name: "playlist", params: { id: summary.playlist.id } });
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy.value = false;
    progress.value = null;
  }
}
</script>

<template>
  <!--
    主按钮不用 ContentDialog 自带的（它在点击后立即关闭、无法在对话框内展示进度），
    改为插槽里的自绘按钮：选文件 → 预览 → 导入，全程对话框保持打开。
  -->
  <ContentDialog
    ref="dialogRef"
    Title="导入歌单"
    CloseButtonText="取消"
    DefaultButton="Close"
  >
    <div class="import">
      <!-- 第一步：说明 + 选文件 -->
      <template v-if="!parsed">
        <p class="import-hint">
          支持 WinPlayer 歌单（.json）与标准播放列表（.m3u / .m3u8）。导入时按曲目去重，
          缺少来源信息的歌曲会自动跨插件重新搜索。
        </p>
        <WpButton class="pick-button" :disabled="busy" @click="pickFile">
          <!-- arrow_import_24_regular (F15A)：F3B3 实际是 desktop_sync_16_regular，不是导入图标 -->
          <span class="wp-icon">&#xF15A;</span>
          {{ busy ? "正在读取…" : "选择歌单文件…" }}
        </WpButton>
      </template>

      <!-- 第二步：预览 + 选目标 -->
      <template v-else>
        <div class="preview">
          <div class="preview-title ellipsis">{{ parsed.name }}</div>
          <div class="preview-meta">
            {{ parsed.format === "json" ? "WinPlayer 歌单" : "M3U 播放列表" }} ·
            {{ parsed.tracks.length }} 首
            <template v-if="needsResolve"> · 其中 {{ needsResolve }} 首需重新搜索</template>
          </div>
        </div>

        <div class="target-list">
          <label class="target-item" :class="{ active: targetId === 0 }">
            <input v-model.number="targetId" type="radio" :value="0" />
            <span class="target-name">新建歌单</span>
          </label>
          <input
            v-if="targetId === 0"
            v-model="newName"
            class="target-input"
            type="text"
            maxlength="50"
            placeholder="歌单名称"
            :disabled="busy"
          />
          <template v-if="library.playlists.length">
            <label
              v-for="playlist in library.playlists"
              :key="playlist.id"
              class="target-item"
              :class="{ active: targetId === playlist.id }"
            >
              <input v-model.number="targetId" type="radio" :value="playlist.id" />
              <span class="target-name ellipsis">{{ playlist.name }}</span>
              <span class="target-count">{{ playlist.trackCount ?? 0 }} 首</span>
            </label>
          </template>
        </div>

        <div v-if="progress !== null" class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${Math.round(progress * 100)}%` }" />
          </div>
          <span class="progress-text">正在重新搜索歌曲…{{ Math.round(progress * 100) }}%</span>
        </div>

        <!-- 操作区：导入 / 重新选择 -->
        <div class="import-actions">
          <WpButton variant="standard" :disabled="busy" @click="pickFile">重新选择</WpButton>
          <WpButton variant="accent" :disabled="busy" @click="doImport">
            {{ busy ? "正在导入…" : "导入" }}
          </WpButton>
        </div>
      </template>
    </div>
  </ContentDialog>
</template>

<style scoped>
.import {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 12px);
  min-width: min(420px, 70vw);
}

.import-hint {
  margin: 0;
  color: var(--wp-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.pick-button {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--wp-text-primary);
}

.preview-meta {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.target-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.target-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  font-size: 13px;
}

.target-item:hover {
  background: var(--wp-control-hover, rgba(128, 128, 128, 0.1));
}

.target-item.active {
  background: var(--wp-accent-subtle, rgba(0, 120, 212, 0.12));
}

.target-name {
  flex: 1;
  min-width: 0;
}

.target-count {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.target-input {
  margin-left: 24px;
  padding: 8px 10px;
  border: 1px solid var(--wp-control-stroke, rgba(128, 128, 128, 0.4));
  border-radius: var(--radius-md, 8px);
  background: var(--wp-fill-control, rgba(255, 255, 255, 0.06));
  color: var(--wp-text-primary);
  font-size: 13px;
}

.progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--wp-control-fill, rgba(128, 128, 128, 0.2));
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--wp-accent);
  transition: width 0.2s ease;
}

.progress-text {
  margin: 0;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* 导入 / 重新选择：靠右排列 */
.import-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm, 8px);
}
</style>
