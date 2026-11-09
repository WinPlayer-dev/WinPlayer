<script setup lang="ts">
/**
 * 移动端分类选择面板（底部升起）。
 *
 * 原来是一排横向滚动的胶囊：手机端 10 个分类只有 7~8 个露在屏幕里，
 * 用户既不知道一共有几类，也看不到「我在第几栏」。
 * 改成一个按钮 + 底部面板，一屏列全，每类带一句副标题解释装什么。
 *
 * 复用 ContentDialog：它本身在手机端就是底部面板，而且 Esc / 点遮罩 / Android
 * 返回键三处关闭逻辑都以「声明了关闭按钮」为前提，声明 CloseButtonText 即可白嫖。
 */
import { ref } from "vue";
import { ContentDialog } from "@/components/winui";
import type { SettingsCategory, SettingsCategoryKey } from "@/views/settings/categories";

defineProps<{
  categories: readonly SettingsCategory[];
  active: SettingsCategoryKey;
}>();

const emit = defineEmits<{ pick: [key: SettingsCategoryKey] }>();

interface DialogRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

const dialogRef = ref<DialogRef | null>(null);

async function open(): Promise<void> {
  await dialogRef.value?.ShowAsync();
}

function choose(key: SettingsCategoryKey): void {
  dialogRef.value?.Hide();
  emit("pick", key);
}

defineExpose({ open });
</script>

<template>
  <ContentDialog
    ref="dialogRef"
    Title="选择设置分类"
    CloseButtonText="取消"
    DefaultButton="Close"
  >
    <ul class="category-sheet">
      <li v-for="category in categories" :key="category.key">
        <button
          type="button"
          class="sheet-item"
          :class="{ active: category.key === active }"
          @click="choose(category.key)"
        >
          <span class="wp-icon sheet-icon" v-html="category.icon" aria-hidden="true" />
          <span class="sheet-text">
            <span class="sheet-label">{{ category.label }}</span>
            <span class="sheet-sub">{{ category.mobileSubtitle }}</span>
          </span>
          <span v-if="category.key === active" class="sheet-check" aria-hidden="true">✓</span>
        </button>
      </li>
    </ul>
  </ContentDialog>
</template>

<style scoped>
.category-sheet {
  list-style: none;
  margin: 0;
  /* 底部面板里滚动而不是把整面板顶高 */
  max-height: 58vh;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  padding: 10px var(--space-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-primary);
  text-align: left;
  cursor: pointer;
}

.sheet-item:active {
  background: var(--wp-card-active);
}

.sheet-item.active {
  background: var(--wp-card-active);
}

.sheet-icon {
  flex: none;
  font-size: 18px;
  color: var(--wp-text-secondary);
}

.sheet-item.active .sheet-icon {
  color: var(--wp-accent);
}

.sheet-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-label {
  font-size: 14px;
}

.sheet-item.active .sheet-label {
  font-weight: 600;
}

.sheet-sub {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.sheet-check {
  flex: none;
  font-size: 14px;
  line-height: 1;
  color: var(--wp-accent);
}
</style>
