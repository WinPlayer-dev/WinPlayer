<script setup lang="ts">
/**
 * 页面框架（可被主题重写）：标题栏 / 侧边导航 / 内容区 / 播放条的可替换骨架。
 *
 * 这是主题唯一能改「整体布局」的入口。默认实现与原先 App.vue 的骨架完全一致，
 * 主题通过 components.PageShell 替换它即可把侧边栏换成 MD3 Navigation Rail、
 * 把播放条挪到顶部等等。页面内容通过 #content 插槽传入。
 */
import TitleBar from "@/components/layout/TitleBar.vue";
import SideNav from "@/components/layout/SideNav.vue";
import PlayerBar from "@/components/layout/PlayerBar.vue";
import MobileTabBar from "@/components/layout/MobileTabBar.vue";
import MobilePlayerBar from "@/components/layout/MobilePlayerBar.vue";
import MobilePullToRefresh from "@/components/layout/MobilePullToRefresh.vue";

defineProps<{
  /** 移动端（Android / iOS WebView） */
  mobile: boolean;
}>();

defineSlots<{
  /** 主内容区（RouterView） */
  content?: () => unknown;
}>();
</script>

<template>
  <div class="app-frame">
    <TitleBar v-if="!mobile" class="app-titlebar" />
    <div class="app-body">
      <SideNav v-if="!mobile" class="app-sidenav" />
      <main class="app-content">
        <slot name="content" />
      </main>
    </div>
    <!-- 移动端：迷你播放条 + 底部导航栏；桌面端：完整播放条 -->
    <MobilePlayerBar v-if="mobile" />
    <MobileTabBar v-if="mobile" />
    <MobilePullToRefresh v-if="mobile" />
    <PlayerBar v-if="!mobile" class="app-playerbar" />
  </div>
</template>

<style scoped>
.app-frame {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.app-titlebar {
  height: var(--titlebar-height);
  flex: none;
  z-index: 40;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.app-sidenav {
  width: var(--sidenav-width);
  flex: none;
}

.app-content {
  flex: 1;
  min-width: 0;
  position: relative;
}

.app-playerbar {
  height: var(--playerbar-height);
  flex: none;
  z-index: 30;
}
</style>
