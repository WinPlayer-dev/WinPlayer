<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ComboBox, TextBox, ToggleSwitch } from "@/components/winui";
import { useSettingsStore, type ThemePreference } from "@/stores/settings";
import type { WindowMaterial } from "@/services/windowMaterial";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
// 窗口材质仅 Windows 桌面端有意义，其他平台隐藏该设置项

/* ------------------------------ 主题 ------------------------------ */

const THEME_OPTIONS: Array<{ label: string; value: ThemePreference }> = [
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
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
  { label: "Mica（推荐）", value: "mica" },
  { label: "Acrylic", value: "acrylic" },
  { label: "关闭", value: "off" },
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

const FONT_PLACEHOLDER = '如 Microsoft YaHei 或 "HarmonyOS Sans SC", sans-serif';

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
    <!-- 外观 -->
    <section class="settings-section">
      <h2 class="settings-section-title">外观</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">配色模式</div>
          <div class="card-description">
            选择应用的亮/暗外观，默认跟随系统设置；主题的深浅两套配色会随这里的选择切换
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
          <div class="card-header">窗口材质</div>
          <div class="card-description">
            使用系统级 Mica / Acrylic 云母材质作为窗口背景（Mica 仅 Windows 11
            支持，自动回退 Acrylic）；关闭则使用不透明纯色背景
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
          <div class="card-header">封面取色</div>
          <div class="card-description">
            从当前播放封面的主色生成应用强调色，按钮、进度条等高亮元素跟随封面变化
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.coverAccent" @Toggled="onCoverAccentToggle" />
      </WpCard>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">按封面原始比例</div>
          <div class="card-description">
            不再把封面统一裁成正方形，而是按插件返回的原图比例显示（如视频类音源的 16:9 封面）。
            卡片外框保持正方、图片居中留白并用模糊封面填充；播放条、歌词页等处宽度不变，
            高度随比例伸缩，超出可用高度时自动缩窄
          </div>
          <div class="cover-preview" :class="{ natural: settings.coverNaturalRatio }" aria-hidden="true">
            <div class="preview-frame">
              <div class="preview-blur" />
              <div class="preview-art" />
            </div>
            <span class="preview-caption">
              {{ settings.coverNaturalRatio ? "16:9 封面完整显示" : "裁切为 1:1 正方形" }}
            </span>
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.coverNaturalRatio" @Toggled="onCoverNaturalToggle" />
      </WpCard>
    </section>

    <!-- 字体 -->
    <section class="settings-section">
      <h2 class="settings-section-title">字体</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">全局字体</div>
          <div class="card-description">
            自定义整个应用的显示字体，输入 CSS font-family 值（可含备选字体与引号），
            留空恢复默认；输入即实时预览
          </div>
        </div>
        <TextBox
          class="font-input"
          :Text="fontInput"
          :PlaceholderText="FONT_PLACEHOLDER"
          @update:Text="(value: unknown) => (fontInput = String(value ?? ''))"
        />
        <button class="font-reset" type="button" @click="resetFont">恢复默认</button>
      </WpCard>
    </section>
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
