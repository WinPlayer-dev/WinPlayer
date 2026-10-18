<script setup lang="ts">
/** 移动端底部导航栏：首页 / 我的 / 插件 / 设置 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { hapticTap } from "@/services/haptics";

const route = useRoute();
const router = useRouter();

interface TabItem {
  name: string;
  routeName: string;
  icon: string;
  label: string;
}

const tabs: TabItem[] = [
  { name: "recommend", routeName: "recommend", icon: "&#xF481;", label: "首页" },
  { name: "mine", routeName: "mine", icon: "&#xF5BE;", label: "我的" },
  { name: "plugins", routeName: "plugins", icon: "&#xF137;", label: "插件" },
  { name: "settings", routeName: "settings", icon: "&#xF6AA;", label: "设置" },
];

/**
 * 当前高亮的 Tab。
 * 底部导航只覆盖四个一级页；进入歌单 / 专辑 / 歌手等二级页时 route.name
 * 匹配不到任何 Tab，若直接精确匹配会出现「四个都不亮」的失向感。
 * 因此记住最近一次命中一级页的 Tab，二级页沿用（对齐 iOS / Android 原生行为）。
 */
const activeName = ref<string>(tabs[0].name);

watch(
  () => route.name,
  (name) => {
    const matched = tabs.find((tab) => tab.name === name);
    if (matched) activeName.value = matched.name;
  },
  { immediate: true },
);

const active = computed(() => activeName.value);

/** 切换 Tab：已在当前 Tab 时不重复导航，但仍给一次触感反馈 */
function go(tab: TabItem): void {
  hapticTap();
  if (route.name === tab.name) return;
  void router.push({ name: tab.routeName });
}
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      type="button"
      class="tab-item"
      :class="{ active: tab.name === active }"
      :aria-current="tab.name === active ? 'page' : undefined"
      @click="go(tab)"
    >
      <span class="wp-icon tab-icon" v-html="tab.icon" />
      <span class="tab-label">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  flex: none;
  display: flex;
  align-items: stretch;
  background: var(--wp-layer-solid);
  border-top: 1px solid var(--wp-divider);
  /* iOS/Android 底部安全区 */
  padding-bottom: var(--safe-area-bottom);
  z-index: 30;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 56px;
  /* button 默认样式归一 */
  border: none;
  padding: 0;
  background: transparent;
  font: inherit;
  text-decoration: none;
  color: var(--wp-text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);
}

/* 触摸端用 :active 反馈（hover 在触摸设备上会粘滞） */
.tab-item:active {
  background: var(--wp-card-active);
}

.tab-icon {
  font-size: 18px;
  /* 选中切换时图标轻微弹跳上浮 */
  transition: transform var(--duration-normal) var(--ease-decelerate);
}

.tab-item.active .tab-icon {
  transform: translateY(-1px) scale(1.12);
}

.tab-label {
  font-size: 11px;
}

.tab-item.active {
  color: var(--wp-accent);
}
</style>
