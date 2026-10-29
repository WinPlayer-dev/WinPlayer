<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ComboBox, Slider, TextBox, ToggleSwitch } from "@/components/winui";
import { useSettingsStore, DEFAULT_SOURCE_SEARCH_FORMAT } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { useIsMobile } from "@/composables/useIsMobile";
import { getAudioEngine } from "@/services/audio";
import { EQ_FREQS, EQ_PRESETS, formatEqFreq } from "@/constants/eqPresets";
import type { PluginCapability } from "@/types/plugin";
import WpCard from "@/components/theme/WpCard.vue";
import WpButton from "@/components/theme/WpButton.vue";

const settings = useSettingsStore();
const pluginsStore = usePluginsStore();

/* ------------------------------ 来源偏好 ------------------------------ */

interface SourceKindConfig {
  key: "trackSourceId" | "playSourceId" | "lyricsSourceId" | "avatarSourceId";
  title: string;
  description: string;
  /** 插件需具备的能力（须全部满足才会出现在下拉框中） */
  capabilities: PluginCapability[];
}

const SOURCE_KINDS: SourceKindConfig[] = [
  {
    key: "trackSourceId",
    title: "歌曲信息源",
    description: "搜索结果聚合时，该插件的结果排在前面",
    capabilities: ["search"],
  },
  {
    key: "playSourceId",
    title: "播放源",
    description: "播放时在该插件重新搜曲并取其直链；搜不到时回退歌曲自身来源",
    capabilities: ["search", "songUrl"],
  },
  {
    key: "lyricsSourceId",
    title: "歌词源",
    description: "取歌词时在该插件重新搜曲后取词；取不到时回退歌曲自身来源",
    capabilities: ["search", "lyrics"],
  },
  {
    key: "avatarSourceId",
    title: "头像源",
    description: "右上角头像优先从该插件获取，取不到时再试其他插件",
    capabilities: ["avatar"],
  },
];

interface SourceOption {
  label: string;
  /** 插件 ID，空串表示默认（自动） */
  value: string;
}

/** 各来源下拉框选项：默认 + 按能力过滤后的已启用插件 */
const sourceOptions = computed(() =>
  SOURCE_KINDS.map((kind) => {
    const options: SourceOption[] = [{ label: "默认", value: "" }];
    for (const record of pluginsStore.enabledRecords) {
      if (kind.capabilities.every((capability) => pluginsStore.hasCapability(record, capability))) {
        options.push({ label: record.entry.manifest.name, value: record.entry.id });
      }
    }
    return { kind, options };
  }),
);

function sourceIndex(currentValue: string, options: SourceOption[]): number {
  const index = options.findIndex((option) => option.value === currentValue);
  return index >= 0 ? index : 0;
}

/**
 * 来源下拉框的行数据：每行预构造好带类型的 SelectionChanged 处理器。
 * 不能在模板里写内联箭头（模板表达式无法标注参数类型，且调用表达式会被
 * Vue 当作内联语句丢弃返回值），因此这里提前柯里化好，模板直接以标识符引用。
 */
const sourceRows = computed(() =>
  sourceOptions.value.map(({ kind, options }) => ({
    kind,
    options,
    onSelect: (sender: unknown, payload?: { AddedItems?: unknown[] }): void => {
      onSourceSelectionChanged(kind, options, sender, payload);
    },
  })),
);

function onSourceSelectionChanged(
  kind: SourceKindConfig,
  options: SourceOption[],
  _sender: unknown,
  payload?: { AddedItems?: unknown[] },
): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = options.find((entry) => entry.label === label);
  if (option && option.value !== settings[kind.key]) {
    void settings.setSourcePreference(kind.key, option.value);
  }
}

/** 配置了播放源或歌词源时才显示「搜索格式」输入框（两者共用） */
const showSearchFormat = computed(() => Boolean(settings.playSourceId || settings.lyricsSourceId));

function onFormatChange(value: unknown): void {
  void settings.setSourceSearchFormat(String(value ?? ""));
}

/* ------------------------------ 音效（均衡器） ------------------------------ */

const EQ_CUSTOM_LABEL = "自定义";

/** 预设下拉框选项：内置预设 + 「自定义」（仅作手动状态的展示项） */
const eqPresetLabels = [...EQ_PRESETS.map((preset) => preset.name), EQ_CUSTOM_LABEL];

const eqPresetIndex = computed(() => {
  const index = EQ_PRESETS.findIndex((preset) => preset.id === settings.eqPreset);
  return index >= 0 ? index : eqPresetLabels.length - 1;
});

function onEqToggle(event: { IsOn: boolean }): void {
  void settings.setEqEnabled(Boolean(event?.IsOn));
}

/* ------------------------------ 无缝播放 ------------------------------ */

const isMobile = useIsMobile();

function onCrossfadeToggle(event: { IsOn: boolean }): void {
  void settings.setCrossfadeEnabled(Boolean(event?.IsOn));
}

/* ------------------------------ 输出设备 ------------------------------ */

/** 「系统默认」伪选项（空串持久化，交由系统选择默认设备） */
const DEFAULT_OUTPUT_LABEL = "系统默认";

const outputDevices = ref<string[]>([]);
const devicesLoading = ref(false);

const outputDeviceLabels = computed(() => [DEFAULT_OUTPUT_LABEL, ...outputDevices.value]);

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
  const value = label === DEFAULT_OUTPUT_LABEL ? "" : label;
  if (value !== settings.outputDevice) void settings.setOutputDevice(value);
}

onMounted(() => {
  void loadOutputDevices();
});

function onEqPresetChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  if (label === EQ_CUSTOM_LABEL) return; // 自定义由手动拖动滑杆产生
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
 * 模板内联箭头无法标注参数类型，与上方 sourceRows 采用相同的柯里化模式。
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
  <div>
    <!-- 来源偏好 -->
    <section class="settings-section">
      <h2 class="settings-section-title">来源偏好</h2>
      <WpCard variant="row" v-for="{ kind, options, onSelect } in sourceRows" :key="kind.key" >
        <div class="card-content">
          <div class="card-header">{{ kind.title }}</div>
          <div class="card-description">{{ kind.description }}</div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="options.map((option) => option.label)"
          :SelectedIndex="sourceIndex(settings[kind.key], options)"
          @SelectionChanged="onSelect"
        />
      </WpCard>

      <WpCard variant="column" v-if="showSearchFormat" >
        <div class="card-content">
          <div class="card-header">搜索格式</div>
          <div class="card-description">
            播放源、歌词源重新搜曲的关键词格式，支持 {歌曲名}、{歌手名}、{专辑名}、{别名}；
            留空使用默认「{{ DEFAULT_SOURCE_SEARCH_FORMAT }}」。
          </div>
        </div>
        <TextBox
          class="format-input"
          :Text="settings.sourceSearchFormat"
          :PlaceholderText="DEFAULT_SOURCE_SEARCH_FORMAT"
          @update:Text="onFormatChange"
        />
      </WpCard>
    </section>

    <!-- 无缝播放 -->
    <section class="settings-section">
      <h2 class="settings-section-title">无缝播放</h2>
      <template v-if="!isMobile">
        <WpCard variant="row" >
          <div class="card-content">
            <div class="card-header">横向淡入淡出（Crossfade）</div>
            <div class="card-description">
              自动切歌前 6 秒开始淡出淡入，手动切歌不适用
            </div>
          </div>
          <ToggleSwitch :IsOn="settings.crossfadeEnabled" @Toggled="onCrossfadeToggle" />
        </WpCard>
        <WpCard variant="row" >
          <div class="card-content">
            <div class="card-header">无缝衔接（Gapless）</div>
            <div class="card-description">始终开启：关闭淡入淡出后，自动切歌零间隙接续下一曲</div>
          </div>
        </WpCard>
      </template>
      <WpCard variant="row" v-else >
        <div class="card-content">
          <div class="card-header">无缝衔接（Gapless）</div>
          <div class="card-description">移动端自动切歌无缝衔接，不支持混音过渡</div>
        </div>
      </WpCard>
    </section>

    <!-- 输出设备（仅桌面端可枚举选择） -->
    <section v-if="!isMobile" class="settings-section">
      <h2 class="settings-section-title">输出设备</h2>
      <WpCard variant="row" >
        <div class="card-content">
          <div class="card-header">音频输出</div>
          <div class="card-description">
            选择声音输出设备，切换后立即在新设备上继续播放；插入新设备后点「刷新」
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
            {{ devicesLoading ? "刷新中…" : "刷新" }}
          </WpButton>
        </div>
      </WpCard>
    </section>

    <!-- 音效（均衡器） -->
    <section class="settings-section">
      <h2 class="settings-section-title">音效</h2>
      <WpCard variant="row" >
        <div class="card-content">
          <div class="card-header">均衡器</div>
          <div class="card-description">
            10 段均衡（31Hz ~ 16kHz），播放时实时调整音色；关闭后输出原声
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.eqEnabled" @Toggled="onEqToggle" />
      </WpCard>

      <template v-if="settings.eqEnabled">
        <WpCard variant="row" >
          <div class="card-content">
            <div class="card-header">预设</div>
            <div class="card-description">快速套用常见音色，手动拖动滑杆后变为「自定义」</div>
          </div>
          <ComboBox
            class="card-control"
            :ItemsSource="eqPresetLabels"
            :SelectedIndex="eqPresetIndex"
            @SelectionChanged="onEqPresetChange"
          />
        </WpCard>

        <WpCard variant="column" >
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
            <WpButton variant="standard" class="small" @click="settings.resetEq()">重置</WpButton>
          </div>
        </WpCard>
      </template>
    </section>
  </div>
</template>

<style scoped>
.format-input {
  width: 100%;
}

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
