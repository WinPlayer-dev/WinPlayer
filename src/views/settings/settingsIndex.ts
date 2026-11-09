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

/* ------------------------------ 分组 ------------------------------ */

export interface SettingsSectionMeta {
  /** 全局唯一，同时是 `<SettingsSection id>` 与 DOM 上的 data-section-id */
  id: string;
  category: SettingsCategoryKey;
  title: string;
  /** 只在部分平台渲染：开发期漂移校验跳过「缺失」，chips 也按 DOM 过滤 */
  optional?: boolean;
}

/**
 * 每个分类包含哪些分组，按页面里的展示顺序排列。
 * 这张表同时驱动：分组 chips、搜索结果的「分类 › 分组」归属、开发期漂移校验。
 */
export const SETTINGS_SECTIONS: Record<SettingsCategoryKey, SettingsSectionMeta[]> = {
  general: [
    { id: "general-startup", category: "general", title: "启动与引导" },
    { id: "general-window", category: "general", title: "窗口与系统", optional: true },
    { id: "general-car", category: "general", title: "车载模式", optional: true },
    { id: "general-feedback", category: "general", title: "触感反馈", optional: true },
    { id: "general-search", category: "general", title: "搜索" },
    { id: "general-privacy", category: "general", title: "隐私" },
    { id: "general-update", category: "general", title: "更新" },
  ],
  shortcut: [
    { id: "shortcut-app", category: "shortcut", title: "快捷键" },
    { id: "shortcut-global", category: "shortcut", title: "全局快捷键", optional: true },
  ],
  appearance: [
    { id: "appearance-colors", category: "appearance", title: "配色与材质" },
    { id: "appearance-theme", category: "appearance", title: "主题" },
    { id: "appearance-font", category: "appearance", title: "字体" },
    { id: "appearance-motion", category: "appearance", title: "动效" },
  ],
  playback: [
    { id: "playback-source", category: "playback", title: "来源偏好" },
    { id: "playback-gapless", category: "playback", title: "无缝播放" },
    { id: "playback-lyrics", category: "playback", title: "桌面歌词", optional: true },
    { id: "playback-output", category: "playback", title: "输出设备", optional: true },
    { id: "playback-eq", category: "playback", title: "音效" },
  ],
  plugins: [{ id: "plugins-market", category: "plugins", title: "插件市场" }],
  data: [
    { id: "data-cache", category: "data", title: "存储与缓存" },
    { id: "data-download", category: "data", title: "下载与离线" },
    { id: "data-backup", category: "data", title: "备份与还原" },
    { id: "data-cloud", category: "data", title: "同步" },
  ],
  experimental: [
    { id: "experimental-studio", category: "experimental", title: "录音棚" },
    { id: "experimental-auto-playlist", category: "experimental", title: "听完自动加歌单" },
  ],
  about: [
    { id: "about-hero", category: "about", title: "版本信息" },
    { id: "about-update", category: "about", title: "更新" },
    { id: "about-notices", category: "about", title: "开源与致谢" },
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
  /** 卡片标题，须与模板里的 `.card-header` 文案一致 */
  title: string;
  /** 卡片描述，用于命中匹配与搜索结果副标题 */
  description: string;
  /** 用户可能搜的口语词（权重高于描述、低于标题） */
  aliases?: string[];
  /** 英文名 / 旧分类名 / 同义词 */
  keywords?: string[];
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  /* ---------- 通用 ---------- */
  {
    id: "general.startup.page",
    category: "general",
    sectionId: "general-startup",
    title: "打开时页面",
    description: "每次启动应用后直接进入所选页面",
    aliases: ["启动页", "首页", "默认页面", "开机进入"],
    keywords: ["startup", "home"],
  },
  {
    id: "general.startup.onboarding",
    category: "general",
    sectionId: "general-startup",
    title: "欢迎引导",
    description: "重新查看欢迎页与添加播放源引导，不影响已装插件与现有设置",
    aliases: ["新手引导", "引导", "欢迎页", "教程"],
    keywords: ["onboarding", "welcome"],
  },
  {
    id: "general.window.remember",
    category: "general",
    sectionId: "general-window",
    title: "记住窗口大小与位置",
    description: "退出时记住窗口尺寸、位置与最大化状态，下次启动还原",
    aliases: ["窗口大小", "窗口位置", "重置窗口", "最大化"],
    keywords: ["window", "size", "position"],
  },
  {
    id: "general.window.closeBehavior",
    category: "general",
    sectionId: "general-window",
    title: "关闭按钮行为",
    description: "关闭窗口时收进托盘继续播放、最小化到任务栏或直接退出",
    aliases: ["托盘", "最小化到托盘", "关闭后退出", "关窗", "后台运行"],
    keywords: ["tray", "minimize", "quit", "close"],
  },
  {
    id: "general.window.backgroundOptimize",
    category: "general",
    sectionId: "general-window",
    title: "后台优化",
    description: "窗口隐藏时暂停动画与轮询以降低占用，播放不受影响",
    aliases: ["后台", "省电", "降低占用", "卡顿"],
    keywords: ["optimize", "background"],
  },
  {
    id: "general.window.smtc",
    category: "general",
    sectionId: "general-window",
    title: "系统媒体传输控件（SMTC）",
    description: "在系统媒体浮出窗、锁屏与蓝牙设备上显示曲目和进度，并响应系统播放控制",
    aliases: ["媒体控件", "锁屏", "蓝牙控制", "SMTC", "系统媒体"],
    keywords: ["smtc", "media", "thumbnail"],
  },
  {
    id: "general.car.lyrics",
    category: "general",
    sectionId: "general-car",
    title: "歌词显示在媒体控件上",
    description: "媒体控件标题显示当前歌词行，没有歌词时显示歌名；需开启系统媒体控件",
    aliases: ["车载", "车机", "媒体控件歌词"],
    keywords: ["car", "lyrics"],
  },
  {
    id: "general.feedback.haptics",
    category: "general",
    sectionId: "general-feedback",
    title: "震动反馈",
    description: "长按菜单、下拉刷新、收藏等操作时轻微震动",
    aliases: ["震动", "触感", "振动", "haptic"],
    keywords: ["haptics", "vibrate"],
  },
  {
    id: "general.search.aggregate",
    category: "general",
    sectionId: "general-search",
    title: "聚合搜索",
    description: "搜索页多出一个「全部」Tab，聚合所有插件的结果",
    aliases: ["全部Tab", "搜索聚合", "多源搜索"],
    keywords: ["aggregate", "search"],
  },
  {
    id: "general.privacy.history",
    category: "general",
    sectionId: "general-privacy",
    title: "记录播放历史",
    description: "记录播放次数与最近播放时间；关闭后不再记录，已有数据保留",
    aliases: ["播放历史", "听歌记录", "历史记录", "隐私"],
    keywords: ["history", "privacy"],
  },
  {
    id: "general.privacy.demoMode",
    category: "general",
    sectionId: "general-privacy",
    title: "隐藏来源名与歌单",
    description:
      "录屏 / 截图时使用：播放源名称统一显示为「在线音乐」，侧边栏与「我的」页里的歌单、平台歌单入口一并隐藏",
    aliases: ["演示模式", "录屏", "截图", "打码", "隐藏来源"],
    keywords: ["demo", "screenshot"],
  },
  {
    id: "general.update.autoCheck",
    category: "general",
    sectionId: "general-update",
    title: "自动检查更新",
    description: "启动时静默检查新版本，有更新时提示；关闭后仍可在「关于」页手动检查",
    aliases: ["更新", "升级", "新版本", "自动升级"],
    keywords: ["update", "auto"],
  },
  {
    id: "general.update.frequency",
    category: "general",
    sectionId: "general-update",
    title: "自动检查频率",
    description: "「每次启动」每次打开都检查，「每 24 小时」每天只检查一次，「仅手动」只在「关于」页检查",
    aliases: ["检查频率", "多久检查一次", "每天检查"],
    keywords: ["frequency", "daily"],
  },
  {
    id: "general.update.prerelease",
    category: "general",
    sectionId: "general-update",
    title: "接收预览版本（Beta）",
    description: "同时检查预发布版本，可提前体验新功能，但可能不够稳定",
    aliases: ["内测", "beta", "预览版", "尝鲜"],
    keywords: ["prerelease", "beta", "nightly"],
  },

  /* ---------- 快捷键 ---------- */
  {
    id: "shortcut.app.prev",
    category: "shortcut",
    sectionId: "shortcut-app",
    title: "上一首",
    description: "切换到播放队列中的上一首",
    aliases: ["上一个", "上曲", "切歌"],
    keywords: ["prev", "previous"],
  },
  {
    id: "shortcut.app.next",
    category: "shortcut",
    sectionId: "shortcut-app",
    title: "下一首",
    description: "切换到播放队列中的下一首",
    aliases: ["下一个", "下曲", "切歌"],
    keywords: ["next"],
  },
  {
    id: "shortcut.app.volumeUp",
    category: "shortcut",
    sectionId: "shortcut-app",
    title: "音量加",
    description: "提高播放音量（每次 5%）",
    aliases: ["大声", "调大音量"],
    keywords: ["volume", "up"],
  },
  {
    id: "shortcut.app.volumeDown",
    category: "shortcut",
    sectionId: "shortcut-app",
    title: "音量减",
    description: "降低播放音量（每次 5%）",
    aliases: ["小声", "调小音量"],
    keywords: ["volume", "down"],
  },
  {
    id: "shortcut.app.cycleMode",
    category: "shortcut",
    sectionId: "shortcut-app",
    title: "播放模式切换",
    description: "在顺序播放 / 列表循环 / 单曲循环 / 随机播放之间切换",
    aliases: ["循环", "单曲循环", "随机播放", "顺序播放"],
    keywords: ["mode", "repeat", "shuffle"],
  },
  {
    id: "shortcut.global.enabled",
    category: "shortcut",
    sectionId: "shortcut-global",
    title: "启用全局快捷键",
    description: "关闭后立即注销所有系统热键，仅保留窗口内快捷键；重新开启后按下面的设置恢复注册",
    aliases: ["全局热键", "系统热键", "后台快捷键"],
    keywords: ["global", "hotkey"],
  },
  {
    id: "shortcut.global.actions",
    category: "shortcut",
    sectionId: "shortcut-global",
    title: "全局播放快捷键",
    description: "播放 / 暂停、上一首、下一首的系统级热键，窗口在后台或托盘中也生效",
    aliases: ["全局热键", "系统热键", "后台控制"],
    keywords: ["global", "hotkey", "media key"],
  },

  /* ---------- 外观 ---------- */
  {
    id: "appearance.colors.scheme",
    category: "appearance",
    sectionId: "appearance-colors",
    title: "配色模式",
    description: "选择应用的亮 / 暗外观，默认跟随系统",
    aliases: ["深色模式", "浅色模式", "暗色", "日夜", "跟随系统"],
    keywords: ["theme", "dark", "light", "scheme"],
  },
  {
    id: "appearance.colors.material",
    category: "appearance",
    sectionId: "appearance-colors",
    title: "窗口材质",
    description: "使用系统 Mica / Acrylic 材质作为窗口背景；关闭则使用纯色背景",
    aliases: ["亚克力", "毛玻璃", "透明", "云母"],
    keywords: ["mica", "acrylic", "material"],
  },
  {
    id: "appearance.colors.coverAccent",
    category: "appearance",
    sectionId: "appearance-colors",
    title: "封面取色",
    description: "从当前封面提取主色作为强调色，按钮、进度条跟随变化",
    aliases: ["主题色", "主色", "强调色", "跟随封面变色"],
    keywords: ["accent", "color"],
  },
  {
    id: "appearance.colors.coverRatio",
    category: "appearance",
    sectionId: "appearance-colors",
    title: "按封面原始比例",
    description: "按原图比例显示封面，不再统一裁成正方形；卡片外框保持正方，多余区域用模糊封面填充",
    aliases: ["封面比例", "方形封面", "裁切", "封面形状"],
    keywords: ["cover", "ratio", "square"],
  },
  {
    id: "appearance.theme.current",
    category: "appearance",
    sectionId: "appearance-theme",
    title: "当前主题",
    description: "主题可改配色、圆角、背景，甚至重写标题栏 / 播放条等界面组件；切换后立即生效",
    aliases: ["主题皮肤", "皮肤", "换主题", "主题市场", "外观包"],
    keywords: ["theme", "skin"],
  },
  {
    id: "appearance.font.family",
    category: "appearance",
    sectionId: "appearance-font",
    title: "全局字体",
    description: "自定义应用字体，填入 CSS font-family 值（可含备选字体）；留空恢复默认，输入即预览",
    aliases: ["字体", "字号", "font", "改字体"],
    keywords: ["font", "family", "typeface"],
  },
  {
    id: "appearance.motion.spring",
    category: "appearance",
    sectionId: "appearance-motion",
    title: "弹簧手感",
    description: "把全站缓动换成带回弹的曲线：按钮、卡片、弹层、页面切换都会「Q 弹」一下；关闭则回到 WinUI 标准曲线",
    aliases: ["动效", "动画", "弹性", "回弹", "Q 弹", "灵动", "阻尼"],
    keywords: ["motion", "animation", "spring", "bounce", "easing", "transition"],
  },
  {
    id: "appearance.motion.strength",
    category: "appearance",
    sectionId: "appearance-motion",
    title: "回弹幅度",
    description: "到达终点后多冲出去一点再落回；越大幅度越夸张，调好后可在下面直接试手感",
    aliases: ["弹性强度", "回弹强度", "弹多狠", "动效强度"],
    keywords: ["strength", "overshoot", "spring", "bounce"],
  },

  /* ---------- 播放 ---------- */
  {
    id: "playback.source.track",
    category: "playback",
    sectionId: "playback-source",
    title: "歌曲信息源",
    description: "搜索结果聚合时，该插件的结果排在前面",
    aliases: ["信息源", "搜索排序", "优先来源"],
    keywords: ["source", "track"],
  },
  {
    id: "playback.source.play",
    category: "playback",
    sectionId: "playback-source",
    title: "播放源",
    description: "播放时在该插件重新搜曲并取其直链；搜不到时回退歌曲自身来源",
    aliases: ["音源", "换源", "播放来源"],
    keywords: ["play", "url", "source"],
  },
  {
    id: "playback.source.lyrics",
    category: "playback",
    sectionId: "playback-source",
    title: "歌词源",
    description: "取歌词时在该插件重新搜曲后取词；取不到时回退歌曲自身来源",
    aliases: ["歌词来源", "拿歌词"],
    keywords: ["lyrics", "source"],
  },
  {
    id: "playback.source.avatar",
    category: "playback",
    sectionId: "playback-source",
    title: "头像源",
    description: "右上角头像优先从该插件获取，取不到时再试其他插件",
    aliases: ["头像", "用户头像来源"],
    keywords: ["avatar", "source"],
  },
  {
    id: "playback.source.searchFormat",
    category: "playback",
    sectionId: "playback-source",
    title: "搜索格式",
    description: "播放源、歌词源重新搜曲的关键词格式，支持 {歌曲名}、{歌手名}、{专辑名}、{别名}",
    aliases: ["搜索模板", "关键词格式", "标题格式"],
    keywords: ["format", "keyword"],
  },
  {
    id: "playback.gapless.crossfade",
    category: "playback",
    sectionId: "playback-gapless",
    title: "横向淡入淡出（Crossfade）",
    description: "自动切歌前 6 秒开始淡出淡入，手动切歌不适用",
    aliases: ["淡入淡出", "交叉淡化", "mix", "混音过渡"],
    keywords: ["crossfade", "fade"],
  },
  {
    id: "playback.gapless.gapless",
    category: "playback",
    sectionId: "playback-gapless",
    title: "无缝衔接（Gapless）",
    description: "自动切歌零间隙接续下一曲，关闭淡入淡出后生效",
    aliases: ["无缝", "零间隙", "连播"],
    keywords: ["gapless"],
  },
  {
    id: "playback.lyrics.enabled",
    category: "playback",
    sectionId: "playback-lyrics",
    title: "显示桌面歌词",
    description: "在桌面上显示一个置顶歌词窗，可拖动到任意位置（位置会被记住），不占任务栏",
    aliases: ["桌面歌词", "悬浮歌词", "置顶歌词"],
    keywords: ["desktop lyrics"],
  },
  {
    id: "playback.lyrics.style",
    category: "playback",
    sectionId: "playback-lyrics",
    title: "外观",
    description: "纯文字用描边投影，压在亮壁纸上也看得清；歌曲卡片带歌曲信息与封面模糊底色",
    aliases: ["歌词外观", "歌词样式", "纯文字", "歌曲卡片"],
    keywords: ["lyrics style"],
  },
  {
    id: "playback.lyrics.fontSize",
    category: "playback",
    sectionId: "playback-lyrics",
    title: "字号",
    description: "当前行字号，上下句按比例缩小",
    aliases: ["桌面歌词字号", "歌词大小", "歌词字体大小", "字太小"],
    keywords: ["fontsize"],
  },
  {
    id: "playback.lyrics.lock",
    category: "playback",
    sectionId: "playback-lyrics",
    title: "锁定（鼠标穿透）",
    description: "锁定后点击直接落到下面的窗口，歌词不再挡住操作；解锁请回到这里或播放条「更多」",
    aliases: ["穿透", "锁定歌词", "点不到桌面"],
    keywords: ["lock", "clickthrough"],
  },
  {
    id: "playback.output.device",
    category: "playback",
    sectionId: "playback-output",
    title: "音频输出",
    description: "选择声音输出设备，切换后立即在新设备上继续播放；插入新设备后点「刷新」",
    aliases: ["输出设备", "声卡", "扬声器", "耳机", "没声音"],
    keywords: ["output", "device", "speaker"],
  },
  {
    id: "playback.eq.enabled",
    category: "playback",
    sectionId: "playback-eq",
    title: "均衡器",
    description: "10 段均衡（31Hz ~ 16kHz），播放时实时调整音色；关闭后输出原声",
    aliases: ["EQ", "音效", "调音", "低音", "高音"],
    keywords: ["equalizer", "eq"],
  },
  {
    id: "playback.eq.preset",
    category: "playback",
    sectionId: "playback-eq",
    title: "预设",
    description: "快速套用常见音色，手动拖动滑杆后变为「自定义」",
    aliases: ["均衡器预设", "EQ预设", "音色预设", "流行", "摇滚"],
    keywords: ["preset", "equalizer"],
  },

  /* ---------- 插件 ---------- */
  {
    id: "plugins.market.mirror",
    category: "plugins",
    sectionId: "plugins-market",
    title: "GitHub 镜像源",
    description: "为经 GitHub 下载的内容（插件安装、市场索引、图片）加速，例如 https://ghproxy.net/",
    aliases: ["镜像", "加速", "ghproxy", "下载慢"],
    keywords: ["mirror", "github", "proxy"],
  },
  {
    id: "plugins.market.sources",
    category: "plugins",
    sectionId: "plugins-market",
    title: "市场源列表",
    description: "每个源是一个 JSON 索引地址，插件市场会聚合展示所有源",
    aliases: ["市场源", "插件源", "索引地址", "第三方市场"],
    keywords: ["market", "source", "index"],
  },

  /* ---------- 数据 ---------- */
  {
    id: "data.cache.policy",
    category: "data",
    sectionId: "data-cache",
    title: "缓存项",
    description: "选择需要缓存的内容（页面数据 / 封面图片）；切换后立即清除被关闭类型的缓存",
    aliases: ["缓存", "图片缓存", "歌单缓存", "占空间"],
    keywords: ["cache", "policy"],
  },
  {
    id: "data.cache.clear",
    category: "data",
    sectionId: "data-cache",
    title: "清除缓存",
    description: "清除封面图片与页面数据缓存，下次访问时重新下载",
    aliases: ["清缓存", "清理缓存", "释放空间", "占多少空间"],
    keywords: ["clear", "cache"],
  },
  {
    id: "data.download.dir",
    category: "data",
    sectionId: "data-download",
    title: "下载目录",
    description: "下载的音频与歌词存放位置；修改目录不影响已下载的文件",
    aliases: ["保存位置", "下载路径", "存哪了", "换目录"],
    keywords: ["download", "dir", "folder"],
  },
  {
    id: "data.download.template",
    category: "data",
    sectionId: "data-download",
    title: "文件名模板",
    description: "用变量组合文件名，/ 可建立子目录（如 {artist}/{album}/{name}）；非法字符自动移除",
    aliases: ["文件名", "命名规则", "命名格式", "改名"],
    keywords: ["filename", "template"],
  },
  {
    id: "data.download.tags",
    category: "data",
    sectionId: "data-download",
    title: "写入歌曲标签",
    description: "下载时把标题 / 歌手 / 专辑 / 封面 / 歌词写进音频文件，同时保存同名 .lrc",
    aliases: ["标签", "元数据", "ID3", "歌词文件"],
    keywords: ["tags", "metadata"],
  },
  {
    id: "data.download.offline",
    category: "data",
    sectionId: "data-download",
    title: "离线音乐",
    description: "查看已下载的曲库、导出文件或定位到文件夹",
    aliases: ["已下载", "离线", "本地下载", "导出音频"],
    keywords: ["offline", "downloaded"],
  },
  {
    id: "data.backup.export",
    category: "data",
    sectionId: "data-backup",
    title: "导出备份",
    description: "把设置、歌单、喜欢的音乐、离线索引与播放队列导出为 JSON",
    aliases: ["备份", "导出", "换机", "迁移"],
    keywords: ["backup", "export"],
  },
  {
    id: "data.backup.credentials",
    category: "data",
    sectionId: "data-backup",
    title: "包含插件登录凭证",
    description: "勾选后会把插件 Cookie / Token 一并写入备份。备份是明文 JSON，分享前请取消勾选",
    aliases: ["凭证", "Cookie", "Token", "登录状态备份"],
    keywords: ["credential", "cookie"],
  },
  {
    id: "data.backup.import",
    category: "data",
    sectionId: "data-backup",
    title: "导入备份",
    description: "按名称合并歌单、按曲目去重；不会删除现有内容，重复导入也不会产生重复数据",
    aliases: ["还原", "导入", "恢复备份"],
    keywords: ["import", "restore"],
  },
  {
    id: "data.cloud.server",
    category: "data",
    sectionId: "data-cloud",
    title: "服务器地址",
    description: "填你自建服务器（Docker 部署后就是 http://IP:3456）。地址存在本机，换服务器只需改这里重新登录",
    aliases: ["自建服务器", "云服务地址", "音乐云"],
    keywords: ["server", "url", "cloud"],
  },
  {
    id: "data.cloud.account",
    category: "data",
    sectionId: "data-cloud",
    title: "账号",
    description: "同一个账号在多台设备登录后，喜欢、歌单、播放历史与歌曲自定义信息会互相同步",
    aliases: ["登录", "注册", "账号", "同步账号"],
    keywords: ["account", "login", "register"],
  },
  {
    id: "data.cloud.library",
    category: "data",
    sectionId: "data-cloud",
    title: "曲库",
    description: "上传本地文件到云端曲库，查看占用与已上传数量",
    aliases: ["云端曲库", "上传音乐", "云盘"],
    keywords: ["library", "upload"],
  },
  {
    id: "data.cloud.sync",
    category: "data",
    sectionId: "data-cloud",
    title: "账号数据同步",
    description: "同步喜欢、歌单（含顺序）、播放历史与歌曲自定义信息",
    aliases: ["同步", "立即同步", "多端同步", "重置同步"],
    keywords: ["sync", "cloud"],
  },

  /* ---------- 实验性 ---------- */
  {
    id: "experimental.studio.enabled",
    category: "experimental",
    sectionId: "experimental-studio",
    title: "显示录音棚入口",
    description: "开启后侧边栏与「更多」菜单出现「录音棚」，可用当前歌曲伴奏录人声并混音；关闭只隐藏入口，作品仍保留",
    aliases: ["录音棚", "录音", "翻唱", "录歌"],
    keywords: ["studio", "record"],
  },
  {
    id: "experimental.autoPlaylist.enabled",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "自然播完后自动整理",
    description: "一首歌播放到结尾后按下面的规则加入本地歌单，手动切歌不计入",
    aliases: ["自动加歌单", "听完自动收藏", "自动归档"],
    keywords: ["auto playlist"],
  },
  {
    id: "experimental.autoPlaylist.mode",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "添加方式",
    description: "固定歌单适合把所有听完的歌攒在一起；自动分类会按歌词与歌手判断语种和类型",
    aliases: ["自动分类", "固定歌单", "按语种分类"],
    keywords: ["mode"],
  },
  {
    id: "experimental.autoPlaylist.target",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "目标歌单",
    description: "听完的歌全部加入这个歌单，本地歌单与已登录平台的个人歌单都能选",
    aliases: ["加进哪个歌单", "目标歌单"],
    keywords: ["target"],
  },
  {
    id: "experimental.autoPlaylist.groups",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "分类歌单",
    description: "给每个语种 / 类型各选一个歌单，选「不自动添加」表示这一类不处理",
    aliases: ["华语歌单", "日韩歌单", "Vocaloid 歌单", "纯音乐"],
    keywords: ["language", "genre"],
  },
  {
    id: "experimental.autoPlaylist.keywords",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "Vocaloid 自定义关键词",
    description: "在内置词表之外追加：按歌名、歌手与专辑做子串匹配，命中就只进 Vocaloid 歌单",
    aliases: ["Vocaloid", "术力口", "自定义关键词"],
    keywords: ["keywords", "vocaloid"],
  },
  {
    id: "experimental.autoPlaylist.reset",
    category: "experimental",
    sectionId: "experimental-auto-playlist",
    title: "已处理记录",
    description: "清空记录不会动歌单内容，只是让之后听完的歌重新走一次判定",
    aliases: ["处理记录", "重新判定", "清空记录"],
    keywords: ["reset"],
  },

  /* ---------- 关于 ---------- */
  {
    id: "about.hero.version",
    category: "about",
    sectionId: "about-hero",
    title: "版本号",
    description: "点击可复制版本号，反馈问题时常用",
    aliases: ["版本", "版本信息", "当前版本"],
    keywords: ["version"],
  },
  {
    id: "about.hero.links",
    category: "about",
    sectionId: "about-hero",
    title: "Github 主页与反馈",
    description: "打开项目主页或提交 issue",
    aliases: ["反馈", "issue", "github", "提意见", "开源地址"],
    keywords: ["repo", "issues"],
  },
  {
    id: "about.update.check",
    category: "about",
    sectionId: "about-update",
    title: "软件更新",
    description: "手动检查新版本，或前往 Release 页面下载",
    aliases: ["检查更新", "手动更新", "下载新版本"],
    keywords: ["update", "release"],
  },
  {
    id: "about.notices.thirdParty",
    category: "about",
    sectionId: "about-notices",
    title: "第三方组件",
    description: "主要依赖 Tauri、Vue 的协议信息与完整声明",
    aliases: ["开源协议", "致谢", "许可", "License"],
    keywords: ["notices", "license", "third party"],
  },
];

export const ITEM_BY_ID = new Map(SETTINGS_ITEMS.map((item) => [item.id, item]));
export const SECTION_BY_ITEM_ID = new Map(SETTINGS_ITEMS.map((item) => [item.id, item.sectionId]));

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

/** 预编译一次：每条记录的标题 / 别名 / 分类分组 / 描述都归一化好 */
const COMPILED = SETTINGS_ITEMS.map((item, order) => {
  const sectionTitle = SECTION_BY_ID.get(item.sectionId)?.title ?? "";
  return {
    item,
    order,
    title: normalize(item.title),
    alias: [...(item.aliases ?? []), ...(item.keywords ?? [])].map(normalize),
    group: normalize(`${categoryLabel(item.category)}${sectionTitle}`),
    description: normalize(item.description),
  };
});

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
  for (const row of COMPILED) {
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
  const title = SECTION_BY_ID.get(item.sectionId)?.title ?? "";
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
