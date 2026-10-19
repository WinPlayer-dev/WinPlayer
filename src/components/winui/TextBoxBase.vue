<script setup lang="ts">
/**
 * WinUI 输入框（TextBox）
 *
 * 视觉对齐 WinUI 3：控件填充色背景、底部描边，聚焦时底部换成强调色
 * （用 inset 阴影叠出 2px 效果，避免改边框宽度导致文字跳动）。
 * 属性 / 事件命名沿用 XAML 风格，双向绑定为 Text / update:Text。
 */
const props = withDefaults(
  defineProps<{
    /** 文本值 */
    Text?: string;
    /** 占位文字 */
    PlaceholderText?: string;
    /** 最大字数（0 表示不限） */
    MaxLength?: number;
    /** 是否只读 */
    IsReadOnly?: boolean;
    /** 是否可用 */
    IsEnabled?: boolean;
  }>(),
  { Text: "", PlaceholderText: "", MaxLength: 0, IsReadOnly: false, IsEnabled: true },
);

const emit = defineEmits<{ "update:Text": [value: string] }>();

function onInput(event: Event): void {
  emit("update:Text", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="wp-text-box" :class="{ 'is-disabled': !props.IsEnabled }">
    <input
      class="wp-text-box-input"
      type="text"
      :value="props.Text"
      :placeholder="props.PlaceholderText"
      :maxlength="props.MaxLength > 0 ? props.MaxLength : undefined"
      :readonly="props.IsReadOnly"
      :disabled="!props.IsEnabled"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
/**
 * 输入框的尺寸 / 圆角走 --input-* 令牌，主题改令牌即可整体换形状；
 * 若要换结构（例如 MD3 的填充式 + 浮动标签），
 * 主题可以覆盖 components.TextBox（见 docs/THEME-DEVELOPMENT.md）。
 */
.wp-text-box {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--input-height);
  padding: 0 var(--input-padding-x);
  background: var(--wp-control-fill);
  border: 1px solid transparent;
  border-bottom-color: var(--wp-control-stroke-secondary);
  border-radius: var(--input-radius);
  transition: background var(--duration-fast) var(--ease-standard);
}

.wp-text-box:hover:not(.is-disabled) {
  background: var(--wp-card-hover);
}

.wp-text-box:focus-within {
  background: var(--wp-layer-solid);
  border-bottom-color: var(--wp-accent);
  box-shadow: inset 0 -1px 0 0 var(--wp-accent);
}

.wp-text-box.is-disabled {
  background: var(--wp-control-fill-secondary);
}

.wp-text-box-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text-primary);
  font-family: inherit;
  font-size: 14px;
  user-select: text;
}

.wp-text-box-input::placeholder {
  color: var(--wp-text-secondary);
}

.wp-text-box-input:disabled {
  color: var(--wp-text-disabled);
  cursor: default;
}
</style>
