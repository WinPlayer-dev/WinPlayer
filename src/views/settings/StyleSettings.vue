<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ComboBox, TextBox, ToggleSwitch } from "@/components/winui";
import { useSettingsStore, type ThemePreference } from "@/stores/settings";
import { useIsWindows } from "@/composables/useIsMobile";
import type { WindowMaterial } from "@/services/windowMaterial";

const settings = useSettingsStore();
// 窗口材质仅 Windows 桌面端有意义，其他平台隐藏该设置项
const isWindows = useIsWindows();

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
function onThemeChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
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
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">主题</div>
          <div class="card-description">选择应用的亮/暗外观，默认跟随系统设置</div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="themeLabels"
          :SelectedIndex="themeIndex"
          @SelectionChanged="onThemeChange"
        />
      </div>
      <div v-if="isWindows" class="settings-card">
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
      </div>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">封面取色</div>
          <div class="card-description">
            从当前播放封面的主色生成应用强调色，按钮、进度条等高亮元素跟随封面变化
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.coverAccent" @Toggled="onCoverAccentToggle" />
      </div>
    </section>

    <!-- 字体 -->
    <section class="settings-section">
      <h2 class="settings-section-title">字体</h2>
      <div class="settings-card">
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
      </div>
    </section>
  </div>
</template>

<style scoped>
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
