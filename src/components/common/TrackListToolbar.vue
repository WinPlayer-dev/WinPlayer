<script setup lang="ts">
/**
 * 曲目列表的「搜索 + 排序」工具条。
 *
 * 与 SongTable 上下相邻使用（放在表头之上），只在列表非空时渲染。
 * 搜索框、排序下拉、升降序按钮三者都受控：状态由调用方的
 * `useTrackList` 持有，组件本身不存任何状态。
 */
import { computed } from "vue";
import { ComboBox, TextBox } from "@/components/winui";
import WpIconButton from "@/components/theme/WpIconButton.vue";
import { TRACK_SORT_OPTIONS, type TrackSortKey } from "@/services/trackQuery";

const props = withDefaults(
  defineProps<{
    /** 搜索关键词 */
    Query: string;
    /** 当前排序字段 */
    SortKey: TrackSortKey;
    /** 是否降序 */
    Descending: boolean;
    /** 过滤后条数 */
    Shown: number;
    /** 过滤前总条数 */
    Total: number;
    /** 是否显示排序控件（只有固定上下文才提供「添加时间」等语义） */
    ShowSort?: boolean;
  }>(),
  { ShowSort: true },
);

const emit = defineEmits<{
  "update:Query": [value: string];
  "update:SortKey": [value: TrackSortKey];
  "update:Descending": [value: boolean];
}>();

const sortLabels = TRACK_SORT_OPTIONS.map((option) => option.label);

const sortIndex = computed(() =>
  Math.max(
    0,
    TRACK_SORT_OPTIONS.findIndex((option) => option.key === props.SortKey),
  ),
);

/** 升降序按钮文案：跟随当前排序字段的语义（字母序 / 时长 / 时间） */
const directionTitle = computed(() => {
  const label = TRACK_SORT_OPTIONS[sortIndex.value]?.label ?? "排序";
  return props.Descending ? `${label}：降序（点击切为升序）` : `${label}：升序（点击切为降序）`;
});

function onQueryInput(value: string): void {
  emit("update:Query", value);
}

function onSortChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = TRACK_SORT_OPTIONS.find((entry) => entry.label === label);
  if (option) emit("update:SortKey", option.key);
}

function toggleDirection(): void {
  emit("update:Descending", !props.Descending);
}

function clearQuery(): void {
  emit("update:Query", "");
}
</script>

<template>
  <div class="track-toolbar">
    <div class="search-box">
      <span class="search-icon wp-icon" aria-hidden="true">&#xF4A3;</span>
      <TextBox
        class="search-input"
        :Text="props.Query"
        PlaceholderText="在列表中搜索歌名 / 歌手 / 专辑"
        @update:Text="onQueryInput"
      />
      <button
        v-if="props.Query"
        class="search-clear"
        title="清空搜索"
        aria-label="清空搜索"
        @click="clearQuery"
      >
        <span class="wp-icon">&#xF36A;</span>
      </button>
    </div>

    <div class="toolbar-tail">
      <span v-if="props.Query" class="result-count" aria-live="polite">
        {{ props.Shown }} / {{ props.Total }}
      </span>
      <template v-if="props.ShowSort">
        <ComboBox
          class="sort-combo"
          :ItemsSource="sortLabels"
          :SelectedIndex="sortIndex"
          @SelectionChanged="onSortChange"
        />
        <WpIconButton :title="directionTitle" @click="toggleDirection">
          <span class="wp-icon" :class="{ 'is-up': !props.Descending }">&#xF5A9;</span>
        </WpIconButton>
      </template>
    </div>
  </div>
</template>

<style scoped>
.track-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 0 var(--space-lg) var(--space-md);
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  font-size: 14px;
  color: var(--wp-text-tertiary);
  pointer-events: none;
}

/* 给左侧图标与右侧清空按钮留出内边距 */
.search-box :deep(.wp-text-box) {
  padding-left: 32px;
  padding-right: 32px;
}

.search-clear {
  position: absolute;
  right: 4px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.search-clear:hover {
  background: var(--wp-card-active);
  color: var(--wp-text-primary);
}

.toolbar-tail {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: none;
}

.result-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sort-combo {
  width: 120px;
  flex: none;
}

/* 升序时箭头朝上（图标默认朝下） */
.toolbar-tail .wp-icon.is-up {
  transform: rotate(180deg);
}

/* 移动端：搜索框独占一行，排序控件收窄 */
@media (max-width: 720px) {
  .track-toolbar {
    flex-wrap: wrap;
    padding: 0 var(--space-md) var(--space-sm);
  }

  .search-box {
    flex: 1 1 100%;
  }

  .toolbar-tail {
    flex: 1 1 100%;
    justify-content: flex-end;
  }
}
</style>
