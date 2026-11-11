<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ComboBox, TextBox, ToggleSwitch } from "@/components/winui";
import { useSettingsStore, type ThemePreference } from "@/stores/settings";
import type { WindowMaterial } from "@/services/windowMaterial";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();
// 窗口材质仅 Windows 桌面端有意义，其他平台隐藏该设置项

/* ------------------------------ 主题 ------------------------------ */

const THEME_OPTIONS: Array<{ label: string; value: ThemePreference }> = [
  { label: t("settings.appearance.colors.scheme.options.system"), value: "system" },
  { label: t("settings.appearance.colors.scheme.options.light"), value: "light" },
  { label: t("settings.appearance.colors.scheme.options.dark"), value: "dark" },
];

const themeLabels = computed(() => THEME_OPTIONS.map((option) => option.label));

const themeIndex = computed(() =>
  THEME_OPTIONS.findIndex((option) => option.value === settings.theme),
);

/**
 * 自研 ComboBox 的 SelectionChanged 签名为 (sender, payload)，
 * payload 中的 AddedItems 才是新选中的值。
 */
function onSchemeChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = THEME_OPTIONS.find((entry) => entry.label === label);
  if (option && option.value !== settings.theme) void settings.setTheme(option.value);
}

/* ------------------------------ 窗口材质 ------------------------------ */

const MATERIAL_OPTIONS: Array<{ label: string; value: WindowMaterial }> = [
  { label: t("settings.appearance.colors.material.options.mica"), value: "mica" },
  { label: "Acrylic", value: "acrylic" },
  { label: t("common.action.close"), value: "off" },
];

const materialLabels = MATERIAL_OPTIONS.map((option) => option.label);

const materialIndex = computed(() =>
  MATERIAL_OPTIONS.findIndex((option) => option.value === settings.windowMaterial),
);

function onMaterialChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = MATERIAL_OPTIONS.find((entry) => entry.label === label);
  if (option && option.value !== settings.windowMaterial) {
    void settings.setWindowMaterial(option.value);
  }
}

function onCoverAccentToggle(event: { IsOn: boolean }): void {
  void settings.setCoverAccent(Boolean(event?.IsOn));
}

function onCoverNaturalToggle(event: { IsOn: boolean }): void {
  void settings.setCoverNaturalRatio(Boolean(event?.IsOn));
}

/* ------------------------------ 全局字体 ------------------------------ */

const FONT_PLACEHOLDER = t("settings.appearance.font.global.placeholder");

/** 本地输入值：击键实时预览，防抖后落库，避免每个字符写一次数据库 */
const fontInput = ref(settings.fontFamily);

let fontDebounce = 0;

watch(fontInput, (value) => {
  // 输入过程中即应用（预览），落库防抖
  const apply = (): void => void settings.setFontFamily(value);
  window.clearTimeout(fontDebounce);
  fontDebounce = window.setTimeout(apply, 500);
});

// 其他入口（恢复默认）改动 store 时同步回输入框
watch(
  () => settings.fontFamily,
  (value) => {
    if (value !== fontInput.value) fontInput.value = value;
  },
);

function resetFont(): void {
  window.clearTimeout(fontDebounce);
  fontInput.value = "";
  void settings.setFontFamily("");
}

onBeforeUnmount(() => window.clearTimeout(fontDebounce));
</script>

<template>
  <div>
    <!-- 配色与材质 -->
    <SettingsSection id="appearance-colors" :title="t('settings.appearance.colors.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.appearance.colors.scheme.title") }}</div>
          <div class="card-description">
            {{ t("settings.appearance.colors.scheme.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="themeLabels"
          :SelectedIndex="themeIndex"
          @SelectionChanged="onSchemeChange"
        />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.appearance.colors.material.title") }}</div>
          <div class="card-description">
            {{ t("settings.appearance.colors.material.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="materialLabels"
          :SelectedIndex="materialIndex"
          @SelectionChanged="onMaterialChange"
        />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.appearance.colors.coverAccent.title") }}</div>
          <div class="card-description">
            {{ t("settings.appearance.colors.coverAccent.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.coverAccent" @Toggled="onCoverAccentToggle" />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.appearance.colors.coverNatural.title") }}</div>
          <div class="card-description">
            {{ t("settings.appearance.colors.coverNatural.description") }}
          </div>
          <div class="cover-preview" :class="{ natural: settings.coverNaturalRatio }" aria-hidden="true">
            <div class="preview-frame">
              <div class="preview-blur" />
              <div class="preview-art" />
            </div>
            <span class="preview-caption">
              {{
                settings.coverNaturalRatio
                  ? t("settings.appearance.colors.coverNatural.previewNatural")
                  : t("settings.appearance.colors.coverNatural.previewSquare")
              }}
            </span>
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.coverNaturalRatio" @Toggled="onCoverNaturalToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 字体 -->
    <SettingsSection id="appearance-font" :title="t('settings.appearance.font.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.appearance.font.global.title") }}</div>
          <div class="card-description">
            {{ t("settings.appearance.font.global.description") }}
          </div>
        </div>
        <TextBox
          class="font-input"
          :Text="fontInput"
          :PlaceholderText="FONT_PLACEHOLDER"
          @update:Text="(value: unknown) => (fontInput = String(value ?? ''))"
        />
        <button class="font-reset" type="button" @click="resetFont">
          {{ t("common.action.restoreDefault") }}
        </button>
      </WpCard>
    </SettingsSection>
  </div>
</template>

<style scoped>
/* ------------------------------ 封面比例预览 ------------------------------ */
/* 用纯 CSS 渐变模拟一张 16:9 封面：关闭时裁切填满，开启后完整居中显示 */

.cover-preview {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  margin-top: var(--space-lg);
}

.preview-frame {
  position: relative;
  flex: none;
  width: 84px;
  height: 84px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--wp-control-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-blur {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #7c9cff 0%, #b06bff 46%, #ff7ab6 100%);
  filter: blur(10px) saturate(1.3);
  transform: scale(1.15);
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-standard);
}

.preview-art {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 0;
  background: linear-gradient(135deg, #7c9cff 0%, #b06bff 46%, #ff7ab6 100%);
  transition:
    height var(--duration-normal) var(--ease-standard),
    border-radius var(--duration-normal) var(--ease-standard);
}

.cover-preview.natural .preview-art {
  height: auto;
  aspect-ratio: 16 / 9;
  border-radius: 3px;
}

.cover-preview.natural .preview-blur {
  opacity: 1;
}

.preview-caption {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.font-input {
  flex: none;
  width: 260px;
}

.font-reset {
  flex: none;
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-standard);
}

.font-reset:hover {
  color: var(--wp-text-primary);
}
</style>
