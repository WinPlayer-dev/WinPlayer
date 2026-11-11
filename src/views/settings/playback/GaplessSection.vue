<script setup lang="ts">
/** 设置 → 播放 → 无缝播放（Crossfade / Gapless）。 */
import { ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();
const { t } = useI18n();

function onCrossfadeToggle(event: { IsOn: boolean }): void {
  void settings.setCrossfadeEnabled(Boolean(event?.IsOn));
}
</script>

<template>
  <SettingsSection id="playback-gapless" :title="t('settings.playback.gapless.section')">
    <template v-if="!isMobile">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.playback.gapless.crossfade.title") }}</div>
          <div class="card-description">
            {{ t("settings.playback.gapless.crossfade.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.crossfadeEnabled" @Toggled="onCrossfadeToggle" />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.playback.gapless.gapless.title") }}</div>
          <div class="card-description">{{ t("settings.playback.gapless.gapless.description") }}</div>
        </div>
      </WpCard>
    </template>
    <WpCard variant="row" v-else>
      <div class="card-content">
        <div class="card-header">{{ t("settings.playback.gapless.gapless.title") }}</div>
        <div class="card-description">{{ t("settings.playback.gapless.gapless.mobileDescription") }}</div>
      </div>
    </WpCard>
  </SettingsSection>
</template>
