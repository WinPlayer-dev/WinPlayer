<script setup lang="ts">
/**
 * 设置 → 外观 → 歌词样式（手机端专属）。
 *
 * 管的只有一件事：手机「正在播放」全屏页里那屏歌词长什么样 ——
 * 字号、对齐、字体、字重、当前行是否放大 / 加粗、非当前行是否模糊与压暗、
 * 行距、翻译副行、投影、上下边缘渐隐。
 *
 * 两个设计取舍：
 * 1. 顶部先给一块**实时预览**。这些参数互相影响（放大 + 模糊 + 行距叠在一起
 *    很容易难看），只靠文字描述根本调不准，所以预览必须放在第一张卡；
 * 2. 预览和真实播放页共用 `styles/lyrics-style.css` 与同一组 `--lrc-*` 变量，
 *    不另写一套「示意样式」，避免预览好看、实际不一样。
 *
 * 桌面端不渲染本分组：它只作用于手机全屏页，桌面播放条歌词面板与桌面歌词窗口
 * 各有独立外观设置。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ComboBox, Slider, ToggleSwitch } from "@/components/winui";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import {
  LYRICS_FONT_WEIGHTS,
  LYRICS_STYLE_RANGES,
  useSettingsStore,
  type LyricAlign,
  type LyricFontPreset,
} from "@/stores/settings";
import { LYRIC_FONT_OPTIONS, lyricStyleClasses, lyricStyleVars } from "@/services/lyricStyle";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";

const settings = useSettingsStore();

/** 当前配置的简写，模板里少写几层 */
const style = computed(() => settings.lyricsStyle);

const previewVars = computed(() => lyricStyleVars(style.value));
const previewClasses = computed(() => lyricStyleClasses(style.value));

/** 预览歌词：故意留一句长句与两句带翻译，能看出折行、对齐与副行效果 */
const PREVIEW_LINES: ReadonlyArray<{ text: string; translation: string }> = [
  { text: "雨落下的声音", translation: "" },
  { text: "把整座城市泡成一片模糊的蓝", translation: "The rain dissolves the city into blue" },
  { text: "我在便利店门口站了很久", translation: "I waited outside the store" },
  { text: "等一句不会再来的晚安", translation: "" },
  { text: "雨停之前", translation: "Before the rain stops" },
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

const FONT_LABELS = LYRIC_FONT_OPTIONS.map((option) => option.label);
const fontIndex = computed(() =>
  Math.max(
    0,
    LYRIC_FONT_OPTIONS.findIndex((option) => option.value === style.value.fontPreset),
  ),
);

function onFontChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = LYRIC_FONT_OPTIONS.find((entry) => entry.label === label);
  if (!option || option.value === style.value.fontPreset) return;
  update({ fontPreset: option.value as LyricFontPreset });
}

const ALIGN_LABELS = ["居中", "靠左"];
const alignIndex = computed(() => (style.value.align === "left" ? 1 : 0));

function onAlignChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const align: LyricAlign = label === "靠左" ? "left" : "center";
  if (align !== style.value.align) update({ align });
}

const WEIGHT_LABELS = ["细", "常规", "中等", "半粗", "粗"];
const weightIndex = computed(() =>
  Math.max(0, LYRICS_FONT_WEIGHTS.indexOf(style.value.fontWeight)),
);

function onWeightChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const index = WEIGHT_LABELS.indexOf(String(payload?.AddedItems?.[0] ?? ""));
  if (index >= 0) update({ fontWeight: LYRICS_FONT_WEIGHTS[index] });
}

/** 下拉选中的字体预设对应的说明（展示在卡片描述里） */
const fontHint = computed(
  () =>
    LYRIC_FONT_OPTIONS.find((option) => option.value === style.value.fontPreset)?.hint ?? "",
);

/* ------------------------------ 自定义字体 ------------------------------ */

const FONT_PLACEHOLDER = '如 "Noto Serif SC" 或 "HarmonyOS Sans SC"';

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

const scaleLabel = computed(() => `${Math.round(style.value.activeScale * 100)}%`);
const blurLabel = computed(() => `${style.value.blurStrength.toFixed(1)}×`);
const dimLabel = computed(() => `${Math.round(style.value.inactiveOpacity * 100)}%`);
const glowLabel = computed(() =>
  style.value.glow <= 0 ? "关闭" : style.value.glow.toFixed(1),
);
</script>

<template>
  <SettingsSection id="appearance-lyrics" title="歌词样式">
    <!-- 实时预览：放第一张卡，调任何参数都能立刻看到整体效果 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">实时预览</div>
        <div class="card-description">
          手机「正在播放」全屏页的歌词效果；下面的设置会立即反映到这里，下一首歌 / 下次打开播放页同样生效
        </div>
      </div>

      <div class="lrc-preview">
        <div
          class="wp-lrc is-preview"
          :class="previewClasses"
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
        <div class="card-header">歌词字号</div>
        <div class="card-description">常规行的字号，当前行按下面的比例放大或保持不变</div>
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
        <div class="card-header">对齐方式</div>
        <div class="card-description">
          居中适合短句独白，靠左适合长句与说唱；翻译副行跟随同一方向
        </div>
      </div>
      <ComboBox
        class="card-control"
        :ItemsSource="ALIGN_LABELS"
        :SelectedIndex="alignIndex"
        @SelectionChanged="onAlignChange"
      />
    </WpCard>

    <!-- 字体 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">歌词字体</div>
        <div class="card-description">{{ fontHint }}；只作用于歌词，不改界面字体</div>
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
        <div class="card-header">文字粗细</div>
        <div class="card-description">
          所有歌词行的基础字重；系统缺少该字重时会就近取用（细 / 常规 / 中等 / 半粗 / 粗）
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
        <div class="card-header">当前行加粗</div>
        <div class="card-description">让正在播放的那一句用更重的字重突出（比常规字重至少加粗 300）</div>
      </div>
      <ToggleSwitch
        :IsOn="style.activeBold"
        @Toggled="(event: { IsOn: boolean }) => update({ activeBold: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <!-- 放大当前行 -->
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">放大当前行</div>
        <div class="card-description">关闭后所有行一样大，只靠亮度区分当前行，适合喜欢安静排版的人</div>
      </div>
      <ToggleSwitch
        :IsOn="style.enlargeActive"
        @Toggled="(event: { IsOn: boolean }) => update({ enlargeActive: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <WpCard v-if="style.enlargeActive" variant="column">
      <div class="card-content">
        <div class="card-header">放大比例</div>
        <div class="card-description">当前行相对常规行的倍数；100% 等于不放大</div>
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
        <div class="card-header">模糊非当前行</div>
        <div class="card-description">
          距离当前行越远越模糊，模拟视线焦点；关闭后仍然按亮度分层，不会整屏一样亮
        </div>
      </div>
      <ToggleSwitch
        :IsOn="style.blurInactive"
        @Toggled="(event: { IsOn: boolean }) => update({ blurInactive: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <WpCard v-if="style.blurInactive" variant="column">
      <div class="card-content">
        <div class="card-header">模糊强度</div>
        <div class="card-description">1× 是默认手感；调高会形成「只有当前句清晰」的强焦点效果</div>
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
        <div class="card-header">非当前行亮度</div>
        <div class="card-description">
          紧邻当前行那一句的不透明度，越远的行按比例更淡；调低会让焦点更集中
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
        <div class="card-header">行间距</div>
        <div class="card-description">
          每行歌词上下的留白；调大后一屏能看到的行数变少，但每句更透气
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
        <div class="card-header">显示翻译</div>
        <div class="card-description">有翻译的歌词在原文下方显示小字副行；关闭后只显示原文</div>
      </div>
      <ToggleSwitch
        :IsOn="style.showTranslation"
        @Toggled="(event: { IsOn: boolean }) => update({ showTranslation: Boolean(event?.IsOn) })"
      />
    </WpCard>

    <!-- 投影 -->
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">当前行投影</div>
        <div class="card-description">
          给正在播放的一句加柔和投影，压在亮色封面上也能看清；调到 0 则完全不加
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
        <div class="card-header">上下边缘渐隐</div>
        <div class="card-description">
          歌词在歌词区上下边缘淡入淡出；关闭后是一块干净的裁切边缘
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
        <div class="card-header">恢复默认</div>
        <div class="card-description">把上面所有选项恢复成初始外观，不影响歌词来源、偏移与其他设置</div>
      </div>
      <WpButton variant="standard" class="small" @click="settings.resetLyricsStyle()">恢复默认</WpButton>
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
   和真实播放页的观感一致；再矮就会把首尾整句切掉。 */
.lrc-preview .wp-lrc {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  height: 340px;
  overflow: hidden;
}

/* 预览不可点：真实行是可点的（点击跳转），这里只做视觉展示 */
.lrc-preview .wp-lrc-line {
  cursor: default;
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
