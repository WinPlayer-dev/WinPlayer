<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useIsMobile } from "@/composables/useIsMobile";
import GeneralSettings from "@/views/settings/GeneralSettings.vue";
import StyleSettings from "@/views/settings/StyleSettings.vue";
import PlaybackSettings from "@/views/settings/PlaybackSettings.vue";
import ExperimentalSettings from "@/views/settings/ExperimentalSettings.vue";
import KeymapSettings from "@/views/settings/KeymapSettings.vue";
import PluginSettings from "@/views/settings/PluginSettings.vue";
import StorageSettings from "@/views/settings/StorageSettings.vue";
import DownloadSettings from "@/views/settings/DownloadSettings.vue";
import BackupSettings from "@/views/settings/BackupSettings.vue";
import AboutSettings from "@/views/settings/AboutSettings.vue";

const route = useRoute();
const router = useRouter();
const isMobile = useIsMobile();

/* ------------------------------ 分类定义 ------------------------------ */

interface SettingsCategory {
  key: string;
  label: string;
  /** Fluent UI System Icons 码点（.wp-icon 字体族，24 Regular） */
  icon: string;
  component: Component;
}

const CATEGORIES: SettingsCategory[] = [
  { key: "general", label: "通用", icon: "&#xF6AA;", component: GeneralSettings }, // ic_fluent_settings_24_regular
  { key: "style", label: "样式", icon: "&#xF2F6;", component: StyleSettings }, // ic_fluent_color_24_regular（调色板）
  { key: "playback", label: "播放", icon: "&#xE855;", component: PlaybackSettings }, // ic_fluent_music_note_2_24_regular
  { key: "shortcut", label: "快捷键", icon: "&#xF4B9;", component: KeymapSettings }, // ic_fluent_keyboard_24_regular
  { key: "plugins", label: "插件", icon: "&#xE9EA;", component: PluginSettings }, // ic_fluent_puzzle_piece_24_regular
  { key: "storage", label: "存储", icon: "&#xE467;", component: StorageSettings }, // ic_fluent_database_24_regular
  { key: "download", label: "下载与离线", icon: "&#xE38E;", component: DownloadSettings }, // ic_fluent_cloud_arrow_down_24_regular
  { key: "backup", label: "备份与还原", icon: "&#xF2CD;", component: BackupSettings }, // ic_fluent_arrow_sync_24_regular（迁移/同步）
  // 实验性：主题皮肤、录音棚等还没"毕业"的功能都收在这里，放在「关于」之前
  { key: "experimental", label: "实验性", icon: "&#xF1D8;", component: ExperimentalSettings }, // ic_fluent_beaker_24_regular（烧瓶）
  { key: "about", label: "关于", icon: "&#xF4A4;", component: AboutSettings }, // ic_fluent_info_24_regular
];

/** 移动端无物理键盘，隐藏快捷键分类 */
const categories = computed<SettingsCategory[]>(() =>
  isMobile ? CATEGORIES.filter((category) => category.key !== "shortcut") : CATEGORIES,
);

/**
 * 当前选中分类：以路由 query ?tab= 为准（便于其他页面深链到指定分类，
 * 刷新 / 返回后也停留在原分类）；非法或缺省时回退到第一个分类。
 */
const activeTab = computed(() => {
  const tab = String(route.query.tab ?? "");
  const list = categories.value;
  return list.some((category) => category.key === tab) ? tab : list[0].key;
});

const activeCategory = computed(
  () => categories.value.find((category) => category.key === activeTab.value) ?? categories.value[0],
);

function selectTab(key: string): void {
  if (key === activeTab.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}

// 兜底：query 里没有合法 tab 时补写一份，保证地址栏始终反映当前分类
watch(
  activeTab,
  (tab) => {
    if (route.query.tab !== tab) void router.replace({ query: { ...route.query, tab } });
  },
  { immediate: true },
);

/* ------------------------------ 移动端顶部 Tab 跟随选中项 ------------------------------ */

/**
 * 顶部横向分类 Tab：让当前分类自动滚到可视区中间。
 *
 * 这个容器是 overflow-x: auto 的横向滚动条，分类多达 8 个（移动端隐藏「快捷键」
 * 后仍有 8 个），「下载与离线」「备份与还原」「关于」默认都在屏幕外。
 * 从别的页面深链进来（?tab=about）或点了靠后的分类后，高亮项会停在屏幕外，
 * 用户看不到「我现在在哪一栏」，只能盲滑去找。
 *
 * 用 scrollIntoView({ inline: "center" }) 而不是手工算 scrollLeft：
 * 浏览器会把滚动限制在容器自身（block 方向指定 nearest，不会带动整页），
 * 且天然处理宽窄不一的胶囊宽度。
 */
const tabsRef = ref<HTMLElement | null>(null);

async function scrollActiveTabIntoView(): Promise<void> {
  if (!isMobile) return;
  await nextTick();
  const active = tabsRef.value?.querySelector<HTMLElement>(".settings-tab-item.active");
  active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

onMounted(() => void scrollActiveTabIntoView());

// 切换分类后同样跟随：否则从「通用」点到「关于」，高亮项仍在屏幕外
watch(activeTab, () => void scrollActiveTabIntoView());

/* ------------------------------ 滑动选中药丸（与 SideNav 一致） ------------------------------ */

const navPill = ref({ top: 0, visible: false });
const pillsReady = ref(false);

function updatePill(): void {
  const nav = document.querySelector(".settings-nav");
  const active = nav?.querySelector<HTMLElement>(".settings-nav-item.active");
  if (!nav || !active) {
    navPill.value = { top: 0, visible: false };
    return;
  }
  navPill.value = { top: active.offsetTop, visible: true };
}

/** 药丸定位样式；offset 用于强调胶囊相对药丸的垂直居中偏移（(36-16)/2 = 10px） */
function pillStyle(offset = 0) {
  return {
    top: `${navPill.value.top + offset}px`,
    opacity: navPill.value.visible ? "1" : "0",
    transition: pillsReady.value ? undefined : "none",
  };
}

/** 解除初始定位的 transition:none（rAF 在窗口被完全遮挡时不触发，加 setTimeout 兜底） */
function markPillsReady(): void {
  pillsReady.value = true;
}

onMounted(() => {
  void nextTick(() => {
    updatePill();
    requestAnimationFrame(markPillsReady);
    window.setTimeout(markPillsReady, 320);
  });
});

watch(activeTab, async () => {
  if (isMobile) return;
  await nextTick();
  updatePill();
});
</script>

<template>
  <div class="wp-page settings-page" :class="{ mobile: isMobile }">
    <div class="wp-page-header">
      <h1 class="wp-page-title">设置</h1>
    </div>

    <div class="settings-layout">
      <!-- 桌面端：左侧竖向分类导航 -->
      <nav v-if="!isMobile" class="settings-nav" aria-label="设置分类">
        <span class="nav-pill" :style="pillStyle()" aria-hidden="true" />
        <span class="nav-accent" :style="pillStyle(10)" aria-hidden="true" />
        <button
          v-for="category in categories"
          :key="category.key"
          class="settings-nav-item"
          :class="{ active: category.key === activeTab }"
          type="button"
          @click="selectTab(category.key)"
        >
          <span class="wp-icon nav-icon" v-html="category.icon" />
          <span>{{ category.label }}</span>
        </button>
      </nav>

      <!-- 移动端：顶部横向滚动分类 Tab -->
      <nav v-else ref="tabsRef" class="settings-tabs" aria-label="设置分类">
        <button
          v-for="category in categories"
          :key="category.key"
          class="settings-tab-item"
          :class="{ active: category.key === activeTab }"
          type="button"
          @click="selectTab(category.key)"
        >
          <span>{{ category.label }}</span>
        </button>
      </nav>

      <!-- 分类内容 -->
      <div class="settings-content">
        <component :is="activeCategory.component" />
      </div>
    </div>
  </div>
</template>

<style src="./settings/settings.css"></style>

<style scoped>
/* 滚动容器必须占满内容区（否则滚动条停在 max-width 处而非窗口右缘） */
.settings-page {
  width: 100%;
  max-width: none;
}

.settings-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2xl);
}

/* ------------------------- 桌面端左侧导航 ------------------------- */

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 200px;
  flex: none;
  position: sticky;
  top: var(--space-lg);
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 36px;
  padding: 0 var(--space-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  position: relative;
  z-index: 1;
  transition: color var(--duration-fast) var(--ease-standard);
}

/* 与侧边栏一致：悬浮仅文字提亮，不加背景 */
.settings-nav-item:hover {
  color: var(--wp-text-primary);
}

/* 选中高亮由滑动的 .nav-pill / .nav-accent 承担（不用逐项 ::before，避免瞬移） */
.settings-nav-item.active {
  color: var(--wp-text-primary);
  font-weight: 600;
}

/* 选中药丸：随选中项滑动，由 JS 定位 top */
.nav-pill {
  position: absolute;
  left: 0;
  right: 0;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--wp-card-active);
  z-index: 0;
  pointer-events: none;
  transition:
    top 300ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 200ms var(--ease-standard);
}

/* 左侧强调胶囊：与药丸同源定位（top + 10px 垂直居中），随选中项滑动 */
.nav-accent {
  position: absolute;
  left: 0;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--wp-accent);
  z-index: 1;
  pointer-events: none;
  transition:
    top 300ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 200ms var(--ease-standard);
}

.nav-icon {
  font-size: 16px;
  color: var(--wp-text-secondary);
}

.settings-nav-item.active .nav-icon {
  color: var(--wp-accent);
}

/* ------------------------- 移动端顶部 Tab ------------------------- */

.settings-tabs {
  display: none;
}

.settings-page.mobile .settings-layout {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-lg);
}

.settings-page.mobile .settings-tabs {
  display: flex;
  gap: var(--space-sm);
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}

.settings-tab-item {
  flex: none;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: 16px;
  background: var(--wp-card);
  color: var(--wp-text-primary);
  font-size: 13px;
  cursor: pointer;
}

.settings-tab-item.active {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
  font-weight: 600;
}

.settings-content {
  flex: 1;
  min-width: 0;
}
</style>
