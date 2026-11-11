<script setup lang="ts">
/** 设置 → 实验性 → 录音棚（入口开关）。 */
import { ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();

function onStudioToggle(event: { IsOn: boolean }): void {
  void settings.setStudioEnabled(Boolean(event?.IsOn));
}
</script>

<template>
  <SettingsSection id="experimental-studio" :title="t('settings.experimental.studio.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.experimental.studio.enabled.title") }}</div>
        <div class="card-description">
          {{ t("settings.experimental.studio.enabled.description") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.studioEnabled" @Toggled="onStudioToggle" />
    </WpCard>
  </SettingsSection>
</template>
