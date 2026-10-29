<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ComboBox } from "@/components/winui";
import { toast } from "@/services/toast";
import { clearDataCache, dataCacheSize } from "@/services/cache";
import { useSettingsStore, type CachePolicy } from "@/stores/settings";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();

/** 缓存占用（进入本页与清理后重新统计） */
const imageCount = ref(0);
const imageBytes = ref(0);
const dataBytes = ref(0);
const cacheLoading = ref(false);

/* ------------------------------ 缓存项 ------------------------------ */

const CACHE_OPTIONS: Array<{ label: string; value: CachePolicy }> = [
  { label: "歌单", value: "playlist" },
  { label: "图片", value: "images" },
  { label: "歌单与图片", value: "both" },
  { label: "不缓存", value: "none" },
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
    toast("缓存设置已更新，已清除被关闭类型的缓存", "success");
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
    toast("缓存已清除", "success");
    await refreshCacheStats();
  } catch (error) {
    toast(`清除缓存失败: ${error}`, "error");
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

const cacheSummary = computed(
  () =>
    `封面图片 ${formatBytes(imageBytes.value)}（${imageCount.value} 张） · 页面数据 ${formatBytes(dataBytes.value)}`,
);

onMounted(() => {
  void refreshCacheStats();
});
</script>

<template>
  <div>
    <!-- 存储与缓存 -->
    <section class="settings-section">
      <h2 class="settings-section-title">存储与缓存</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">缓存项</div>
          <div class="card-description">
            选择需要缓存的内容（页面数据 / 封面图片）；切换后立即清除被关闭类型的缓存。
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
          <div class="card-header">清除缓存</div>
          <div class="card-description">
            当前占用：{{ cacheSummary }}。清除后将在下次访问时重新下载。
          </div>
        </div>
        <WpButton variant="standard" class="small danger" :disabled="cacheLoading" @click="clearCache">
          清除缓存
        </WpButton>
      </WpCard>
    </section>
  </div>
</template>
