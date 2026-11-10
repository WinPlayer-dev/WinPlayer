<script setup lang="ts">
/**
 * 桌面端歌词入口（历史文件名保留）。
 *
 * 原来是一个 400×520 的小浮层，现在改成整页的沉浸式「正在播放」——
 * 点播放条的封面 / 曲名、或者「歌词」按钮都会打开它。
 *
 * 保留组件名与文件路径是为了主题兼容：`themes/md3` 的 PlayerBar 里
 * 仍然写的是 `<LyricsPanel />` 与 `player.showLyrics`，无需改动。
 *
 * **必须 Teleport 到 body**：本组件挂在播放条里，而播放条自身带
 * `z-index: 30` 形成了层叠上下文 —— 子元素无论 z-index 写多大，整体
 * 都还是「30」这一层，永远压不住 `z-index: 40` 的标题栏（表现为页面
 * 打开了、标题栏仍浮在上面）。送到 body 下才能真正盖住整窗。
 */
import { usePlayerStore } from "@/stores/player";
import NowPlayingPage from "./NowPlayingPage.vue";

const player = usePlayerStore();
</script>

<template>
  <Teleport to="body">
    <transition name="np">
      <NowPlayingPage v-if="player.showLyrics && player.currentTrack" />
    </transition>
  </Teleport>
</template>

<style scoped>
/*
 * 入场：整页淡入并从 102% 收回 100%，左右两栏再错峰升起
 * （见 NowPlayingPage 的 np-rise）。刻意不做整页位移 —— fixed 覆盖层
 * 一旦下移就会在底部露出后面的播放条。
 *
 * 曲线统一用平滑缓动 cubic-bezier(.33,0,.15,1)：起步不抢、收尾不硬停。
 * 不用 --ease-decelerate：它前段爬升极快（opacity 60ms 就到 0.7），
 * fixed 整窗覆盖时看起来像「瞬切」。
 * 这里刻意**不**跟「歌词滚动速度」设置走：那是歌词行切换的动画，
 * 整页入场太快会露出底下的播放条，保持固定时长更稳。
 */
.np-enter-active {
  transition:
    opacity 300ms cubic-bezier(0.33, 0, 0.15, 1),
    transform 480ms cubic-bezier(0.33, 0, 0.15, 1);
}

.np-leave-active {
  transition:
    opacity 190ms cubic-bezier(0.33, 0, 0.15, 1),
    transform 240ms cubic-bezier(0.33, 0, 0.15, 1);
}

.np-enter-from,
.np-leave-to {
  opacity: 0;
  transform: scale(1.02);
}
</style>
