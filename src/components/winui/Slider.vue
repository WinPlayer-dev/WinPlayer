<script setup lang="ts">
/**
 * WinUI 滑杆——可被主题替换。
 *
 * 契约：`Value` 单向下传、`update:Value` 事件回传（父组件负责写回），
 * 其余属性原样透传。
 */
import SliderBase from "@/components/winui/SliderBase.vue";
import { themeSlot } from "@/components/theme/themeSlot";

withDefaults(
  defineProps<{
    Value?: number;
    Minimum?: number;
    Maximum?: number;
    StepFrequency?: number;
    SmallChange?: number;
    LargeChange?: number;
    Orientation?: "Horizontal" | "Vertical";
    IsEnabled?: boolean;
    IsThumbToolTipEnabled?: boolean;
    ThumbToolTipValueConverter?: (value: number) => string;
  }>(),
  {
    Value: 0,
    Minimum: 0,
    Maximum: 100,
    StepFrequency: 1,
    SmallChange: 1,
    LargeChange: 10,
    Orientation: "Horizontal",
    IsEnabled: true,
    IsThumbToolTipEnabled: true,
  },
);

defineEmits<{ "update:Value": [value: number] }>();

const ThemedSlider = themeSlot("Slider", SliderBase);
</script>

<template>
  <ThemedSlider
    :Value="Value"
    :Minimum="Minimum"
    :Maximum="Maximum"
    :StepFrequency="StepFrequency"
    :SmallChange="SmallChange"
    :LargeChange="LargeChange"
    :Orientation="Orientation"
    :IsEnabled="IsEnabled"
    :IsThumbToolTipEnabled="IsThumbToolTipEnabled"
    :ThumbToolTipValueConverter="ThumbToolTipValueConverter"
    @update:Value="$emit('update:Value', $event)"
  />
</template>
