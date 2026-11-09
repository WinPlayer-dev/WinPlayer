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

const themeOptions = computed(() => [
  "默认（WinUI）",
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
  if (label === "默认（WinUI）") {
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
  return labels.length ? labels.join("、") : "无";
});

/** 控件类覆盖（按钮 / 输入框 / 下拉框 …） */
const overriddenControlLabel = computed<string>(() => {
  const labels = overriddenKeys.value
    .filter((key) => THEME_CONTROL_COMPONENT_KEYS.includes(key))
    .map((key) => THEME_COMPONENT_LABELS[key]);
  return labels.length ? labels.join("、") : "无";
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
  <SettingsSection id="appearance-theme" title="主题">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">当前主题</div>
        <div class="card-description">
          主题可改配色、圆角、背景，甚至重写标题栏 / 播放条等界面组件；切换后立即生效
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
          {{ activeThemeInfo.description || "该主题没有提供描述" }}
        </div>
      </div>

      <div class="theme-detail">
        <div class="detail-row">
          <span class="detail-label">作者</span>
          <span class="detail-value">{{ activeThemeInfo.author || "未知" }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">重写界面</span>
          <span class="detail-value">{{ overriddenLayoutLabel }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">重写控件</span>
          <span class="detail-value">{{ overriddenControlLabel }}</span>
        </div>
        <div v-if="themes.lastError" class="detail-row">
          <span class="detail-label">警告</span>
          <span class="detail-value danger">{{ themes.lastError }}</span>
        </div>
        <div v-if="runtimeErrorLabel" class="detail-row">
          <span class="detail-label">已回退</span>
          <span class="detail-value danger">{{ runtimeErrorLabel }}</span>
        </div>
      </div>

      <div class="theme-actions">
        <WpButton class="small" @click="openThemeMarket" variant="standard">浏览主题市场</WpButton>
        <WpButton class="small" @click="themes.applyTheme('')" variant="standard">恢复默认</WpButton>
      </div>
    </WpCard>

    <!-- 没有生效主题时的占位卡（与上面的详情卡互斥，避免同时出现两张） -->
    <WpCard v-else variant="row">
      <div class="card-content">
        <div class="card-header">还没有应用主题</div>
        <div class="card-description">
          当前使用内置 WinUI 外观，可从主题市场安装或导入 .zip 主题包。
        </div>
      </div>
      <WpButton @click="openThemeMarket" variant="standard">打开主题市场</WpButton>
    </WpCard>

    <!-- 安全提示：主题含可执行组件 -->
    <ContentDialog
      ref="trustDialogRef"
      Title="该主题包含可执行代码"
      PrimaryButtonText="仍要启用"
      CloseButtonText="取消"
    >
      <div class="dialog-hint">
        这个主题重写了内置界面组件（Vue 单文件组件）。启用后，主题代码将以完整权限运行在主界面中，
        可以读取你的曲库、设置与登录凭证。请只启用你信任来源的主题。
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
