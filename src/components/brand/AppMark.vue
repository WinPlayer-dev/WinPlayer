<script setup lang="ts">
/**
 * WinPlayer 品牌图标（播放三角 + Windows 四格 + 运动线）。
 *
 * 造型与 `src-tauri/icons/icon.png` 一致，但用 SVG 内联实现并填**主题强调色渐变**，
 * 因此换肤 / 亮暗主题切换时会自动跟着变；PNG 只能是一份固定的黑色图。
 *
 * 唯一真源：首次引导页（WelcomeView）与设置 → 关于页的 Hero 共用这一份，
 * 不要再各写一段 SVG。
 *
 * 尺寸由父容器决定（组件铺满父级宽高），调用方用 width / height 控制。
 */
import { useId } from "vue";

withDefaults(defineProps<{ label?: string }>(), { label: "WinPlayer" });

/** 渐变与 mask 的 id 必须全局唯一：同页出现两个实例时 id 冲突会让后一个变成纯黑 */
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
const gradientId = `wp-app-mark-grad-${uid}`;
const maskId = `wp-app-mark-mask-${uid}`;
</script>

<template>
  <svg class="app-mark" viewBox="0 0 1024 1024" role="img" :aria-label="label">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--wp-accent-hover)" />
        <stop offset="100%" stop-color="var(--wp-accent)" />
      </linearGradient>
      <!-- mask 里白色为保留、黑色为镂空：四格窗就是挖出来的 -->
      <mask :id="maskId">
        <polygon
          points="285,270 285,755 700,512"
          fill="#fff"
          stroke="#fff"
          stroke-width="120"
          stroke-linejoin="round"
        />
        <line
          x1="545"
          y1="762"
          x2="812"
          y2="616"
          stroke="#fff"
          stroke-width="86"
          stroke-linecap="round"
        />
        <rect x="330" y="406" width="92" height="92" rx="6" fill="#000" />
        <rect x="432" y="406" width="92" height="92" rx="6" fill="#000" />
        <rect x="330" y="508" width="92" height="92" rx="6" fill="#000" />
        <rect x="432" y="508" width="92" height="92" rx="6" fill="#000" />
      </mask>
    </defs>
    <rect width="1024" height="1024" :fill="`url(#${gradientId})`" :mask="`url(#${maskId})`" />
  </svg>
</template>

<style scoped>
.app-mark {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
