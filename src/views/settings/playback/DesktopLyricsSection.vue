<script setup lang="ts">
/**
 * 设置 → 播放 → 桌面歌词。
 *
 * 桌面端专属（第二个透明置顶窗口），移动端整组不渲染。
 */
import { computed } from "vue";
import { ComboBox, Slider, ToggleSwitch } from "@/components/winui";
import {
  DESKTOP_LYRICS_FONT_MAX,
  DESKTOP_LYRICS_FONT_MIN,
  useSettingsStore,
} from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();

/** 外观下拉：与 settings.desktopLyricsStyle 一一对应 */
const LYRICS_STYLE_LABELS = ["纯文字", "歌曲卡片"];

const lyricsStyleIndex = computed(() => (settings.desktopLyricsStyle === "glass" ? 1 : 0));

function onLyricsStyleChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  void settings.setDesktopLyricsStyle(label === "歌曲卡片" ? "glass" : "plain");
}

function onDesktopLyricsToggle(event: { IsOn: boolean }): void {
  void settings.setDesktopLyricsEnabled(Boolean(event?.IsOn));
}

function onLyricsLockToggle(event: { IsOn: boolean }): void {
  void settings.setDesktopLyricsLocked(Boolean(event?.IsOn));
}

function onLyricsFontInput(value: number): void {
  void settings.setDesktopLyricsFontSize(value);
}
</script>

<template>
  <SettingsSection v-if="!isMobile" id="playback-lyrics" title="桌面歌词">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">显示桌面歌词</div>
        <div class="card-description">
          在桌面上显示一个置顶歌词窗，可拖动到任意位置（位置会被记住），不占任务栏
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.desktopLyricsEnabled" @Toggled="onDesktopLyricsToggle" />
    </WpCard>

    <template v-if="settings.desktopLyricsEnabled">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">外观</div>
          <div class="card-description">
            纯文字用描边投影，压在亮壁纸上也看得清；歌曲卡片带歌曲信息与封面模糊底色
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="LYRICS_STYLE_LABELS"
          :SelectedIndex="lyricsStyleIndex"
          @SelectionChanged="onLyricsStyleChange"
        />
      </WpCard>

      <WpCard variant="column">
        <div class="card-content">
          <div class="card-header">字号</div>
          <div class="card-description">当前行字号，上下句按比例缩小</div>
        </div>
        <div class="lyrics-font-row">
          <Slider
            class="lyrics-font-slider"
            :Value="settings.desktopLyricsFontSize"
            :Minimum="DESKTOP_LYRICS_FONT_MIN"
            :Maximum="DESKTOP_LYRICS_FONT_MAX"
            :StepFrequency="2"
            :SmallChange="2"
            :LargeChange="4"
            :IsThumbToolTipEnabled="false"
            @update:Value="onLyricsFontInput"
          />
          <span class="lyrics-font-value">{{ settings.desktopLyricsFontSize }}px</span>
        </div>
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">锁定（鼠标穿透）</div>
          <div class="card-description">
            锁定后点击直接落到下面的窗口，歌词不再挡住操作；解锁请回到这里或播放条「更多」
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.desktopLyricsLocked" @Toggled="onLyricsLockToggle" />
      </WpCard>
    </template>
  </SettingsSection>
</template>

<style scoped>
/* 桌面歌词字号：滑杆 + 数值 */
.lyrics-font-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
}

.lyrics-font-slider {
  flex: 1;
  min-width: 0;
}

.lyrics-font-value {
  flex: none;
  min-width: 48px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--wp-text-secondary);
}
</style>
