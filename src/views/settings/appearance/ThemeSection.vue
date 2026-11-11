<script setup lang="ts">
/**
 * 设置 → 外观 → 主题。
 *
 * 从原「实验性」分类里毕业出来的：用户想换皮肤时第一反应是翻「外观」，
 * 藏在实验性里等于找不到。开关逻辑与信任提示原样保留。
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ComboBox, ContentDialog } from "@/components/winui";
import { useThemesStore } from "@/stores/themes";
import { useI18n } from "@/i18n";
import {
  THEME_COMPONENT_LABELS,
  THEME_CONTROL_COMPONENT_KEYS,
  THEME_LAYOUT_COMPONENT_KEYS,
  type ThemeComponentKey,
} from "@/types/theme";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const themes = useThemesStore();
const router = useRouter();
const { t } = useI18n();

/** ContentDialog 通过 ShowAsync() 打开（库没有 IsOpen prop） */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}

const trustDialogRef = ref<DialogRef | null>(null);
const activeTheme = computed(() => themes.activeTheme?.manifest ?? null);

/** 模板里安全取值：activeTheme 为 null 时给空对象，避免在模板中做多次判空 */
const activeThemeInfo = computed(() => ({
  name: activeTheme.value?.name ?? "",
  version: activeTheme.value?.version ?? "",
  description: activeTheme.value?.description ?? "",
  author: activeTheme.value?.author ?? "",
  homepage: activeTheme.value?.homepage ?? "",
}));

/** 下拉里的「内置外观」项：既是首项文案，也是判定是否切回内置的比对值 */
const DEFAULT_THEME_OPTION = t("settings.appearance.theme.current.defaultOption");

const themeOptions = computed(() => [
  DEFAULT_THEME_OPTION,
  ...themes.installed.map((entry) => entry.manifest.name),
]);

const themeOptionIndex = computed(() => {
  if (!themes.activeId) return 0;
  const index = themes.installed.findIndex((entry) => entry.id === themes.activeId);
  return index < 0 ? 0 : index + 1;
});

async function onThemeChange(
  _sender: unknown,
  payload?: { AddedItems?: unknown[] },
): Promise<void> {
  const label = String(payload?.AddedItems?.[0] ?? "");
  if (label === DEFAULT_THEME_OPTION) {
    await themes.applyTheme("");
    return;
  }
  const entry = themes.installed.find((item) => item.manifest.name === label);
  if (!entry || entry.id === themes.activeId) return;

  // 含可执行组件的主题：首次启用前明确告知风险
  if (themes.needsAcknowledgement(entry.id)) {
    const result = await trustDialogRef.value?.ShowAsync();
    if (result !== "Primary") return;
    await themes.acknowledge(entry.id);
  }
  await themes.applyTheme(entry.id);
}

/** 主题覆盖的组件键 */
const overriddenKeys = computed<ThemeComponentKey[]>(() => {
  const keys = Object.keys(activeTheme.value?.components ?? {}) as ThemeComponentKey[];
  return keys.filter((key) => key in THEME_COMPONENT_LABELS);
});

/** 界面类覆盖（标题栏 / 侧边栏 / 播放条 …） */
const overriddenLayoutLabel = computed<string>(() => {
  const labels = overriddenKeys.value
    .filter((key) => THEME_LAYOUT_COMPONENT_KEYS.includes(key))
    .map((key) => THEME_COMPONENT_LABELS[key]);
  return labels.length ? labels.join("、") : t("common.state.none");
});

/** 控件类覆盖（按钮 / 输入框 / 下拉框 …） */
const overriddenControlLabel = computed<string>(() => {
  const labels = overriddenKeys.value
    .filter((key) => THEME_CONTROL_COMPONENT_KEYS.includes(key))
    .map((key) => THEME_COMPONENT_LABELS[key]);
  return labels.length ? labels.join("、") : t("common.state.none");
});

/** 运行时被自动回退的组件（渲染抛错） */
const runtimeErrorLabel = computed<string>(() => {
  if (!themes.runtimeErrors.length) return "";
  return themes.runtimeErrors
    .map((item) => `${THEME_COMPONENT_LABELS[item.key] ?? item.key}（${item.message}）`)
    .join("；");
});

function openThemeMarket(): void {
  void router.push({ path: "/plugins", query: { tab: "themes" } });
}
</script>

<template>
  <SettingsSection id="appearance-theme" :title="t('settings.appearance.theme.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.theme.current.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.theme.current.description") }}
        </div>
      </div>
      <ComboBox
        class="card-control"
        :ItemsSource="themeOptions"
        :SelectedIndex="themeOptionIndex"
        @SelectionChanged="onThemeChange"
      />
    </WpCard>

    <!-- 当前主题详情：纵向堆叠，避免详情表与描述在同一行里互相挤压 -->
    <WpCard v-if="activeTheme" variant="column">
      <div class="card-content">
        <div class="card-header">
          {{ activeThemeInfo.name }}
          <span class="theme-version">v{{ activeThemeInfo.version }}</span>
        </div>
        <div class="card-description">
          {{ activeThemeInfo.description || t("settings.appearance.theme.detail.noDescription") }}
        </div>
      </div>

      <div class="theme-detail">
        <div class="detail-row">
          <span class="detail-label">{{ t("settings.appearance.theme.detail.author") }}</span>
          <span class="detail-value">{{ activeThemeInfo.author || t("common.state.unknown") }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ t("settings.appearance.theme.detail.layout") }}</span>
          <span class="detail-value">{{ overriddenLayoutLabel }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ t("settings.appearance.theme.detail.control") }}</span>
          <span class="detail-value">{{ overriddenControlLabel }}</span>
        </div>
        <div v-if="themes.lastError" class="detail-row">
          <span class="detail-label">{{ t("common.state.warning") }}</span>
          <span class="detail-value danger">{{ themes.lastError }}</span>
        </div>
        <div v-if="runtimeErrorLabel" class="detail-row">
          <span class="detail-label">{{ t("settings.appearance.theme.detail.fallback") }}</span>
          <span class="detail-value danger">{{ runtimeErrorLabel }}</span>
        </div>
      </div>

      <div class="theme-actions">
        <WpButton class="small" @click="openThemeMarket" variant="standard">
          {{ t("settings.appearance.theme.actions.browseMarket") }}
        </WpButton>
        <WpButton class="small" @click="themes.applyTheme('')" variant="standard">
          {{ t("common.action.restoreDefault") }}
        </WpButton>
      </div>
    </WpCard>

    <!-- 没有生效主题时的占位卡（与上面的详情卡互斥，避免同时出现两张） -->
    <WpCard v-else variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.theme.empty.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.theme.empty.description") }}
        </div>
      </div>
      <WpButton @click="openThemeMarket" variant="standard">
        {{ t("settings.appearance.theme.actions.openMarket") }}
      </WpButton>
    </WpCard>

    <!-- 安全提示：主题含可执行组件 -->
    <ContentDialog
      ref="trustDialogRef"
      :Title="t('settings.appearance.theme.trust.title')"
      :PrimaryButtonText="t('settings.appearance.theme.trust.confirm')"
      :CloseButtonText="t('common.action.cancel')"
    >
      <div class="dialog-hint">
        {{ t("settings.appearance.theme.trust.hint") }}
      </div>
    </ContentDialog>
  </SettingsSection>
</template>

<style scoped>
.theme-version {
  margin-left: var(--space-md);
  font-size: 11px;
  font-weight: 400;
  color: var(--wp-text-tertiary);
}

.theme-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-lg);
  background: var(--wp-control-fill-secondary);
  border-radius: var(--radius-sm);
}

.detail-row {
  display: flex;
  gap: var(--space-lg);
  font-size: 13px;
}

.detail-label {
  flex: none;
  width: 72px;
  color: var(--wp-text-tertiary);
}

.detail-value {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.detail-value.danger {
  color: var(--wp-danger);
}

.theme-actions {
  display: flex;
  gap: var(--space-md);
  width: 100%;
}

.dialog-hint {
  font-size: 13px;
  line-height: 1.6;
  color: var(--wp-text-secondary);
}
</style>
