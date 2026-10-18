<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { RouterView } from "vue-router";
import TitleBar from "@/components/layout/TitleBar.vue";
import SideNav from "@/components/layout/SideNav.vue";
import PlayerBar from "@/components/layout/PlayerBar.vue";
import MobileTabBar from "@/components/layout/MobileTabBar.vue";
import MobilePlayerBar from "@/components/layout/MobilePlayerBar.vue";
import MobilePullToRefresh from "@/components/layout/MobilePullToRefresh.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import ToastHost from "@/components/common/ToastHost.vue";
import ContextMenuHost from "@/components/common/ContextMenuHost.vue";
import PlaylistPickerHost from "@/components/common/PlaylistPickerHost.vue";
import ShortcutHost from "@/components/common/ShortcutHost.vue";
import UpdateDialogHost from "@/components/common/UpdateDialogHost.vue";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useDownloadsStore } from "@/stores/downloads";
import { useShortcutsStore } from "@/stores/shortcuts";
import { useUpdaterStore } from "@/stores/updater";
import { disposeSmtc, initSmtc, setSmtcEnabled } from "@/services/smtc";
import { refreshAccentFromCover } from "@/services/coverAccent";

const settings = useSettingsStore();
const plugins = usePluginsStore();
const library = useLibraryStore();
const player = usePlayerStore();
const downloads = useDownloadsStore();
const shortcuts = useShortcutsStore();
const updater = useUpdaterStore();
const isMobile = useIsMobile();

// 注册于 load() 之前：设置读出后立即把开关同步给系统媒体控件（SMTC）
const stopSmtcWatch = watch(
  () => settings.smtcEnabled,
  (value) => setSmtcEnabled(value),
  { immediate: true },
);

// 跟随封面取色（可在设置中开关）：封面 / 开关 / 主题变化时重新提取强调色
const stopAccentWatch = watch(
  [() => player.currentTrack?.cover, () => settings.coverAccent, () => settings.theme],
  ([cover, enabled]) => void refreshAccentFromCover(cover, enabled),
);

onMounted(async () => {
  await settings.load();
  await Promise.all([library.loadAll(), player.restore(), shortcuts.load()]);
  await plugins.loadInstalled();
  initSmtc(player);
  // 离线下载：订阅进度、解析默认目录、载入离线索引（不阻塞首屏）
  void downloads.init();
  // 自动更新与播放无关：放在最后并静默执行，不阻塞首屏
  void updater.init().then(() => updater.maybeAutoCheck());
});

onUnmounted(() => {
  plugins.disposeAll();
  updater.dispose();
  stopSmtcWatch();
  stopAccentWatch();
  disposeSmtc();
});
</script>

<template>
  <div class="app-shell" :class="{ 'is-mobile': isMobile }">
    <TitleBar v-if="!isMobile" class="app-titlebar" />
    <div class="app-body">
      <SideNav v-if="!isMobile" class="app-sidenav" />
      <main class="app-content">
        <router-view v-slot="{ Component }">
          <transition name="wp-route" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
    <!-- 移动端：迷你播放条 + 底部导航栏；桌面端：完整播放条 -->
    <MobilePlayerBar v-if="isMobile" />
    <MobileTabBar v-if="isMobile" />
    <MobilePullToRefresh v-if="isMobile" />
    <PlayerBar v-if="!isMobile" class="app-playerbar" />
    <ToastHost />
    <ContextMenuHost />
    <PlaylistPickerHost />
    <ShortcutHost />
    <UpdateDialogHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--wp-base);
  color: var(--wp-text-primary);
}

/* 移动端：为顶部状态栏 / 刘海留出安全区（桌面端不生效） */
.app-shell.is-mobile {
  padding-top: var(--safe-area-top);
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
