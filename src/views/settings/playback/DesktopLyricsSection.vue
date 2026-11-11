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
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();
const { t } = useI18n();

/** 外观下拉：与 settings.desktopLyricsStyle 一一对应 */
const LYRICS_STYLE_LABELS = computed(() => [
  t("settings.playback.desktopLyrics.style.options.plain"),
  t("settings.playback.desktopLyrics.style.options.card"),
]);

const lyricsStyleIndex = computed(() => (settings.desktopLyricsStyle === "glass" ? 1 : 0));

function onLyricsStyleChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const cardLabel = t("settings.playback.desktopLyrics.style.options.card");
  void settings.setDesktopLyricsStyle(label === cardLabel ? "glass" : "plain");
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
  <SettingsSection v-if="!isMobile" id="playback-lyrics" :title="t('settings.playback.desktopLyrics.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.playback.desktopLyrics.enabled.title") }}</div>
        <div class="card-description">
          {{ t("settings.playback.desktopLyrics.enabled.description") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.desktopLyricsEnabled" @Toggled="onDesktopLyricsToggle" />
    </WpCard>

    <template v-if="settings.desktopLyricsEnabled">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.playback.desktopLyrics.style.title") }}</div>
          <div class="card-description">
            {{ t("settings.playback.desktopLyrics.style.description") }}
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
          <div class="card-header">{{ t("settings.playback.desktopLyrics.fontSize.title") }}</div>
          <div class="card-description">{{ t("settings.playback.desktopLyrics.fontSize.description") }}</div>
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
          <div class="card-header">{{ t("settings.playback.desktopLyrics.lock.title") }}</div>
          <div class="card-description">
            {{ t("settings.playback.desktopLyrics.lock.description") }}
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
