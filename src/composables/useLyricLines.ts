/**
 * 歌词时间轴与外观：偏移校准、当前行、层级判定、CSS 变量、自动居中、点击跳转。
 *
 * 手机全屏播放页（`MobilePlayerBar`）与桌面沉浸页（`NowPlayingPage`）共用这一份，
 * 保证两端体验完全一致 —— 连按曲目持久化的歌词偏移都是同一个 key：
 * 在手机上把某首歌的歌词调早 0.5s，PC 上打开也是调好的。
 *
 * 样式本身写在 `styles/lyrics-style.css`，这里只负责把配置翻译成 `--lrc-*` 变量。
 */
import { computed, ref, watch, type Ref } from "vue";
import { useAutoCenter, SCROLL_DURATION_BASE } from "@/composables/useAutoCenter";
import { getSetting, setSetting } from "@/services/db";
import { findLyricIndex } from "@/services/lrc";
import { LYRIC_ANCHOR_RATIO, LYRIC_EASE_FN, lyricStyleClasses, lyricStyleVars } from "@/services/lyricStyle";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

export interface LyricLinesOptions {
  /** 歌词滚动容器 */
  container: Ref<HTMLElement | null>;
  /** 场景是否可见：不可见时不做自动居中（避免给隐藏元素算滚动） */
  isActive: () => boolean;
  /** 模糊层级的作用跨度（行数）。视口越高传越大，否则外侧行会「没模糊却已很淡」 */
  focusSpan?: number;
  /** 字号基准倍数：手机 1，桌面大屏按比例放大（配置里的 px 是手机基准值） */
  fontScale?: number;
}

/** 歌词偏移的上下限（±5s），超过这个范围基本是误操作 */
const OFFSET_LIMIT = 5000;

/** 边缘渐隐带相对容器高度的上限：歌词区再高，一条渐隐带也不该超过两成 */
const FADE_MAX_RATIO = 0.2;
/** 当前行边缘与渐隐带之间留的余量（px），避免刚好像贴着渐变起点一样发灰 */
const FADE_PADDING = 14;

export function useLyricLines(options: LyricLinesOptions) {
  const player = usePlayerStore();
  const settings = useSettingsStore();
  const { container, isActive, focusSpan = 9, fontScale = 1 } = options;

  /* ------------------------------ 偏移校准 ------------------------------ */

  /** 歌词偏移（毫秒，正值 = 歌词整体后移、更晚出现） */
  const lyricOffset = ref(0);

  function lyricOffsetKey(): string | null {
    const track = player.currentTrack;
    return track ? `lyric.offset:${track.sourceId ?? ""}:${track.id}` : null;
  }

  async function loadLyricOffset(): Promise<void> {
    const key = lyricOffsetKey();
    lyricOffset.value = 0;
    if (!key) return;
    lyricOffset.value = await getSetting<number>(key, 0);
  }

  function persistLyricOffset(value: number): void {
    const key = lyricOffsetKey();
    if (!key) return;
    void setSetting(key, value);
  }

  /** 微调歌词偏移：正值让歌词更晚出现 */
  function shiftLyricOffset(delta: number): void {
    lyricOffset.value = Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, lyricOffset.value + delta));
    persistLyricOffset(lyricOffset.value);
  }

  function resetLyricOffset(): void {
    lyricOffset.value = 0;
    persistLyricOffset(0);
  }

  /** 偏移显示文案，如 +0.5s / −1.0s */
  const offsetLabel = computed(
    () => `${lyricOffset.value >= 0 ? "+" : "−"}${(Math.abs(lyricOffset.value) / 1000).toFixed(1)}s`,
  );

  // 切歌时重新读取该曲目自己的偏移（首次挂载也走一次）
  watch(
    () => player.currentTrack,
    () => {
      void loadLyricOffset();
    },
    { immediate: true },
  );

  /* ------------------------------ 时间轴 ------------------------------ */

  /** 当前歌词行（已按偏移校正，-1 表示尚未开始） */
  const activeIndex = computed(() =>
    findLyricIndex(player.lyrics, player.currentTime * 1000 - lyricOffset.value),
  );

  /** 歌词行：原文 + 对照翻译（翻译只挂在该行自己的时间轴上，没有就是空） */
  const lyricRows = computed(() =>
    player.lyrics.map((line) => ({
      time: line.time,
      text: line.text,
      translation: line.translation ?? "",
    })),
  );

  /**
   * 视觉层级：0 当前行 / 1~3 逐级模糊渐隐 / 4 远端仅压暗。
   * 档位按 focusSpan 均分，超过跨度的行不再加模糊（此时已滚出视口），以控制渲染开销。
   */
  function lineLevel(index: number): number {
    const distance = Math.abs(index - activeIndex.value);
    if (distance === 0) return 0;
    if (distance >= focusSpan) return 4;
    return Math.min(3, Math.ceil((distance / focusSpan) * 3));
  }

  /** 歌词外观（设置 → 外观 → 歌词样式） */
  const baseLyricVars = computed(() => lyricStyleVars(settings.lyricsStyle, fontScale));
  const lyricClasses = computed(() => lyricStyleClasses(settings.lyricsStyle));

  /**
   * 边缘渐隐带的宽度（px），覆盖 `--lrc-fade-top` / `--lrc-fade-bottom`。
   *
   * 渐隐带是容器级的 `mask`，跟行高无关；而「靠上」播放时当前行中心只到
   * 容器 30% 的位置，一旦这一行折成三四行（字号大 + 长句 + 翻译），行顶
   * 就落进了渐隐区，高亮行的上半截被压暗 —— 看起来像盖了层灰影。
   *
   * 所以这里按「当前行上沿到容器顶还剩多少空间」动态收窄：先吃掉那段余量
   * 的一部分，再与 20% 的上限取小；余量本来就不够时就压到 0，宁可不渐隐
   * 也不能糊住正在唱的那一句。
   */
  const fadeVars = ref<Record<string, string>>({});

  function updateFadeVars(itemHeight: number, containerHeight: number): void {
    if (containerHeight <= 0) return;
    const anchor = LYRIC_ANCHOR_RATIO[settings.lyricsStyle.alignY] ?? 0.5;
    const half = itemHeight / 2;
    const cap = containerHeight * FADE_MAX_RATIO;
    // 行顶 / 行底到容器边缘的剩余空间：渐隐带只能吃其中的一小部分
    const roomTop = containerHeight * anchor - half;
    const roomBottom = containerHeight * (1 - anchor) - half;
    const fade = (room: number): string =>
      `${Math.round(Math.min(cap, Math.max(0, room - FADE_PADDING)))}px`;
    fadeVars.value = {
      "--lrc-fade-top": fade(roomTop),
      "--lrc-fade-bottom": fade(roomBottom),
    };
  }

  /** 外观变量 = 配置翻译出的 `--lrc-*` + 按行高算出的渐隐带 */
  const lyricVars = computed(() => ({ ...baseLyricVars.value, ...fadeVars.value }));

  /** 点击歌词行：按偏移校正后的时间跳转，使该行成为当前行 */
  function seekToLine(index: number): void {
    const row = lyricRows.value[index];
    if (!row) return;
    player.seek((row.time + lyricOffset.value) / 1000);
  }

  // 当前行自动对齐到设置的位置（靠上 / 居中 / 靠下）；用户手动滚动后延迟回正
  useAutoCenter({
    container,
    // 类名与 styles/lyrics-style.css 保持一致（设置页预览复用同一套类名）
    itemSelector: ".wp-lrc-line",
    getIndex: () => activeIndex.value,
    isActive,
    // 设置里改「靠上 / 靠下」，立刻平移到新位置
    getAnchor: () => LYRIC_ANCHOR_RATIO[settings.lyricsStyle.alignY] ?? 0.5,
    // 歌词滚动速度：速度倍数越大，同样距离花的时间越短
    getDuration: () => SCROLL_DURATION_BASE / (settings.lyricsStyle.scrollSpeed || 1),
    // 曲线与 CSS 行过渡共用同一选项（缓出 / 缓入缓出）
    getEasing: () => LYRIC_EASE_FN[settings.lyricsStyle.scrollEasing] ?? LYRIC_EASE_FN.out,
    // 当前行高度 → 渐隐带宽度（靠上播放 + 长句折行时不糊住高亮行）
    onMeasure: ({ itemHeight, containerHeight }) => updateFadeVars(itemHeight, containerHeight),
    // 桌面沉浸页挂载时就已可见（没有 false→true 的变化），需要立即对齐一次；
    // 手机端此时 isActive 还是 false，watch 会直接跳过，不受影响。
    immediate: true,
  });

  return {
    lyricOffset,
    offsetLabel,
    shiftLyricOffset,
    resetLyricOffset,
    activeIndex,
    lyricRows,
    lineLevel,
    lyricVars,
    lyricClasses,
    seekToLine,
  };
}
