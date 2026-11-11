<script setup lang="ts">
/** 设置 → 播放 → 输出设备（仅桌面端可枚举选择）。 */
import { computed, onMounted, ref } from "vue";
import { ComboBox } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import { getAudioEngine } from "@/services/audio";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();
const { t } = useI18n();

/** 「系统默认」伪选项（空串持久化，交由系统选择默认设备） */
const DEFAULT_OUTPUT_LABEL = computed(() => t("settings.playback.output.options.systemDefault"));

const outputDevices = ref<string[]>([]);
const devicesLoading = ref(false);

const outputDeviceLabels = computed(() => [DEFAULT_OUTPUT_LABEL.value, ...outputDevices.value]);

/** 当前选中项索引：设备已拔出（不在列表中）时回落到「系统默认」 */
const outputDeviceIndex = computed(() => {
  const index = outputDevices.value.indexOf(settings.outputDevice);
  return index >= 0 ? index + 1 : 0;
});

async function loadOutputDevices(): Promise<void> {
  devicesLoading.value = true;
  try {
    outputDevices.value = await getAudioEngine().listOutputDevices();
  } finally {
    devicesLoading.value = false;
  }
}

function onOutputDeviceChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const value = label === DEFAULT_OUTPUT_LABEL.value ? "" : label;
  if (value !== settings.outputDevice) void settings.setOutputDevice(value);
}

onMounted(() => {
  if (!isMobile) void loadOutputDevices();
});
</script>

<template>
  <SettingsSection v-if="!isMobile" id="playback-output" :title="t('settings.playback.output.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.playback.output.device.title") }}</div>
        <div class="card-description">
          {{ t("settings.playback.output.device.description") }}
        </div>
      </div>
      <div class="card-control output-device-control">
        <ComboBox
          :ItemsSource="outputDeviceLabels"
          :SelectedIndex="outputDeviceIndex"
          @SelectionChanged="onOutputDeviceChange"
        />
        <WpButton
          variant="standard"
          class="small"
          :disabled="devicesLoading"
          @click="loadOutputDevices"
        >
          {{ devicesLoading ? t("settings.playback.output.actions.refreshing") : t("common.action.refresh") }}
        </WpButton>
      </div>
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
/* 输出设备：下拉框 + 刷新按钮同排 */
.output-device-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: min(380px, 42vw);
}

.output-device-control :deep(.wp-combo-box) {
  flex: 1;
  min-width: 0;
}
</style>
