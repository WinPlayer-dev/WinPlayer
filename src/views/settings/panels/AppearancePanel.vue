<script setup lang="ts">
/**
 * 设置 → 外观。
 *
 * 只负责按顺序摆开分组：配色与材质 → 字体（都在 ColorsSection 里）→ 主题 → 布局 → 歌词样式 → 动效。
 * 主题原本在「实验性」里，用户想换皮肤第一反应是翻外观，所以搬到这来。
 * 「布局」只影响手机端列表排版；「歌词样式」两端通用 —— 手机全屏页与桌面
 * 沉浸式正在播放页共用同一份配置，所以桌面端也渲染这一组。
 */
import { useIsMobile } from "@/composables/useIsMobile";
import ColorsSection from "@/views/settings/appearance/ColorsSection.vue";
import ThemeSection from "@/views/settings/appearance/ThemeSection.vue";
import LayoutSection from "@/views/settings/appearance/LayoutSection.vue";
import LyricsStyleSection from "@/views/settings/appearance/LyricsStyleSection.vue";
import MotionSection from "@/views/settings/appearance/MotionSection.vue";

const isMobile = useIsMobile();
</script>

<template>
  <div>
    <ColorsSection />
    <ThemeSection />
    <LayoutSection v-if="isMobile" />
    <LyricsStyleSection />
    <MotionSection />
  </div>
</template>
