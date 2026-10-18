<script setup lang="ts">
/**
 * WinUI 内容对话框（ContentDialog）
 *
 * 通过实例方法 ShowAsync() 打开，返回一个在关闭时兑现的 Promise，
 * 结果为 "Primary" / "Secondary" / "None"（与 XAML 的 ContentDialogResult 对齐）；
 * Hide() 可直接关闭（结果视为 "None"）。对话框渲染到 body，带遮罩、按钮区与 Esc 关闭。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** 标题 */
    Title?: string;
    /** 正文（纯文本；复杂内容用默认插槽） */
    Content?: string;
    /** 主按钮文字（空则不显示） */
    PrimaryButtonText?: string;
    /** 次按钮文字（空则不显示） */
    SecondaryButtonText?: string;
    /** 关闭按钮文字（空则不显示，且不响应 Esc） */
    CloseButtonText?: string;
    /** 主按钮是否可用 */
    IsPrimaryButtonEnabled?: boolean;
    /** 次按钮是否可用 */
    IsSecondaryButtonEnabled?: boolean;
    /** 回车默认触发的按钮 */
    DefaultButton?: "None" | "Primary" | "Secondary" | "Close";
  }>(),
  {
    Title: "",
    Content: "",
    PrimaryButtonText: "",
    SecondaryButtonText: "",
    CloseButtonText: "",
    IsPrimaryButtonEnabled: true,
    IsSecondaryButtonEnabled: true,
    DefaultButton: "Primary",
  },
);

const visible = ref(false);
const dialogRef = ref<HTMLElement | null>(null);
const primaryRef = ref<HTMLButtonElement | null>(null);
const secondaryRef = ref<HTMLButtonElement | null>(null);
const closeRef = ref<HTMLButtonElement | null>(null);

/** 所有等待中的 ShowAsync 调用（同一对话框重复打开时一并兑现） */
const resolvers: Array<(result: string) => void> = [];

function showAsync(): Promise<string> {
  return new Promise<string>((resolve) => {
    resolvers.push(resolve);
    visible.value = true;
    void nextTick(focusDefaultButton);
  });
}

function close(result: string): void {
  if (!visible.value) return;
  visible.value = false;
  const pending = resolvers.splice(0, resolvers.length);
  for (const resolve of pending) resolve(result);
}

function hide(): void {
  close("None");
}

function focusDefaultButton(): void {
  const target =
    props.DefaultButton === "Secondary"
      ? secondaryRef.value
      : props.DefaultButton === "Close"
        ? closeRef.value
        : primaryRef.value;
  (target ?? dialogRef.value)?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && props.CloseButtonText.trim()) {
    event.preventDefault();
    close("None");
  }
}

watch(visible, (value) => {
  if (value) window.addEventListener("keydown", onKeydown);
  else window.removeEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

defineExpose({ ShowAsync: showAsync, Hide: hide });
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="wp-dialog-overlay">
      <div
        ref="dialogRef"
        class="wp-content-dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <h2 v-if="props.Title" class="wp-content-dialog-title">{{ props.Title }}</h2>

        <div class="wp-content-dialog-body">
          <p v-if="props.Content" class="wp-content-dialog-text">{{ props.Content }}</p>
          <slot />
        </div>

        <div
          v-if="props.PrimaryButtonText || props.SecondaryButtonText || props.CloseButtonText"
          class="wp-content-dialog-buttons"
        >
          <button
            v-if="props.PrimaryButtonText"
            ref="primaryRef"
            class="wp-accent-button wp-dialog-button"
            :disabled="!props.IsPrimaryButtonEnabled"
            @click="close('Primary')"
          >
            {{ props.PrimaryButtonText }}
          </button>
          <button
            v-if="props.SecondaryButtonText"
            ref="secondaryRef"
            class="wp-standard-button wp-dialog-button"
            :disabled="!props.IsSecondaryButtonEnabled"
            @click="close('Secondary')"
          >
            {{ props.SecondaryButtonText }}
          </button>
          <button
            v-if="props.CloseButtonText"
            ref="closeRef"
            class="wp-standard-button wp-dialog-button"
            @click="close('None')"
          >
            {{ props.CloseButtonText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl);
  background: rgba(0, 0, 0, 0.3);
  animation: wp-dialog-overlay-in var(--duration-fast) var(--ease-standard);
}

.wp-content-dialog {
  display: flex;
  flex-direction: column;
  width: min(548px, 100%);
  max-height: min(80vh, 640px);
  padding: var(--space-2xl);
  gap: var(--space-lg);
  background: var(--wp-flyout);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-flyout);
  outline: none;
  animation: wp-dialog-in var(--duration-normal) var(--ease-decelerate);
}

.wp-content-dialog-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--wp-text-primary);
}

.wp-content-dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  color: var(--wp-text-primary);
  font-size: 14px;
  line-height: 1.6;
}

.wp-content-dialog-text {
  margin: 0;
}

.wp-content-dialog-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-md);
  flex: none;
}

.wp-dialog-button {
  flex: none;
}

@keyframes wp-dialog-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes wp-dialog-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
