<script setup lang="ts">
import { computed } from "vue";
import { ComboBox, ToggleSwitch } from "winuionweb";
import { useSettingsStore, type UpdateCheckFrequency } from "@/stores/settings";
import { useIsMobile, useIsWindows } from "@/composables/useIsMobile";

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

const frequencyLabels = FREQUENCIES.map((item) => item.label);
const frequencyIndex = computed(() =>
  FREQUENCIES.findIndex((item) => item.value === settings.updateCheckFrequency),
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
</script>

<template>
  <div>
    <!-- 触感反馈（仅移动端） -->
    <section v-if="isMobile" class="settings-section">
      <h2 class="settings-section-title">触感反馈</h2>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">震动反馈</div>
          <div class="card-description">
            长按唤起菜单、下拉刷新、收藏歌曲或切换播放模式时轻微震动，提供操作确认
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.hapticsEnabled" @Toggled="onHapticsToggle" />
      </div>
    </section>

    <!-- 系统集成（SMTC 仅 Windows 提供） -->
    <section v-if="isWindows" class="settings-section">
      <h2 class="settings-section-title">系统集成</h2>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">系统媒体传输控件（SMTC）</div>
          <div class="card-description">
            在 Windows 媒体浮出窗、锁屏与蓝牙设备上显示正在播放的曲目、封面与进度，并响应系统的播放 / 暂停 / 上一首 / 下一首按钮
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.smtcEnabled" @Toggled="onSmtcToggle" />
      </div>
    </section>

    <!-- 更新 -->
    <section class="settings-section">
      <h2 class="settings-section-title">更新</h2>

      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">自动检查更新</div>
          <div class="card-description">
            启动时静默检查 GitHub 上是否有新版本，发现后弹窗提示下载安装；关闭后仍可在「关于」页手动检查
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.autoCheckUpdate" @Toggled="onAutoCheckToggle" />
      </div>

      <div class="settings-card">
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
      </div>

      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">接收预览版本（Beta）</div>
          <div class="card-description">
            开启后会把 GitHub 上的预发布版本也纳入检查，可提前体验新功能，但可能不够稳定
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.updateIncludePrerelease" @Toggled="onPrereleaseToggle" />
      </div>
    </section>
  </div>
</template>
