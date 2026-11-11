/**
 * 设置项的**唯一真源**：分组表 + 条目索引 + 搜索/高亮纯函数。
 *
 * 为什么手写而不是运行时抓 DOM：设置页用 `<component :is>` 一次只挂载一个分类，
 * 其余分类的 DOM 根本不存在，采集不到全量。所以索引必须静态维护。
 *
 * 维护约定：
 * - 新增/改名设置项时，同时更新这里与面板模板里的 `.card-header` 文案；
 * - 新增/改名分组时，同时更新 `SETTINGS_SECTIONS` 与模板里的
 *   `<SettingsSection id title>`；
 * - 漂移由 SettingsView.vue 里的开发期校验兜底（DEV 下比对 DOM 的
 *   `data-section-id` 与本文件的 section 列表）。
 */

import { categoryLabel, type SettingsCategoryKey } from "./categories";
import { locale, t, type I18nKey } from "@/i18n";

/* ------------------------------ 分组 ------------------------------ */

export interface SettingsSectionMeta {
  /** 全局唯一，同时是 `<SettingsSection id>` 与 DOM 上的 data-section-id */
  id: string;
  category: SettingsCategoryKey;
  /**
   * 分组标题的**词条 key**，与模板里 `<SettingsSection :title>` 引用同一个 key。
   *
   * 这里存 key 而不是文案：分组标题在 chips、搜索归属行、漂移校验三处都要用，
   * 抄一份字面量必然漏改。取文本用 `sectionTitle()`。
   */
  titleKey: I18nKey;
  /** 只在部分平台渲染：开发期漂移校验跳过「缺失」，chips 也按 DOM 过滤 */
  optional?: boolean;
}

/**
 * 每个分类包含哪些分组，按页面里的展示顺序排列。
 * 这张表同时驱动：分组 chips、搜索结果的「分类 › 分组」归属、开发期漂移校验。
 */
export const SETTINGS_SECTIONS: Record<SettingsCategoryKey, SettingsSectionMeta[]> = {
  general: [
    { id: "general-language", category: "general", titleKey: "settings.general.language.section" },
    { id: "general-startup", category: "general", titleKey: "settings.general.startup.section" },
    { id: "general-window", category: "general", titleKey: "settings.general.window.section", optional: true },
    { id: "general-car", category: "general", titleKey: "settings.general.car.section", optional: true },
    { id: "general-feedback", category: "general", titleKey: "settings.general.feedback.section", optional: true },
    { id: "general-search", category: "general", titleKey: "settings.general.search.section" },
    { id: "general-privacy", category: "general", titleKey: "settings.general.privacy.section" },
    { id: "general-update", category: "general", titleKey: "settings.general.update.section" },
  ],
  shortcut: [
    { id: "shortcut-app", category: "shortcut", titleKey: "settings.shortcut.app.section" },
    { id: "shortcut-global", category: "shortcut", titleKey: "settings.shortcut.global.section", optional: true },
  ],
  appearance: [
    { id: "appearance-colors", category: "appearance", titleKey: "settings.appearance.colors.section" },
    { id: "appearance-theme", category: "appearance", titleKey: "settings.appearance.theme.section" },
    // 只影响手机端列表页，桌面端不渲染该分组
    { id: "appearance-layout", category: "appearance", titleKey: "settings.appearance.layout.section", optional: true },
    // 手机全屏页与桌面沉浸式正在播放页共用同一份配置
    { id: "appearance-lyrics", category: "appearance", titleKey: "settings.appearance.lyrics.section" },
    { id: "appearance-font", category: "appearance", titleKey: "settings.appearance.font.section" },
    { id: "appearance-motion", category: "appearance", titleKey: "settings.appearance.motion.section" },
  ],
  playback: [
    { id: "playback-source", category: "playback", titleKey: "settings.playback.source.section" },
    { id: "playback-gapless", category: "playback", titleKey: "settings.playback.gapless.section" },
    { id: "playback-lyrics", category: "playback", titleKey: "settings.playback.desktopLyrics.section", optional: true },
    { id: "playback-output", category: "playback", titleKey: "settings.playback.output.section", optional: true },
    { id: "playback-eq", category: "playback", titleKey: "settings.playback.equalizer.section" },
  ],
  plugins: [{ id: "plugins-market", category: "plugins", titleKey: "settings.plugins.market.section" }],
  data: [
    { id: "data-cache", category: "data", titleKey: "settings.data.cache.section" },
    { id: "data-download", category: "data", titleKey: "settings.data.download.section" },
    { id: "data-backup", category: "data", titleKey: "settings.data.backup.section" },
    { id: "data-cloud", category: "data", titleKey: "settings.data.cloud.section" },
  ],
  experimental: [
    { id: "experimental-studio", category: "experimental", titleKey: "settings.experimental.studio.section" },
    { id: "experimental-auto-playlist", category: "experimental", titleKey: "settings.experimental.autoPlaylist.section" },
  ],
  about: [
    { id: "about-hero", category: "about", titleKey: "settings.about.hero.section" },
    { id: "about-update", category: "about", titleKey: "settings.about.update.section" },
    { id: "about-notices", category: "about", titleKey: "settings.about.notices.section" },
  ],
};

export const SECTION_BY_ID = new Map(
  Object.values(SETTINGS_SECTIONS)
    .flat()
    .map((section) => [section.id, section]),
);

/* ------------------------------ 条目 ------------------------------ */

export interface SettingsItem {
  /** 全局唯一：`<分类>.<分组>.<项>`，同时作为 `?focus=` 的值 */
  id: string;
  category: SettingsCategoryKey;
  sectionId: string;
  /** 卡片标题的词条 key，与模板里的 `.card-header` 引用同一个 key */
  titleKey: I18nKey;
  /**
   * 搜索摘要的词条 key。
   *
   * 注意它**不是**卡片描述：卡片描述讲「这个开关做什么」，搜索摘要讲「你为什么
   * 会搜到它」（同义词、使用场景、别名），两者内容有意不同，见
   * `locales/zh-CN/settings/searchHints.ts` 的说明。
   */
  descriptionKey: I18nKey;
  /** 用户可能搜的口语词（权重高于描述、低于标题） */
  aliases?: string[];
  /** 英文名 / 旧分类名 / 同义词 */
  keywords?: string[];
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  /* ---------- 通用 ---------- */
  {
    id: "general.language.interface",
    category: "general",
    sectionId: "general-language",
    titleKey: "settings.general.language.interface.title",
    descriptionKey: "settings.general.language.interface.description",
    aliases: ["语言", "语言设置", "中文", "英文", "汉化"],
    keywords: ["language", "locale", "i18n", "lang"],
  },
  {
    id: "general.startup.page",
    category: "general",
    sectionId: "general-startup",
    titleKey: "settings.general.startup.page.title",
    descriptionKey: "settings.general.startup.page.description",
    aliases: ["启动页", "首页", "默认页面", "开机进入"],
    keywords: ["startup", "home"],
  },
  {
    id: "general.startup.onboarding",
    category: "general",
    sectionId: "general-startup",
    titleKey: "settings.general.startup.onboarding.title",
    descriptionKey: "settings.general.startup.onboarding.description",
    aliases: ["新手引导", "引导", "欢迎页", "教程"],
    keywords: ["onboarding", "welcome"],
  },
  {
    id: "general.window.remember",
    category: "general",
    sectionId: "general-window",
    titleKey: "settings.general.window.remember.title",
    descriptionKey: "settings.general.window.remember.description",
    aliases: ["窗口大小", "窗口位置", "重置窗口", "最大化"],
    keywords: ["window", "size", "position"],
  },
  {
    id: "general.window.closeBehavior",
    category: "general",
    sectionId: "general-window",
    titleKey: "settings.general.window.closeBehavior.title",
    descriptionKey: "settings.general.window.closeBehavior.description",
    aliases: ["托盘", "最小化到托盘", "关闭后退出", "关窗", "后台运行"],
    keywords: ["tray", "minimize", "quit", "close"],
  },
  {
    id: "general.window.backgroundOptimize",
    category: "general",
    sectionId: "general-window",
    titleKey: "settings.general.window.background.title",
    descriptionKey: "settings.general.window.background.description",
    aliases: ["后台", "省电", "降低占用", "卡顿"],
    keywords: ["optimize", "background"],
  },
  {
    id: "general.window.smtc",
    category: "general",
    sectionId: "general-window",
    titleKey: "settings.general.window.smtc.title",
    descriptionKey: "settings.general.window.smtc.description",
    aliases: ["媒体控件", "锁屏", "蓝牙控制", "SMTC", "系统媒体"],
    keywords: ["smtc", "media", "thumbnail"],
  },
  {
    id: "general.car.lyrics",
    category: "general",
    sectionId: "general-car",
    titleKey: "settings.general.car.lyrics.title",
    descriptionKey: "settings.general.car.lyrics.description",
    aliases: ["车载", "车机", "媒体控件歌词"],
    keywords: ["car", "lyrics"],
  },
  {
    id: "general.feedback.haptics",
    category: "general",
    sectionId: "general-feedback",
    titleKey: "settings.general.feedback.vibration.title",
    descriptionKey: "settings.general.feedback.vibration.description",
    aliases: ["震动", "触感", "振动", "haptic"],
    keywords: ["haptics", "vibrate"],
  },
  {
    id: "general.search.aggregate",
    category: "general",
    sectionId: "general-search",
    titleKey: "settings.general.search.aggregate.title",
    descriptionKey: "settings.general.search.aggregate.description",
    aliases: ["全部Tab", "搜索聚合", "多源搜索"],
    keywords: ["aggregate", "search"],
  },
  {
    id: "general.privacy.history",
    category: "general",
    sectionId: "general-privacy",
    titleKey: "settings.general.privacy.history.title",
    descriptionKey: "settings.general.privacy.history.description",
    aliases: ["播放历史", "听歌记录", "历史记录", "隐私"],
    keywords: ["history", "privacy"],
  },
  {
    id: "general.privacy.demoMode",
    category: "general",
    sectionId: "general-privacy",
    titleKey: "settings.general.privacy.demoMode.title",
    descriptionKey: "settings.searchHints.general.privacyDemoMode",
    aliases: ["演示模式", "录屏", "截图", "打码", "隐藏来源"],
    keywords: ["demo", "screenshot"],
  },
  {
    id: "general.update.autoCheck",
    category: "general",
    sectionId: "general-update",
    titleKey: "settings.general.update.auto.title",
    descriptionKey: "settings.searchHints.general.updateAutoCheck",
    aliases: ["更新", "升级", "新版本", "自动升级"],
    keywords: ["update", "auto"],
  },
  {
    id: "general.update.frequency",
    category: "general",
    sectionId: "general-update",
    titleKey: "settings.general.update.frequency.title",
    descriptionKey: "settings.searchHints.general.updateFrequency",
    aliases: ["检查频率", "多久检查一次", "每天检查"],
    keywords: ["frequency", "daily"],
  },
  {
    id: "general.update.prerelease",
    category: "general",
    sectionId: "general-update",
    titleKey: "settings.general.update.prerelease.title",
    descriptionKey: "settings.general.update.prerelease.description",
    aliases: ["内测", "beta", "预览版", "尝鲜"],
    keywords: ["prerelease", "beta", "nightly"],
  },

  /* ---------- 快捷键 ---------- */
  {
    id: "shortcut.app.prev",
    category: "shortcut",
    sectionId: "shortcut-app",
    titleKey: "shortcuts.action.prev.label",
    descriptionKey: "shortcuts.action.prev.description",
    aliases: ["上一个", "上曲", "切歌"],
    keywords: ["prev", "previous"],
  },
  {
    id: "shortcut.app.next",
    category: "shortcut",
    sectionId: "shortcut-app",
    titleKey: "shortcuts.action.next.label",
    descriptionKey: "shortcuts.action.next.description",
    aliases: ["下一个", "下曲", "切歌"],
    keywords: ["next"],
  },
  {
    id: "shortcut.app.volumeUp",
    category: "shortcut",
    sectionId: "shortcut-app",
    titleKey: "shortcuts.action.volumeUp.label",
    descriptionKey: "shortcuts.action.volumeUp.description",
    aliases: ["大声", "调大音量"],
    keywords: ["volume", "up"],
  },
  {
    id: "shortcut.app.volumeDown",
    category: "shortcut",
    sectionId: "shortcut-app",
    titleKey: "shortcuts.action.volumeDown.label",
    descriptionKey: "shortcuts.action.volumeDown.description",
    aliases: ["小声", "调小音量"],
    keywords: ["volume", "down"],
  },
  {
    id: "shortcut.app.cycleMode",
    category: "shortcut",
    sectionId: "shortcut-app",
    titleKey: "shortcuts.action.cycleMode.label",
    descriptionKey: "shortcuts.action.cycleMode.description",
    aliases: ["循环", "单曲循环", "随机播放", "顺序播放"],
    keywords: ["mode", "repeat", "shuffle"],
  },
  {
    id: "shortcut.global.enabled",
    category: "shortcut",
    sectionId: "shortcut-global",
    titleKey: "settings.shortcut.global.enabled.title",
    descriptionKey: "settings.shortcut.global.enabled.description",
    aliases: ["全局热键", "系统热键", "后台快捷键"],
    keywords: ["global", "hotkey"],
  },
  {
    id: "shortcut.global.actions",
    category: "shortcut",
    sectionId: "shortcut-global",
    titleKey: "settings.shortcut.global.actionsTitle",
    descriptionKey: "settings.shortcut.global.actionsHint",
    aliases: ["全局热键", "系统热键", "后台控制"],
    keywords: ["global", "hotkey", "media key"],
  },

  /* ---------- 外观 ---------- */
  {
    id: "appearance.colors.scheme",
    category: "appearance",
    sectionId: "appearance-colors",
    titleKey: "settings.appearance.colors.scheme.title",
    descriptionKey: "settings.appearance.colors.scheme.description",
    aliases: ["深色模式", "浅色模式", "暗色", "日夜", "跟随系统"],
    keywords: ["theme", "dark", "light", "scheme"],
  },
  {
    id: "appearance.colors.material",
    category: "appearance",
    sectionId: "appearance-colors",
    titleKey: "settings.appearance.colors.material.title",
    descriptionKey: "settings.appearance.colors.material.description",
    aliases: ["亚克力", "毛玻璃", "透明", "云母"],
    keywords: ["mica", "acrylic", "material"],
  },
  {
    id: "appearance.colors.coverAccent",
    category: "appearance",
    sectionId: "appearance-colors",
    titleKey: "settings.appearance.colors.coverAccent.title",
    descriptionKey: "settings.appearance.colors.coverAccent.description",
    aliases: ["主题色", "主色", "强调色", "跟随封面变色"],
    keywords: ["accent", "color"],
  },
  {
    id: "appearance.colors.coverRatio",
    category: "appearance",
    sectionId: "appearance-colors",
    titleKey: "settings.appearance.colors.coverNatural.title",
    descriptionKey: "settings.appearance.colors.coverNatural.description",
    aliases: ["封面比例", "方形封面", "裁切", "封面形状"],
    keywords: ["cover", "ratio", "square"],
  },
  {
    id: "appearance.theme.current",
    category: "appearance",
    sectionId: "appearance-theme",
    titleKey: "settings.appearance.theme.current.title",
    descriptionKey: "settings.appearance.theme.current.description",
    aliases: ["主题皮肤", "皮肤", "换主题", "主题市场", "外观包"],
    keywords: ["theme", "skin"],
  },
  {
    id: "appearance.font.family",
    category: "appearance",
    sectionId: "appearance-font",
    titleKey: "settings.appearance.font.global.title",
    descriptionKey: "settings.appearance.font.global.description",
    aliases: ["字体", "字号", "font", "改字体"],
    keywords: ["font", "family", "typeface"],
  },
  {
    id: "appearance.layout.songList",
    category: "appearance",
    sectionId: "appearance-layout",
    titleKey: "settings.appearance.layout.songList.title",
    descriptionKey: "settings.searchHints.appearance.layoutSongList",
    aliases: ["布局", "手机布局", "列表样式", "卡片样式", "云端布局", "云音乐布局"],
    keywords: ["layout", "list", "cloud", "card"],
  },
  {
    id: "appearance.lyrics.preview",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.preview.title",
    descriptionKey: "settings.searchHints.appearance.lyricsPreview",
    aliases: ["歌词预览", "效果预览", "预览"],
    keywords: ["lyrics", "preview"],
  },
  {
    id: "appearance.lyrics.fontSize",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.fontSize.title",
    descriptionKey: "settings.searchHints.appearance.lyricsFontSize",
    aliases: ["歌词大小", "字太小", "字号", "字体大小"],
    keywords: ["fontsize", "lyrics", "size"],
  },
  {
    id: "appearance.lyrics.align",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.align.title",
    descriptionKey: "settings.searchHints.appearance.lyricsAlign",
    aliases: ["对齐", "居中", "靠左", "左对齐"],
    keywords: ["align", "center", "left"],
  },
  {
    id: "appearance.lyrics.position",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.anchor.title",
    descriptionKey: "settings.searchHints.appearance.lyricsPosition",
    aliases: ["位置", "歌词位置", "靠上", "靠下", "居中", "垂直位置"],
    keywords: ["position", "anchor", "top", "bottom", "center"],
  },
  {
    id: "appearance.lyrics.scroll",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.scroll.title",
    descriptionKey: "settings.searchHints.appearance.lyricsScroll",
    aliases: ["滚动速度", "歌词动画", "动画速度", "滚太快", "滚太慢", "缓动", "缓入缓出", "曲线"],
    keywords: ["scroll", "animation", "speed", "duration", "smooth", "easing"],
  },
  {
    id: "appearance.lyrics.font",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.font.title",
    descriptionKey: "settings.searchHints.appearance.lyricsFont",
    aliases: ["字体", "歌词字体", "宋体", "圆体", "楷体", "等宽"],
    keywords: ["font", "family", "typeface"],
  },
  {
    id: "appearance.lyrics.weight",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.weight.title",
    descriptionKey: "settings.searchHints.appearance.lyricsWeight",
    aliases: ["字重", "粗细", "加粗", "变细"],
    keywords: ["weight", "bold"],
  },
  {
    id: "appearance.lyrics.activeBold",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.activeBold.title",
    descriptionKey: "settings.searchHints.appearance.lyricsActiveBold",
    aliases: ["当前行加粗", "高亮加粗"],
    keywords: ["active", "bold"],
  },
  {
    id: "appearance.lyrics.enlarge",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.enlarge.title",
    descriptionKey: "settings.searchHints.appearance.lyricsEnlarge",
    aliases: ["放大", "当前行放大", "高亮"],
    keywords: ["enlarge", "scale", "active"],
  },
  {
    id: "appearance.lyrics.scale",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.scale.title",
    descriptionKey: "settings.searchHints.appearance.lyricsScale",
    aliases: ["放大倍数", "放大多少"],
    keywords: ["scale", "ratio"],
  },
  {
    id: "appearance.lyrics.blur",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.blur.title",
    descriptionKey: "settings.searchHints.appearance.lyricsBlur",
    aliases: ["模糊", "虚化", "非当前行模糊", "焦点"],
    keywords: ["blur", "inactive"],
  },
  {
    id: "appearance.lyrics.blurStrength",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.blurStrength.title",
    descriptionKey: "settings.searchHints.appearance.lyricsBlurStrength",
    aliases: ["模糊程度", "虚化强度"],
    keywords: ["blur", "strength"],
  },
  {
    id: "appearance.lyrics.dim",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.dim.title",
    descriptionKey: "settings.searchHints.appearance.lyricsDim",
    aliases: ["亮度", "透明度", "变暗", "压暗"],
    keywords: ["opacity", "dim"],
  },
  {
    id: "appearance.lyrics.gap",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.lineGap.title",
    descriptionKey: "settings.searchHints.appearance.lyricsGap",
    aliases: ["行距", "间距", "行高", "拥挤"],
    keywords: ["gap", "spacing"],
  },
  {
    id: "appearance.lyrics.translation",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.translation.title",
    descriptionKey: "settings.searchHints.appearance.lyricsTranslation",
    aliases: ["翻译", "双语", "对照"],
    keywords: ["translation", "bilingual"],
  },
  {
    id: "appearance.lyrics.glow",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.glow.title",
    descriptionKey: "settings.searchHints.appearance.lyricsGlow",
    aliases: ["投影", "阴影", "看不清歌词"],
    keywords: ["shadow", "glow"],
  },
  {
    id: "appearance.lyrics.mask",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.maskFade.title",
    descriptionKey: "settings.searchHints.appearance.lyricsMask",
    aliases: ["渐隐", "边缘淡出", "遮罩"],
    keywords: ["mask", "fade"],
  },
  {
    id: "appearance.lyrics.reset",
    category: "appearance",
    sectionId: "appearance-lyrics",
    titleKey: "settings.appearance.lyrics.reset.title",
    descriptionKey: "settings.searchHints.appearance.lyricsReset",
    aliases: ["重置歌词样式", "恢复默认"],
    keywords: ["reset", "default"],
  },
  {
    id: "appearance.motion.spring",
    category: "appearance",
    sectionId: "appearance-motion",
    titleKey: "settings.appearance.motion.spring.title",
    descriptionKey: "settings.appearance.motion.spring.description",
    aliases: ["动效", "动画", "弹性", "回弹", "Q 弹", "灵动", "阻尼"],
    keywords: ["motion", "animation", "spring", "bounce", "easing", "transition"],
  },
  {
    id: "appearance.motion.strength",
    category: "appearance",
    sectionId: "appearance-motion",
    titleKey: "settings.appearance.motion.strength.title",
    descriptionKey: "settings.appearance.motion.strength.description",
    aliases: ["弹性强度", "回弹强度", "弹多狠", "动效强度"],
    keywords: ["strength", "overshoot", "spring", "bounce"],
  },

  /* ---------- 播放 ---------- */
  {
    id: "playback.source.track",
    category: "playback",
    sectionId: "playback-source",
    titleKey: "settings.playback.source.track.title",
    descriptionKey: "settings.playback.source.track.description",
    aliases: ["信息源", "搜索排序", "优先来源"],
    keywords: ["source", "track"],
  },
  {
    id: "playback.source.play",
    category: "playback",
    sectionId: "playback-source",
    titleKey: "settings.playback.source.play.title",
    descriptionKey: "settings.playback.source.play.description",
    aliases: ["音源", "换源", "播放来源"],
    keywords: ["play", "url", "source"],
  },
  {
    id: "playback.source.lyrics",
    category: "playback",
    sectionId: "playback-source",
    titleKey: "settings.playback.source.lyrics.title",
    descriptionKey: "settings.playback.source.lyrics.description",
    aliases: ["歌词来源", "拿歌词"],
    keywords: ["lyrics", "source"],
  },
  {
    id: "playback.source.avatar",
    category: "playback",
    sectionId: "playback-source",
    titleKey: "settings.playback.source.avatar.title",
    descriptionKey: "settings.playback.source.avatar.description",
    aliases: ["头像", "用户头像来源"],
    keywords: ["avatar", "source"],
  },
  {
    id: "playback.source.searchFormat",
    category: "playback",
    sectionId: "playback-source",
    titleKey: "settings.playback.source.searchFormat.title",
    descriptionKey: "settings.searchHints.playback.sourceSearchFormat",
    aliases: ["搜索模板", "关键词格式", "标题格式"],
    keywords: ["format", "keyword"],
  },
  {
    id: "playback.gapless.crossfade",
    category: "playback",
    sectionId: "playback-gapless",
    titleKey: "settings.playback.gapless.crossfade.title",
    descriptionKey: "settings.playback.gapless.crossfade.description",
    aliases: ["淡入淡出", "交叉淡化", "mix", "混音过渡"],
    keywords: ["crossfade", "fade"],
  },
  {
    id: "playback.gapless.gapless",
    category: "playback",
    sectionId: "playback-gapless",
    titleKey: "settings.playback.gapless.gapless.title",
    descriptionKey: "settings.searchHints.playback.gaplessGapless",
    aliases: ["无缝", "零间隙", "连播"],
    keywords: ["gapless"],
  },
  {
    id: "playback.lyrics.enabled",
    category: "playback",
    sectionId: "playback-lyrics",
    titleKey: "settings.playback.desktopLyrics.enabled.title",
    descriptionKey: "settings.playback.desktopLyrics.enabled.description",
    aliases: ["桌面歌词", "悬浮歌词", "置顶歌词"],
    keywords: ["desktop lyrics"],
  },
  {
    id: "playback.lyrics.style",
    category: "playback",
    sectionId: "playback-lyrics",
    titleKey: "settings.playback.desktopLyrics.style.title",
    descriptionKey: "settings.playback.desktopLyrics.style.description",
    aliases: ["歌词外观", "歌词样式", "纯文字", "歌曲卡片"],
    keywords: ["lyrics style"],
  },
  {
    id: "playback.lyrics.fontSize",
    category: "playback",
    sectionId: "playback-lyrics",
    titleKey: "settings.playback.desktopLyrics.fontSize.title",
    descriptionKey: "settings.playback.desktopLyrics.fontSize.description",
    aliases: ["桌面歌词字号", "歌词大小", "歌词字体大小", "字太小"],
    keywords: ["fontsize"],
  },
  {
    id: "playback.lyrics.lock",
    category: "playback",
    sectionId: "playback-lyrics",
    titleKey: "settings.playback.desktopLyrics.lock.title",
    descriptionKey: "settings.playback.desktopLyrics.lock.description",
    aliases: ["穿透", "锁定歌词", "点不到桌面"],
    keywords: ["lock", "clickthrough"],
  },
  {
    id: "playback.output.device",
    category: "playback",
    sectionId: "playback-output",
    titleKey: "settings.playback.output.device.title",
    descriptionKey: "settings.playback.output.device.description",
    aliases: ["输出设备", "声卡", "扬声器", "耳机", "没声音"],
    keywords: ["output", "device", "speaker"],
  },
  {
    id: "playback.eq.enabled",
    category: "playback",
    sectionId: "playback-eq",
    titleKey: "settings.playback.equalizer.enabled.title",
    descriptionKey: "settings.playback.equalizer.enabled.description",
    aliases: ["EQ", "音效", "调音", "低音", "高音"],
    keywords: ["equalizer", "eq"],
  },
  {
    id: "playback.eq.preset",
    category: "playback",
    sectionId: "playback-eq",
    titleKey: "settings.playback.equalizer.preset.title",
    descriptionKey: "settings.playback.equalizer.preset.description",
    aliases: ["均衡器预设", "EQ预设", "音色预设", "流行", "摇滚"],
    keywords: ["preset", "equalizer"],
  },

  /* ---------- 插件 ---------- */
  {
    id: "plugins.market.mirror",
    category: "plugins",
    sectionId: "plugins-market",
    titleKey: "settings.plugins.market.mirror.title",
    descriptionKey: "settings.searchHints.plugins.marketMirror",
    aliases: ["镜像", "加速", "ghproxy", "下载慢"],
    keywords: ["mirror", "github", "proxy"],
  },
  {
    id: "plugins.market.sources",
    category: "plugins",
    sectionId: "plugins-market",
    titleKey: "settings.plugins.market.sources.title",
    descriptionKey: "settings.searchHints.plugins.marketSources",
    aliases: ["市场源", "插件源", "索引地址", "第三方市场"],
    keywords: ["market", "source", "index"],
  },

  /* ---------- 数据 ---------- */
  {
    id: "data.cache.policy",
    category: "data",
    sectionId: "data-cache",
    titleKey: "settings.data.cache.policy.title",
    descriptionKey: "settings.searchHints.data.cachePolicy",
    aliases: ["缓存", "图片缓存", "歌单缓存", "占空间"],
    keywords: ["cache", "policy"],
  },
  {
    id: "data.cache.clear",
    category: "data",
    sectionId: "data-cache",
    titleKey: "settings.data.cache.clear.title",
    descriptionKey: "settings.searchHints.data.cacheClear",
    aliases: ["清缓存", "清理缓存", "释放空间", "占多少空间"],
    keywords: ["clear", "cache"],
  },
  {
    id: "data.download.dir",
    category: "data",
    sectionId: "data-download",
    titleKey: "settings.data.download.dir.title",
    descriptionKey: "settings.searchHints.data.downloadDir",
    aliases: ["保存位置", "下载路径", "存哪了", "换目录"],
    keywords: ["download", "dir", "folder"],
  },
  {
    id: "data.download.template",
    category: "data",
    sectionId: "data-download",
    titleKey: "settings.data.download.template.title",
    descriptionKey: "settings.searchHints.data.downloadTemplate",
    aliases: ["文件名", "命名规则", "命名格式", "改名"],
    keywords: ["filename", "template"],
  },
  {
    id: "data.download.tags",
    category: "data",
    sectionId: "data-download",
    titleKey: "settings.data.download.writeTags.title",
    descriptionKey: "settings.searchHints.data.downloadTags",
    aliases: ["标签", "元数据", "ID3", "歌词文件"],
    keywords: ["tags", "metadata"],
  },
  {
    id: "data.download.offline",
    category: "data",
    sectionId: "data-download",
    titleKey: "settings.data.download.offline.title",
    descriptionKey: "settings.searchHints.data.downloadOffline",
    aliases: ["已下载", "离线", "本地下载", "导出音频"],
    keywords: ["offline", "downloaded"],
  },
  {
    id: "data.backup.export",
    category: "data",
    sectionId: "data-backup",
    titleKey: "settings.data.backup.export.title",
    descriptionKey: "settings.searchHints.data.backupExport",
    aliases: ["备份", "导出", "换机", "迁移"],
    keywords: ["backup", "export"],
  },
  {
    id: "data.backup.credentials",
    category: "data",
    sectionId: "data-backup",
    titleKey: "settings.data.backup.credentials.title",
    descriptionKey: "settings.searchHints.data.backupCredentials",
    aliases: ["凭证", "Cookie", "Token", "登录状态备份"],
    keywords: ["credential", "cookie"],
  },
  {
    id: "data.backup.import",
    category: "data",
    sectionId: "data-backup",
    titleKey: "settings.data.backup.import.title",
    descriptionKey: "settings.searchHints.data.backupImport",
    aliases: ["还原", "导入", "恢复备份"],
    keywords: ["import", "restore"],
  },
  {
    id: "data.cloud.server",
    category: "data",
    sectionId: "data-cloud",
    titleKey: "settings.data.cloud.server.title",
    descriptionKey: "settings.searchHints.data.cloudServer",
    aliases: ["自建服务器", "云服务地址", "音乐云"],
    keywords: ["server", "url", "cloud"],
  },
  {
    id: "data.cloud.account",
    category: "data",
    sectionId: "data-cloud",
    titleKey: "settings.data.cloud.account.title",
    descriptionKey: "settings.searchHints.data.cloudAccount",
    aliases: ["登录", "注册", "账号", "同步账号"],
    keywords: ["account", "login", "register"],
  },
  {
    id: "data.cloud.library",
    category: "data",
    sectionId: "data-cloud",
    titleKey: "settings.data.cloud.library.title",
    descriptionKey: "settings.searchHints.data.cloudLibrary",
    aliases: ["云端曲库", "上传音乐", "云盘"],
    keywords: ["library", "upload"],
  },
  {
    id: "data.cloud.sync",
    category: "data",
    sectionId: "data-cloud",
    titleKey: "settings.data.cloud.sync.title",
    descriptionKey: "settings.searchHints.data.cloudSync",
    aliases: ["同步", "立即同步", "多端同步", "重置同步"],
    keywords: ["sync", "cloud"],
  },

  /* ---------- 实验性 ---------- */
  {
    id: "experimental.studio.enabled",
    category: "experimental",
    sectionId: "experimental-studio",
    titleKey: "settings.experimental.studio.enabled.title",
    descriptionKey: "settings.experimental.studio.enabled.description",
    aliases: ["录音棚", "录音", "翻唱", "录歌"],
    keywords: ["studio", "record"],
  },
  {
    id: "experimental.autoPlaylist.enabled",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.enabled.title",
    descriptionKey: "settings.searchHints.experimental.autoPlaylistEnabled",
    aliases: ["自动加歌单", "听完自动收藏", "自动归档"],
    keywords: ["auto playlist"],
  },
  {
    id: "experimental.autoPlaylist.mode",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.mode.title",
    descriptionKey: "settings.experimental.autoPlaylist.mode.description",
    aliases: ["自动分类", "固定歌单", "按语种分类"],
    keywords: ["mode"],
  },
  {
    id: "experimental.autoPlaylist.target",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.target.title",
    descriptionKey: "settings.experimental.autoPlaylist.target.description",
    aliases: ["加进哪个歌单", "目标歌单"],
    keywords: ["target"],
  },
  {
    id: "experimental.autoPlaylist.groups",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.groups.title",
    descriptionKey: "settings.searchHints.experimental.autoPlaylistGroups",
    aliases: ["华语歌单", "日韩歌单", "Vocaloid 歌单", "纯音乐"],
    keywords: ["language", "genre"],
  },
  {
    id: "experimental.autoPlaylist.keywords",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.keywords.title",
    descriptionKey: "settings.searchHints.experimental.autoPlaylistKeywords",
    aliases: ["Vocaloid", "术力口", "自定义关键词"],
    keywords: ["keywords", "vocaloid"],
  },
  {
    id: "experimental.autoPlaylist.reset",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    titleKey: "settings.experimental.autoPlaylist.reset.title",
    descriptionKey: "settings.searchHints.experimental.autoPlaylistReset",
    aliases: ["处理记录", "重新判定", "清空记录"],
    keywords: ["reset"],
  },

  /* ---------- 关于 ---------- */
  {
    id: "about.hero.version",
    category: "about",
    sectionId: "about-hero",
    titleKey: "settings.about.hero.versionTitle",
    descriptionKey: "settings.about.hero.versionHint",
    aliases: ["版本", "版本信息", "当前版本"],
    keywords: ["version"],
  },
  {
    id: "about.hero.links",
    category: "about",
    sectionId: "about-hero",
    titleKey: "settings.about.hero.linksTitle",
    descriptionKey: "settings.about.hero.linksHint",
    aliases: ["反馈", "issue", "github", "提意见", "开源地址"],
    keywords: ["repo", "issues"],
  },
  {
    id: "about.update.check",
    category: "about",
    sectionId: "about-update",
    titleKey: "settings.about.update.software.title",
    descriptionKey: "settings.searchHints.about.updateCheck",
    aliases: ["检查更新", "手动更新", "下载新版本"],
    keywords: ["update", "release"],
  },
  {
    id: "about.notices.thirdParty",
    category: "about",
    sectionId: "about-notices",
    titleKey: "settings.about.notices.thirdParty.title",
    descriptionKey: "settings.searchHints.about.noticesThirdParty",
    aliases: ["开源协议", "致谢", "许可", "License"],
    keywords: ["notices", "license", "third party"],
  },
];

export const ITEM_BY_ID = new Map(SETTINGS_ITEMS.map((item) => [item.id, item]));
export const SECTION_BY_ITEM_ID = new Map(SETTINGS_ITEMS.map((item) => [item.id, item.sectionId]));

/* ------------------------------ 取文本 ------------------------------ */

/**
 * 索引里存的是 key，文本在这里统一取。
 *
 * 三个 helper 都直接调 `t()`（而不是缓存结果），这样切语种时用到的地方会跟着重算。
 */
export function sectionTitle(section: SettingsSectionMeta): string {
  return t(section.titleKey);
}

/** 设置项标题：与面板卡片的 `.card-header` 引用同一个 key */
export function itemTitle(item: SettingsItem): string {
  return t(item.titleKey);
}

/** 搜索摘要：与卡片描述**不是**同一句话，见 `SettingsItem.descriptionKey` */
export function itemDescription(item: SettingsItem): string {
  return t(item.descriptionKey);
}

/* ------------------------------ 搜索 ------------------------------ */

export interface SettingsSearchHit {
  item: SettingsItem;
  /** 命中权重，高者靠前 */
  score: number;
  /** 声明顺序，同分时的稳定排序依据 */
  order: number;
}

/** 比较用的归一化：去空白 + 小写（设置项数量在百级，击键时直接重算也不卡） */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

interface CompiledRow {
  item: SettingsItem;
  order: number;
  title: string;
  alias: string[];
  group: string;
  description: string;
}

let compiledLocale: string | null = null;
let compiledRows: CompiledRow[] = [];

/**
 * 搜索用的归一化索引：标题 / 别名 / 分类分组 / 摘要都先归一化好。
 *
 * 按语种**懒重建**而不是模块加载时算一次——文案来自词条，切到另一种语言后
 * 若沿用旧索引，新语言下的界面文案一个都搜不到（中文关键词也搜不到）。
 * 重建只在语种变化时发生一次，击键路径上只是一次字符串比较。
 */
function compiled(): CompiledRow[] {
  if (compiledLocale === locale.value) return compiledRows;
  compiledRows = SETTINGS_ITEMS.map((item, order) => {
    const section = SECTION_BY_ID.get(item.sectionId);
    return {
      item,
      order,
      title: normalize(itemTitle(item)),
      alias: [...(item.aliases ?? []), ...(item.keywords ?? [])].map(normalize),
      group: normalize(`${categoryLabel(item.category)}${section ? sectionTitle(section) : ""}`),
      description: normalize(itemDescription(item)),
    };
  });
  compiledLocale = locale.value;
  return compiledRows;
}

/** 命中权重：标题 > 别名/同义词 > 分类与分组名 > 描述 */
const WEIGHT_TITLE = 100;
const WEIGHT_ALIAS = 60;
const WEIGHT_GROUP = 40;
const WEIGHT_DESCRIPTION = 20;

/**
 * 搜索设置项。
 *
 * 多个关键词之间是 AND：每个词都必须在这条记录里命中，命中位置越好权重越高。
 * 空查询返回空数组（由调用方决定是否展示空态）。
 */
export function searchSettings(raw: string, limit = 24): SettingsSearchHit[] {
  const terms = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalize);
  if (!terms.length) return [];

  const hits: SettingsSearchHit[] = [];
  for (const row of compiled()) {
    let score = 0;
    for (const term of terms) {
      if (row.title.includes(term)) score += WEIGHT_TITLE;
      else if (row.alias.some((alias) => alias.includes(term))) score += WEIGHT_ALIAS;
      else if (row.group.includes(term)) score += WEIGHT_GROUP;
      else if (row.description.includes(term)) score += WEIGHT_DESCRIPTION;
      else {
        score = -1;
        break;
      }
    }
    if (score >= 0) hits.push({ item: row.item, score, order: row.order });
  }

  return hits.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit);
}

/** 「分类 › 分组」，搜索结果的归属行与 chips 的无障碍标签共用 */
export function sectionPath(item: SettingsItem): string {
  const label = categoryLabel(item.category);
  const section = SECTION_BY_ID.get(item.sectionId);
  const title = section ? sectionTitle(section) : "";
  return title ? `${label} › ${title}` : label;
}

/* ------------------------------ 命中高亮 ------------------------------ */

export interface TextSegment {
  text: string;
  hit: boolean;
}

/**
 * 把文本按命中区间切成若干段，交给模板渲染成 `<mark>`。
 *
 * 不用 `v-html`：卡片描述里本身就含 `<code>` 之类的结构，用 HTML 拼接既要自己
 * 转义又有注入面；分段数组是纯文本，模板只会生成文本节点。
 */
export function highlightSegments(text: string, terms: string[]): TextSegment[] {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const term of terms) {
    const needle = term.trim().toLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      ranges.push([at, at + needle.length]);
    }
  }
  if (!ranges.length) return [{ text, hit: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
