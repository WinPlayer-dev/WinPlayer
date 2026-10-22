<script setup lang="ts">
/**
 * WinUI 输入框——可被主题替换。
 *
 * 分发层：主题覆盖 `TextBox` 时渲染主题组件，否则渲染内置实现（TextBoxBase.vue）。
 * 两边共享同一套 XAML 风格 props / 事件契约，因此调用方无需感知。
 */
import TextBoxBase from "@/components/winui/TextBoxBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

withDefaults(
  defineProps<{
    Text?: string;
    PlaceholderText?: string;
    MaxLength?: number;
    IsReadOnly?: boolean;
    IsEnabled?: boolean;
    /** 输入类型（密码框用 password） */
    InputType?: "text" | "password";
  }>(),
  // 默认值必须与 TextBoxBase 保持一致：否则省略 IsEnabled 时，主题组件会收到
  // undefined 并被判为「禁用」，表现就是设置页的输入框全部点不动
  { Text: "", PlaceholderText: "", MaxLength: 0, IsReadOnly: false, IsEnabled: true, InputType: "text" },
);

defineEmits<{ "update:Text": [value: string] }>();

const ThemedTextBox = themeSlot("TextBox", TextBoxBase);
</script>

<template>
  <ThemedTextBox
    :Text="Text"
    :PlaceholderText="PlaceholderText"
    :MaxLength="MaxLength"
    :IsReadOnly="IsReadOnly"
    :IsEnabled="IsEnabled"
    :InputType="InputType"
    @update:Text="$emit('update:Text', $event)"
  >
    <slot />
  </ThemedTextBox>
</template>
