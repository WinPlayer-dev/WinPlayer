<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ComboBox } from "@/components/winui";
import { toast } from "@/services/toast";
import { clearDataCache, dataCacheSize } from "@/services/cache";
import { useSettingsStore, type CachePolicy } from "@/stores/settings";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();

/** 缓存占用（进入本页与清理后重新统计） */
const imageCount = ref(0);
const imageBytes = ref(0);
const dataBytes = ref(0);
const cacheLoading = ref(false);

/* ------------------------------ 缓存项 ------------------------------ */

const CACHE_OPTIONS: Array<{ label: string; value: CachePolicy }> = [
  { label: t("settings.data.cache.policy.options.playlist"), value: "playlist" },
  { label: t("settings.data.cache.policy.options.images"), value: "images" },
  { label: t("settings.data.cache.policy.options.both"), value: "both" },
  { label: t("settings.data.cache.policy.options.none"), value: "none" },
];

const cacheLabels = computed(() => CACHE_OPTIONS.map((option) => option.label));

const cacheIndex = computed(() =>
  CACHE_OPTIONS.findIndex((option) => option.value === settings.cachePolicy),
);

function onCachePolicyChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  const option = CACHE_OPTIONS.find((entry) => entry.label === label);
  if (option && option.value !== settings.cachePolicy) {
    void settings.setCachePolicy(option.value);
    toast(t("settings.data.cache.policy.updated"), "success");
    void refreshCacheStats();
  }
}

interface CacheStats {
  imageCount: number;
  imageBytes: number;
}

async function refreshCacheStats(): Promise<void> {
  cacheLoading.value = true;
  try {
    const stats = await invoke<CacheStats>("cache_stats");
    imageCount.value = stats.imageCount;
    imageBytes.value = stats.imageBytes;
    dataBytes.value = await dataCacheSize();
  } catch {
    /* 统计失败时保持原值 */
  } finally {
    cacheLoading.value = false;
  }
}

async function clearCache(): Promise<void> {
  cacheLoading.value = true;
  try {
    await invoke<CacheStats>("cache_clear");
    await clearDataCache();
    toast(t("settings.data.cache.clear.done"), "success");
    await refreshCacheStats();
  } catch (error) {
    toast(t("settings.data.cache.clear.failed", { error: String(error) }), "error");
  } finally {
    cacheLoading.value = false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const cacheSummary = computed(() =>
  t("settings.data.cache.summary", {
    size: formatBytes(imageBytes.value),
    count: imageCount.value,
    dataSize: formatBytes(dataBytes.value),
  }),
);

onMounted(() => {
  void refreshCacheStats();
});
</script>

<template>
  <SettingsSection id="data-cache" :title="t('settings.data.cache.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.cache.policy.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.cache.policy.description") }}
        </div>
      </div>
      <ComboBox
        class="card-control"
        :ItemsSource="cacheLabels"
        :SelectedIndex="cacheIndex"
        @SelectionChanged="onCachePolicyChange"
      />
    </WpCard>
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.cache.clear.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.cache.clear.description", { summary: cacheSummary }) }}
        </div>
      </div>
      <WpButton variant="standard" class="small danger" :disabled="cacheLoading" @click="clearCache">
        {{ t("settings.data.cache.clear.action") }}
      </WpButton>
    </WpCard>
  </SettingsSection>
</template>
