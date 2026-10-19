<script setup lang="ts">
/**
 * WinUI 数字输入框（NumberBox）
 *
 * 左侧文本输入 + 右侧上下微调按钮，外观与 TextBox 对齐。
 * 属性 / 事件命名沿用 XAML 风格：Value / update:Value。
 */
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** 当前值 */
    Value?: number;
    /** 最小值 */
    Minimum?: number;
    /** 最大值 */
    Maximum?: number;
    /** 微调步长 */
    SmallChange?: number;
    /** 占位文字 */
    PlaceholderText?: string;
    /** 是否可用 */
    IsEnabled?: boolean;
  }>(),
  {
    Value: 0,
    Minimum: -Infinity,
    Maximum: Infinity,
    SmallChange: 1,
    PlaceholderText: "",
    IsEnabled: true,
  },
);

const emit = defineEmits<{ "update:Value": [value: number] }>();

const inputRef = ref<HTMLInputElement | null>(null);
/** 编辑中的文本（未聚焦时与 Value 保持同步） */
const text = ref(String(props.Value ?? 0));

watch(
  () => props.Value,
  (value) => {
    if (document.activeElement === inputRef.value) return;
    text.value = String(value ?? 0);
  },
);

function clamp(value: number): number {
  return Math.min(props.Maximum, Math.max(props.Minimum, value));
}

function commit(value: number): void {
  const next = clamp(value);
  text.value = String(next);
  if (next !== props.Value) emit("update:Value", next);
}

function onInput(event: Event): void {
  text.value = (event.target as HTMLInputElement).value;
  const parsed = Number(text.value);
  if (text.value.trim() !== "" && Number.isFinite(parsed)) emit("update:Value", clamp(parsed));
}

function onBlur(): void {
  const parsed = Number(text.value);
  commit(Number.isFinite(parsed) ? parsed : props.Value);
}

function step(delta: number): void {
  if (!props.IsEnabled) return;
  commit((Number.isFinite(props.Value) ? props.Value : 0) + delta);
}
</script>

<template>
  <div class="wp-number-box" :class="{ 'is-disabled': !props.IsEnabled }">
    <input
      ref="inputRef"
      class="wp-number-box-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :value="text"
      :placeholder="props.PlaceholderText"
      :disabled="!props.IsEnabled"
      @input="onInput"
      @blur="onBlur"
      @keydown.up.prevent="step(props.SmallChange)"
      @keydown.down.prevent="step(-props.SmallChange)"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    />
    <span class="wp-number-box-spinners">
      <button
        type="button"
        class="wp-number-box-spinner"
        tabindex="-1"
        :disabled="!props.IsEnabled"
        @click="step(props.SmallChange)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 7.5 6 4 9.5 7.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button
        type="button"
        class="wp-number-box-spinner"
        tabindex="-1"
        :disabled="!props.IsEnabled"
        @click="step(-props.SmallChange)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8 9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </span>
  </div>
</template>

<style scoped>
.wp-number-box {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 32px;
  background: var(--wp-control-fill);
  border: 1px solid transparent;
  border-bottom-color: var(--wp-control-stroke-secondary);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}

.wp-number-box:hover:not(.is-disabled) {
  background: var(--wp-card-hover);
}

.wp-number-box:focus-within {
  background: var(--wp-layer-solid);
  border-bottom-color: var(--wp-accent);
  box-shadow: inset 0 -1px 0 0 var(--wp-accent);
}

.wp-number-box.is-disabled {
  background: var(--wp-control-fill-secondary);
}

.wp-number-box-input {
  flex: 1;
  min-width: 0;
  padding: 0 var(--space-lg);
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text-primary);
  font-family: inherit;
  font-size: 14px;
  user-select: text;
}

.wp-number-box-input::placeholder {
  color: var(--wp-text-secondary);
}

.wp-number-box-spinners {
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-right: 2px;
}

.wp-number-box-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 13px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  cursor: pointer;
}

.wp-number-box-spinner svg {
  width: 12px;
  height: 12px;
}

.wp-number-box-spinner:hover:not(:disabled) {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.wp-number-box-spinner:disabled {
  color: var(--wp-text-disabled);
  cursor: default;
}
</style>
