<script setup lang="ts">
/**
 * WinUI 数字输入框——可被主题替换。
 *
 * 契约：`Value` 下传、`update:Value` 回传数字；主题实现可直接用
 * `<mdui-text-field type="number">` 之类的 MD3 控件。
 */
import NumberBoxBase from "@/components/winui/NumberBoxBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

withDefaults(
  defineProps<{
    Value?: number;
    Minimum?: number;
    Maximum?: number;
    SmallChange?: number;
    PlaceholderText?: string;
    IsEnabled?: boolean;
  }>(),
  {
    Value: 0,
    Minimum: -Infinity,
    Maximum: Infinity,
    SmallChange: 1,
    PlaceholderText: "",
    IsEnabled: true,
  },
);

defineEmits<{ "update:Value": [value: number] }>();

const ThemedNumberBox = themeSlot("NumberBox", NumberBoxBase);
</script>

<template>
  <ThemedNumberBox
    :Value="Value"
    :Minimum="Minimum"
    :Maximum="Maximum"
    :SmallChange="SmallChange"
    :PlaceholderText="PlaceholderText"
    :IsEnabled="IsEnabled"
    @update:Value="$emit('update:Value', $event)"
  />
</template>
