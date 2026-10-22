<script setup lang="ts">
/**
 * WinUI 内容对话框（ContentDialog）
 *
 * 通过实例方法 ShowAsync() 打开，返回一个在关闭时兑现的 Promise，
 * 结果为 "Primary" / "Secondary" / "None"（与 XAML 的 ContentDialogResult 对齐）；
 * Hide() 可直接关闭（结果视为 "None"）。对话框渲染到 body，带遮罩、按钮区与 Esc 关闭。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import WpButton from "@/components/theme/WpButton.vue";
import { registerBackInterceptor } from "@/services/backButton";
import { useIsMobile } from "@/composables/useIsMobile";

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
const isMobile = useIsMobile();
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

/**
 * 移动端点烟层（弹窗上方的空白区域）关闭。
 * 只在移动端生效——底部面板是「贴着拇指的抽屉」，点上方灰底收起符合直觉；
 * 桌面端保持居中卡片、必须显式点按钮。
 * 判定条件与 Esc / 返回键一致：声明了关闭按钮才允许这样关，
 * 避免把没有退出口的对话框（如安装进度）误关。
 */
function onOverlayClick(): void {
  if (!isMobile) return;
  if (!props.CloseButtonText.trim()) return;
  close("None");
}

// Android 返回键：对话框开着时优先关闭它，而不是让返回键去关页面 / 退应用。
// 只在可见期间注册，且只有声明了关闭按钮的对话框才消费（与 Esc 行为一致）。
let unregisterBack: (() => void) | null = null;

watch(visible, (value) => {
  if (value) window.addEventListener("keydown", onKeydown);
  else window.removeEventListener("keydown", onKeydown);

  unregisterBack?.();
  unregisterBack = null;
  if (!value) return;
  unregisterBack = registerBackInterceptor(() => {
    if (!props.CloseButtonText.trim()) return false;
    close("None");
    return true;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  unregisterBack?.();
  unregisterBack = null;
});

defineExpose({ ShowAsync: showAsync, Hide: hide });
</script>

<template>
  <Teleport to="body">
    <transition name="wp-dialog">
      <div v-if="visible" class="wp-dialog-overlay" @click.self="onOverlayClick">
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
            <!-- 按钮走 WpButton：主题覆盖 components.Button 后，对话框按钮一起换皮 -->
            <WpButton
              v-if="props.PrimaryButtonText"
              ref="primaryRef"
              variant="accent"
              class="wp-dialog-button"
              :disabled="!props.IsPrimaryButtonEnabled"
              @click="close('Primary')"
            >
              {{ props.PrimaryButtonText }}
            </WpButton>
            <WpButton
              v-if="props.SecondaryButtonText"
              ref="secondaryRef"
              variant="standard"
              class="wp-dialog-button"
              :disabled="!props.IsSecondaryButtonEnabled"
              @click="close('Secondary')"
            >
              {{ props.SecondaryButtonText }}
            </WpButton>
            <WpButton
              v-if="props.CloseButtonText"
              ref="closeRef"
              variant="standard"
              class="wp-dialog-button"
              @click="close('None')"
            >
              {{ props.CloseButtonText }}
            </WpButton>
          </div>
        </div>
      </div>
    </transition>
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

/* 弹窗进出场（WinUI Connected 弹窗动画近似）：
   进场烟层淡入 + 面板从轻微放大回落；退场整体快速淡出并轻微上浮 */
.wp-dialog-enter-active,
.wp-dialog-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
}

.wp-dialog-enter-active .wp-content-dialog {
  transition:
    transform var(--duration-normal) var(--ease-decelerate),
    opacity var(--duration-normal) var(--ease-decelerate);
}

.wp-dialog-leave-active .wp-content-dialog {
  transition:
    transform var(--duration-fast) var(--ease-standard),
    opacity var(--duration-fast) var(--ease-standard);
}

.wp-dialog-enter-from,
.wp-dialog-leave-to {
  opacity: 0;
}

.wp-dialog-enter-from .wp-content-dialog {
  transform: scale(1.06);
  opacity: 0;
}

.wp-dialog-leave-to .wp-content-dialog {
  transform: translateY(8px) scale(1.02);
  opacity: 0;
}

/* ---------------------------------- 移动端 ---------------------------------- */
/* 对话框 teleport 到 body，命中不到 .app-shell.is-mobile 下的触摸尺寸规则，
   这里用 html.is-mobile（main.ts 挂在 <html> 上）单独兜住。
   形态也与桌面区分：贴底升起的面板，按钮铺满整行，拇指更容易够到。 */
html.is-mobile .wp-dialog-overlay {
  align-items: flex-end;
  padding: 0;
}

html.is-mobile .wp-content-dialog {
  width: 100%;
  max-width: none;
  max-height: 86vh;
  padding: var(--space-xl) var(--space-xl) calc(var(--space-lg) + var(--safe-area-bottom));
  gap: var(--space-md);
  border: none;
  border-top: 1px solid var(--wp-flyout-stroke);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--wp-flyout);
  box-shadow: var(--shadow-flyout);
}

html.is-mobile .wp-content-dialog-title {
  font-size: 18px;
  /* 标题常是歌曲名 / 歌单名，压成单行省略，避免把面板顶高 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html.is-mobile .wp-content-dialog-body {
  font-size: 15px;
  /* 键盘弹起时内容区仍可滚动 */
  -webkit-overflow-scrolling: touch;
}

/* 竖排：主按钮在上（紧跟内容），关闭按钮在最下、离拇指最近；都铺满整行 */
html.is-mobile .wp-content-dialog-buttons {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: var(--space-sm);
}

html.is-mobile .wp-dialog-button {
  width: 100%;
  height: 48px;
  justify-content: center;
  font-size: 15px;
}

/* 贴底面板改为整体上滑进入 / 下滑退出，与页面内其它底部面板一致 */
html.is-mobile .wp-dialog-enter-from .wp-content-dialog,
html.is-mobile .wp-dialog-leave-to .wp-content-dialog {
  transform: translateY(100%);
  opacity: 1;
}

html.is-mobile .wp-dialog-enter-active .wp-content-dialog {
  transition: transform var(--duration-normal) var(--ease-decelerate);
}
</style>
