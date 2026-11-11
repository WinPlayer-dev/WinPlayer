/**
 * 歌词外观（设置 → 外观 → 歌词样式）在运行时的落地。
 *
 * 只做一件事：把持久化配置翻译成一组 CSS 变量（`--lrc-*`），由
 * `styles/lyrics-style.css` 消费。
 *
 * 为什么走变量而不是给每种组合生成类名：
 * 手机全屏播放页和设置页里的「实时预览」用的是同一份 CSS，变量能让两处
 * 共用一套样式 —— 预览所见即所得，不会出现「设置页好看、实际播放不一样」。
 *
 * 作用范围：手机全屏播放页、桌面沉浸式正在播放页（`NowPlayingPage`）与设置页实时预览。
 * 桌面歌词悬浮窗（独立窗口）另有自己的字号设置，不走这套变量。
 *
 * 配置里的字号是**手机基准值**（12–30px），桌面页按 `fontScale` 等比放大——
 * 同一份配置在宽屏上不会显得又小又稀，但两边仍然是「改一处、两端一起变」。
 */

import type { LyricAnchor, LyricEasing, LyricFontPreset, LyricsStyleConfig } from "@/stores/settings";

/**
 * 桌面沉浸式正在播放页的字号基准倍数。
 *
 * 配置里存的是**手机基准值**（12–30px，412px 宽屏下的观感），直接搬到大窗口
 * 会又小又稀；桌面页按这个系数等比放大。设置页的实时预览也按它渲染，
 * 所以两端看到的都是真实效果，而配置仍然只有一份。
 */
export const DESKTOP_LYRIC_FONT_SCALE = 1.3;

/**
 * 当前行在歌词区里的垂直位置 → 容器高度上的比例（0 = 顶部，1 = 底部）。
 *
 * 靠上取 0.3、靠下取 0.72：再往外会让上下几乎没有「上下文行」，
 * 反而不容易看出下一句是什么。
 */
export const LYRIC_ANCHOR_RATIO: Record<LyricAnchor, number> = {
  top: 0.3,
  center: 0.5,
  bottom: 0.72,
};

/**
 * 歌词行过渡（字号、字重、明暗、模糊）的基准时长（毫秒）。
 * 实际时长 = 它 / scrollSpeed，与滚动保持一致的手感：调快时行切换也跟着利落。
 */
export const LYRIC_LINE_DURATION_BASE = 340;

/**
 * 缓动曲线：CSS 用贝塞尔，JS 补间用同形状的函数（见 useAutoCenter）。
 *
 * - `out`：`1-(1-t)³`，起步快、收尾缓 —— 跨多行滚动时不会「咕噔」一下停住；
 * - `inout`：`t<.5 ? 4t³ : 1-(-2t+2)³/2`，两头慢、中间快，慢歌更贴。
 * 两者与下面 CSS 里选的贝塞尔曲线感知接近，不会出现「滚动和行过渡节奏不一样」。
 */
export const LYRIC_EASE_CSS: Record<LyricEasing, string> = {
  out: "cubic-bezier(0.33, 0, 0.2, 1)",
  inout: "cubic-bezier(0.65, 0, 0.35, 1)",
};

/** 与 `LYRIC_EASE_CSS` 对应的 JS 缓动函数 */
export const LYRIC_EASE_FN: Record<LyricEasing, (t: number) => number> = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/** 字体预设的**可选值**。显示名与说明在 settings/appearance.ts 的词条里（服务层不放界面文案） */
export const LYRIC_FONT_OPTIONS: readonly LyricFontPreset[] = [
  "default",
  "sans",
  "serif",
  "round",
  "kai",
  "mono",
  "custom",
];

/**
 * 预设 → CSS font-family 栈。
 * 全是系统字体（WebView 无法加载应用外字体），所以每个栈都写了完整备选链，
 * 找不到时逐级回落，绝不会变成方块或空字体。
 */
const FONT_STACKS: Record<Exclude<LyricFontPreset, "custom">, string> = {
  default: "",
  sans: 'system-ui, -apple-system, "Segoe UI", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  round: '"Yuanti SC", "HarmonyOS Sans SC", "MiSans", "PingFang SC", sans-serif',
  kai: '"Kaiti SC", KaiTi, STKaiti, "AR PL UKai CN", serif',
  mono: 'ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
};

/** 解析实际 font-family 值；空串表示不覆盖（继承界面字体） */
export function lyricFontFamily(style: LyricsStyleConfig): string {
  if (style.fontPreset === "custom") return style.fontCustom.trim();
  return FONT_STACKS[style.fontPreset] ?? "";
}

/** 保留两位小数，避免 `0.6799999` 这种浮点尾巴写进 style 属性 */
function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * 配置 → CSS 变量。
 *
 * 非当前行的「逐渐变淡」由 `inactiveOpacity`（紧邻当前行那一档）按比例推导，
 * 这样用户只需要调一个滑杆，四层层级仍然保持原设计的比例关系。
 */
export function lyricStyleVars(
  style: LyricsStyleConfig,
  /** 字号基准倍数：手机 1，桌面大屏约 1.3（配置里存的是手机基准值） */
  fontScale = 1,
): Record<string, string> {
  const opacity = style.inactiveOpacity;
  // 关闭模糊时三级全部归零，亮度层级仍保留（否则整屏一样亮，找不到当前行）
  const blur = style.blurInactive ? style.blurStrength : 0;
  const scale = style.enlargeActive ? style.activeScale : 1;
  const activeWeight = style.activeBold ? Math.max(style.fontWeight, 700) : style.fontWeight;

  return {
    "--lrc-size": `${round(style.fontSize * fontScale)}px`,
    "--lrc-weight": String(style.fontWeight),
    "--lrc-scale": round(scale),
    "--lrc-active-weight": String(activeWeight),
    "--lrc-font": lyricFontFamily(style) || "inherit",
    "--lrc-gap": `${round(style.lineGap)}px`,
    "--lrc-op-1": round(opacity),
    "--lrc-op-2": round(opacity * 0.66),
    "--lrc-op-3": round(opacity * 0.4),
    "--lrc-op-4": round(opacity * 0.22),
    "--lrc-blur-1": `${round(0.6 * blur)}px`,
    "--lrc-blur-2": `${round(1.4 * blur)}px`,
    "--lrc-blur-3": `${round(2.4 * blur)}px`,
    "--lrc-glow": `${round(12 * style.glow)}px`,
    "--lrc-glow-alpha": round(0.45 * style.glow),
    // 行过渡时长与曲线：跟随「歌词滚动」的速度与缓动选项，
    // 这样放大 / 加粗 / 变淡与滚动是同一个节奇
    "--lrc-dur": `${Math.round(LYRIC_LINE_DURATION_BASE / (style.scrollSpeed || 1))}ms`,
    "--lrc-ease": LYRIC_EASE_CSS[style.scrollEasing] ?? LYRIC_EASE_CSS.out,
    // 当前行在容器上的比例位置：CSS 拿它兜底算「上下边缘渐隐带」的宽度
    // （运行时会被 useLyricLines 按当前行实际高度改写成精确 px）
    "--lrc-anchor": String(LYRIC_ANCHOR_RATIO[style.alignY] ?? 0.5),
  };
}

/** 容器类名：对齐方向与上下边缘渐隐（两者影响的是容器而不是单行） */
export function lyricStyleClasses(style: LyricsStyleConfig): Record<string, boolean> {
  return {
    "align-left": style.align === "left",
    "no-fade": !style.maskFade,
  };
}
