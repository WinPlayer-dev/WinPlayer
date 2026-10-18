<script setup lang="ts">
/**
 * WinUI 下拉选择框（ComboBox）
 *
 * 收起态：WinUI ComboBox 外观（ControlFillColorDefault 填充 + 1px 描边 +
 * 4px 圆角，右侧下拉箭头）。
 * 展开态：与原生 WinUI 一致，弹层“套在”控件上——选中项与控件位置对齐，
 * 弹层向下（空间不足时向上）延展；弹层为半透明毛玻璃背景 + 淡 blur。
 * 选项悬浮 / 选中时背景稍稍变深，选中项左侧带强调色标签条。
 *
 * 属性 / 事件命名沿用 XAML 风格：ItemsSource / SelectedIndex / SelectionChanged。
 * SelectionChanged 回调签名为 (sender, { AddedItems: [label] })，与项目既有调用一致。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

/** 单行选项高度（32px 内容 + 上下各 2px 外边距），用于把选中项对齐到控件上 */
const ITEM_HEIGHT = 36;
/** 单行选项可见高度 */
const ITEM_SIZE = 32;
/** 单行选项外边距 */
const ITEM_MARGIN = 2;
/** 弹层上下内边距 */
const LIST_PADDING = 4;
/** 弹层描边宽度 */
const LIST_BORDER = 1;
/** 弹层最大高度（WinUI ComboBox MaxDropDownHeight) */
const MAX_LIST_HEIGHT = 320;
/** 弹层与视口边缘的最小间距 */
const VIEWPORT_MARGIN = 8;

const props = withDefaults(
  defineProps<{
    /** 选项文本列表 */
    ItemsSource?: string[];
    /** 当前选中索引（-1 表示未选中，展示占位） */
    SelectedIndex?: number;
    /** 未选中时的占位文字 */
    PlaceholderText?: string;
    /** 是否可用 */
    IsEnabled?: boolean;
  }>(),
  { ItemsSource: () => [], SelectedIndex: -1, PlaceholderText: "", IsEnabled: true },
);

const emit = defineEmits<{
  SelectionChanged: [sender: HTMLElement | null, payload: { AddedItems: unknown[] }];
}>();

const rootRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const flyoutStyle = ref<Record<string, string>>({});

const items = computed(() => props.ItemsSource ?? []);
const selectedLabel = computed(() => items.value[props.SelectedIndex] ?? "");

/** 按 WinUI 规则定位弹层：选中项与控件重叠对齐，再整体夹取进视口 */
function updatePosition(): void {
  const button = buttonRef.value;
  if (!button) return;
  const rect = button.getBoundingClientRect();
  const count = items.value.length;
  const listHeight = Math.min(
    Math.max(count, 1) * ITEM_HEIGHT + (LIST_PADDING + LIST_BORDER) * 2,
    MAX_LIST_HEIGHT,
  );
  const index = Math.min(Math.max(props.SelectedIndex, 0), Math.max(count - 1, 0));
  // 让选中项与控件重叠对齐（WinUI ComboBox 弹层行为）
  let top = rect.top - LIST_PADDING - LIST_BORDER - ITEM_MARGIN - index * ITEM_HEIGHT;
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - listHeight;
  if (top > maxTop) top = maxTop;
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
  // 展开动画从选中项处向上下撑开，高度由「一个选项」缓出到完整高度
  const anchorY =
    LIST_BORDER + LIST_PADDING + ITEM_MARGIN + index * ITEM_HEIGHT + ITEM_SIZE / 2;
  const originY = Math.min(Math.max(anchorY, 0), listHeight);
  const expandFrom = Math.min(1, ITEM_HEIGHT / Math.max(listHeight, 1));
  flyoutStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(rect.left)}px`,
    minWidth: `${Math.round(rect.width)}px`,
    maxHeight: `${MAX_LIST_HEIGHT}px`,
    transformOrigin: `50% ${Math.round(originY)}px`,
    "--wp-combo-box-expand-from": expandFrom.toFixed(4),
  };
}

function openList(): void {
  if (!props.IsEnabled || open.value) return;
  activeIndex.value = props.SelectedIndex;
  updatePosition();
  open.value = true;
  void nextTick(() => {
    window.addEventListener("pointerdown", onDocumentPointerDown, true);
    scrollActiveIntoView();
  });
}

function closeList(): void {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener("pointerdown", onDocumentPointerDown, true);
}

function toggle(): void {
  if (open.value) closeList();
  else openList();
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (rootRef.value?.contains(target)) return;
  if (listRef.value?.contains(target)) return;
  closeList();
}

function onWindowBlur(): void {
  closeList();
}

function scrollActiveIntoView(): void {
  const list = listRef.value;
  if (!list || activeIndex.value < 0) return;
  const item = list.children[activeIndex.value] as HTMLElement | undefined;
  if (!item) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top - LIST_PADDING;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function select(index: number): void {
  const label = items.value[index];
  if (label === undefined) return;
  closeList();
  buttonRef.value?.focus();
  if (index === props.SelectedIndex) return;
  emit("SelectionChanged", buttonRef.value, { AddedItems: [label] });
}

function moveActive(delta: number): void {
  if (!items.value.length) return;
  const next = activeIndex.value < 0 ? 0 : activeIndex.value + delta;
  activeIndex.value = Math.min(items.value.length - 1, Math.max(0, next));
  void nextTick(scrollActiveIntoView);
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (open.value) moveActive(1);
      else openList();
      break;
    case "ArrowUp":
      event.preventDefault();
      if (open.value) moveActive(-1);
      else openList();
      break;
    case "Home":
      if (!open.value) return;
      event.preventDefault();
      activeIndex.value = 0;
      void nextTick(scrollActiveIntoView);
      break;
    case "End":
      if (!open.value) return;
      event.preventDefault();
      activeIndex.value = items.value.length - 1;
      void nextTick(scrollActiveIntoView);
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      if (open.value) select(activeIndex.value);
      else openList();
      break;
    case "Escape":
      if (!open.value) return;
      event.preventDefault();
      closeList();
      break;
    default:
      break;
  }
}

// 外部改动选中项（如恢复默认）时同步高亮位置
watch(
  () => props.SelectedIndex,
  (index) => {
    if (open.value) activeIndex.value = index;
  },
);

watch(open, (value) => {
  if (value) {
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
  } else {
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("resize", updatePosition);
    window.removeEventListener("scroll", updatePosition, true);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("resize", updatePosition);
  window.removeEventListener("scroll", updatePosition, true);
});
</script>

<template>
  <div
    ref="rootRef"
    class="wp-combo-box"
    :class="{ 'is-open': open, 'is-disabled': !props.IsEnabled }"
  >
    <button
      ref="buttonRef"
      type="button"
      class="wp-combo-box-button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="!props.IsEnabled"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="wp-combo-box-text" :class="{ 'is-placeholder': !selectedLabel }">
        {{ selectedLabel || props.PlaceholderText }}
      </span>
      <svg class="wp-combo-box-chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 6 8 9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="wp-combo-box-flyout">
        <ul
          v-if="open"
          ref="listRef"
          class="wp-combo-box-flyout"
          :style="flyoutStyle"
          role="listbox"
          tabindex="-1"
        >
          <li
            v-for="(item, index) in items"
            :key="`${index}:${item}`"
            class="wp-combo-box-item"
            :class="{
              'is-selected': index === props.SelectedIndex,
              'is-active': index === activeIndex,
            }"
            role="option"
            :aria-selected="index === props.SelectedIndex"
            @click="select(index)"
            @pointermove="activeIndex = index"
          >
            <span class="wp-combo-box-item-text">{{ item }}</span>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ---------------- 收起态 ---------------- */
.wp-combo-box {
  position: relative;
  min-width: 0;
}

.wp-combo-box-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  box-sizing: border-box;
  width: 100%;
  min-width: 64px;
  height: 32px;
  padding: 0 var(--space-lg);
  background: var(--wp-control-fill);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--wp-text-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

/* WinUI 控件“浮起”描边：底部 1px 稍深 + 向上渐浅，像一层淡淡的内阴影 */
.wp-combo-box-button::after {
  content: "";
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: 1px;
  border-radius: inherit;
  background: var(--wp-control-elevation-border);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

.wp-combo-box-button:hover:not(:disabled) {
  background: var(--wp-control-fill-secondary);
}

.wp-combo-box.is-open .wp-combo-box-button {
  background: var(--wp-control-fill-secondary);
}

.wp-combo-box-button:focus-visible {
  outline: 2px solid var(--wp-text-primary);
  outline-offset: 1px;
}

.wp-combo-box-button:disabled {
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-disabled);
  cursor: default;
}

.wp-combo-box-button:disabled::after {
  background: var(--wp-control-stroke);
}

.wp-combo-box-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-combo-box-text.is-placeholder {
  color: var(--wp-text-secondary);
}

.wp-combo-box-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--wp-text-secondary);
}

/* ---------------- 展开态：套在控件上的弹层 ---------------- */
.wp-combo-box-flyout {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: 320px;
  margin: 0;
  padding: 4px 5px;
  overflow-x: hidden;
  overflow-y: auto;
  list-style: none;
  /* 淡毛玻璃：半透明背景 + 轻微模糊 */
  background: var(--wp-flyout-acrylic);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid var(--wp-flyout-stroke);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-flyout);
  transform-origin: 50%;
}

.wp-combo-box-item {
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 32px;
  margin: 2px 0;
  padding: 5px 11px 7px 11px;
  border-radius: 3px;
  color: var(--wp-text-primary);
  font-size: 14px;
  line-height: 20px;
  cursor: default;
  transition: background var(--duration-fast) var(--ease-standard);
}

.wp-combo-box-item.is-active {
  background: var(--wp-subtle-secondary);
}

.wp-combo-box-item.is-selected {
  background: var(--wp-subtle-secondary);
}

/* 选中项左侧强调色标签条（WinUI ComboBox 选中态） */
.wp-combo-box-item.is-selected::before {
  content: "";
  position: absolute;
  left: 1px;
  top: 50%;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--wp-accent);
  transform: translateY(-50%);
}

.wp-combo-box-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* WinUI 弹层展开 / 收起动画：从选中项处由「一个选项」的高度撑开 */
.wp-combo-box-flyout-enter-active {
  animation: wp-combo-box-in 300ms var(--ease-decelerate) both;
}

.wp-combo-box-flyout-leave-active {
  animation: wp-combo-box-out 120ms cubic-bezier(0.7, 0, 1, 0.5) both;
}

@keyframes wp-combo-box-in {
  from {
    opacity: 0;
    transform: scaleY(var(--wp-combo-box-expand-from, 0.3));
  }
  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

@keyframes wp-combo-box-out {
  from {
    opacity: 1;
    transform: scaleY(1);
  }
  to {
    opacity: 0;
    transform: scaleY(var(--wp-combo-box-expand-from, 0.3));
  }
}
</style>
