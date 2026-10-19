<script setup lang="ts">
/**
 * WinUI 开关——可被主题替换。
 *
 * 契约：`IsOn` 下传、`Toggled` 事件回传 `{ IsOn }`；主题实现必须保持该形状。
 */
import ToggleSwitchBase from "@/components/winui/ToggleSwitchBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

withDefaults(
  defineProps<{
    IsOn?: boolean;
    IsEnabled?: boolean;
  }>(),
  { IsOn: false, IsEnabled: true },
);

defineEmits<{ Toggled: [event: { IsOn: boolean }] }>();

const ThemedToggleSwitch = themeSlot("ToggleSwitch", ToggleSwitchBase);
</script>

<template>
  <ThemedToggleSwitch
    :IsOn="IsOn"
    :IsEnabled="IsEnabled"
    @Toggled="$emit('Toggled', $event)"
  />
</template>
