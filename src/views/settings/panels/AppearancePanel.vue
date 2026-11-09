<script setup lang="ts">
/**
 * 设置 → 外观。
 *
 * 只负责按顺序摆开分组：配色与材质 → 字体（都在 ColorsSection 里）→ 主题。
 * 主题原本在「实验性」里，用户想换皮肤第一反应是翻外观，所以搬到这来。
 */
import ColorsSection from "@/views/settings/appearance/ColorsSection.vue";
import ThemeSection from "@/views/settings/appearance/ThemeSection.vue";
</script>

<template>
  <div>
    <ColorsSection />
    <ThemeSection />
  </div>
</template>
