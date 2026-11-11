<script setup lang="ts">
import { ref } from "vue";
import { usePlayerStore } from "@/stores/player";
import { useLibraryStore } from "@/stores/library";
import { useTrackMetaStore } from "@/stores/trackMeta";
import { useAutoCenter } from "@/composables/useAutoCenter";
import { openContextMenu, type ContextMenuItem } from "@/services/contextMenu";
import { openPlaylistPicker, useCanAddToPlaylist } from "@/services/playlistPicker";
import { copyText } from "@/services/clipboard";
import { formatDuration, trackArtist, trackTitle } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const player = usePlayerStore();
const library = useLibraryStore();
const trackMeta = useTrackMetaStore();

const bodyRef = ref<HTMLElement | null>(null);

// 当前播放项自动居中；用户手动滚动后延迟回正
useAutoCenter({
  container: bodyRef,
  itemSelector: ".queue-item",
  getIndex: () => player.currentIndex,
  isActive: () => player.showQueue,
});

/** 与歌曲列表 / 播放条共用同一判定（演示模式下入口整体隐藏） */
const canAddToPlaylist = useCanAddToPlaylist();

/** 队列行右键菜单：添加到歌单 / 添加到我喜欢 / 移除 / 添加到播放队列 */
function openItemMenu(track: UnifiedTrack, uid: string, event: MouseEvent) {
  const liked = library.isLiked(track);
  const items: ContextMenuItem[] = [];
  if (canAddToPlaylist.value) {
    items.push({
      key: "playlist",
      label: t("layout.playerBar.addToPlaylist"),
      icon: "&#xF4EE;",
      action: () => openPlaylistPicker(track),
    });
  }
  items.push({
    key: "like",
    label: liked ? t("layout.playerBar.unlike") : t("layout.playerBar.like"),
    icon: liked ? "&#xF47E;" : "&#xF47A;",
    filled: liked,
    action: () => library.toggleLike(track),
  });
  items.push({
    key: "queue",
    label: t("layout.playerBar.addToQueue"),
    icon: "&#xF10A;",
    action: () => player.addToQueue([track]),
  });
  items.push({
    key: "remove",
    label: t("common.action.remove"),
    icon: "&#xF34D;",
    danger: true,
    action: () => player.removeFromQueue(uid),
  });
  items.push({
    key: "copy-name",
    label: t("layout.playerBar.copyTrackName"),
    icon: "&#xF32C;",
    action: () => copyText(trackMeta.decorate(track).name, t("layout.playerBar.trackNameLabel")),
  });
  const alias = track.alias;
  if (alias) {
    items.push({
      key: "copy-alias",
      label: t("layout.playerBar.copyTrackAlias"),
      icon: "&#xF32C;",
      action: () => copyText(alias, t("layout.playerBar.trackAliasLabel")),
    });
  }
  openContextMenu(event, items);
}
</script>

<template>
  <transition name="panel">
    <div v-if="player.showQueue" class="queue-panel" @pointerdown.stop>
      <div class="panel-header">
        <span class="panel-title">{{ t("layout.playerBar.queue") }}</span>
        <span class="panel-count">{{ t("common.unit.track", { count: player.queue.length }) }}</span>
        <button v-if="player.queue.length" class="panel-action" @click="player.clearQueue">{{ t("layout.playerBar.clearQueue") }}</button>
      </div>

      <div ref="bodyRef" class="panel-body">
        <div v-if="!player.queue.length" class="panel-empty">{{ t("layout.playerBar.queueEmpty") }}</div>
        <ul v-else class="queue-list">
          <li
            v-for="(item, index) in player.queue"
            :key="item.uid"
            class="queue-item"
            :class="{ current: index === player.currentIndex }"
            draggable="true"
            @dragstart.stop
            @dblclick="player.playAt(index)"
            @contextmenu="openItemMenu(item.track, item.uid, $event)"
          >
            <div class="queue-index">
              <span v-if="index === player.currentIndex" class="wp-icon filled playing-indicator">&#xE855;</span>
              <span v-else>{{ index + 1 }}</span>
            </div>
            <div class="queue-meta">
              <div class="queue-title ellipsis">{{ trackTitle(trackMeta.decorate(item.track)) }}</div>
              <div class="queue-artist ellipsis">{{ trackArtist(trackMeta.decorate(item.track)) }}</div>
            </div>
            <span class="queue-duration">{{ formatDuration(item.track.duration) }}</span>
            <button class="queue-remove" :title="t('common.action.remove')" @click.stop="player.removeFromQueue(item.uid)">
              <span class="wp-icon">&#xF36A;</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.queue-panel {
  position: absolute;
  right: var(--space-xl);
  bottom: calc(100% + var(--space-md));
  width: 380px;
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
}

.panel-action {
  border: none;
  background: transparent;
  color: var(--wp-accent);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
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

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 48px;
  padding: 0 var(--space-md);
  border-radius: var(--radius-sm);
  cursor: default;
  transition: background var(--duration-fast) var(--ease-standard);
}

.queue-item:hover {
  background: var(--wp-card-hover);
}

.queue-item.current .queue-title {
  color: var(--wp-accent);
}

.queue-index {
  width: 28px;
  flex: none;
  text-align: center;
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.playing-indicator {
  color: var(--wp-accent);
  font-size: 12px;
}

.queue-meta {
  flex: 1;
  min-width: 0;
}

.queue-title {
  font-size: 13px;
}

.queue-artist {
  font-size: 11px;
  color: var(--wp-text-secondary);
  margin-top: 1px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-duration {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.queue-remove {
  width: 28px;
  height: 28px;
  flex: none;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 10px;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.queue-item:hover .queue-remove {
  opacity: 1;
}

.queue-remove:hover {
  background: var(--wp-card-active);
  color: var(--wp-text-primary);
}

/* 面板动画（WinUI Connected Animation 近似） */
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
