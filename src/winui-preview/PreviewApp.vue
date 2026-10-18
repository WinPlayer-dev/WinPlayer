<script setup lang="ts">
import { ref } from "vue";
import {
  ComboBox,
  ContentDialog,
  NumberBox,
  PersonPicture,
  ProgressBar,
  ProgressRing,
  Slider,
  TextBox,
  ToggleSwitch,
} from "@/components/winui";

const theme = ref<"light" | "dark">("light");
function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme.value;
}

const text = ref("");
const number = ref(6);
const on = ref(true);
const off = ref(false);
const slider = ref(40);
const vertical = ref(2);
const combo = ref(1);
const dialogRef = ref<InstanceType<typeof ContentDialog> | null>(null);

const ITEMS = ["跟随系统", "浅色", "深色"];

function openDialog(): void {
  void dialogRef.value?.ShowAsync();
}
</script>

<template>
  <div class="page">
    <header class="bar">
      <h1>自研 WinUI 控件</h1>
      <button class="wp-standard-button" @click="toggleTheme">切换主题（{{ theme }}）</button>
    </header>

    <section class="card">
      <div class="row"><span>ProgressBar 确定</span><ProgressBar :Value="45" :Maximum="100" /></div>
      <div class="row"><span>ProgressBar 不定</span><ProgressBar :IsIndeterminate="true" /></div>
      <div class="row">
        <span>ProgressRing</span>
        <span class="rings">
          <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="36" :Height="36" />
          <ProgressRing :IsActive="true" :IsIndeterminate="true" :Width="24" :Height="24" />
        </span>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <span>ComboBox</span>
        <ComboBox class="ctl" :ItemsSource="ITEMS" :SelectedIndex="combo" @SelectionChanged="(_s, p) => (combo = ITEMS.indexOf(String(p.AddedItems[0])))" />
      </div>
      <div class="row">
        <span>TextBox</span>
        <TextBox class="ctl" :Text="text" PlaceholderText="输入文字…" @update:Text="(v) => (text = v)" />
      </div>
      <div class="row">
        <span>NumberBox</span>
        <NumberBox class="ctl" :Value="number" :SmallChange="1" @update:Value="(v) => (number = v)" />
      </div>
      <div class="row">
        <span>ToggleSwitch</span>
        <span class="pair">
          <ToggleSwitch :IsOn="on" @Toggled="(e) => (on = e.IsOn)" />
          <ToggleSwitch :IsOn="off" @Toggled="(e) => (off = e.IsOn)" />
        </span>
      </div>
      <div class="row">
        <span>Slider（{{ slider }}）</span>
        <Slider class="ctl" :Value="slider" :Minimum="0" :Maximum="100" :StepFrequency="1" @update:Value="(v) => (slider = v)" />
      </div>
      <div class="row">
        <span>Slider 纵向</span>
        <div class="vslider">
          <Slider
            class="vslider-ctl"
            Orientation="Vertical"
            :Value="vertical"
            :Minimum="-12"
            :Maximum="12"
            :StepFrequency="1"
            :IsThumbToolTipEnabled="false"
            @update:Value="(v) => (vertical = v)"
          />
        </div>
      </div>
      <div class="row">
        <span>PersonPicture</span>
        <span class="pair">
          <PersonPicture DisplayName="音" :Width="72" :Height="72" FontSize="30" />
          <PersonPicture DisplayName="音" :Width="28" :Height="28" FontSize="12" />
        </span>
      </div>
      <div class="row">
        <span>ContentDialog</span>
        <button class="wp-accent-button" @click="openDialog">打开对话框</button>
      </div>
    </section>

    <ContentDialog
      ref="dialogRef"
      Title="新建歌单"
      PrimaryButtonText="创建"
      SecondaryButtonText="忽略"
      CloseButtonText="取消"
    >
      <div class="form">
        <TextBox PlaceholderText="歌单名称" />
        <TextBox PlaceholderText="歌单简介（可选）" />
      </div>
    </ContentDialog>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  color: var(--wp-text-primary);
  background: var(--wp-base);
  min-height: 100vh;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.bar h1 {
  font-size: 22px;
  margin: 0;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  border-radius: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.row > span:first-child {
  width: 140px;
  font-size: 13px;
  color: var(--wp-text-secondary);
}

.ctl {
  width: 220px;
}

.pair {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rings {
  display: flex;
  align-items: center;
  gap: 12px;
}

.vslider {
  width: 32px;
  height: 140px;
}

.vslider-ctl {
  width: 100%;
  height: 100%;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
