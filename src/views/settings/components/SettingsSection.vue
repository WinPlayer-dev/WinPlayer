<script setup lang="ts">
/**
 * 设置分组容器。
 *
 * 一个分组 = 一个 `<section class="settings-section">`，由父面板按顺序摆开。
 * 存在的意义有两个：
 * 1. 统一产出 `data-section-id`。分组 chips、设置搜索的跳转、以及开发期的
 *    索引漂移校验都靠这个属性定位，手抄 27 处属性一定会漏，收敛到组件里就不会。
 * 2. 统一分组标题的 DOM 结构，吸顶样式只需写在 `.settings-section-title` 一处。
 *
 * 注意：`id` 是组件 prop，不会落到 DOM 的 id 上（Vue 不会把它当透传属性）。
 */
defineProps<{
  /** 分组 id，见 settingsIndex.ts 的 SETTINGS_SECTIONS，全局唯一 */
  id: string;
  /** 分组标题（渲染为 h2.settings-section-title） */
  title: string;
}>();
</script>

<template>
  <section class="settings-section" :data-section-id="id">
    <h2 class="settings-section-title">{{ title }}</h2>
    <slot />
  </section>
</template>
