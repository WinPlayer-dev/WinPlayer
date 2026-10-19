<script setup lang="ts">
/**
 * 主题背景层（壁纸 / 滤镜 / 噪点 / 暗角）。
 *
 * 渲染在应用最底层（`z-index: -1`，由 .app-shell 建立层叠上下文），
 * 只读取主题清单里的 `appearance`；没有主题或主题没配壁纸时不渲染任何节点，
 * 因此默认外观零成本、零影响。
 *
 * 所有参数都通过 CSS 变量传给样式，切换主题时只需改变量，不重建 DOM。
 */

import { computed } from "vue";
import { useThemesStore } from "@/stores/themes";

const themes = useThemesStore();

const appearance = computed(() => themes.appearance);

const wallpaper = computed(() => {
  const path = appearance.value?.wallpaper;
  if (!path) return "";
  return themes.resolveAsset(path) ?? "";
});

const visible = computed(() => Boolean(wallpaper.value) || Boolean(appearance.value?.overlay));

/** 噪点用内联 SVG 生成（不额外请求资源，可任意缩放） */
const NOISE_URL = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="160" height="160" filter="url(#n)" opacity="0.55"/></svg>`,
)}")`;

const layerStyle = computed(() => {
  const config = appearance.value ?? {};
  const cssVars: Record<string, string> = {
    "--theme-wallpaper": wallpaper.value ? `url("${wallpaper.value}")` : "none",
    "--theme-wallpaper-blur": `${Math.max(0, config.wallpaperBlur ?? 0)}px`,
    "--theme-wallpaper-opacity": String(clamp(config.wallpaperOpacity ?? 1, 0, 1)),
    "--theme-wallpaper-size": config.wallpaperSize ?? "cover",
    "--theme-wallpaper-blend": config.wallpaperBlend ?? "normal",
    "--theme-noise": config.noise ? NOISE_URL : "none",
    "--theme-noise-opacity": String(clamp(config.noise ?? 0, 0, 1)),
    "--theme-vignette-opacity": String(clamp(config.vignette ?? 0, 0, 1)),
    "--theme-overlay": config.overlay ?? "none",
  };
  return cssVars;
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
</script>

<template>
  <div v-if="visible" class="theme-backdrop" :style="layerStyle" aria-hidden="true">
    <div class="theme-wallpaper" />
    <div class="theme-overlay" />
    <div class="theme-vignette" />
    <div class="theme-noise" />
  </div>
</template>

<style scoped>
.theme-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}

/* 壁纸层：放大一点，避免模糊时边缘透出底色 */
.theme-wallpaper {
  position: absolute;
  inset: -8%;
  background-image: var(--theme-wallpaper);
  background-size: var(--theme-wallpaper-size);
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(var(--theme-wallpaper-blur));
  opacity: var(--theme-wallpaper-opacity);
  mix-blend-mode: var(--theme-wallpaper-blend);
  transition:
    opacity var(--duration-slow) var(--ease-standard),
    filter var(--duration-slow) var(--ease-standard);
}

.theme-overlay {
  position: absolute;
  inset: 0;
  background: var(--theme-overlay);
}

/* 暗角：四周压暗，让中心内容更聚焦 */
.theme-vignette {
  position: absolute;
  inset: 0;
  opacity: var(--theme-vignette-opacity);
  background: radial-gradient(
    120% 90% at 50% 40%,
    transparent 35%,
    rgba(0, 0, 0, 0.55) 100%
  );
}

.theme-noise {
  position: absolute;
  inset: 0;
  background-image: var(--theme-noise);
  background-size: 160px 160px;
  opacity: var(--theme-noise-opacity);
  mix-blend-mode: overlay;
}
</style>
