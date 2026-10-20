<script setup lang="ts">
/**
 * 快捷键设置：录制 / 清除可配置动作的按键绑定，并支持恢复默认。
 *
 * 两个区块：
 * - 应用内快捷键：窗口聚焦时生效；
 * - 系统级全局快捷键：任意应用中生效（桌面端），可整体开关，注册结果会如实回显
 *   （被其他程序占用时会标红提示）。
 *
 * 空格「播放 / 暂停」为内置不可设置的应用内快捷键，不在本页展示。
 */
import { onBeforeUnmount, ref } from "vue";
import { ToggleSwitch } from "@/components/winui";
import { useIsMobile } from "@/composables/useIsMobile";
import { bindingFromEvent, formatBinding } from "@/services/shortcuts";
import { useShortcutsStore } from "@/stores/shortcuts";
import {
  GLOBAL_SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS,
  type GlobalShortcutActionId,
  type ShortcutActionId,
} from "@/types/shortcut";
import WpCard from "@/components/theme/WpCard.vue";
import WpButton from "@/components/theme/WpButton.vue";

const shortcuts = useShortcutsStore();
/** 全局快捷键仅在桌面端有意义（移动端没有系统热键） */
const isMobile = useIsMobile();

/** 正在录制的动作 ID（null 表示未录制） */
const recordingId = ref<ShortcutActionId | null>(null);
/** 正在录制的全局动作 ID */
const recordingGlobalId = ref<GlobalShortcutActionId | null>(null);

/** 全局区块的整体开关 */
function onGlobalToggle(event: { IsOn: boolean }): void {
  void shortcuts.setGlobalEnabled(Boolean(event?.IsOn));
}

/** 全局动作的按键框文本 */
function displayForGlobal(id: GlobalShortcutActionId): string {
  if (recordingGlobalId.value === id) return "请按下组合键…";
  return formatBinding(shortcuts.globalBindings[id]) || "未设置";
}

/** 全局动作的注册状态提示：生效 / 被占用 */
function statusTextFor(id: GlobalShortcutActionId): string {
  const status = shortcuts.statusFor(id);
  if (!status) return "";
  return status.registered ? "已生效" : (status.error ?? "注册失败");
}

function isStatusError(id: GlobalShortcutActionId): boolean {
  const status = shortcuts.statusFor(id);
  return Boolean(status && !status.registered);
}

function startGlobalRecording(id: GlobalShortcutActionId): void {
  if (recordingGlobalId.value === id) return;
  recordingGlobalId.value = id;
  shortcuts.setCapturing(true);
}

function finishGlobalRecording(event?: KeyboardEvent): void {
  recordingGlobalId.value = null;
  shortcuts.setCapturing(false);
  const el = event?.currentTarget;
  if (el instanceof HTMLElement) el.blur();
}

function onGlobalRecorderBlur(id: GlobalShortcutActionId): void {
  if (recordingGlobalId.value === id) finishGlobalRecording();
}

function onGlobalRecorderKeydown(event: KeyboardEvent, id: GlobalShortcutActionId): void {
  if (recordingGlobalId.value !== id) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    finishGlobalRecording(event);
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    void shortcuts.clearGlobalBinding(id);
    finishGlobalRecording(event);
    return;
  }

  const binding = bindingFromEvent(event);
  if (!binding) return;
  // 全局热键必须是「修饰键 + 普通键」：单键会在任意应用里抢输入
  if (!binding.ctrl && !binding.alt && !binding.shift && !binding.meta) {
    return;
  }
  void shortcuts.setGlobalBinding(id, binding);
  finishGlobalRecording(event);
}

function clearGlobalBinding(id: GlobalShortcutActionId): void {
  if (recordingGlobalId.value === id) finishGlobalRecording();
  void shortcuts.clearGlobalBinding(id);
}

function resetGlobalDefaults(): void {
  finishGlobalRecording();
  void shortcuts.resetGlobalDefaults();
}

/** 按键框显示文本：录制中提示、已绑定显示组合键、未绑定显示占位 */
function displayFor(id: ShortcutActionId): string {
  if (recordingId.value === id) return "请按下组合键…";
  return formatBinding(shortcuts.bindings[id]) || "未设置";
}

function startRecording(id: ShortcutActionId): void {
  if (recordingId.value === id) return;
  recordingId.value = id;
  shortcuts.setCapturing(true);
}

/** 结束录制并移开焦点，避免后续按键被误当作绑定 */
function finishRecording(event?: KeyboardEvent): void {
  // 先复位状态：随后 blur 触发的 onRecorderBlur 会直接返回
  recordingId.value = null;
  shortcuts.setCapturing(false);
  const el = event?.currentTarget;
  if (el instanceof HTMLElement) el.blur();
}

function onRecorderBlur(id: ShortcutActionId): void {
  if (recordingId.value === id) finishRecording();
}

function onRecorderKeydown(event: KeyboardEvent, id: ShortcutActionId): void {
  if (recordingId.value !== id) return;
  // 录制期间独占按键：阻止滚动 / 按钮激活，并阻止冒泡到全局快捷键处理
  event.preventDefault();
  event.stopPropagation();

  // Esc 取消录制（保留原绑定）
  if (event.key === "Escape") {
    finishRecording(event);
    return;
  }
  // 退格 / 删除快速清除绑定
  if (event.key === "Backspace" || event.key === "Delete") {
    void shortcuts.clearBinding(id);
    finishRecording(event);
    return;
  }

  const binding = bindingFromEvent(event);
  if (!binding) return; // 仅按修饰键：继续等待

  void shortcuts.setBinding(id, binding);
  finishRecording(event);
}

function clearBinding(id: ShortcutActionId): void {
  if (recordingId.value === id) finishRecording();
  void shortcuts.clearBinding(id);
}

function resetDefaults(): void {
  finishRecording();
  void shortcuts.resetToDefaults();
}

// 切换设置分类 / 离开页面时退出录制态
onBeforeUnmount(() => {
  finishRecording();
  finishGlobalRecording();
});
</script>

<template>
  <div>
    <section class="settings-section">
      <h2 class="settings-section-title">快捷键</h2>
      <p class="shortcut-hint">
        点击右侧按键框后按下想要的组合键即可录制；录制时按 Esc 取消，按 Backspace / Delete 清除绑定。
        快捷键仅在应用窗口处于前台时生效。
      </p>

      <WpCard variant="row" v-for="action in SHORTCUT_ACTIONS" :key="action.id" >
        <div class="card-content">
          <div class="card-header">{{ action.label }}</div>
          <div class="card-description">{{ action.description }}</div>
        </div>
        <div class="shortcut-keys">
          <!-- 用带 tabindex 的 div 而非 button：避免空格 / 回车触发按钮激活，干扰录制 -->
          <div
            class="shortcut-key"
            :class="{
              recording: recordingId === action.id,
              empty: !shortcuts.bindings[action.id] && recordingId !== action.id,
            }"
            role="button"
            tabindex="0"
            @focus="startRecording(action.id)"
            @blur="onRecorderBlur(action.id)"
            @keydown="onRecorderKeydown($event, action.id)"
          >
            {{ displayFor(action.id) }}
          </div>
          <button
            v-if="shortcuts.bindings[action.id]"
            type="button"
            class="shortcut-clear"
            title="清除绑定"
            aria-label="清除绑定"
            @click="clearBinding(action.id)"
          >
            <span class="wp-icon">&#xF36A;</span>
          </button>
        </div>
      </WpCard>

      <div class="shortcut-actions">
        <WpButton variant="standard" type="button" @click="resetDefaults">恢复默认</WpButton>
      </div>
    </section>

    <!-- 系统级全局快捷键（仅桌面端）：任意应用中生效 -->
    <section v-if="!isMobile" class="settings-section">
      <h2 class="settings-section-title">全局快捷键</h2>
      <p class="shortcut-hint">
        由系统注册的热键：窗口在后台、甚至隐藏到系统托盘时也能用。默认使用 Ctrl + Alt
        组合键，避免抢占其他应用的常用按键；点击按键框可重新录制（必须带 Ctrl / Alt / Shift / Win），
        按 Esc 取消、Backspace / Delete 清除。若组合键已被其他程序占用，这里会标出「注册失败」。
      </p>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">启用全局快捷键</div>
          <div class="card-description">
            关闭后立即注销所有系统热键，仅保留窗口内的快捷键；重新开启会按下面的设置恢复注册
          </div>
        </div>
        <ToggleSwitch :IsOn="shortcuts.globalEnabled" @Toggled="onGlobalToggle" />
      </WpCard>

      <WpCard variant="row" v-for="action in GLOBAL_SHORTCUT_ACTIONS" :key="action.id">
        <div class="card-content">
          <div class="card-header">
            {{ action.label }}
            <span
              v-if="shortcuts.globalEnabled && shortcuts.globalBindings[action.id]"
              class="shortcut-status"
              :class="{ error: isStatusError(action.id) }"
            >
              {{ statusTextFor(action.id) }}
            </span>
          </div>
          <div class="card-description">{{ action.description }}</div>
        </div>
        <div class="shortcut-keys" :class="{ disabled: !shortcuts.globalEnabled }">
          <div
            class="shortcut-key"
            :class="{
              recording: recordingGlobalId === action.id,
              empty: !shortcuts.globalBindings[action.id] && recordingGlobalId !== action.id,
            }"
            role="button"
            :tabindex="shortcuts.globalEnabled ? 0 : -1"
            @focus="shortcuts.globalEnabled && startGlobalRecording(action.id)"
            @blur="onGlobalRecorderBlur(action.id)"
            @keydown="onGlobalRecorderKeydown($event, action.id)"
          >
            {{ displayForGlobal(action.id) }}
          </div>
          <button
            v-if="shortcuts.globalBindings[action.id]"
            type="button"
            class="shortcut-clear"
            title="清除绑定"
            aria-label="清除绑定"
            :disabled="!shortcuts.globalEnabled"
            @click="clearGlobalBinding(action.id)"
          >
            <span class="wp-icon">&#xF36A;</span>
          </button>
        </div>
      </WpCard>

      <div class="shortcut-actions">
        <WpButton variant="standard" type="button" @click="resetGlobalDefaults">恢复默认</WpButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.shortcut-hint {
  margin: 0 0 var(--space-xl) 0;
  font-size: 12px;
  color: var(--wp-text-secondary);
  line-height: 1.6;
}

.shortcut-keys {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.shortcut-key {
  min-width: 160px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--wp-control-stroke-secondary);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill);
  color: var(--wp-text-primary);
  font-size: 13px;
  line-height: 30px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.shortcut-key:hover {
  background: var(--wp-card-hover);
}

.shortcut-key.empty {
  color: var(--wp-text-tertiary);
}

.shortcut-key.recording {
  border-color: var(--wp-accent);
  background: var(--wp-accent-light);
  color: var(--wp-accent);
}

.shortcut-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.shortcut-clear:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.shortcut-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-xl);
}

/* 注册状态徽标：默认低调，失败时用危险色 */
.shortcut-status {
  margin-left: var(--space-sm);
  font-size: 11px;
  font-weight: 400;
  color: var(--wp-text-tertiary);
}

.shortcut-status.error {
  color: var(--wp-danger);
}

/* 全局快捷键关闭时，右侧控件整体变灰 */
.shortcut-keys.disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
