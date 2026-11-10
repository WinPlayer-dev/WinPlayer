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
 * 只影响手机全屏播放页；桌面端 `PlayerBarBase` 的歌词面板与桌面歌词窗口
 * 各自有独立的外观设置，互不干扰。
 */

import type { LyricFontPreset, LyricsStyleConfig } from "@/stores/settings";

/** 字体预设下拉项：label 展示、hint 在卡片描述里提示跨端差异 */
export const LYRIC_FONT_OPTIONS: ReadonlyArray<{
  value: LyricFontPreset;
  label: string;
  hint: string;
}> = [
  { value: "default", label: "跟随应用", hint: "与界面使用同一套字体，最稳" },
  { value: "sans", label: "无衬线（黑体）", hint: "思源黑体 / HarmonyOS Sans 一类，清晰现代" },
  { value: "serif", label: "衬线（宋体）", hint: "宋体 / Noto Serif，适合慢歌与老歌" },
  { value: "round", label: "圆体", hint: "圆润可爱，系统没有圆体时回落到黑体" },
  { value: "kai", label: "楷体", hint: "手写感，系统没有楷体时回落到宋体" },
  { value: "mono", label: "等宽", hint: "数字与英文更整齐，适合电子 / 说唱" },
  { value: "custom", label: "自定义", hint: "填系统里已安装的字体名" },
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
export function lyricStyleVars(style: LyricsStyleConfig): Record<string, string> {
  const opacity = style.inactiveOpacity;
  // 关闭模糊时三级全部归零，亮度层级仍保留（否则整屏一样亮，找不到当前行）
  const blur = style.blurInactive ? style.blurStrength : 0;
  const scale = style.enlargeActive ? style.activeScale : 1;
  const activeWeight = style.activeBold ? Math.max(style.fontWeight, 700) : style.fontWeight;

  return {
    "--lrc-size": `${round(style.fontSize)}px`,
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
  };
}

/** 容器类名：对齐方向与上下边缘渐隐（两者影响的是容器而不是单行） */
export function lyricStyleClasses(style: LyricsStyleConfig): Record<string, boolean> {
  return {
    "align-left": style.align === "left",
    "no-fade": !style.maskFade,
  };
}
