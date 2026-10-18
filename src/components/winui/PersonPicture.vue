<script setup lang="ts">
/**
 * WinUI 头像（PersonPicture）
 *
 * 无图片时显示 DisplayName 首字（WinUI 的 initials 行为）。
 * 属性命名沿用 XAML 风格。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 显示名（取首字作为占位） */
    DisplayName?: string;
    /** 图片地址（可选） */
    ImageSource?: string;
    /** 宽（px） */
    Width?: number | string;
    /** 高（px） */
    Height?: number | string;
    /** 字号（px，0 表示按尺寸自适应） */
    FontSize?: number | string;
  }>(),
  { DisplayName: "", ImageSource: "", Width: 40, Height: 40, FontSize: 0 },
);

const initial = computed(() => props.DisplayName.trim().slice(0, 1) || "?");

/** 尺寸样式：圆形头像 + 自适应字号（属性可能以字符串传入，统一转数字） */
const style = computed(() => {
  const width = Number(props.Width) || 40;
  const height = Number(props.Height) || 40;
  const fontSize = Number(props.FontSize) || 0;
  return {
    width: `${width}px`,
    height: `${height}px`,
    fontSize: `${fontSize > 0 ? fontSize : Math.round(Math.min(width, height) * 0.42)}px`,
  };
});
</script>

<template>
  <span class="wp-person-picture" :style="style">
    <img v-if="props.ImageSource" class="wp-person-picture-image" :src="props.ImageSource" alt="" />
    <span v-else class="wp-person-picture-initial">{{ initial }}</span>
  </span>
</template>

<style scoped>
.wp-person-picture {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
  font-weight: 600;
  line-height: 1;
  user-select: none;
}

.wp-person-picture-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wp-person-picture-initial {
  transform: translateY(1px);
}
</style>
