<script setup lang="ts">
/**
 * 自动更新的弹窗宿主（全局唯一实例，挂在 App.vue）
 *
 * 弹窗的显示状态完全由 stores/updater 的 dialog 字段驱动：
 * - prompt：发现新版本，询问是否下载安装
 * - progress：下载 / 安装进度
 */
import { computed, ref, watch } from "vue";
import { ContentDialog, ProgressBar } from "@/components/winui";
import { useUpdaterStore } from "@/stores/updater";
import { formatBytes, installerLabel } from "@/services/updater";

/** ContentDialog 通过实例方法 ShowAsync() 打开（组件没有 IsOpen prop） */
interface DialogRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

/** 组件尚未挂载完成时的重试次数与间隔 */
const SHOW_RETRY_LIMIT = 25;
const SHOW_RETRY_DELAY = 60;

const updater = useUpdaterStore();

/** 开发模式下禁用真实安装，避免误替换本地可执行文件 */
const isDev = import.meta.env.DEV;

const promptRef = ref<DialogRef | null>(null);
const progressRef = ref<DialogRef | null>(null);

const info = computed(() => updater.info);
const downloading = computed(() => updater.phase === "downloading");
const installing = computed(() => updater.phase === "installing");

/** 安装包类型名称 */
const installerText = computed(() =>
  info.value ? installerLabel(info.value.installer) : "",
);

/** 发布说明：纯文本展示，保留换行即可（不解析 Markdown，避免 v-html 注入风险） */
const notes = computed(() => info.value?.notes.trim() ?? "");

/** 发布日期（仅取 yyyy-MM-dd） */
const publishedDate = computed(() => {
  const raw = info.value?.publishedAt;
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
});

/** 进度弹窗标题 */
const progressTitle = computed(() => {
  if (installing.value) return "正在安装更新";
  if (updater.phase === "done") return "更新已就绪";
  return "正在下载更新";
});

/** 进度弹窗说明文字 */
const progressHint = computed(() => {
  if (installing.value) return "安装程序已启动，应用即将自动关闭以完成更新，请稍候…";
  if (updater.phase === "done") return "更新已准备完成。";
  const total = updater.progress.total;
  if (!total) return `已下载 ${formatBytes(updater.progress.downloaded)}`;
  return `${formatBytes(updater.progress.downloaded)} / ${formatBytes(total)}`;
});

/** 平均下载速度文本 */
const speedText = computed(() =>
  downloading.value && updater.progress.speed > 0
    ? `${formatBytes(updater.progress.speed)}/s`
    : "",
);

/** 取消下载按钮仅在下载中显示 */
const primaryButtonText = computed(() => (downloading.value ? "取消下载" : ""));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 打开弹窗并等待用户操作结果；组件引用尚未就绪（挂载中）时稍后重试。
 * @param target 弹窗组件引用
 * @param isActive 目标状态是否仍然有效（状态被改写时放弃展示）
 */
async function showDialog(
  target: typeof promptRef,
  isActive: () => boolean,
): Promise<string | null> {
  for (let attempt = 0; attempt < SHOW_RETRY_LIMIT; attempt += 1) {
    if (!isActive()) return null;
    const dialogRef = target.value;
    if (dialogRef) return dialogRef.ShowAsync();
    await delay(SHOW_RETRY_DELAY);
  }
  return null;
}

/** 「发现新版本」弹窗的交互结果处理 */
async function runPrompt(): Promise<void> {
  const result = await showDialog(promptRef, () => updater.dialog === "prompt");
  if (updater.dialog !== "prompt") return;
  if (result === "Primary") {
    await updater.startDownloadAndInstall();
    return;
  }
  if (result === "Secondary") {
    await updater.ignoreCurrentVersion();
    return;
  }
  // 「稍后」：关闭弹窗但保留发现的版本，关于页可再次查看
  updater.closeDialog();
}

/** 进度弹窗的交互结果处理 */
async function runProgress(): Promise<void> {
  const result = await showDialog(progressRef, () => updater.dialog === "progress");
  if (updater.dialog !== "progress") return;
  if (result === "Primary") {
    await updater.cancelDownload();
    return;
  }
  // 「后台继续」：仅收起弹窗，下载继续进行
  updater.closeDialog();
}

watch(
  () => updater.dialog,
  (mode) => {
    if (mode === "prompt") void runPrompt();
    else if (mode === "progress") void runProgress();
    else {
      promptRef.value?.Hide();
      progressRef.value?.Hide();
    }
  },
);
</script>

<template>
  <!-- 发现新版本 -->
  <ContentDialog
    ref="promptRef"
    :Title="info?.prerelease ? '发现新的预览版本' : '发现新版本'"
    PrimaryButtonText="下载并安装"
    SecondaryButtonText="忽略此版本"
    CloseButtonText="稍后"
    :IsPrimaryButtonEnabled="!isDev"
    DefaultButton="Primary"
  >
    <div v-if="info" class="update-prompt">
      <div class="update-version">
        <span class="version-tag">{{ info.version }}</span>
        <span v-if="info.prerelease" class="prerelease-badge">预览版</span>
      </div>
      <div class="update-meta">
        <span v-if="installerText">{{ installerText }}</span>
        <span v-if="info.assetSize">{{ formatBytes(info.assetSize) }}</span>
        <span v-if="publishedDate">{{ publishedDate }}</span>
      </div>
      <div v-if="notes" class="update-notes">{{ notes }}</div>
      <div v-else class="update-notes empty">该版本未提供更新说明</div>
      <div v-if="isDev" class="update-dev-hint">开发模式下不会真正执行安装</div>
    </div>
  </ContentDialog>

  <!-- 下载 / 安装进度 -->
  <ContentDialog
    ref="progressRef"
    :Title="progressTitle"
    :PrimaryButtonText="primaryButtonText"
    :CloseButtonText="downloading ? '后台继续' : ''"
    :IsPrimaryButtonEnabled="downloading"
  >
    <div class="update-progress">
      <div class="progress-target">
        <span v-if="info" class="version-tag">{{ info.version }}</span>
        <span v-if="installerText" class="progress-installer">{{ installerText }}</span>
      </div>
      <ProgressBar
        :Value="updater.percent"
        :Maximum="100"
        :IsIndeterminate="installing"
        class="progress-bar"
      />
      <div class="progress-meta">
        <span class="progress-hint">{{ progressHint }}</span>
        <span v-if="downloading" class="progress-side">
          <span>{{ updater.percent }}%</span>
          <span v-if="speedText">{{ speedText }}</span>
        </span>
      </div>
    </div>
  </ContentDialog>
</template>

<style scoped>
.update-prompt {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 380px;
  max-width: 480px;
}

.update-version {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.version-tag {
  font-size: 20px;
  font-weight: 600;
}

.prerelease-badge {
  font-size: 11px;
  color: var(--wp-accent);
  background: var(--wp-accent-light);
  border-radius: 8px;
  padding: 1px 8px;
}

.update-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.update-notes {
  font-size: 13px;
  line-height: 1.6;
  color: var(--wp-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-md);
  background: var(--wp-control-fill-secondary);
  border-radius: var(--radius-sm);
}

.update-notes.empty {
  color: var(--wp-text-tertiary);
  font-style: italic;
}

.update-dev-hint {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  min-width: 380px;
  padding-top: var(--space-sm);
}

.progress-target {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.progress-target .version-tag {
  font-size: 15px;
}

.progress-installer {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.progress-bar {
  width: 100%;
}

.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.progress-side {
  display: flex;
  gap: var(--space-lg);
  flex: none;
  color: var(--wp-text-tertiary);
}
</style>
