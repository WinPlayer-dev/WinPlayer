<script setup lang="ts">
/**
 * 设置 → 播放 → 音效（10 段均衡器）。
 *
 * 从原来的「播放」大文件里拆出来：本组自带 10 个竖向滑杆与一整套布局样式，
 * 混在页面里会淹掉其它分组。
 */
import { computed } from "vue";
import { ComboBox, Slider, ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { EQ_FREQS, EQ_PRESETS, formatEqFreq } from "@/constants/eqPresets";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();

const EQ_CUSTOM_LABEL = computed(() => t("settings.playback.equalizer.options.custom"));

/** 预设下拉框选项：内置预设 + 「自定义」（仅作手动状态的展示项） */
const eqPresetLabels = computed(() => [...EQ_PRESETS.map((preset) => preset.name), EQ_CUSTOM_LABEL.value]);

const eqPresetIndex = computed(() => {
  const index = EQ_PRESETS.findIndex((preset) => preset.id === settings.eqPreset);
  return index >= 0 ? index : eqPresetLabels.value.length - 1;
});

function onEqToggle(event: { IsOn: boolean }): void {
  void settings.setEqEnabled(Boolean(event?.IsOn));
}

function onEqPresetChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  if (label === EQ_CUSTOM_LABEL.value) return; // 自定义由手动拖动滑杆产生
  const preset = EQ_PRESETS.find((entry) => entry.name === label);
  if (preset && preset.id !== settings.eqPreset) void settings.setEqPreset(preset.id);
}

function onEqSliderInput(index: number, value: number): void {
  const gains = [...settings.eqGains];
  gains[index] = value;
  void settings.setEqGains(gains);
}

/**
 * 均衡器滑杆行数据：每段预构造好带类型的 update:Value 处理器。
 * 模板内联箭头无法标注参数类型，因此提前柯里化好。
 */
const eqBands = computed(() =>
  EQ_FREQS.map((freq, index) => ({
    freq,
    index,
    onValue: (value: number): void => onEqSliderInput(index, value),
  })),
);

function formatGain(gain: number | undefined): string {
  const value = gain ?? 0;
  return `${value > 0 ? "+" : ""}${value}dB`;
}
</script>

<template>
  <SettingsSection id="playback-eq" :title="t('settings.playback.equalizer.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.playback.equalizer.enabled.title") }}</div>
        <div class="card-description">
          {{ t("settings.playback.equalizer.enabled.description") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.eqEnabled" @Toggled="onEqToggle" />
    </WpCard>

    <template v-if="settings.eqEnabled">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.playback.equalizer.preset.title") }}</div>
          <div class="card-description">{{ t("settings.playback.equalizer.preset.description") }}</div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="eqPresetLabels"
          :SelectedIndex="eqPresetIndex"
          @SelectionChanged="onEqPresetChange"
        />
      </WpCard>

      <WpCard variant="column">
        <div class="eq-sliders-row">
          <div v-for="band in eqBands" :key="band.freq" class="eq-band">
            <span class="eq-gain">{{ formatGain(settings.eqGains[band.index]) }}</span>
            <div class="eq-slider-wrap">
              <Slider
                class="eq-slider"
                Orientation="Vertical"
                :Value="settings.eqGains[band.index] ?? 0"
                :Minimum="-12"
                :Maximum="12"
                :StepFrequency="1"
                :SmallChange="1"
                :LargeChange="3"
                :IsThumbToolTipEnabled="false"
                @update:Value="band.onValue"
              />
            </div>
            <span class="eq-freq">{{ formatEqFreq(band.freq) }}</span>
          </div>
        </div>
        <div class="eq-actions">
          <WpButton variant="standard" class="small" @click="settings.resetEq()">{{ t("common.action.reset") }}</WpButton>
        </div>
      </WpCard>
    </template>
  </SettingsSection>
</template>

<style scoped>
/* 均衡器：10 段竖向滑杆 */
.eq-sliders-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  width: 100%;
  overflow-x: auto;
  padding: var(--space-sm) 0;
}

.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  min-width: 40px;
}

.eq-gain {
  font-size: 11px;
  color: var(--wp-text-secondary);
  min-height: 14px;
}

/* 竖向滑杆：容器固定尺寸，Slider 撑满（覆盖组件默认的横向尺寸） */
.eq-slider-wrap {
  flex: none;
  width: 32px;
  height: 140px;
}

.eq-band .eq-slider {
  width: 100%;
  height: 100%;
}

.eq-freq {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.eq-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
