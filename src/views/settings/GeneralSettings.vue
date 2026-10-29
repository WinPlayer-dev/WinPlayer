<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ComboBox, ToggleSwitch } from "@/components/winui";
import {
  useSettingsStore,
  STARTUP_PAGE_OPTIONS,
  type CloseBehavior,
  type UpdateCheckFrequency,
} from "@/stores/settings";
import { useIsAndroid, useIsMobile, useIsWindows } from "@/composables/useIsMobile";
import { resetWindowState } from "@/services/windowState";
import { toast } from "@/services/toast";
import WpCard from "@/components/theme/WpCard.vue";
import WpButton from "@/components/theme/WpButton.vue";

const settings = useSettingsStore();
const router = useRouter();
// SMTC 是 Windows 专属能力，其他平台隐藏该设置项
const isWindows = useIsWindows();
// 车载模式依赖媒体控件：Windows 走 SMTC，安卓走媒体通知
const isAndroid = useIsAndroid();
// 触感反馈仅移动端有意义
const isMobile = useIsMobile();

/** 检查频率选项（顺序与 ComboBox 的 SelectedIndex 一致） */
const FREQUENCIES: { value: UpdateCheckFrequency; label: string }[] = [
  { value: "startup", label: "每次启动" },
  { value: "daily", label: "每 24 小时" },
  { value: "manual", label: "仅手动" },
];

/** 关闭按钮行为选项（仅 Windows 托盘场景生效） */
const CLOSE_BEHAVIORS: { value: CloseBehavior; label: string }[] = [
  { value: "tray", label: "关闭到系统托盘" },
  { value: "minimize", label: "最小化到任务栏" },
  { value: "quit", label: "直接退出" },
];

const frequencyLabels = FREQUENCIES.map((item) => item.label);
const frequencyIndex = computed(() =>
  FREQUENCIES.findIndex((item) => item.value === settings.updateCheckFrequency),
);

const closeBehaviorLabels = CLOSE_BEHAVIORS.map((item) => item.label);
const closeBehaviorIndex = computed(() =>
  CLOSE_BEHAVIORS.findIndex((item) => item.value === settings.closeBehavior),
);

/**
 * 「打开时页面」候选项：`mobileOnly` 的项（我的）只在移动端出现。
 * 桌面端若偏好里仍是「我的」（例如从移动端备份还原过来），下拉显示占位文案但启动照旧生效。
 */
const startupOptions = computed(() =>
  STARTUP_PAGE_OPTIONS.filter((item) => isMobile || !item.mobileOnly),
);
const startupLabels = computed(() => startupOptions.value.map((item) => item.label));
const startupIndex = computed(() =>
  startupOptions.value.findIndex((item) => item.value === settings.startupPage),
);
const startupPlaceholder = computed(() => (isMobile ? "" : "仅移动端可选"));

function onStartupPageChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = STARTUP_PAGE_OPTIONS.find((item) => item.label === String(label ?? ""));
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
  const option = FREQUENCIES.find((item) => item.label === String(label ?? ""));
  if (option) void settings.setUpdateCheckFrequency(option.value);
}

function onCloseBehaviorChange(_sender: unknown, payload: unknown): void {
  const label = (payload as { AddedItems?: unknown[] } | undefined)?.AddedItems?.[0];
  const option = CLOSE_BEHAVIORS.find((item) => item.label === String(label ?? ""));
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
    toast("窗口已恢复默认大小并居中", "success");
  } catch (error) {
    toast(`重置失败: ${error}`, "error");
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
</script>

<template>
  <div>
    <!-- 启动：冷启动后直接进入哪个页面 -->
    <section class="settings-section">
      <h2 class="settings-section-title">启动</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">打开时页面</div>
          <div class="card-description">
            每次启动应用后直接进入所选页面
            <template v-if="!isMobile">。桌面端不提供「我的」</template>
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
    </section>

    <!-- 新手引导：重新进入欢迎页（不改动已装插件） -->
    <section class="settings-section">
      <h2 class="settings-section-title">新手引导</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">欢迎引导</div>
          <div class="card-description">
            重新查看欢迎页与添加播放源引导，不影响已装插件与现有设置
          </div>
        </div>
        <WpButton variant="standard" class="small" @click="replayOnboarding">重新查看</WpButton>
      </WpCard>
    </section>

    <!-- 触感反馈（仅移动端） -->
    <section v-if="isMobile" class="settings-section">
      <h2 class="settings-section-title">触感反馈</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">震动反馈</div>
          <div class="card-description">
            长按菜单、下拉刷新、收藏等操作时轻微震动
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.hapticsEnabled" @Toggled="onHapticsToggle" />
      </WpCard>
    </section>

    <!-- 窗口（仅桌面端：移动端窗口由系统全屏托管） -->
    <section v-if="!isMobile" class="settings-section">
      <h2 class="settings-section-title">窗口</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">记住窗口大小与位置</div>
          <div class="card-description">
            退出时记住窗口尺寸、位置与最大化状态，下次启动还原
          </div>
        </div>
        <div class="card-control window-state-control">
          <WpButton variant="standard" class="small" @click="resetWindow">重置</WpButton>
          <ToggleSwitch :IsOn="settings.rememberWindowState" @Toggled="onRememberWindowToggle" />
        </div>
      </WpCard>
    </section>

    <!-- 系统集成（SMTC 仅 Windows 提供） -->
    <section v-if="isWindows" class="settings-section">
      <h2 class="settings-section-title">系统集成</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">关闭按钮行为</div>
          <div class="card-description">
            关闭窗口时收进托盘继续播放、最小化到任务栏或直接退出
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

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">后台优化</div>
          <div class="card-description">
            窗口隐藏时暂停动画与轮询以降低占用，播放不受影响
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.backgroundOptimize" @Toggled="onOptimizeToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">系统媒体传输控件（SMTC）</div>
          <div class="card-description">
            在系统媒体浮出窗、锁屏与蓝牙设备上显示曲目和进度，并响应系统播放控制
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.smtcEnabled" @Toggled="onSmtcToggle" />
      </WpCard>
    </section>

    <!-- 车载模式：依赖媒体控件（Windows 的 SMTC / 安卓的媒体通知） -->
    <section v-if="isWindows || isAndroid" class="settings-section">
      <h2 class="settings-section-title">车载模式</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">歌词显示在媒体控件上</div>
          <div class="card-description">
            媒体控件标题显示当前歌词行，没有歌词时显示歌名；需开启系统媒体控件
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.carMode" @Toggled="onCarModeToggle" />
      </WpCard>
    </section>

    <!-- 搜索 -->
    <section class="settings-section">
      <h2 class="settings-section-title">搜索</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">聚合搜索</div>
          <div class="card-description">
            搜索页多出一个「全部」Tab，聚合所有插件的结果
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.aggregateSearch" @Toggled="onAggregateSearchToggle" />
      </WpCard>
    </section>

    <!-- 隐私 -->
    <section class="settings-section">
      <h2 class="settings-section-title">隐私</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">记录播放历史</div>
          <div class="card-description">
            记录播放次数与最近播放时间；关闭后不再记录，已有数据保留
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.historyEnabled" @Toggled="onHistoryToggle" />
      </WpCard>
    </section>

    <!-- 更新 -->
    <section class="settings-section">
      <h2 class="settings-section-title">更新</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">自动检查更新</div>
          <div class="card-description">
            启动时静默检查新版本，有更新时提示；关闭后仍可在「关于」页手动检查
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.autoCheckUpdate" @Toggled="onAutoCheckToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">自动检查频率</div>
          <div class="card-description">
            「每次启动」每次打开都检查，「每 24 小时」每天只检查一次，「仅手动」只在「关于」页检查
          </div>
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
          <div class="card-header">接收预览版本（Beta）</div>
          <div class="card-description">
            同时检查预发布版本，可提前体验新功能，但可能不够稳定
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.updateIncludePrerelease" @Toggled="onPrereleaseToggle" />
      </WpCard>
    </section>
  </div>
</template>

<style scoped>
/* 「重置」按钮与开关并排放在卡片右侧 */
.window-state-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 8px);
}
</style>
