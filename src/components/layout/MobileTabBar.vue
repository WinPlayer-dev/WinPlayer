<script setup lang="ts">
/** 移动端底部导航栏：首页 / 我的 / 插件 / 设置 */
import { useRoute } from "vue-router";

const route = useRoute();

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
</script>

<template>
  <nav class="tabbar">
    <router-link
      v-for="tab in tabs"
      :key="tab.name"
      :to="{ name: tab.routeName }"
      class="tab-item"
      :class="{ active: route.name === tab.name }"
    >
      <span class="wp-icon tab-icon" v-html="tab.icon" />
      <span class="tab-label">{{ tab.label }}</span>
    </router-link>
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
  text-decoration: none;
  color: var(--wp-text-secondary);
  transition: color var(--duration-fast) var(--ease-standard);
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
