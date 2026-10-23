<script setup lang="ts">
/**
 * 设置 → 实验性
 *
 * 收纳还没"毕业"的功能开关与入口：
 * - 主题皮肤（第三方主题可重写界面组件，仍在实验阶段）
 * - 录音棚（麦克风采集 + 混音，默认关闭，打开后侧边栏/播放器「更多」才出现入口）
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ComboBox, ContentDialog, ToggleSwitch } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { useThemesStore } from "@/stores/themes";
import {
  THEME_COMPONENT_LABELS,
  THEME_CONTROL_COMPONENT_KEYS,
  THEME_LAYOUT_COMPONENT_KEYS,
  type ThemeComponentKey,
} from "@/types/theme";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const themes = useThemesStore();
const router = useRouter();

/* ------------------------------ 主题皮肤 ------------------------------ */

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

/* ------------------------------ 录音棚 ------------------------------ */

function onStudioToggle(event: { IsOn: boolean }): void {
  void settings.setStudioEnabled(Boolean(event?.IsOn));
}
</script>

<template>
  <div>
    <p class="experimental-note">
      这些功能还在打磨中，界面与行为可能随版本调整；遇到问题欢迎反馈。关闭某个开关只是隐藏入口，
      已经产生的数据（主题、录音作品）不会被删除。
    </p>

    <!-- 主题皮肤 -->
    <section class="settings-section">
      <h2 class="settings-section-title">主题</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">当前主题</div>
          <div class="card-description">
            主题可以改配色、圆角、字体、背景壁纸，甚至重写标题栏 / 侧边栏 / 播放条等界面组件；
            切换后立即生效，无需重启
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
            当前使用内置 WinUI 外观。可以从主题市场安装，或导入本地 .zip 主题包。
          </div>
        </div>
        <WpButton @click="openThemeMarket" variant="standard">打开主题市场</WpButton>
      </WpCard>
    </section>

    <!-- 录音棚入口 -->
    <section class="settings-section">
      <h2 class="settings-section-title">录音棚</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">显示录音棚入口</div>
          <div class="card-description">
            开启后侧边栏与播放器「更多」菜单里会出现「录音棚」，可以把当前播放的歌曲当伴奏录人声并自动混音。
            不同声卡 / 麦克风下的延迟与音质表现可能有差异；关闭只隐藏入口，之前录好的作品仍保留在本地
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.studioEnabled" @Toggled="onStudioToggle" />
      </WpCard>
    </section>

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
  </div>
</template>

<style scoped>
/* 顶部说明：整段浅色小字，和卡片区分开 */
.experimental-note {
  margin: 0 0 var(--space-3xl);
  padding: var(--space-lg) var(--space-xl);
  border-radius: var(--radius-lg);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

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
