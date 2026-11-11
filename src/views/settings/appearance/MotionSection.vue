<script setup lang="ts">
/**
 * 设置 → 外观 → 动效。
 *
 * 开关只做一件事：给 <html> 挂 `.spring-motion`（样式见 styles/motion.css），
 * 把全站的 `--ease-*` 令牌换成带回弹的曲线——按钮、卡片、弹层、页面切换一起变手感。
 * 「回弹幅度」滑杆控制曲线的过冲幅度：拖动时立即写 CSS 变量预览，落库防抖。
 *
 * 预览条和真实组件吃的是同一套令牌，所以这里看到的手感就是全站的手感。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Slider, ToggleSwitch } from "@/components/winui";
import {
  SPRING_STRENGTH_MAX,
  SPRING_STRENGTH_MIN,
  useSettingsStore,
} from "@/stores/settings";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();

const strengthLabel = computed(() => {
  const value = settings.springStrength;
  if (value < 1.4) return t("settings.appearance.motion.strength.options.subtle");
  if (value < 1.7) return t("settings.appearance.motion.strength.options.medium");
  if (value < 1.86) return t("settings.appearance.motion.strength.options.strong");
  return t("settings.appearance.motion.strength.options.extreme");
});

/* ------------------------------ 实时预览 ------------------------------ */

/** 每次加一：作为圆点的 key，重建元素就能让入场动画重播 */
const demoRun = ref(0);

let saveTimer = 0;

function replayDemo(): void {
  demoRun.value += 1;
}

function onSpringToggle(event: { IsOn: boolean }): void {
  void settings.setSpringMotion(Boolean(event?.IsOn));
}

function onStrengthInput(value: number): void {
  settings.previewSpringStrength(value);
  replayDemo();
  // 拖动过程中只改样式，停手 300ms 再落库，避免每个像素写一次数据库
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void settings.setSpringStrength(settings.springStrength), 300);
}

// 开关状态变化（含从其他入口改回来）时放一遍预览，让用户看清影响的是什么
watch(
  () => settings.springMotion,
  () => replayDemo(),
);

onBeforeUnmount(() => window.clearTimeout(saveTimer));</script>

<template>
  <SettingsSection id="appearance-motion" :title="t('settings.appearance.motion.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.motion.spring.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.motion.spring.description") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.springMotion" @Toggled="onSpringToggle" />
    </WpCard>

    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.appearance.motion.strength.title") }}</div>
        <div class="card-description">
          {{ t("settings.appearance.motion.strength.description") }}
        </div>
      </div>
      <div class="motion-row">
        <Slider
          class="motion-slider"
          :Value="settings.springStrength"
          :Minimum="SPRING_STRENGTH_MIN"
          :Maximum="SPRING_STRENGTH_MAX"
          :StepFrequency="0.05"
          :SmallChange="0.05"
          :LargeChange="0.25"
          :IsEnabled="settings.springMotion"
          :IsThumbToolTipEnabled="false"
          @update:Value="onStrengthInput"
        />
        <span class="motion-value">{{ strengthLabel }}</span>
      </div>

      <button
        class="motion-demo"
        :class="{ muted: !settings.springMotion }"
        type="button"
        :title="
          settings.springMotion
            ? t('settings.appearance.motion.demo.replay')
            : t('settings.appearance.motion.demo.disabledHint')
        "
        @click="replayDemo"
      >
        <span class="demo-track">
          <span :key="demoRun" class="demo-dot" />
        </span>
        <span class="demo-caption">{{ t("settings.appearance.motion.demo.replay") }}</span>
      </button>
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
/* ------------------------------ 幅度滑杆 ------------------------------ */

.motion-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
}

.motion-slider {
  flex: 1;
  min-width: 0;
}

.motion-value {
  flex: none;
  min-width: 40px;
  text-align: right;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* ------------------------------ 手感预览 ------------------------------ */
/* 轨道留出的余量刚好接住最大幅度（约 23%）的过冲，冲出去也不会压到右侧文字 */

.motion-demo {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  margin-top: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-md);
  background: var(--wp-subtle-secondary);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard);
}

.motion-demo:hover {
  background: var(--wp-card-hover);
}

.demo-track {
  position: relative;
  flex: none;
  width: 200px;
  height: 8px;
  border-radius: 4px;
  background: var(--wp-control-stroke-secondary);
}

.demo-dot {
  position: absolute;
  top: 50%;
  left: 0;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 50%;
  background: var(--wp-accent);
  animation: motion-demo-run 520ms var(--ease-decelerate) both;
}

/* 关闭弹簧时曲线是单调的，预览会正常停在终点；开启后同一个动画会冲过头再落回 */
@keyframes motion-demo-run {
  from {
    transform: translateX(0) scale(0.8);
  }
  to {
    transform: translateX(150px) scale(1);
  }
}

.demo-caption {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.motion-demo.muted .demo-dot {
  background: var(--wp-text-disabled);
}

@media (max-width: 520px) {
  .motion-demo {
    flex-wrap: wrap;
    row-gap: var(--space-sm);
  }
}
</style>
