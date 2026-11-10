<script setup lang="ts">
/**
 * 设置 → 外观。
 *
 * 只负责按顺序摆开分组：配色与材质 → 字体（都在 ColorsSection 里）→ 主题 → 布局 → 动效。
 * 主题原本在「实验性」里，用户想换皮肤第一反应是翻外观，所以搬到这来。
 * 「布局」只影响手机端列表页，桌面端整个分组不渲染。
 */
import { useIsMobile } from "@/composables/useIsMobile";
import ColorsSection from "@/views/settings/appearance/ColorsSection.vue";
import ThemeSection from "@/views/settings/appearance/ThemeSection.vue";
import LayoutSection from "@/views/settings/appearance/LayoutSection.vue";
import MotionSection from "@/views/settings/appearance/MotionSection.vue";

const isMobile = useIsMobile();
</script>

<template>
  <div>
    <ColorsSection />
    <ThemeSection />
    <LayoutSection v-if="isMobile" />
    <MotionSection />
  </div>
</template>
