<script setup lang="ts">
import { ref } from "vue";
import { useAutoCenter } from "@/composables/useAutoCenter";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();
const listRef = ref<HTMLElement | null>(null);

// 当前歌词行自动居中；用户手动滚动后延迟回正
useAutoCenter({
  container: listRef,
  itemSelector: ".lrc-line",
  getIndex: () => player.lyricIndex,
  isActive: () => player.showLyrics,
});
</script>

<template>
  <transition name="panel">
    <div v-if="player.showLyrics" class="lyrics-panel" @pointerdown.stop>
      <div class="panel-header">
        <span class="panel-title">歌词</span>
        <button class="panel-close" title="关闭" @click="player.showLyrics = false">
          <span class="wp-icon">&#xF36A;</span>
        </button>
      </div>

      <div ref="listRef" class="lyrics-scroll">
        <div v-if="player.lyricsLoading" class="lyrics-empty">歌词加载中…</div>
        <div v-else-if="!player.lyrics.length" class="lyrics-empty">暂无歌词</div>
        <div v-else class="lyrics-list">
          <p
            v-for="(line, index) in player.lyrics"
            :key="index"
            class="lrc-line"
            :class="{ active: index === player.lyricIndex }"
            @click="player.seek(line.time / 1000)"
          >
            <span class="lrc-text">{{ line.text }}</span>
            <span v-if="line.translation" class="lrc-translation">{{ line.translation }}</span>
          </p>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.lyrics-panel {
  position: absolute;
  right: var(--space-xl);
  bottom: calc(100% + var(--space-md));
  width: 400px;
  height: 520px;
  max-height: 60vh;
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
  padding: var(--space-lg) var(--space-xl);
  border-bottom: 1px solid var(--wp-divider);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}

.panel-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.panel-close:hover {
  background: var(--wp-card-hover);
}

.lyrics-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 40% var(--space-xl);
}

.lyrics-empty {
  padding: var(--space-3xl) 0;
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 13px;
}

.lyrics-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.lrc-line {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--wp-text-tertiary);
  cursor: pointer;
  transition:
    color var(--duration-normal) var(--ease-standard),
    transform var(--duration-normal) var(--ease-standard);
}

/* 对照翻译：原文下方的小字副行，只有该行确实有翻译时才渲染 */
.lrc-translation {
  font-size: 12px;
  line-height: 1.5;
  font-weight: 400;
  opacity: 0.8;
}

.lrc-line:hover {
  color: var(--wp-text-secondary);
}

.lrc-line.active {
  color: var(--wp-text-primary);
  font-weight: 600;
  font-size: 15px;
}

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
