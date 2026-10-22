<script setup lang="ts">
/**
 * 内嵌右键菜单宿主（全局唯一实例，挂在 App.vue）
 * - 在元素上调用 openContextMenu(event, items, title) 即可在鼠标位置弹出
 * - 全局拦截右键：非可编辑区域一律屏蔽系统原生菜单
 *
 * 移动端没有鼠标右键，长按（openContextMenuAt）直接复用 ContentDialog：
 * 与「添加到歌单」等弹窗完全同一套底部面板（标题 + 选项列表 + 取消按钮），
 * 不再维护第二套动作面板；点空白 / 取消 / 返回键都能收起。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ContentDialog } from "@/components/winui";
import {
  closeContextMenu,
  contextMenuState,
  type ContextMenuItem,
} from "@/services/contextMenu";
import { useIsMobile } from "@/composables/useIsMobile";
import { registerBackInterceptor } from "@/services/backButton";

const isMobile = useIsMobile();
const menuRef = ref<HTMLElement | null>(null);

/** 移动端底部面板（ContentDialog 只暴露 ShowAsync / Hide） */
interface SheetRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

const sheetRef = ref<SheetRef | null>(null);

watch(
  () => contextMenuState.visible,
  async (visible) => {
    if (isMobile) {
      // 移动端：状态与对话框双向同步——打开即 ShowAsync，关闭即 Hide
      if (!visible) {
        sheetRef.value?.Hide();
        return;
      }
      await nextTick();
      const shown = sheetRef.value?.ShowAsync();
      await shown;
      // 用户点空白 / 取消 / 返回键关掉了面板，把状态收回来
      if (contextMenuState.visible) closeContextMenu();
      return;
    }

    // 桌面端弹出后测量尺寸，避免超出视口边缘
    if (!visible) return;
    await nextTick();
    const el = menuRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (contextMenuState.x + rect.width > window.innerWidth - 8) {
      contextMenuState.x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (contextMenuState.y + rect.height > window.innerHeight - 8) {
      contextMenuState.y = Math.max(8, window.innerHeight - rect.height - 8);
    }
  },
);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, [contenteditable]") !== null;
}

async function activate(item: ContextMenuItem) {
  if (item.disabled) return;
  closeContextMenu();
  await item.action();
}

/**
 * 面板外的指针按下会关闭菜单；但面板随即消失，本次触摸补发的 click 可能穿透
 * 到下层页面（误触导航 / 播放）。这里吞掉紧随其后的一次 click。
 * 仅桌面端需要：移动端面板由 ContentDialog 的遮罩接管，不存在穿透。
 */
let swallowTimer: number | null = null;

function cleanupSwallow() {
  window.removeEventListener("click", swallowClick, true);
  if (swallowTimer !== null) {
    window.clearTimeout(swallowTimer);
    swallowTimer = null;
  }
}

function swallowClick(event: Event) {
  event.stopPropagation();
  event.preventDefault();
  cleanupSwallow();
}

function armSwallow() {
  window.addEventListener("click", swallowClick, true);
  if (swallowTimer !== null) window.clearTimeout(swallowTimer);
  swallowTimer = window.setTimeout(cleanupSwallow, 400);
}

function onWindowPointerDown(event: PointerEvent) {
  if (!contextMenuState.visible) return;
  // 移动端由 ContentDialog 的遮罩负责关闭（否则点面板里的选项会先被这里关掉）
  if (isMobile) return;
  if (menuRef.value && event.target instanceof Node && menuRef.value.contains(event.target)) return;
  closeContextMenu();
  armSwallow();
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && contextMenuState.visible) closeContextMenu();
}

/** 非可编辑区域统一屏蔽系统右键菜单；未被业务处理过的位置顺带关闭已弹出的菜单 */
function onWindowContextMenu(event: MouseEvent) {
  if (isEditable(event.target)) return;
  if (!event.defaultPrevented) {
    event.preventDefault();
    if (contextMenuState.visible) closeContextMenu();
  }
}

function onWindowBlur() {
  if (contextMenuState.visible) closeContextMenu();
}

/** 返回键拦截器的注销函数（Android） */
let unregisterBack: (() => void) | null = null;

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("contextmenu", onWindowContextMenu);
  window.addEventListener("blur", onWindowBlur);
  // Android 返回键：面板开着时先收起它，而不是让返回键去关页面 / 退应用
  unregisterBack = registerBackInterceptor(() => {
    if (!contextMenuState.visible) return false;
    closeContextMenu();
    return true;
  });
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("contextmenu", onWindowContextMenu);
  window.removeEventListener("blur", onWindowBlur);
  unregisterBack?.();
  unregisterBack = null;
  cleanupSwallow();
});
</script>

<template>
  <!-- 移动端：与「添加到歌单」等同款底部面板 -->
  <ContentDialog
    v-if="isMobile"
    ref="sheetRef"
    :Title="contextMenuState.title"
    CloseButtonText="取消"
  >
    <div class="ctx-list">
      <button
        v-for="item in contextMenuState.items"
        :key="item.key"
        class="ctx-item"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="activate(item)"
      >
        <span
          v-if="item.icon"
          class="wp-icon ctx-icon"
          :class="{ filled: item.filled }"
          v-html="item.icon"
        ></span>
        <span class="ctx-label">{{ item.label }}</span>
      </button>
    </div>
  </ContentDialog>

  <!-- 桌面端：光标处浮出菜单 -->
  <teleport v-else to="body">
    <transition name="ctx-menu">
      <div
        v-if="contextMenuState.visible"
        ref="menuRef"
        class="ctx-menu"
        :style="{ left: `${contextMenuState.x}px`, top: `${contextMenuState.y}px` }"
        @contextmenu.prevent.stop
      >
        <button
          v-for="item in contextMenuState.items"
          :key="item.key"
          class="ctx-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="activate(item)"
        >
          <span
            v-if="item.icon"
            class="wp-icon ctx-icon"
            :class="{ filled: item.filled }"
            v-html="item.icon"
          ></span>
          <span class="ctx-label">{{ item.label }}</span>
        </button>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 4px;
  background: var(--wp-flyout);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-flyout);
  display: flex;
  flex-direction: column;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 34px;
  padding: 0 var(--space-lg);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 13px;
  color: var(--wp-text-primary);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard);
}

.ctx-item:hover:not(:disabled) {
  background: var(--wp-card-hover);
}

.ctx-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.ctx-item.danger {
  color: var(--wp-danger);
}

.ctx-icon {
  font-size: 14px;
  color: var(--wp-text-secondary);
  flex: none;
}

.ctx-item.danger .ctx-icon {
  color: var(--wp-danger);
}

.ctx-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 弹出动画（WinUI 飞入近似） */
.ctx-menu-enter-active,
.ctx-menu-leave-active {
  transition:
    transform var(--duration-fast) var(--ease-decelerate),
    opacity var(--duration-fast) var(--ease-decelerate);
}

.ctx-menu-enter-from,
.ctx-menu-leave-to {
  transform: scale(0.96);
  opacity: 0;
}

/* ---------------------------- 移动端：对话框内的选项列表 ---------------------------- */

.ctx-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 触摸目标加大到 48px；触摸端用 :active 反馈，屏蔽粘滞 hover */
html.is-mobile .ctx-item {
  height: 48px;
  padding: 0 var(--space-md);
  border-radius: var(--radius-md);
  font-size: 15px;
  gap: var(--space-lg);
}

html.is-mobile .ctx-item:hover:not(:disabled) {
  background: transparent;
}

html.is-mobile .ctx-item:active:not(:disabled) {
  background: var(--wp-card-hover);
}

html.is-mobile .ctx-icon {
  font-size: 18px;
}
</style>
