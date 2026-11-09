<script setup lang="ts">
/** 设置 → 实验性 → 录音棚（入口开关）。 */
import { ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();

function onStudioToggle(event: { IsOn: boolean }): void {
  void settings.setStudioEnabled(Boolean(event?.IsOn));
}
</script>

<template>
  <SettingsSection id="experimental-studio" title="录音棚">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">显示录音棚入口</div>
        <div class="card-description">
          开启后侧边栏与「更多」菜单出现「录音棚」，可用当前歌曲伴奏录人声并混音；关闭只隐藏入口，作品仍保留
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.studioEnabled" @Toggled="onStudioToggle" />
    </WpCard>
  </SettingsSection>
</template>
