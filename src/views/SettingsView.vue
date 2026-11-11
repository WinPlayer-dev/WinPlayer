<script setup lang="ts">
/**
 * 设置页容器。
 *
 * 结构：页头（标题 + 搜索）→ 桌面左侧分类导航 / 移动端分类按钮 → 分组 chips → 分类内容。
 *
 * 三条约定：
 * 1. 分类与分组元数据都在 `settings/categories.ts` 与 `settings/settingsIndex.ts`，
 *    这里只做映射与编排，不再内联一堆配置。
 * 2. 深链统一走 `?tab=`；旧 key（storage / download / backup / cloud / style）由
 *    `resolveTab` 翻译成新分类 + 落地分组，老书签不会断。
 * 3. 设置搜索按 `?tab=` + `?focus=` 跳转，focus 用一次就消费掉，避免刷新重复高亮。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useIsMobile } from "@/composables/useIsMobile";
import { toast } from "@/services/toast";
import { useI18n } from "@/i18n";
import {
  CATEGORIES,
  MOBILE_CATEGORIES,
  resolveTab,
  type SettingsCategory,
  type SettingsCategoryKey,
} from "@/views/settings/categories";
import {
  SECTION_BY_ITEM_ID,
  SETTINGS_SECTIONS,
  type SettingsItem,
} from "@/views/settings/settingsIndex";
import GeneralPanel from "@/views/settings/panels/GeneralPanel.vue";
import ShortcutPanel from "@/views/settings/panels/ShortcutPanel.vue";
import AppearancePanel from "@/views/settings/panels/AppearancePanel.vue";
import PlaybackPanel from "@/views/settings/panels/PlaybackPanel.vue";
import PluginsPanel from "@/views/settings/panels/PluginsPanel.vue";
import DataPanel from "@/views/settings/panels/DataPanel.vue";
import ExperimentalPanel from "@/views/settings/panels/ExperimentalPanel.vue";
import AboutPanel from "@/views/settings/panels/AboutPanel.vue";
import SettingsSearchBox from "@/views/settings/components/SettingsSearchBox.vue";
import SettingsSectionNav from "@/views/settings/components/SettingsSectionNav.vue";
import CategoryPickerSheet from "@/views/settings/components/CategoryPickerSheet.vue";

const route = useRoute();
const router = useRouter();
const isMobile = useIsMobile();
const { t } = useI18n();

/** 页面根节点（也是滚动容器），锚点跳转与 scroll-spy 都以它为基准 */
const pageRef = ref<HTMLElement | null>(null);

/** 分类 key → 面板组件（元数据里不含组件，避免索引模块拖进整棵组件树） */
const PANELS: Record<SettingsCategoryKey, Component> = {
  general: GeneralPanel,
  shortcut: ShortcutPanel,
  appearance: AppearancePanel,
  playback: PlaybackPanel,
  plugins: PluginsPanel,
  data: DataPanel,
  experimental: ExperimentalPanel,
  about: AboutPanel,
};

/** 移动端无物理键盘，隐藏「快捷键」 */
const categories = computed<readonly SettingsCategory[]>(() =>
  isMobile ? MOBILE_CATEGORIES : CATEGORIES,
);

/* ------------------------------ 分类切换 ------------------------------ */

/** 旧别名要落到的分组（`?tab=cloud` → data-cloud）；换分类时用一次就清 */
const pendingSection = ref<string | null>(null);

const activeTab = computed<SettingsCategoryKey>(() => {
  const list = categories.value;
  const resolved = resolveTab(String(route.query.tab ?? ""));
  if (resolved && list.some((category) => category.key === resolved.category)) {
    return resolved.category;
  }
  return list[0].key;
});

const activeCategory = computed(
  () => categories.value.find((category) => category.key === activeTab.value) ?? categories.value[0],
);

const sections = computed(() => SETTINGS_SECTIONS[activeTab.value] ?? []);

/*
 * 旧别名的落地分组。
 *
 * 这个监听必须早于下面的 activeTab 监听注册：前者要在 query 被规范化成新 key
 * 之前把落地分组记下来，否则 ?tab=cloud 的信息就丢了。
 */
watch(
  () => route.query.tab,
  (raw) => {
    const resolved = resolveTab(String(raw ?? ""));
    if (!resolved?.sectionId) return;
    // 已经在同一个分类里（从别处跳到 ?tab=backup 而当前就是「数据」）：
    // activeTab 不会变化，要靠这里直接滚过去
    if (resolved.category === activeTab.value && pageRef.value) {
      void scrollToSection(resolved.sectionId);
      return;
    }
    pendingSection.value = resolved.sectionId;
  },
  { immediate: true },
);

function selectTab(key: SettingsCategoryKey): void {
  if (key === activeTab.value) return;
  void router.replace({ query: { tab: key } });
}

// 兜底：query 里没有合法 tab（或是旧别名）时补写一份，保证地址栏反映当前分类
watch(
  activeTab,
  (tab) => {
    if (route.query.tab !== tab) void router.replace({ query: { ...route.query, tab } });
  },
  { immediate: true },
);

/* ------------------------------ 滚动与锚点 ------------------------------ */

/**
 * 吸顶栏（chips）在视口里占掉的高度。
 *
 * chips 用负 top 吸顶，粘住时正好顶到视口最上沿，所以占用高度就是它的实际高度。
 * 直接量 DOM，桌面 / 移动、字体缩放都不用改常量。
 */
function stickyOffset(): number {
  const chips = pageRef.value?.querySelector<HTMLElement>(".settings-chips");
  return chips ? chips.offsetHeight : 0;
}

/**
 * 平滑滚到某个分组；返回是否找到（平台差异可能让分组不存在）。
 *
 * 刻意不用 `element.scrollIntoView({ behavior: "smooth" })`：在本项目的 WebView
 * 里实测完全不滚（instant 版有效），而且它还会打断正在进行中的容器滚动动画，
 * 表现为「点了标签没反应」。改成自己算偏移 + 容器 scrollTo，行为可控。
 */
async function scrollToSection(id: string, flash = false): Promise<boolean> {
  await nextTick();
  const container = pageRef.value;
  const element = container?.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
  if (!container || !element) return false;

  const top =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    stickyOffset();
  const max = container.scrollHeight - container.clientHeight;
  container.scrollTo({ top: Math.min(Math.max(top, 0), max), behavior: "smooth" });

  if (flash) {
    element.classList.add("settings-flash");
    window.setTimeout(() => element.classList.remove("settings-flash"), 1400);
  }
  return true;
}

async function applyPendingSection(): Promise<void> {
  const target = pendingSection.value;
  pendingSection.value = null;
  if (target && (await scrollToSection(target))) return;
  pageRef.value?.scrollTo({ top: 0 });
}

watch(activeTab, async () => {
  await nextTick();
  if (!isMobile) updatePill();
  // 搜索跳转带来的 tab 变化交给 focus 流程接管，别在这里先把页面滚回顶部
  if (route.query.focus) return;
  await applyPendingSection();
});

/** `?focus=` 跳转：滚到所属分组并短暂高亮，然后把这个参数消费掉 */
watch(
  () => route.query.focus,
  async (focus) => {
    if (!focus) return;
    const key = String(focus);
    const sectionId = SECTION_BY_ITEM_ID.get(key) ?? key;
    await nextTick();
    await nextTick();
    const found = await scrollToSection(sectionId, true);
    if (!found) toast(t("settings.shell.focusUnavailable"), "info");
    void router.replace({ query: { ...route.query, focus: undefined } });
  },
);

/** 搜索结果点击：同分类直接滚（避免 query 未变化导致 watcher 不触发），跨分类走 query */
function onSearchSelect(item: SettingsItem): void {
  if (item.category === activeTab.value) {
    void scrollToSection(item.sectionId, true);
    return;
  }
  void router.replace({ query: { ...route.query, tab: item.category, focus: item.id } });
}

/* ------------------------------ 分组 chips ------------------------------ */

function onSectionPick(id: string): void {
  void scrollToSection(id);
}

/* ------------------------------ 桌面端滑动药丸 ------------------------------ */

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

let navObserver: ResizeObserver | null = null;

function onViewportResize(): void {
  if (isMobile) return;
  updatePill();
}

/* ------------------------------ 移动端分类面板 ------------------------------ */

const pickerRef = ref<InstanceType<typeof CategoryPickerSheet> | null>(null);

function openCategoryPicker(): void {
  void pickerRef.value?.open();
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(async () => {
  window.addEventListener("resize", onViewportResize);
  const nav = document.querySelector(".settings-nav");
  if (nav && typeof ResizeObserver !== "undefined") {
    navObserver = new ResizeObserver(() => updatePill());
    navObserver.observe(nav);
  }

  await nextTick();
  updatePill();
  requestAnimationFrame(markPillsReady);
  window.setTimeout(markPillsReady, 320);

  // 直接深链进来（?tab=cloud / ?focus=…）时的首次定位
  if (!route.query.focus) await applyPendingSection();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onViewportResize);
  navObserver?.disconnect();
  navObserver = null;
});

/* ------------------------------ 开发期索引校验 ------------------------------ */

// 索引里登记了分组、模板里却忘了挂 data-section-id（或反之）时，搜索跳转会静默失效。
// 生产构建下 import.meta.env.DEV 是常量 false，整段会被摇掉。
watch(
  [activeTab, () => route.query.focus],
  async () => {
    if (!import.meta.env.DEV) return;
    await nextTick();
    await nextTick();
    const domIds = [...(pageRef.value?.querySelectorAll<HTMLElement>(
      ".settings-content [data-section-id]",
    ) ?? [])].map((element) => element.dataset.sectionId ?? "");
    const metaIds = sections.value.map((section) => section.id);
    // 只在部分平台渲染的分组（桌面歌词 / 输出设备 / 触感反馈 …）本来就可能缺席，
    // 不算漂移；漏挂 data-section-id 才算。
    const missing = sections.value
      .filter((section) => !section.optional)
      .map((section) => section.id)
      .filter((id) => !domIds.includes(id));
    const extra = domIds.filter((id) => !metaIds.includes(id));
    if (missing.length || extra.length) {
      console.warn(`[settings] 索引与 DOM 分组不一致（${activeTab.value}）`, { missing, extra });
    }
  },
  { immediate: true },
);
</script>

<template>
  <div ref="pageRef" class="wp-page settings-page" :class="{ mobile: isMobile }">
    <div class="wp-page-header settings-header">
      <h1 class="wp-page-title">{{ t("settings.shell.title") }}</h1>
      <SettingsSearchBox :mobile="isMobile" @select="onSearchSelect" />
    </div>

    <div class="settings-layout">
      <!-- 桌面端：左侧竖向分类导航 -->
      <nav v-if="!isMobile" class="settings-nav" :aria-label="t('settings.shell.navLabel')">
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
          <span>{{ t(category.labelKey) }}</span>
        </button>
      </nav>

      <div class="settings-main">
        <!-- 移动端：一个按钮 + 底部面板列全（替代原来的横向滚动胶囊） -->
        <button
          v-if="isMobile"
          type="button"
          class="settings-category-button"
          :aria-label="t('settings.shell.categorySwitch')"
          @click="openCategoryPicker"
        >
          <span class="wp-icon category-icon" v-html="activeCategory.icon" aria-hidden="true" />
          <span class="category-label">{{ t(activeCategory.labelKey) }}</span>
          <span class="category-sub ellipsis">{{ t(activeCategory.mobileSubtitleKey) }}</span>
          <span class="category-arrow" aria-hidden="true" />
        </button>

        <SettingsSectionNav
          :sections="sections"
          :scroll-root="pageRef"
          @pick="onSectionPick"
        />

        <div class="settings-content">
          <component :is="PANELS[activeTab]" />
        </div>
      </div>
    </div>

    <CategoryPickerSheet
      v-if="isMobile"
      ref="pickerRef"
      :categories="categories"
      :active="activeTab"
      @pick="selectTab"
    />
  </div>
</template>

<style src="./settings/settings.css"></style>

<style scoped>
/* 滚动容器必须占满内容区（否则滚动条停在 max-width 处而非窗口右缘） */
.settings-page {
  width: 100%;
  max-width: none;
}

/* 页头：标题左、搜索右；窄屏时搜索换成图标按钮，不占额外高度 */
.settings-header {
  gap: var(--space-2xl);
}

.settings-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2xl);
}

.settings-main {
  flex: 1;
  min-width: 0;
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
    top 300ms var(--ease-decelerate),
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
    top 300ms var(--ease-decelerate),
    opacity 200ms var(--ease-standard);
}

.nav-icon {
  font-size: 16px;
  color: var(--wp-text-secondary);
}

.settings-nav-item.active .nav-icon {
  color: var(--wp-accent);
}

/* ------------------------- 移动端分类按钮 ------------------------- */

.settings-page.mobile .settings-layout {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-lg);
}

.settings-category-button {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  height: 44px;
  padding: 0 var(--space-lg);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-md);
  background: var(--wp-card);
  color: var(--wp-text-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.category-icon {
  flex: none;
  font-size: 16px;
  color: var(--wp-accent);
}

.category-label {
  flex: none;
  font-weight: 600;
}

.category-sub {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
  text-align: right;
}

/* 用纯 CSS 画下拉箭头：图标字体里 chevron 的码位在 Regular 字重下不稳定，
   画个旋转的直角边框最省事，也不受主题字体替换影响 */
.category-arrow {
  flex: none;
  width: 7px;
  height: 7px;
  margin-left: var(--space-sm);
  border-right: 1.5px solid var(--wp-text-secondary);
  border-bottom: 1.5px solid var(--wp-text-secondary);
  border-radius: 1px;
  transform: rotate(45deg) translate(-1px, -1px);
}

.settings-content {
  flex: 1;
  min-width: 0;
}
</style>
