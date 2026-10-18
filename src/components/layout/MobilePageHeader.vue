<script setup lang="ts">
/** 移动端二级页顶部返回栏（桌面端不渲染） */
import { useRouter } from "vue-router";
import { useIsMobile } from "@/composables/useIsMobile";
import { navigateBack } from "@/services/backButton";

withDefaults(defineProps<{ title?: string }>(), { title: "" });

const router = useRouter();
const isMobile = useIsMobile();
</script>

<template>
  <div v-if="isMobile" class="mobile-page-header">
    <!-- 没有历史栈时（通知 / 外链直达、冷启动）回首页，而不是退出应用 -->
    <button class="back-button" title="返回" @click="navigateBack(router)">
      <span class="wp-icon">&#xF2AB;</span>
    </button>
    <span v-if="title" class="header-title ellipsis">{{ title }}</span>
  </div>
</template>

<style scoped>
/* 通顶吸顶栏。
   页面（.wp-page.is-mobile）顶部没有内边距，因此这里不需要负的上边距：
   栏的静态位置就是滚动区顶部，吸顶时不会出现上下漏出内容的问题。
   横向用负边距抵消页面左右内边距，让背景铺满整屏。 */
.mobile-page-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin: 0 calc(-1 * var(--page-pad-x, var(--space-3xl))) var(--space-lg);
  padding: var(--space-sm) var(--space-md);
  background: var(--wp-base);
  border-bottom: 1px solid var(--wp-divider);
  z-index: 10;
}

.back-button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-primary);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard);
}

.back-button:active {
  background: var(--wp-card-active);
}

.header-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
