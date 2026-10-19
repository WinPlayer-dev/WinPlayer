<script setup lang="ts">
/**
 * 控件可用性探针（仅开发预览用）。
 *
 * 并排渲染宿主分发组件（会自动走主题实现），用来验证：
 * - 省略 IsEnabled 时控件依然可交互（默认应为启用）；
 * - 主题控件的事件契约是否与内置实现一致（输入 / 切换 / 选择都能回传值）。
 */
import { ref } from "vue";
import { ComboBox, NumberBox, Slider, TextBox, ToggleSwitch } from "@/components/winui";

const text = ref("初始文本");
const on = ref(false);
const slider = ref(40);
const number = ref(6);
const combo = ref(1);
const events = ref<string[]>([]);

function note(message: string): void {
  events.value = [message, ...events.value].slice(0, 8);
}

const ITEMS = ["跟随系统", "浅色", "深色"];
</script>

<template>
  <div class="probe">
    <label class="row">
      <span>TextBox</span>
      <TextBox
        :Text="text"
        PlaceholderText="输入点什么"
        @update:Text="
          (value: string) => {
            text = value;
            note(`TextBox → ${value}`);
          }
        "
      />
    </label>

    <label class="row">
      <span>ToggleSwitch</span>
      <ToggleSwitch
        :IsOn="on"
        @Toggled="
          (event: { IsOn: boolean }) => {
            on = event.IsOn;
            note(`ToggleSwitch → ${event.IsOn}`);
          }
        "
      />
    </label>

    <label class="row">
      <span>ComboBox</span>
      <ComboBox
        :ItemsSource="ITEMS"
        :SelectedIndex="combo"
        @SelectionChanged="
          (_sender: HTMLElement | null, payload: { AddedItems: unknown[] }) => {
            const label = String(payload.AddedItems[0] ?? '');
            const index = ITEMS.indexOf(label);
            if (index >= 0) combo = index;
            note(`ComboBox → ${label}`);
          }
        "
      />
    </label>

    <label class="row">
      <span>Slider {{ slider }}</span>
      <Slider
        :Value="slider"
        :Minimum="0"
        :Maximum="100"
        @update:Value="
          (value: number) => {
            slider = value;
            note(`Slider → ${value}`);
          }
        "
      />
    </label>

    <label class="row">
      <span>NumberBox</span>
      <NumberBox
        :Value="number"
        :Minimum="0"
        :Maximum="100"
        @update:Value="
          (value: number) => {
            number = value;
            note(`NumberBox → ${value}`);
          }
        "
      />
    </label>

    <ul class="events">
      <li v-for="(line, index) in events" :key="index">{{ line }}</li>
    </ul>
  </div>
</template>

<style scoped>
.probe {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.row > span:first-child {
  flex: none;
  width: 92px;
  color: var(--wp-text-tertiary);
}

.events {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  color: var(--wp-text-secondary);
  word-break: break-word;
}
</style>
