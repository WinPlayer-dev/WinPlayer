<script setup lang="ts">
/**
 * 设置 → 外观 → 歌词样式（手机与桌面通用）。
 *
 * 管的只有一件事：沉浸式「正在播放」页面里那屏歌词长什么样 ——
 * 字号、对齐、字体、字重、当前行是否放大 / 加粗、非当前行是否模糊与压暗、
 * 行距、翻译副行、投影、上下边缘渐隐。
 *
 * 两端共用同一份配置：手机全屏页与桌面沉浸页读的都是 `settings.lyricsStyle`，
 * 改一处两端一起变。配置里的字号是手机基准值，桌面按 `DESKTOP_LYRIC_FONT_SCALE`
 * 放大（预览也按当前端渲染，所以看到的就是实际效果）。
 *
 * 两个设计取舍：
 * 1. 顶部先给一块**实时预览**。这些参数互相影响（放大 + 模糊 + 行距叠在一起
 *    很容易难看），只靠文字描述根本调不准，所以预览必须放在第一张卡；
 * 2. 预览和真实播放页共用 `styles/lyrics-style.css` 与同一组 `--lrc-*` 变量，
 *    不另写一套「示意样式」，避免预览好看、实际不一样。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ComboBox, Slider, ToggleSwitch } from "@/components/winui";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import {
  LYRICS_FONT_WEIGHTS,
  LYRICS_STYLE_RANGES,
  LYRIC_EASINGS,
  useSettingsStore,
  type LyricAlign,
  type LyricAnchor,
} from "@/stores/settings";
import {
  DESKTOP_LYRIC_FONT_SCALE,
  LYRIC_FONT_OPTIONS,
  lyricStyleClasses,
  lyricStyleVars,
} from "@/services/lyricStyle";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";

const settings = useSettingsStore();
const isMobile = useIsMobile();
const { t } = useI18n();

/** 当前配置的简写，模板里少写几层 */
const style = computed(() => settings.lyricsStyle);

/** 预览按当前端渲染：桌面放大 1.3 倍，与真实播放页一致 */
const previewZoom = isMobile ? 1 : DESKTOP_LYRIC_FONT_SCALE;

const previewVars = computed(() => lyricStyleVars(style.value, previewZoom));
const previewClasses = computed(() => lyricStyleClasses(style.value));

/** 预览歌词：故意留一句长句与两句带翻译，能看出折行、对齐与副行效果 */
const PREVIEW_LINES: ReadonlyArray<{ text: string; translation: string }> = [
  { text: t("settings.appearance.lyrics.preview.lines.first"), translation: "" },
  {
    text: t("settings.appearance.lyrics.preview.lines.second"),
    translation: t("settings.appearance.lyrics.preview.translations.second"),
  },
  {
    text: t("settings.appearance.lyrics.preview.lines.third"),
    translation: t("settings.appearance.lyrics.preview.translations.third"),
  },
  { text: t("settings.appearance.lyrics.preview.lines.fourth"), translation: "" },
  {
    text: t("settings.appearance.lyrics.preview.lines.fifth"),
    translation: t("settings.appearance.lyrics.preview.translations.fifth"),
  },
];

/** 当前行固定在中间那行：上下各两行刚好覆盖 level-1 / level-2 两档层级 */
const PREVIEW_ACTIVE = 2;

/** 预览行的层级：与播放页 lineLevel 同一套 0~4 语义（这里只需到 2） */
function previewLevel(index: number): number {
  return Math.min(2, Math.abs(index - PREVIEW_ACTIVE));
}

const update = (patch: Parameters<typeof settings.setLyricsStyle>[0]): void => {
  settings.setLyricsStyle(patch);
};

/* ------------------------------ 下拉选项 ------------------------------ */

/**
 * 字体预设的显示文案归本页维护（预设值与字体栈在 `services/lyricStyle`，
 * 那里只放实现，不放界面文案）。
 */
const FONT_TEXT_KEYS = {
  default: {
    label: "settings.appearance.lyrics.font.options.default.label",
    hint: "settings.appearance.lyrics.font.options.default.hint",
  },
  sans: {
    label: "settings.appearance.lyrics.font.options.sans.label",
    hint: "settings.appearance.lyrics.font.options.sans.hint",
  },
  serif: {
    label: "settings.appearance.lyrics.font.options.serif.label",
    hint: "settings.appearance.lyrics.font.options.serif.hint",
  },
  round: {
    label: "settings.appearance.lyrics.font.options.round.label",
    hint: "settings.appearance.lyrics.font.options.round.hint",
  },
  kai: {
    label: "settings.appearance.lyrics.font.options.kai.label",
    hint: "settings.appearance.lyrics.font.options.kai.hint",
  },
  mono: {
    label: "settings.appearance.lyrics.font.options.mono.label",
    hint: "settings.appearance.lyrics.font.options.mono.hint",
  },
  custom: {
    label: "settings.appearance.lyrics.font.options.custom.label",
    hint: "settings.appearance.lyrics.font.options.custom.hint",
  },
} as const;

const FONT_LABELS = LYRIC_FONT_OPTIONS.map((option) => t(FONT_TEXT_KEYS[option].label));
const fontIndex = computed(() =>
  Math.max(
    0,
    LYRIC_FONT_OPTIONS.findIndex((option) => option === style.value.fontPreset),
  ),
);

function onFontChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  // 按显示文案反查序号（文案已本地化，不能再拿它和服务层的 label 比对）
  const index = FONT_LABELS.indexOf(String(payload?.AddedItems?.[0] ?? ""));
  const option = LYRIC_FONT_OPTIONS[index];
  if (!option || option === style.value.fontPreset) return;
  update({ fontPreset: option });
}

const ALIGN_OPTIONS: ReadonlyArray<{ value: LyricAlign; label: string }> = [
  { value: "center", label: t("settings.appearance.lyrics.align.options.center") },
  { value: "left", label: t("settings.appearance.lyrics.align.options.left") },
];

const WEIGHT_LABELS = [
  t("settings.appearance.lyrics.weight.options.thin"),
  t("settings.appearance.lyrics.weight.options.normal"),
  t("settings.appearance.lyrics.weight.options.medium"),
  t("settings.appearance.lyrics.weight.options.semibold"),
  t("settings.appearance.lyrics.weight.options.bold"),
];
const weightIndex = computed(() =>
  Math.max(0, LYRICS_FONT_WEIGHTS.indexOf(style.value.fontWeight)),
);

function onWeightChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const index = WEIGHT_LABELS.indexOf(String(payload?.AddedItems?.[0] ?? ""));
  if (index >= 0) update({ fontWeight: LYRICS_FONT_WEIGHTS[index] });
}

/** 下拉选中的字体预设对应的说明（展示在卡片描述里） */
const fontHint = computed(() => t(FONT_TEXT_KEYS[style.value.fontPreset].hint));

/* ------------------------------ 自定义字体 ------------------------------ */

const FONT_PLACEHOLDER = t("settings.appearance.lyrics.font.placeholder");

/** 本地输入值：击键即预览，防抖后落库（与全局字体设置同一套做法） */
const fontInput = ref(style.value.fontCustom);
let fontTimer = 0;

watch(fontInput, (value) => {
  window.clearTimeout(fontTimer);
  fontTimer = window.setTimeout(() => update({ fontCustom: value }), 400);
});

watch(
  () => style.value.fontCustom,
  (value) => {
    if (value !== fontInput.value) fontInput.value = value;
  },
);

onBeforeUnmount(() => window.clearTimeout(fontTimer));

/* ------------------------------ 展示文案 ------------------------------ */

/** 当前行垂直位置的可选项：三段按钮比下拉更直观，点一下就能看到位置变化 */
const ANCHOR_OPTIONS: ReadonlyArray<{ value: LyricAnchor; label: string }> = [
  { value: "top", label: t("settings.appearance.lyrics.anchor.options.top") },
  { value: "center", label: t("settings.appearance.lyrics.anchor.options.center") },
  { value: "bottom", label: t("settings.appearance.lyrics.anchor.options.bottom") },
];

const anchorHint = computed(() => {
  switch (style.value.alignY) {
    case "top":
      return t("settings.appearance.lyrics.anchor.hints.top");
    case "bottom":
      return t("settings.appearance.lyrics.anchor.hints.bottom");
    default:
      return t("settings.appearance.lyrics.anchor.hints.center");
  }
});

/** 滚动速度文案：1× 为基准，越快切换行时滑得越短促 */
const scrollLabel = computed(() => `${style.value.scrollSpeed.toFixed(2).replace(/0$/, "")}×`);

/** 缓动曲线的显示文案归本页（曲线选项本身在 settings store） */
const EASING_LABEL_KEYS = {
  out: "settings.appearance.lyrics.scroll.easingOptions.out",
  inout: "settings.appearance.lyrics.scroll.easingOptions.inout",
} as const;

const easingHint = computed(() =>
  style.value.scrollEasing === "inout"
    ? t("settings.appearance.lyrics.scroll.easingHints.inout")
    : t("settings.appearance.lyrics.scroll.easingHints.out"),
);

const scaleLabel = computed(() => `${Math.round(style.value.activeScale * 100)}%`);
const blurLabel = computed(() => `${style.value.blurStrength.toFixed(1)}×`);
const dimLabel = computed(() => `${Math.round(style.value.inactiveOpacity * 100)}%`);
const glowLabel = computed(() =>
  style.value.glow <= 0 ? t("common.action.close") : style.value.glow.toFixed(1),
);
</script>

<template>
  <SettingsSection id="appearance-lyrics" :title="t('settings.appearance.lyrics.section')">
    <!-- 实时预览：放第一张卡，调任何参数都能立刻看到整体效果 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.preview.title") }}</div>
        <div class="card-description">
          {{
            t("settings.appearance.lyrics.preview.description", { scale: DESKTOP_LYRIC_FONT_SCALE })
          }}
        </div>
      </div>

      <div class="lrc-preview" :style="{ '--preview-zoom': previewZoom }">
        <div
          class="wp-lrc is-preview"
          :class="[previewClasses, `preview-anchor-${style.alignY}`]"
          :style="previewVars"
          aria-hidden="true"
        >
          <p
            v-for="(line, index) in PREVIEW_LINES"
            :key="index"
            class="wp-lrc-line"
            :class="`level-${previewLevel(index)}`"
          >
            <span class="wp-lrc-text">{{ line.text }}</span>
            <span v-if="line.translation && style.showTranslation" class="wp-lrc-translation">
              {{ line.translation }}
            </span>
          </p>
        </div>
      </div>
    </WpCard>

    <!-- 字号 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.fontSize.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.fontSize.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.fontSize"
          :Minimum="LYRICS_STYLE_RANGES.fontSize.min"
          :Maximum="LYRICS_STYLE_RANGES.fontSize.max"
          :StepFrequency="1"
          :SmallChange="1"
          :LargeChange="3"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ fontSize: value })"
        />
        <span class="slider-value">{{ style.fontSize }}px</span>
      </div>
    </WpCard>

    <!-- 对齐 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.align.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.align.description") }}
        </div>
      </div>
      <div class="seg" role="group" :aria-label="t('settings.appearance.lyrics.align.title')">
        <button
          v-for="option in ALIGN_OPTIONS"
          :key="option.value"
          type="button"
          class="seg-btn"
          :class="{ on: style.align === option.value }"
          @click="update({ align: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
    </WpCard>

    <!-- 当前行垂直位置 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.anchor.title") }}</div>
        <div class="card-description">{{ anchorHint }}</div>
      </div>
      <div class="seg" role="group" :aria-label="t('settings.appearance.lyrics.anchor.title')">
        <button
          v-for="option in ANCHOR_OPTIONS"
          :key="option.value"
          type="button"
          class="seg-btn"
          :class="{ on: style.alignY === option.value }"
          @click="update({ alignY: option.value })"
        >
          {{ option.label }}
        </button>
      </div>
    </WpCard>

    <!-- 滚动速度 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.scroll.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.scroll.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.scrollSpeed"
          :Minimum="LYRICS_STYLE_RANGES.scrollSpeed.min"
          :Maximum="LYRICS_STYLE_RANGES.scrollSpeed.max"
          :StepFrequency="0.05"
          :SmallChange="0.05"
          :LargeChange="0.25"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ scrollSpeed: value })"
        />
        <span class="slider-value">{{ scrollLabel }}</span>
      </div>

      <div class="ease-row">
        <span class="ease-label">{{ t("settings.appearance.lyrics.scroll.easingLabel") }}</span>
        <div
          class="seg"
          role="group"
          :aria-label="t('settings.appearance.lyrics.scroll.easingLabel')"
        >
          <button
            v-for="option in LYRIC_EASINGS"
            :key="option"
            type="button"
            class="seg-btn"
            :class="{ on: style.scrollEasing === option }"
            @click="update({ scrollEasing: option })"
          >
            {{ t(EASING_LABEL_KEYS[option]) }}
          </button>
        </div>
        <span class="ease-hint">{{ easingHint }}</span>
      </div>
    </WpCard>

    <!-- 字体 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.font.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.font.description", { hint: fontHint }) }}
        </div>
      </div>
      <div class="font-row">
        <ComboBox
          class="card-control"
          :ItemsSource="FONT_LABELS"
          :SelectedIndex="fontIndex"
          @SelectionChanged="onFontChange"
        />
        <input
          v-if="style.fontPreset === 'custom'"
          v-model="fontInput"
          class="font-input"
          type="text"
          :placeholder="FONT_PLACEHOLDER"
          spellcheck="false"
        />
      </div>
    </WpCard>

    <!-- 字重 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.weight.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.weight.description") }}
        </div>
      </div>
      <ComboBox
        class="card-control"
        :ItemsSource="WEIGHT_LABELS"
        :SelectedIndex="weightIndex"
        @SelectionChanged="onWeightChange"
      />
    </WpCard>

    <!-- 当前行加粗 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.activeBold.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.activeBold.description") }}
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.activeBold"
        @Toggled="(event: { IsOn: boolean }) => update({ activeBold: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <!-- 放大当前行 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.enlarge.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.enlarge.description") }}
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.enlargeActive"
        @Toggled="(event: { IsOn: boolean }) => update({ enlargeActive: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <WpCard v-if="style.enlargeActive" variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.scale.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.scale.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.activeScale"
          :Minimum="LYRICS_STYLE_RANGES.activeScale.min"
          :Maximum="LYRICS_STYLE_RANGES.activeScale.max"
          :StepFrequency="0.02"
          :SmallChange="0.02"
          :LargeChange="0.1"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ activeScale: value })"
        />
        <span class="slider-value">{{ scaleLabel }}</span>
      </div>
    </WpCard>

    <!-- 模糊 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.blur.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.blur.description") }}
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.blurInactive"
        @Toggled="(event: { IsOn: boolean }) => update({ blurInactive: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <WpCard v-if="style.blurInactive" variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.blurStrength.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.blurStrength.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.blurStrength"
          :Minimum="LYRICS_STYLE_RANGES.blurStrength.min"
          :Maximum="LYRICS_STYLE_RANGES.blurStrength.max"
          :StepFrequency="0.1"
          :SmallChange="0.1"
          :LargeChange="0.4"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ blurStrength: value })"
        />
        <span class="slider-value">{{ blurLabel }}</span>
      </div>
    </WpCard>

    <!-- 非当前行亮度 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.dim.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.dim.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.inactiveOpacity"
          :Minimum="LYRICS_STYLE_RANGES.inactiveOpacity.min"
          :Maximum="LYRICS_STYLE_RANGES.inactiveOpacity.max"
          :StepFrequency="0.01"
          :SmallChange="0.01"
          :LargeChange="0.05"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ inactiveOpacity: value })"
        />
        <span class="slider-value">{{ dimLabel }}</span>
      </div>
    </WpCard>

    <!-- 行间距 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.lineGap.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.lineGap.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.lineGap"
          :Minimum="LYRICS_STYLE_RANGES.lineGap.min"
          :Maximum="LYRICS_STYLE_RANGES.lineGap.max"
          :StepFrequency="1"
          :SmallChange="1"
          :LargeChange="4"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ lineGap: value })"
        />
        <span class="slider-value">{{ style.lineGap }}px</span>
      </div>
    </WpCard>

    <!-- 翻译 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.translation.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.translation.description") }}
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.showTranslation"
        @Toggled="(event: { IsOn: boolean }) => update({ showTranslation: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <!-- 投影 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.glow.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.glow.description") }}
        </div>
      </div>
      <div class="slider-row">
        <Slider
          class="slider"
          :Value="style.glow"
          :Minimum="LYRICS_STYLE_RANGES.glow.min"
          :Maximum="LYRICS_STYLE_RANGES.glow.max"
          :StepFrequency="0.1"
          :SmallChange="0.1"
          :LargeChange="0.5"
          :IsThumbToolTipEnabled="false"
          @update:Value="(value: number) => update({ glow: value })"
        />
        <span class="slider-value">{{ glowLabel }}</span>
      </div>
    </WpCard>

    <!-- 渐隐 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.maskFade.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.maskFade.description") }}
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.maskFade"
        @Toggled="(event: { IsOn: boolean }) => update({ maskFade: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <!-- 恢复默认 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.lyrics.reset.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.lyrics.reset.description") }}
        </div>
      </div>
      <WpButton variant="standard" class="small" @click="settings.resetLyricsStyle()">
        {{ t("common.action.restoreDefault") }}
      </WpButton>
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
/* ------------------------------ 实时预览 ------------------------------ */

/* 深色底 + 彩光模拟「封面模糊铺满」的全屏页，浅色主题下也能正确评估白字可读性 */
.lrc-preview {
  position: relative;
  margin-top: var(--space-md);
  /* 横向留白与真实播放页的 `.full-lyrics` 一致（var(--space-lg)），
     这样靠左对齐时的缩进、居中时可用宽度都能对上 */
  padding: 18px var(--space-lg);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 18% 12%, rgba(120, 150, 255, 0.55), transparent 62%),
    radial-gradient(120% 90% at 82% 88%, rgba(255, 130, 190, 0.42), transparent 60%),
    linear-gradient(160deg, #1b2036 0%, #0d1020 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

/* 预览里的歌词：高度固定，超出裁掉（真实播放页是可滚动的，这里不需要滚动）。
   高度按「五句 + 两句翻译 + 默认行距」量出来，正好让上下边缘的渐隐各吃掉半句，
   和真实播放页的观感一致；再矮就会把首尾整句切掉。
   桌面端字号放大 1.3 倍，高度按同一比例跟着长，否则首尾行会被裁掉。 */
.lrc-preview .wp-lrc {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  height: calc(340px * var(--preview-zoom, 1));
  overflow: hidden;
}

/* 预览不可点：真实行是可点的（点击跳转），这里只做视觉展示 */
.lrc-preview .wp-lrc-line {
  cursor: default;
}

/* 位置预览：靠上 / 靠下时把整块歌词推一下，方向与真实页一致（真实页靠滚动实现） */
.lrc-preview .wp-lrc.preview-anchor-top {
  padding-bottom: calc(70px * var(--preview-zoom, 1));
}

.lrc-preview .wp-lrc.preview-anchor-bottom {
  padding-top: calc(70px * var(--preview-zoom, 1));
}

/* ------------------------------ 分段按钮 ------------------------------ */

.seg {
  flex: none;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-md);
  background: var(--wp-subtle-secondary);
}

.seg-btn {
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: calc(var(--radius-md) - 2px);
  background: transparent;
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.seg-btn:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.seg-btn.on {
  background: var(--wp-accent);
  color: #fff;
}

/* 缓动曲线行：左标签 + 分段按钮 + 右侧说明 */
.ease-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  margin-top: var(--space-lg);
}

.ease-label {
  flex: none;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.ease-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
  text-align: right;
}

/* 手机：分段按钮换行占满整行。
   注意必须让 `.card-content` 也取 100% basis —— 它的全局规则是 `flex: 1 1 0%`，
   宽度 0 时「放得下」，flex-wrap 不会换行，结果就是按钮吃掉整宽、标题被挤成竖排。 */
@media (max-width: 640px) {
  /* 只影响带分段按钮的卡片，别波及其他开关卡片 */
  .settings-card:has(.seg) > .card-content {
    flex: 1 0 100%;
  }

  .seg {
    flex: 1 0 100%;
  }

  .seg-btn {
    flex: 1;
    padding: 0;
  }

  .ease-row {
    flex-wrap: wrap;
    row-gap: var(--space-sm);
  }

  .ease-hint {
    flex: 1 1 100%;
    text-align: left;
  }
}

/* ------------------------------ 滑杆 ------------------------------ */

.slider-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  margin-top: var(--space-md);
}

.slider {
  flex: 1;
  min-width: 0;
}

/* 数值固定宽度：拖动时数字抖动不会带着滑杆一起左右晃 */
.slider-value {
  flex: none;
  min-width: 52px;
  text-align: right;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--wp-text-secondary);
}

/* ------------------------------ 自定义字体 ------------------------------ */

.font-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  margin-top: var(--space-sm);
}

.font-input {
  flex: 1 1 200px;
  min-width: 0;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--wp-divider);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
  font: inherit;
  font-size: 13px;
}

.font-input:focus {
  outline: none;
  border-color: var(--wp-accent);
}
</style>
