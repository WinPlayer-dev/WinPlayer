/**
 * 设置页的分类元数据。
 *
 * 这里只放**纯数据**，不 import 任何面板组件：settingsIndex.ts 需要读分类名做
 * 关键词匹配与结果分组，如果这里牵进 8 个 SFC，索引模块就会把整棵组件树拖进
 * 依赖图（也让 categories ↔ panels 容易出现循环引用）。面板组件的映射放在
 * SettingsView.vue 里，和导航一起维护。
 *
 * 分类顺序即桌面端左侧导航、移动端分类面板的展示顺序。
 */

export type SettingsCategoryKey =
  | "general"
  | "shortcut"
  | "appearance"
  | "playback"
  | "plugins"
  | "data"
  | "experimental"
  | "about";

export interface SettingsCategory {
  key: SettingsCategoryKey;
  label: string;
  /** Fluent UI System Icons 码点（.wp-icon 字体族，24 Regular），模板里 v-html 使用 */
  icon: string;
  /** 移动端隐藏（无物理键盘，快捷键类无意义） */
  mobileHidden?: boolean;
  /** 移动端分类面板里的一行副标题：分类名太抽象时靠它解释这一栏装什么 */
  mobileSubtitle: string;
  /** 旧版 `?tab=` 值：老书签 / 插件 / 文档里的深链不能断 */
  aliases?: string[];
  /** 旧 tab → 落地分组；缺省时落到分类顶部 */
  aliasSections?: Partial<Record<string, string>>;
}

export const CATEGORIES: readonly SettingsCategory[] = [
  {
    key: "general",
    label: "通用",
    icon: "&#xF6AA;", // ic_fluent_settings_24_regular
    mobileSubtitle: "启动、窗口、隐私、更新",
  },
  {
    key: "shortcut",
    label: "快捷键",
    icon: "&#xF4B9;", // ic_fluent_keyboard_24_regular
    mobileHidden: true,
    mobileSubtitle: "窗口内与应用外热键",
  },
  {
    key: "appearance",
    label: "外观",
    icon: "&#xF2F6;", // ic_fluent_color_24_regular
    mobileSubtitle: "配色、材质、主题、字体",
    aliases: ["style"],
    aliasSections: { style: "appearance-colors" },
  },
  {
    key: "playback",
    label: "播放",
    icon: "&#xE855;", // ic_fluent_music_note_2_24_regular
    mobileSubtitle: "来源、歌词、输出、音效",
  },
  {
    key: "plugins",
    label: "插件",
    icon: "&#xE9EA;", // ic_fluent_puzzle_piece_24_regular
    mobileSubtitle: "市场源与下载镜像",
  },
  {
    key: "data",
    label: "数据",
    icon: "&#xE467;", // ic_fluent_database_24_regular
    mobileSubtitle: "存储、下载、备份、同步",
    // 四个旧分类合并而来：深链要落到各自的分组，而不是笼统地落在分类顶部
    aliases: ["storage", "download", "backup", "cloud"],
    aliasSections: {
      storage: "data-cache",
      download: "data-download",
      backup: "data-backup",
      cloud: "data-cloud",
    },
  },
  {
    key: "experimental",
    label: "实验性",
    icon: "&#xF1D8;", // ic_fluent_beaker_24_regular
    mobileSubtitle: "录音棚、自动歌单",
  },
  {
    key: "about",
    label: "关于",
    icon: "&#xF4A4;", // ic_fluent_info_24_regular
    mobileSubtitle: "版本、更新与致谢",
  },
];

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));

/** 分类 key → 显示名；未知 key 回退空串（搜索索引里不该出现未知分类） */
export function categoryLabel(key: SettingsCategoryKey): string {
  return CATEGORY_BY_KEY.get(key)?.label ?? "";
}

/** 移动端可见的分类（隐藏无物理键盘的「快捷键」） */
export const MOBILE_CATEGORIES: readonly SettingsCategory[] = CATEGORIES.filter(
  (category) => !category.mobileHidden,
);

export interface ResolvedTab {
  category: SettingsCategoryKey;
  /** 旧别名对应的落地分组；直连新 key 时为 undefined */
  sectionId?: string;
}

/**
 * 把 `?tab=` 的值解析成新分类。
 *
 * - 命中新 key → 直接返回该分类
 * - 命中最 alias → 返回分类 + 该别名的落地分组
 * - 其它（空 / 脏值 / 已删除的分类）→ 返回 null，由调用方回退到第一个分类
 */
export function resolveTab(raw: string): ResolvedTab | null {
  const value = raw.trim();
  if (!value) return null;

  const category = CATEGORY_BY_KEY.get(value as SettingsCategoryKey);
  if (category) return { category: category.key };

  for (const item of CATEGORIES) {
    if (!item.aliases?.includes(value)) continue;
    return { category: item.key, sectionId: item.aliasSections?.[value] };
  }
  return null;
}
