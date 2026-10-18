<script setup lang="ts">
/**
 * 内嵌右键菜单宿主（全局唯一实例，挂在 App.vue）
 * - 在元素上调用 openContextMenu(event, items) 即可在鼠标位置弹出
 * - 全局拦截右键：非可编辑区域一律屏蔽系统原生菜单
 *
 * 移动端没有鼠标右键，长按（openContextMenuAt）改以底部动作面板呈现：
 * 与正在播放页「更多」一样的底部抽屉形态，但沿用 WinUI 令牌与桌面右键菜单
 * 完全一致的图标 / 文案 / 动作，只是把「贴着光标弹出」换成「贴底弹出」。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  closeContextMenu,
  contextMenuState,
  type ContextMenuItem,
} from "@/services/contextMenu";
import { useIsMobile } from "@/composables/useIsMobile";
import { registerBackInterceptor } from "@/services/backButton";

const isMobile = useIsMobile();
const menuRef = ref<HTMLElement | null>(null);

/** 桌面端弹出后测量尺寸，避免超出视口边缘（底部面板无需定位） */
watch(
  () => contextMenuState.visible,
  async (visible) => {
    if (!visible || isMobile) return;
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
  <teleport to="body">
    <!-- 移动端：贴底动作面板（与「更多」同形态，WinUI 令牌皮肤） -->
    <transition v-if="isMobile" name="ctx-sheet">
      <div v-if="contextMenuState.visible" class="ctx-sheet-layer" @contextmenu.prevent.stop>
        <div ref="menuRef" class="ctx-sheet ctx-menu">
          <span class="ctx-sheet-grip" aria-hidden="true"></span>
          <div class="ctx-sheet-list">
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
        </div>
      </div>
    </transition>

    <!-- 桌面端：光标处浮出菜单 -->
    <transition v-else name="ctx-menu">
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

/* ---------------------------------- 移动端底部动作面板 ---------------------------------- */

.ctx-sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  /* WinUI Smoke 层：压暗下层页面，突出面板 */
  background: rgba(0, 0, 0, 0.4);
}

.ctx-sheet {
  /* 覆写桌面浮出菜单的定位与尺寸，改为通栏贴底 */
  position: relative;
  min-width: 0;
  width: 100%;
  max-height: 80vh;
  padding: 0 0 calc(var(--safe-area-bottom) + var(--space-md));
  gap: 0;
  border: none;
  border-top: 1px solid var(--wp-flyout-stroke);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  /* WinUI AcrylicInAppFillColorDefault */
  background: var(--wp-flyout-acrylic);
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  box-shadow: var(--shadow-flyout);
  overflow: hidden;
}

/* 顶部抓手：WinUI 底部面板的拖拽提示 */
.ctx-sheet-grip {
  flex: none;
  width: 36px;
  height: 4px;
  margin: var(--space-md) auto var(--space-sm);
  border-radius: 2px;
  background: var(--wp-control-stroke-strong);
}

.ctx-sheet-list {
  display: flex;
  flex-direction: column;
  padding: var(--space-xs) var(--space-sm) 0;
  overflow-y: auto;
}

/* 触摸目标加大到 48px；触摸端用 :active 反馈，屏蔽粘滞 hover */
.ctx-sheet .ctx-item {
  height: 48px;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-md);
  font-size: 15px;
  gap: var(--space-lg);
  transition: background var(--duration-fast) var(--ease-standard);
}

.ctx-sheet .ctx-item:hover:not(:disabled) {
  background: transparent;
}

.ctx-sheet .ctx-item:active:not(:disabled) {
  background: var(--wp-card-hover);
}

.ctx-sheet .ctx-icon {
  font-size: 18px;
}

/* 底部面板：上滑进入 / 下滑退出，同时淡出烟层 */
.ctx-sheet-enter-active,
.ctx-sheet-leave-active {
  transition: opacity var(--duration-normal) var(--ease-standard);
}

.ctx-sheet-enter-active .ctx-sheet,
.ctx-sheet-leave-active .ctx-sheet {
  transition: transform var(--duration-normal) var(--ease-decelerate);
}

.ctx-sheet-enter-from,
.ctx-sheet-leave-to {
  opacity: 0;
}

.ctx-sheet-enter-from .ctx-sheet,
.ctx-sheet-leave-to .ctx-sheet {
  transform: translateY(100%);
}
</style>
