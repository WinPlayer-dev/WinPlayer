<script setup lang="ts">
/**
 * 设置 → 播放 → 来源偏好。
 *
 * 歌曲信息 / 播放 / 歌词 / 头像四类来源各一个下拉框，外加共用的「搜索格式」。
 * 拆分说明：本文件原本是整张「播放」页（526 行），无缝播放 / 桌面歌词 / 输出设备 /
 * 音效已各自拆成独立 section 文件，这里的下拉框逻辑与选项数组保持同文件
 * （ComboBox 只回传 label，必须靠同文件的 options 反查 value）。
 */
import { computed } from "vue";
import { ComboBox, TextBox } from "@/components/winui";
import { DEFAULT_SOURCE_SEARCH_FORMAT, useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import type { PluginCapability } from "@/types/plugin";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const pluginsStore = usePluginsStore();

interface SourceKindConfig {
  key: "trackSourceId" | "playSourceId" | "lyricsSourceId" | "avatarSourceId";
  title: string;
  description: string;
  /** 插件需具备的能力（须全部满足才会出现在下拉框中） */
  capabilities: PluginCapability[];
}

const SOURCE_KINDS: SourceKindConfig[] = [
  {
    key: "trackSourceId",
    title: "歌曲信息源",
    description: "搜索结果聚合时，该插件的结果排在前面",
    capabilities: ["search"],
  },
  {
    key: "playSourceId",
    title: "播放源",
    description: "播放时在该插件重新搜曲并取其直链；搜不到时回退歌曲自身来源",
    capabilities: ["search", "songUrl"],
  },
  {
    key: "lyricsSourceId",
    title: "歌词源",
    description: "取歌词时在该插件重新搜曲后取词；取不到时回退歌曲自身来源",
    capabilities: ["search", "lyrics"],
  },
  {
    key: "avatarSourceId",
    title: "头像源",
    description: "右上角头像优先从该插件获取，取不到时再试其他插件",
    capabilities: ["avatar"],
  },
];

interface SourceOption {
  label: string;
  /** 插件 ID，空串表示默认（自动） */
  value: string;
}

/** 各来源下拉框选项：默认 + 按能力过滤后的已启用插件 */
const sourceOptions = computed(() =>
  SOURCE_KINDS.map((kind) => {
    const options: SourceOption[] = [{ label: "默认", value: "" }];
    for (const record of pluginsStore.enabledRecords) {
      if (kind.capabilities.every((capability) => pluginsStore.hasCapability(record, capability))) {
        options.push({ label: record.entry.manifest.name, value: record.entry.id });
      }
    }
    return { kind, options };
  }),
);

function sourceIndex(currentValue: string, options: SourceOption[]): number {
  const index = options.findIndex((option) => option.value === currentValue);
  return index >= 0 ? index : 0;
}

/**
 * 来源下拉框的行数据：每行预构造好带类型的 SelectionChanged 处理器。
 * 不能在模板里写内联箭头（模板表达式无法标注参数类型，且调用表达式会被
 * Vue 当作内联语句丢弃返回值），因此这里提前柯里化好，模板直接以标识符引用。
 */
const sourceRows = computed(() =>
  sourceOptions.value.map(({ kind, options }) => ({
    kind,
    options,
    onSelect: (sender: unknown, payload?: { AddedItems?: unknown[] }): void => {
      onSourceSelectionChanged(kind, options, sender, payload);
    },
  })),
);

function onSourceSelectionChanged(
  kind: SourceKindConfig,
  options: SourceOption[],
  _sender: unknown,
  payload?: { AddedItems?: unknown[] },
): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = options.find((entry) => entry.label === label);
  if (option && option.value !== settings[kind.key]) {
    void settings.setSourcePreference(kind.key, option.value);
  }
}

/** 配置了播放源或歌词源时才显示「搜索格式」输入框（两者共用） */
const showSearchFormat = computed(() => Boolean(settings.playSourceId || settings.lyricsSourceId));

function onFormatChange(value: unknown): void {
  void settings.setSourceSearchFormat(String(value ?? ""));
}
</script>

<template>
  <SettingsSection id="playback-source" title="来源偏好">
    <WpCard variant="row" v-for="{ kind, options, onSelect } in sourceRows" :key="kind.key">
      <div class="card-content">
        <div class="card-header">{{ kind.title }}</div>
        <div class="card-description">{{ kind.description }}</div>
      </div>
      <ComboBox
        class="card-control"
        :ItemsSource="options.map((option) => option.label)"
        :SelectedIndex="sourceIndex(settings[kind.key], options)"
        @SelectionChanged="onSelect"
      />
    </WpCard>

    <WpCard variant="column" v-if="showSearchFormat">
      <div class="card-content">
        <div class="card-header">搜索格式</div>
        <div class="card-description">
          播放源、歌词源重新搜曲的关键词格式，支持 {歌曲名}、{歌手名}、{专辑名}、{别名}；
          留空使用默认「{{ DEFAULT_SOURCE_SEARCH_FORMAT }}」。
        </div>
      </div>
      <TextBox
        class="format-input"
        :Text="settings.sourceSearchFormat"
        :PlaceholderText="DEFAULT_SOURCE_SEARCH_FORMAT"
        @update:Text="onFormatChange"
      />
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
.format-input {
  width: 100%;
}
</style>
