<script setup lang="ts">
import { computed } from "vue";
import { ComboBox, ToggleSwitch } from "@/components/winui";
import { useSettingsStore, type CloseBehavior, type UpdateCheckFrequency } from "@/stores/settings";
import { useIsMobile, useIsWindows } from "@/composables/useIsMobile";
import { resetWindowState } from "@/services/windowState";
import { toast } from "@/services/toast";
import WpCard from "@/components/theme/WpCard.vue";
import WpButton from "@/components/theme/WpButton.vue";

const settings = useSettingsStore();
// SMTC 是 Windows 专属能力，其他平台隐藏该设置项
const isWindows = useIsWindows();
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

function onSmtcToggle(event: { IsOn: boolean }): void {
  void settings.setSmtcEnabled(Boolean(event?.IsOn));
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
</script>

<template>
  <div>
    <!-- 触感反馈（仅移动端） -->
    <section v-if="isMobile" class="settings-section">
      <h2 class="settings-section-title">触感反馈</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">震动反馈</div>
          <div class="card-description">
            长按唤起菜单、下拉刷新、收藏歌曲或切换播放模式时轻微震动，提供操作确认
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
            退出时记住窗口的尺寸、位置与最大化状态，下次启动原样还原；若显示器有变化导致窗口跑到屏幕外，
            会自动回到主屏居中
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
            关闭窗口时：收藏到系统托盘继续在后台播放、最小化到任务栏，或直接退出应用。托盘图标左键可显示/隐藏主窗口，右键提供播放控制菜单
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
            窗口隐藏（关闭到托盘 / 最小化）时暂停界面动画、进度刷新与插件轮询以降低资源占用；音频播放与无缝切歌不受影响
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.backgroundOptimize" @Toggled="onOptimizeToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">系统媒体传输控件（SMTC）</div>
          <div class="card-description">
            在 Windows 媒体浮出窗、锁屏与蓝牙设备上显示正在播放的曲目、封面与进度，并响应系统的播放 / 暂停 / 上一首 / 下一首按钮
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.smtcEnabled" @Toggled="onSmtcToggle" />
      </WpCard>
    </section>

    <!-- 搜索 -->
    <section class="settings-section">
      <h2 class="settings-section-title">搜索</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">聚合搜索</div>
          <div class="card-description">
            开启后搜索页在插件 Tab 前多出一个「全部」Tab，把所有插件的搜索结果交错融合展示；
            关闭后搜索页只有插件 Tab，切到哪个 Tab 才搜索哪个插件
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
            记录每首歌的播放次数与最近播放时间，用于「最近播放」页与播放次数统计。关闭后不再写入新记录，
            已有记录保留并可在该页清空
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
            启动时静默检查 GitHub 上是否有新版本，发现后弹窗提示下载安装；关闭后仍可在「关于」页手动检查
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.autoCheckUpdate" @Toggled="onAutoCheckToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">自动检查频率</div>
          <div class="card-description">
            「每次启动」每次打开应用都检查；「每 24 小时」同一天内只检查一次；「仅手动」只在手动点击时检查
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
            开启后会把 GitHub 上的预发布版本也纳入检查，可提前体验新功能，但可能不够稳定
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
