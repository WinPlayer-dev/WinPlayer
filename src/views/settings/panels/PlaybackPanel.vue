<script setup lang="ts">
/**
 * 设置 → 播放。
 *
 * 只负责按顺序摆开五个分组：来源偏好 → 无缝播放 → 桌面歌词 → 输出设备 → 音效。
 * 拆分前这里是 526 行的单文件，EQ 的滑杆样式占了近一半。
 */
import SourcePreferenceSection from "@/views/settings/playback/SourcePreferenceSection.vue";
import GaplessSection from "@/views/settings/playback/GaplessSection.vue";
import DesktopLyricsSection from "@/views/settings/playback/DesktopLyricsSection.vue";
import OutputSection from "@/views/settings/playback/OutputSection.vue";
import EqualizerSection from "@/views/settings/playback/EqualizerSection.vue";
</script>

<template>
  <div>
    <SourcePreferenceSection />
    <GaplessSection />
    <DesktopLyricsSection />
    <OutputSection />
    <EqualizerSection />
  </div>
</template>
