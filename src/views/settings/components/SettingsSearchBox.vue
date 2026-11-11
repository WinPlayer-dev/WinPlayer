<script setup lang="ts">
/**
 * 设置搜索框 + 结果下拉面板。
 *
 * 设置项约 65 条、全在本地，输入即算，不需要防抖。
 * 键盘：Ctrl / Cmd + F 聚焦，↑↓ 选择，Enter 跳转，Esc 清空或收起。
 *
 * 为什么 Ctrl+F 要在捕获阶段拦截：WebView2 自带「在页面中查找」，不拦下来
 * 会弹出浏览器自己的查找框；同时也要抢在全局快捷键之前，避免用户把某个动作
 * 绑到 Ctrl+F 时被这里和播放控制各触发一次。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { TextBox } from "@/components/winui";
import { useI18n } from "@/i18n";
import {
  highlightSegments,
  itemDescription,
  itemTitle,
  searchSettings,
  sectionPath,
  type SettingsItem,
} from "@/views/settings/settingsIndex";

const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false });

const emit = defineEmits<{ select: [item: SettingsItem] }>();

const { t } = useI18n();

const rootRef = ref<HTMLElement | null>(null);
const query = ref("");
const open = ref(false);
const activeIndex = ref(0);
/** 移动端默认收成一个图标，点了才展开 */
const expanded = ref(!props.mobile);

const hits = computed(() => searchSettings(query.value));

/** 高亮用的原始词（保留大小写不敏感的子串匹配即可） */
const terms = computed(() =>
  query.value
    .trim()
    .split(/\s+/)
    .filter(Boolean),
);

watch(query, () => {
  activeIndex.value = 0;
  open.value = query.value.trim().length > 0;
});

watch(hits, () => {
  if (activeIndex.value >= hits.value.length) activeIndex.value = 0;
});

function segmentsOf(text: string) {
  return highlightSegments(text, terms.value);
}

function focusInput(): void {
  expanded.value = true;
  void nextTick(() => {
    rootRef.value?.querySelector<HTMLInputElement>("input")?.focus();
  });
}

function close(): void {
  open.value = false;
  if (props.mobile && !query.value) expanded.value = false;
}

function clear(): void {
  query.value = "";
  open.value = false;
  focusInput();
}

function choose(item: SettingsItem): void {
  emit("select", item);
  query.value = "";
  open.value = false;
  if (props.mobile) expanded.value = false;
}

/** 输入框上的键盘导航 */
function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (query.value) clear();
    else close();
    return;
  }
  if (!open.value || !hits.value.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % hits.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + hits.value.length) % hits.value.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = hits.value[activeIndex.value];
    if (hit) choose(hit.item);
  }
}

/** 全局 Ctrl / Cmd + F：捕获阶段拦截，压掉 WebView2 的原生查找 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key.toLowerCase() !== "f") return;
  event.preventDefault();
  event.stopPropagation();
  focusInput();
}

/** 点空白关闭下拉 */
function onDocPointerDown(event: PointerEvent): void {
  if (!open.value) return;
  if (rootRef.value?.contains(event.target as Node)) return;
  close();
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown, true);
  document.addEventListener("pointerdown", onDocPointerDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown, true);
  document.removeEventListener("pointerdown", onDocPointerDown);
});
</script>

<template>
  <div ref="rootRef" class="settings-search" :class="{ mobile, expanded }">
    <button
      v-if="mobile && !expanded"
      type="button"
      class="search-trigger"
      :title="t('settings.shell.search.shortcut')"
      :aria-label="t('settings.shell.search.label')"
      @click="focusInput"
    >
      <span class="wp-icon">&#xF690;</span>
    </button>

    <template v-else>
      <div class="search-field" @keydown="onInputKeydown">
        <span class="wp-icon search-icon" aria-hidden="true">&#xF690;</span>
        <TextBox
          :Text="query"
          :PlaceholderText="t('settings.shell.search.placeholder')"
          @update:Text="(value: unknown) => (query = String(value ?? ''))"
        />
        <button
          v-if="query"
          type="button"
          class="search-clear"
          :title="t('common.action.clear')"
          :aria-label="t('common.action.clear')"
          @click="clear"
        >
          <span class="wp-icon">&#xF36A;</span>
        </button>
      </div>

      <div v-if="open" class="search-panel" role="listbox">
        <template v-if="hits.length">
          <button
            v-for="(hit, index) in hits"
            :key="hit.item.id"
            type="button"
            role="option"
            class="search-hit"
            :class="{ active: index === activeIndex }"
            :aria-selected="index === activeIndex"
            @mouseenter="activeIndex = index"
            @click="choose(hit.item)"
          >
            <span class="hit-main">
              <span v-if="index === 0 || sectionPath(hits[index - 1].item) !== sectionPath(hit.item)" class="hit-path">
                {{ sectionPath(hit.item) }}
              </span>
              <span class="hit-title">
                <template v-for="(segment, i) in segmentsOf(itemTitle(hit.item))" :key="i">
                  <mark v-if="segment.hit">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
              <span class="hit-desc">
                <template v-for="(segment, i) in segmentsOf(itemDescription(hit.item))" :key="i">
                  <mark v-if="segment.hit">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
            </span>
          </button>
        </template>
        <p v-else class="search-empty">
          {{ t("settings.shell.search.empty") }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 布局交给 settings.css 的全局类（.settings-search / .search-field …），
   这里只放与输入框内部结构强相关的部分 */
.search-field :deep(.wp-text-box) {
  width: 100%;
}

.search-field :deep(input) {
  padding-left: 32px;
  padding-right: 32px;
}
</style>
