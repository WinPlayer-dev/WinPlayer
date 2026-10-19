<script setup lang="ts">
/**
 * WinUI 下拉框——可被主题替换。
 *
 * 事件 payload 保持 `{ AddedItems: [label] }` 形状，主题实现需要原样回传，
 * 调用方（设置页等）按这个契约取选中值。
 */
import ComboBoxBase from "@/components/winui/ComboBoxBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

withDefaults(
  defineProps<{
    ItemsSource?: string[];
    SelectedIndex?: number;
    PlaceholderText?: string;
    IsEnabled?: boolean;
  }>(),
  { ItemsSource: () => [], SelectedIndex: -1, PlaceholderText: "", IsEnabled: true },
);

defineEmits<{
  SelectionChanged: [sender: HTMLElement | null, payload: { AddedItems: unknown[] }];
}>();

const ThemedComboBox = themeSlot("ComboBox", ComboBoxBase);
</script>

<template>
  <ThemedComboBox
    :ItemsSource="ItemsSource"
    :SelectedIndex="SelectedIndex"
    :PlaceholderText="PlaceholderText"
    :IsEnabled="IsEnabled"
    @SelectionChanged="
      (sender: HTMLElement | null, payload: { AddedItems: unknown[] }) =>
        $emit('SelectionChanged', sender, payload)
    "
  />
</template>
