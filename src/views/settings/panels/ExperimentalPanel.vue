<script setup lang="ts">
/**
 * 设置 → 实验性。
 *
 * 「主题」已毕业搬到外观、「演示模式」搬到通用 › 隐私，这里只剩两个仍在打磨的
 * 功能入口。顶部那句说明仍然是这一栏的定位，所以留在面板层而不是某一组里。
 */
import StudioSection from "@/views/settings/experimental/StudioSection.vue";
import AutoPlaylistSection from "@/views/settings/experimental/AutoPlaylistSection.vue";
import { useI18n } from "@/i18n";

const { t } = useI18n();
</script>

<template>
  <div>
    <p class="panel-note">
      {{ t("settings.experimental.note") }}
    </p>
    <StudioSection />
    <AutoPlaylistSection />
  </div>
</template>

<style scoped>
/* 顶部说明：整段浅色小字，和卡片区分开 */
.panel-note {
  margin: 0 0 var(--space-3xl);
  padding: var(--space-lg) var(--space-xl);
  border-radius: var(--radius-lg);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
</style>
