<script setup lang="ts">
/**
 * 应用根组件：只做「初始化 + 挂骨架」。
 *
 * 骨架收拢在 PageShell.vue，以便主题整体替换（components.PageShell）。
 * 全局浮层（Toast / 右键菜单 / 更新对话框…）也由骨架渲染，
 * 因此主题换骨架时这些宿主能力不会丢。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import PageShell from "@/components/layout/PageShell.vue";
import TitleBar from "@/components/layout/TitleBar.vue";
import { themeSlot } from "@/components/theme/themeSlot";
import { useIsMobile } from "@/composables/useIsMobile";
import ToastHost from "@/components/common/ToastHost.vue";
import ContextMenuHost from "@/components/common/ContextMenuHost.vue";
import PlaylistPickerHost from "@/components/common/PlaylistPickerHost.vue";
import PlaylistImportHost from "@/components/common/PlaylistImportHost.vue";
import ShortcutHost from "@/components/common/ShortcutHost.vue";
import UpdateDialogHost from "@/components/common/UpdateDialogHost.vue";
import ThemeBackdrop from "@/components/theme/ThemeBackdrop.vue";
import ThemeBackgroundBase from "@/components/theme/ThemeBackgroundBase.vue";
import { useSettingsStore } from "@/stores/settings";
import { useThemesStore } from "@/stores/themes";
import { usePluginsStore } from "@/stores/plugins";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { useDownloadsStore } from "@/stores/downloads";
import { useHistoryStore } from "@/stores/history";
import { useShortcutsStore } from "@/stores/shortcuts";
import { useUpdaterStore } from "@/stores/updater";
import { disposeSmtc, initSmtc, setSmtcEnabled } from "@/services/smtc";
import { initTray, disposeTray } from "@/services/tray";
import { setAppHidden, setOptimizeEnabled } from "@/services/backgroundMode";
import { refreshAccentFromCover } from "@/services/coverAccent";
import { installBackButton, uninstallBackButton } from "@/services/backButton";
import { uninstallKeyboardInset } from "@/services/keyboard";
import { toast } from "@/services/toast";

const router = useRouter();
const route = useRoute();

const settings = useSettingsStore();
const themes = useThemesStore();
const plugins = usePluginsStore();
const library = useLibraryStore();
const player = usePlayerStore();
const downloads = useDownloadsStore();
const history = useHistoryStore();
const shortcuts = useShortcutsStore();
const updater = useUpdaterStore();
const isMobile = useIsMobile();

/** 页面骨架：主题可用 components.PageShell 整体替换（含错误边界回退） */
const ThemedPageShell = themeSlot("PageShell", PageShell);

/**
 * 应用背景层：主题可用 components.Background 整体接管（例如 MD3 主题用 MDUI 色板绘制）。
 * 没有覆盖时渲染 ThemeBackgroundBase（默认什么都不画，保持原有 --wp-base 背景）。
 */
const ThemedBackground = themeSlot("Background", ThemeBackgroundBase);

/**
 * 首屏就绪：初始化阶段先不渲染任何页面，等「是否进首次引导」判定完成后再画真正首屏，
 * 否则新用户会先看到一帧推荐页再跳到欢迎页。
 */
const booting = ref(true);

/**
 * 裸页路由（meta.bare，如 /welcome）：不套 PageShell 骨架。
 * 窗口是自绘标题栏（decorations: false），裸页仍保留 TitleBar，否则无法拖动 / 关闭窗口。
 */
const bareRoute = computed(() => Boolean(route.meta.bare));

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

// 后台优化开关：同步给 backgroundMode 服务，窗口隐藏时才据此节流
const stopOptimizeWatch = watch(
  () => settings.backgroundOptimize,
  (value) => setOptimizeEnabled(value),
  { immediate: true },
);

onMounted(async () => {
  try {
    await settings.load();
    // 快捷键：先订阅全局热键事件再载入绑定（载入会立即把绑定推给 Rust 重建注册表）
    await shortcuts.initGlobalEvents();
    await Promise.all([library.loadAll(), player.restore(), shortcuts.load()]);
    // 播放历史：只读一次库，供「最近播放」页与 SongTable 的播放次数列使用
    void history.load();
    await plugins.loadInstalled();
    /**
     * 首次引导：只有「从未完成过」且「一个插件都没有」才进入欢迎页。
     * 老用户升级上来已经有插件，说明不是首次使用——静默补写完成标记，避免被引导页拦一次。
     */
    if (!settings.onboardingDone) {
      if (plugins.records.length) await settings.setOnboardingDone(true);
      else await router.replace({ name: "welcome" });
    }
    // 主题只依赖设置与本地文件，尽早恢复且不阻塞后续初始化（失败会静默回退默认外观）
    void themes.init();
    initSmtc(player);
    // 系统托盘（仅 Windows）：可见性事件驱动后台模式，切歌刷新托盘提示
    initTray(player);
    // 离线下载：订阅进度、解析默认目录、载入离线索引（不阻塞首屏）
    void downloads.init();
    // 自动更新与播放无关：放在最后并静默执行，不阻塞首屏
    void updater.init().then(() => updater.maybeAutoCheck());
    // Android 返回键：全局只在这里接管一次，其余页面通过拦截器插入
    if (isMobile) {
      void installBackButton(router, () => toast("再按一次返回键退出应用", "info"));
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("focus", onWindowFocus);
  } catch (error) {
    // 初始化（数据库 / 插件目录）出错也要放行首屏，不能把用户停在一片空白上
    console.error("[app] 初始化失败：", error);
    toast("初始化未完全成功，部分数据可能不可用", "error");
  } finally {
    // 首屏闸门：首次引导判定结束（或初始化失败）后才渲染真正的页面
    booting.value = false;
  }
});

/**
 * 从锁屏/后台回到前台：WebView 的 JS 在后台被挂起，期间引擎可能已按播放链
 * 自行换歌、或通过锁屏媒体栏切了歌——这里把界面状态（曲目 / 歌词 / 进度）
 * 重新对齐到引擎的真实状态。
 */
function onVisibilityChange(): void {
  if (document.visibilityState !== "visible") return;
  // 非托盘的最小化/恢复由浏览器可见性兜底驱动后台模式
  setAppHidden(false);
  void player.syncEngineState();
}

/**
 * 窗口重新获得焦点（非托盘路径的最小化恢复兜底，如任务栏还原）。
 * Rust 侧对托盘恢复已主动广播，这里只补足浏览器层的最小化场景。
 */
function onWindowFocus(): void {
  setAppHidden(false);
}

onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  document.removeEventListener("focus", onWindowFocus);
  plugins.disposeAll();
  updater.dispose();
  stopSmtcWatch();
  stopAccentWatch();
  stopOptimizeWatch();
  disposeSmtc();
  disposeTray();
  void uninstallBackButton();
  uninstallKeyboardInset();
});
</script>

<template>
  <div class="app-shell" :class="{ 'is-mobile': isMobile }">
    <ThemedBackground />
    <ThemeBackdrop />
    <!-- 初始化中：只画背景，不画页面（避免先闪一帧推荐页再跳欢迎页） -->
    <template v-if="booting" />
    <!-- 裸页（首次引导）：不套骨架，但保留标题栏的拖动与窗口按钮 -->
    <template v-else-if="bareRoute">
      <TitleBar v-if="!isMobile" class="app-titlebar" />
      <RouterView v-slot="{ Component }">
        <transition name="wp-route" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </template>
    <ThemedPageShell v-else :mobile="isMobile">
      <template #content>
        <RouterView v-slot="{ Component }">
          <transition name="wp-route" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </template>
    </ThemedPageShell>
    <ToastHost />
    <ContextMenuHost />
    <PlaylistPickerHost />
    <PlaylistImportHost />
    <ShortcutHost />
    <UpdateDialogHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  /* 建立独立层叠上下文：主题背景层 z-index:0 永远在内容之下 */
  isolation: isolate;
  background: var(--wp-base);
  color: var(--wp-text-primary);
}

/* 移动端：为顶部状态栏 / 刘海留出安全区（桌面端不生效） */
.app-shell.is-mobile {
  padding-top: var(--safe-area-top);
}

/* 裸页（首次引导）自绘标题栏：高度与 PageShell 内保持一致 */
.app-titlebar {
  height: var(--titlebar-height);
  flex: none;
  z-index: 40;
}
</style>
