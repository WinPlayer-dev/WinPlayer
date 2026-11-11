<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ComboBox, ToggleSwitch } from "@/components/winui";
import {
  useSettingsStore,
  STARTUP_PAGE_OPTIONS,
  type CloseBehavior,
  type StartupPage,
  type UpdateCheckFrequency,
} from "@/stores/settings";
import { useIsAndroid, useIsMobile, useIsWindows } from "@/composables/useIsMobile";
import { resetWindowState } from "@/services/windowState";
import { toast } from "@/services/toast";
import { LOCALES, useI18n, type I18nKey } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";
import WpButton from "@/components/theme/WpButton.vue";

const settings = useSettingsStore();
const router = useRouter();
const { t } = useI18n();
// SMTC 是 Windows 专属能力，其他平台隐藏该设置项
const isWindows = useIsWindows();
// 车载模式依赖媒体控件：Windows 走 SMTC，安卓走媒体通知
const isAndroid = useIsAndroid();
// 触感反馈仅移动端有意义
const isMobile = useIsMobile();

/** 检查频率选项（顺序与 ComboBox 的 SelectedIndex 一致） */
const FREQUENCIES: { value: UpdateCheckFrequency; labelKey: I18nKey }[] = [
  { value: "startup", labelKey: "settings.general.update.frequency.options.startup" },
  { value: "daily", labelKey: "settings.general.update.frequency.options.daily" },
  { value: "manual", labelKey: "settings.general.update.frequency.options.manual" },
];

/** 关闭按钮行为选项（仅 Windows 托盘场景生效） */
const CLOSE_BEHAVIORS: { value: CloseBehavior; labelKey: I18nKey }[] = [
  { value: "tray", labelKey: "settings.general.window.closeBehavior.options.tray" },
  { value: "minimize", labelKey: "settings.general.window.closeBehavior.options.minimize" },
  { value: "quit", labelKey: "settings.general.window.closeBehavior.options.quit" },
];

/**
 * 「打开时页面」候选项的显示名。
 *
 * `STARTUP_PAGE_OPTIONS` 只提供代码值（store 层不放界面文案），这里按值映射到词条。
 */
const STARTUP_PAGE_LABEL_KEYS: Record<StartupPage, I18nKey> = {
  recommend: "settings.general.startup.page.options.recommend",
  liked: "settings.general.startup.page.options.liked",
  offline: "settings.general.startup.page.options.offline",
  mine: "settings.general.startup.page.options.mine",
};

/** 界面语言选项：直接来自 i18n 的已注册语种表（新增语种无需改这里） */
const languageLabels = LOCALES.map((item) => item.label);
const languageIndex = computed(() =>
  LOCALES.findIndex((item) => item.value === settings.language),
);

function onLanguageChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = LOCALES.find((item) => item.label === String(label ?? ""));
  if (option) void settings.setLanguage(option.value);
}

const frequencyLabels = computed(() => FREQUENCIES.map((item) => t(item.labelKey)));
const frequencyIndex = computed(() =>
  FREQUENCIES.findIndex((item) => item.value === settings.updateCheckFrequency),
);

const closeBehaviorLabels = computed(() => CLOSE_BEHAVIORS.map((item) => t(item.labelKey)));
const closeBehaviorIndex = computed(() =>
  CLOSE_BEHAVIORS.findIndex((item) => item.value === settings.closeBehavior),
);

/** 「自动检查频率」的说明：选项名从词条取，避免与下拉选项各写一份 */
const frequencyDescription = computed(() =>
  t("settings.general.update.frequency.description", {
    startup: t("settings.general.update.frequency.options.startup"),
    daily: t("settings.general.update.frequency.options.daily"),
    manual: t("settings.general.update.frequency.options.manual"),
  }),
);

/**
 * 「打开时页面」候选项：`mobileOnly` 的项（我的）只在移动端出现。
 * 桌面端若偏好里仍是「我的」（例如从移动端备份还原过来），下拉显示占位文案但启动照旧生效。
 */
const startupOptions = computed(() =>
  STARTUP_PAGE_OPTIONS.filter((item) => isMobile || !item.mobileOnly),
);
const startupLabels = computed(() =>
  startupOptions.value.map((item) => t(STARTUP_PAGE_LABEL_KEYS[item.value])),
);
const startupIndex = computed(() =>
  startupOptions.value.findIndex((item) => item.value === settings.startupPage),
);
const startupPlaceholder = computed(() =>
  isMobile ? "" : t("settings.general.startup.page.placeholderMobileOnly"),
);

function onStartupPageChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = STARTUP_PAGE_OPTIONS.find(
    (item) => t(STARTUP_PAGE_LABEL_KEYS[item.value]) === String(label ?? ""),
  );
  if (option) void settings.setStartupPage(option.value);
}

function onSmtcToggle(event: { IsOn: boolean }): void {
  void settings.setSmtcEnabled(Boolean(event?.IsOn));
}

function onCarModeToggle(event: { IsOn: boolean }): void {
  void settings.setCarMode(Boolean(event?.IsOn));
}

function onHapticsToggle(event: { IsOn: boolean }): void {
  void settings.setHaptics(Boolean(event?.IsOn));
}

function onAutoCheckToggle(event: { IsOn: boolean }): void {
  void settings.setAutoCheckUpdate(Boolean(event?.IsOn));
}

function onPrereleaseToggle(event: { IsOn: boolean }): void {
  void settings.setUpdateIncludePrerelease(Boolean(event?.IsOn));
}

function onFrequencyChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = FREQUENCIES.find((item) => t(item.labelKey) === String(label ?? ""));
  if (option) void settings.setUpdateCheckFrequency(option.value);
}

function onCloseBehaviorChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = CLOSE_BEHAVIORS.find((item) => t(item.labelKey) === String(label ?? ""));
  if (option) void settings.setCloseBehavior(option.value);
}

function onOptimizeToggle(event: { IsOn: boolean }): void {
  void settings.setBackgroundOptimize(Boolean(event?.IsOn));
}

function onHistoryToggle(event: { IsOn: boolean }): void {
  void settings.setHistoryEnabled(Boolean(event?.IsOn));
}

function onAggregateSearchToggle(event: { IsOn: boolean }): void {
  void settings.setAggregateSearch(Boolean(event?.IsOn));
}

function onRememberWindowToggle(event: { IsOn: boolean }): void {
  void settings.setRememberWindowState(Boolean(event?.IsOn));
}

/** 重置窗口：清掉存档并把窗口恢复成默认尺寸且居中 */
async function resetWindow(): Promise<void> {
  try {
    await resetWindowState();
    toast(t("settings.general.window.remember.resetSuccess"), "success");
  } catch (error) {
    toast(t("settings.general.window.remember.resetFailed", { error: String(error) }), "error");
  }
}

/**
 * 重新进入首次引导（LOGO 欢迎页 + 添加播放源）。
 * 带 from=settings，引导结束（装好源 / 跳过）后回到「设置 → 通用」；
 * 不会重置已安装的插件，也不会清掉「已完成」标记。
 */
function replayOnboarding(): void {
  void router.push({ name: "welcome", query: { from: "settings" } });
}

/** 跳到「关于 › 更新」并高亮那一组：自动检查关掉后，手动检查在那边 */
function goAboutUpdate(): void {
  void router.push({ query: { tab: "about", focus: "about.update.check" } });
}

function onDemoModeToggle(event: { IsOn: boolean }): void {
  void settings.setDemoMode(Boolean(event?.IsOn));
}
</script>

<template>
  <div>
    <!-- 语言：切换即时生效，选项来自 i18n 的已注册语种表 -->
    <SettingsSection id="general-language" :title="t('settings.general.language.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.language.interface.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.language.interface.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="languageLabels"
          :SelectedIndex="languageIndex"
          @SelectionChanged="
            (_sender: unknown, payload: unknown) => onLanguageChange(_sender, payload)
          "
        />
      </WpCard>
    </SettingsSection>

    <!-- 启动与引导：冷启动后进哪个页面 + 重看欢迎引导 -->
    <SettingsSection id="general-startup" :title="t('settings.general.startup.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.startup.page.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.startup.page.description") }}<template v-if="!isMobile">{{
              t("settings.general.startup.page.descriptionDesktopSuffix")
            }}</template>
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="startupLabels"
          :SelectedIndex="startupIndex"
          :PlaceholderText="startupPlaceholder"
          @SelectionChanged="
            (_sender: unknown, payload: unknown) => onStartupPageChange(_sender, payload)
          "
        />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.startup.onboarding.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.startup.onboarding.description") }}
          </div>
        </div>
        <WpButton variant="standard" class="small" @click="replayOnboarding">{{
          t("settings.general.startup.onboarding.action")
        }}</WpButton>
      </WpCard>
    </SettingsSection>

    <!-- 触感反馈（仅移动端） -->
    <SettingsSection v-if="isMobile" id="general-feedback" :title="t('settings.general.feedback.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.feedback.vibration.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.feedback.vibration.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.hapticsEnabled" @Toggled="onHapticsToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 窗口与系统（桌面端才有窗口；SMTC 仅 Windows 提供） -->
    <SettingsSection
      v-if="!isMobile || isWindows"
      id="general-window"
      :title="t('settings.general.window.section')"
    >
      <WpCard v-if="!isMobile" variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.window.remember.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.window.remember.description") }}
          </div>
        </div>
        <div class="card-control window-state-control">
          <WpButton variant="standard" class="small" @click="resetWindow">{{
            t("common.action.reset")
          }}</WpButton>
          <ToggleSwitch :IsOn="settings.rememberWindowState" @Toggled="onRememberWindowToggle" />
        </div>
      </WpCard>

      <WpCard v-if="isWindows" variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.window.closeBehavior.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.window.closeBehavior.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="closeBehaviorLabels"
          :SelectedIndex="closeBehaviorIndex"
          @SelectionChanged="
            (_sender: unknown, payload: unknown) => onCloseBehaviorChange(_sender, payload)
          "
        />
      </WpCard>

      <WpCard v-if="isWindows" variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.window.background.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.window.background.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.backgroundOptimize" @Toggled="onOptimizeToggle" />
      </WpCard>

      <WpCard v-if="isWindows" variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.window.smtc.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.window.smtc.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.smtcEnabled" @Toggled="onSmtcToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 车载模式：依赖媒体控件（Windows 的 SMTC / 安卓的媒体通知） -->
    <SettingsSection v-if="isWindows || isAndroid" id="general-car" :title="t('settings.general.car.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.car.lyrics.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.car.lyrics.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.carMode" @Toggled="onCarModeToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 搜索 -->
    <SettingsSection id="general-search" :title="t('settings.general.search.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.search.aggregate.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.search.aggregate.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.aggregateSearch" @Toggled="onAggregateSearchToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 隐私：播放历史 + 演示模式（录屏/截图时隐藏来源名与歌单） -->
    <SettingsSection id="general-privacy" :title="t('settings.general.privacy.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.privacy.history.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.privacy.history.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.historyEnabled" @Toggled="onHistoryToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.privacy.demoMode.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.privacy.demoMode.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.demoMode" @Toggled="onDemoModeToggle" />
      </WpCard>
    </SettingsSection>

    <!-- 更新：只放「自动检查」相关，手动检查在「关于」页 -->
    <SettingsSection id="general-update" :title="t('settings.general.update.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.update.auto.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.update.auto.description") }}
            <button class="inline-link" type="button" @click="goAboutUpdate">
              {{ t("settings.general.update.auto.link") }}
            </button>
            {{ t("settings.general.update.auto.descriptionAfterLink") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.autoCheckUpdate" @Toggled="onAutoCheckToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.update.frequency.title") }}</div>
          <div class="card-description">{{ frequencyDescription }}</div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="frequencyLabels"
          :SelectedIndex="frequencyIndex"
          :IsEnabled="settings.autoCheckUpdate"
          @SelectionChanged="
            (_sender: unknown, payload: unknown) => onFrequencyChange(_sender, payload)
          "
        />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.general.update.prerelease.title") }}</div>
          <div class="card-description">
            {{ t("settings.general.update.prerelease.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.updateIncludePrerelease" @Toggled="onPrereleaseToggle" />
      </WpCard>
    </SettingsSection>
  </div>
</template>

<style scoped>
/* 「重置」按钮与开关并排放在卡片右侧 */
.window-state-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
}

/* 描述里的行内跳转链接：不换行、不撑高，看起来像正文的一部分 */
.inline-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--wp-accent);
  cursor: pointer;
}

.inline-link:hover {
  text-decoration: underline;
}
</style>
