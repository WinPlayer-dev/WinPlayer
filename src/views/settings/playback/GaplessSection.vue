<script setup lang="ts">
/** 设置 → 播放 → 无缝播放（Crossfade / Gapless）。 */
import { ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();

function onCrossfadeToggle(event: { IsOn: boolean }): void {
  void settings.setCrossfadeEnabled(Boolean(event?.IsOn));
}
</script>

<template>
  <SettingsSection id="playback-gapless" title="无缝播放">
    <template v-if="!isMobile">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">横向淡入淡出（Crossfade）</div>
          <div class="card-description">
            自动切歌前 6 秒开始淡出淡入，手动切歌不适用
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.crossfadeEnabled" @Toggled="onCrossfadeToggle" />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">无缝衔接（Gapless）</div>
          <div class="card-description">始终开启：关闭淡入淡出后，自动切歌零间隙接续下一曲</div>
        </div>
      </WpCard>
    </template>
    <WpCard variant="row" v-else>
      <div class="card-content">
        <div class="card-header">无缝衔接（Gapless）</div>
        <div class="card-description">移动端自动切歌无缝衔接，不支持混音过渡</div>
      </div>
    </WpCard>
  </SettingsSection>
</template>
