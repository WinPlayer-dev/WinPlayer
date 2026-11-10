/**
 * 手机端歌曲列表页布局（设置 → 外观 → 布局）。
 *
 * 布局只影响**手机端**：桌面端窗口宽、表头列多，套云音乐那套「渐变头部 + 白色面板」
 * 反而会把信息压扁，所以 `cloud` 在桌面端不生效（设置项本身在桌面端也不渲染）。
 *
 * 页面通过两样东西接入：
 * 1. `useSongListLayout()` —— 拿到「当前是否云端」，用来挂根节点 class / 决定包裹结构；
 * 2. `useCloudHeaderGradient(cover)` —— 拿到头部渐变要用的封面主色（CSS 变量）。
 *
 * 样式的生效开关是 `<html data-song-layout="cloud">`，由 App.vue 单向写入，
 * 这样新增列表页时只要挂 class 即可，不必在每个页面重复写渐变 / 面板的 CSS。
 */

import { computed, ref, watch, type CSSProperties, type Ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import { coverDominantColor } from "@/services/coverAccent";

/** 云端布局当前是否生效（桌面端恒为 false） */
export function useSongListLayout() {
  const settings = useSettingsStore();
  const isMobile = useIsMobile();
  return computed(() => isMobile && settings.songListLayout === "cloud");
}

/**
 * 从页面封面提取主色，产出头部渐变用的 CSS 变量。
 *
 * 取色失败（没有封面 / 封面没落盘且不在前台）时不写变量，CSS 里回落到主题强调色，
 * 所以调用方不需要处理空值。
 */
export function useCloudHeaderGradient(cover: Ref<string | null | undefined>) {
  const accent = ref<string | null>(null);

  watch(
    cover,
    async (value) => {
      if (!value) {
        accent.value = null;
        return;
      }
      const hex = await coverDominantColor(value);
      // 异步返回时封面可能已经换了，丢弃过期结果
      if (cover.value !== value) return;
      accent.value = hex;
    },
    { immediate: true },
  );

  return computed<CSSProperties>(() =>
    accent.value ? ({ "--cloud-accent": accent.value } as CSSProperties) : {},
  );
}
