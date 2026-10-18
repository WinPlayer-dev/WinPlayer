<script setup lang="ts">
/**
 * 下载管理器浮出面板（挂在 PlayerBar 内，样式与 QueuePanel 一致）。
 *
 * - 串行队列的任务列表：下载中 / 排队 / 已暂停 / 已完成 / 失败；
 * - 逐条暂停、继续、重试、移除，以及全部暂停/继续、清除已完成；
 * - 底部提供「离线音乐」入口（查看已下载曲库）。
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useDownloadsStore, type DownloadTask } from "@/stores/downloads";
import { trackArtist, trackTitle } from "@/types/player";

const router = useRouter();
const downloads = useDownloadsStore();

const hasActive = computed(() => downloads.activeTasks.length > 0);

/** 下载进度百分比（未知总长时为 0） */
function percent(task: DownloadTask): number {
  if (!task.total) return 0;
  return Math.min(100, Math.round((task.downloaded / task.total) * 100));
}

/** 任务状态文案 */
function statusText(task: DownloadTask): string {
  switch (task.status) {
    case "queued":
      return "排队中";
    case "downloading":
      return task.total > 0 ? `${percent(task)}%` : "正在获取…";
    case "paused":
      return "已暂停";
    case "done":
      return `已完成 · ${downloads.formatBytes(task.downloaded)}`;
    case "error":
      return task.error ? `失败：${task.error}` : "下载失败";
    default:
      return "";
  }
}

/** 打开离线音乐页并收起面板 */
function openOffline(): void {
  downloads.panelOpen = false;
  void router.push({ name: "offline" });
}
</script>

<template>
  <transition name="panel">
    <div v-if="downloads.panelOpen" class="download-panel" @pointerdown.stop>
      <div class="panel-header">
        <span class="panel-title">下载管理</span>
        <span class="panel-count">
          {{ hasActive ? `${downloads.activeTasks.length} 项进行中` : `已下载 ${downloads.downloadedCount} 首` }}
        </span>
        <button v-if="hasActive" class="panel-action" @click="downloads.toggleQueuePaused()">
          {{ downloads.queuePaused ? "继续全部" : "暂停全部" }}
        </button>
        <button v-if="downloads.finishedTasks.length" class="panel-action" @click="downloads.clearFinished()">
          清除已完成
        </button>
      </div>

      <div class="panel-body">
        <div v-if="!downloads.tasks.length" class="panel-empty">
          还没有下载任务，在歌曲上右键选择「下载到本地」
        </div>
        <ul v-else class="download-list">
          <li v-for="task in downloads.tasks" :key="task.id" class="download-item" :class="task.status">
            <div class="item-main">
              <div class="item-title ellipsis">{{ trackTitle(task.track) }}</div>
              <div class="item-sub">
                <span class="ellipsis">{{ trackArtist(task.track) }}</span>
                <span class="item-status" :class="{ error: task.status === 'error' }">
                  {{ statusText(task) }}
                </span>
                <span v-if="task.status === 'downloading' && task.speed > 0" class="item-speed">
                  {{ downloads.formatBytes(task.speed) }}/s
                </span>
              </div>
              <div
                v-if="task.status === 'downloading' || task.status === 'queued'"
                class="item-progress"
              >
                <div class="item-progress-fill" :style="{ width: `${percent(task)}%` }" />
              </div>
            </div>

            <div class="item-actions">
              <button
                v-if="task.status === 'downloading' || task.status === 'queued'"
                class="item-action"
                title="暂停"
                @click="downloads.pauseTask(task.id)"
              >
                <span class="wp-icon filled">&#xF610;</span>
              </button>
              <button
                v-else-if="task.status === 'paused'"
                class="item-action"
                title="继续"
                @click="downloads.resumeTask(task.id)"
              >
                <span class="wp-icon filled">&#xF5AC;</span>
              </button>
              <button
                v-else-if="task.status === 'error'"
                class="item-action"
                title="重试"
                @click="downloads.retryTask(task.id)"
              >
                <span class="wp-icon">&#xF13E;</span>
              </button>
              <span v-else class="item-done wp-icon" title="已完成">&#xF294;</span>
              <button class="item-action" title="移除" @click="downloads.removeTask(task.id)">
                <span class="wp-icon">&#xF36A;</span>
              </button>
            </div>
          </li>
        </ul>
      </div>

      <button class="panel-footer" @click="openOffline">
        <span class="wp-icon footer-icon">&#xF151;</span>
        <span class="footer-label">离线音乐</span>
        <span class="footer-count">
          {{ downloads.downloadedCount }} 首 · {{ downloads.formatBytes(downloads.totalSize) }}
        </span>
        <span class="wp-icon footer-chevron">&#xF2B1;</span>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.download-panel {
  position: absolute;
  right: var(--space-xl);
  bottom: calc(100% + var(--space-md));
  width: 400px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--wp-flyout);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-flyout);
  z-index: 50;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-xl);
  border-bottom: 1px solid var(--wp-divider);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
}

.panel-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-action {
  border: none;
  background: transparent;
  color: var(--wp-accent);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  flex: none;
}

.panel-action:hover {
  background: var(--wp-card-hover);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: var(--space-sm);
}

.panel-empty {
  padding: var(--space-3xl) var(--space-xl);
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 13px;
}

.download-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.download-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}

.download-item:hover {
  background: var(--wp-card-hover);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 13px;
}

.download-item.done .item-title {
  color: var(--wp-text-secondary);
}

.item-sub {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: 2px;
  font-size: 11px;
  color: var(--wp-text-secondary);
  min-width: 0;
}

.item-sub > .ellipsis {
  min-width: 0;
  flex: 0 1 auto;
}

.item-status {
  flex: none;
}

.item-status.error {
  color: var(--wp-danger);
}

.download-item.error .item-title {
  color: var(--wp-text-secondary);
}

.item-speed {
  flex: none;
  color: var(--wp-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.item-progress {
  height: 3px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--wp-control-fill-secondary);
  overflow: hidden;
}

.item-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--wp-accent);
  transition: width 0.2s linear;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.item-action {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.item-action:hover {
  background: var(--wp-card-active);
  color: var(--wp-text-primary);
}

.item-done {
  width: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--wp-accent);
}

.panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  height: 44px;
  flex: none;
  padding: 0 var(--space-xl);
  border: none;
  border-top: 1px solid var(--wp-divider);
  background: transparent;
  color: var(--wp-text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.panel-footer:hover {
  background: var(--wp-card-hover);
}

.footer-icon {
  font-size: 15px;
  color: var(--wp-accent);
}

.footer-label {
  flex: 1;
  text-align: left;
}

.footer-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.footer-chevron {
  font-size: 11px;
  color: var(--wp-text-secondary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 面板动画（与播放队列一致） */
.panel-enter-active,
.panel-leave-active {
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    opacity var(--duration-normal) var(--ease-decelerate);
}

.panel-enter-from,
.panel-leave-to {
  transform: translateY(12px) scale(0.98);
  opacity: 0;
}
</style>
