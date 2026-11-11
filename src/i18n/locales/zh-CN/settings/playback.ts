/** 设置 › 播放。分组与 `views/settings/playback/` 下的各段一一对应。 */
export default {
  /** 分组：来源偏好 */
  source: {
    section: "来源偏好",
    track: {
      title: "歌曲信息源",
      description: "搜索结果聚合时，该插件的结果排在前面",
    },
    play: {
      title: "播放源",
      description: "播放时在该插件重新搜曲并取其直链；搜不到时回退歌曲自身来源",
    },
    lyrics: {
      title: "歌词源",
      description: "取歌词时在该插件重新搜曲后取词；取不到时回退歌曲自身来源",
    },
    avatar: {
      title: "头像源",
      description: "右上角头像优先从该插件获取，取不到时再试其他插件",
    },
    searchFormat: {
      title: "搜索格式",
      description:
        "播放源、歌词源重新搜曲的关键词格式，支持 {歌曲名}、{歌手名}、{专辑名}、{别名}；留空使用默认「{placeholder}」。",
    },
    options: {
      default: "默认",
    },
  },

  /** 分组：无缝播放 */
  gapless: {
    section: "无缝播放",
    crossfade: {
      title: "横向淡入淡出（Crossfade）",
      description: "自动切歌前 6 秒开始淡出淡入，手动切歌不适用",
    },
    gapless: {
      title: "无缝衔接（Gapless）",
      description: "始终开启：关闭淡入淡出后，自动切歌零间隙接续下一曲",
      mobileDescription: "移动端自动切歌无缝衔接，不支持混音过渡",
    },
  },

  /** 分组：桌面歌词（桌面端专属） */
  desktopLyrics: {
    section: "桌面歌词",
    enabled: {
      title: "显示桌面歌词",
      description: "在桌面上显示一个置顶歌词窗，可拖动到任意位置（位置会被记住），不占任务栏",
    },
    style: {
      title: "外观",
      description: "纯文字用描边投影，压在亮壁纸上也看得清；歌曲卡片带歌曲信息与封面模糊底色",
      options: {
        plain: "纯文字",
        card: "歌曲卡片",
      },
    },
    fontSize: {
      title: "字号",
      description: "当前行字号，上下句按比例缩小",
    },
    lock: {
      title: "锁定（鼠标穿透）",
      description: "锁定后点击直接落到下面的窗口，歌词不再挡住操作；解锁请回到这里或播放条「更多」",
    },
  },

  /** 分组：输出设备（仅桌面端） */
  output: {
    section: "输出设备",
    device: {
      title: "音频输出",
      description: "选择声音输出设备，切换后立即在新设备上继续播放；插入新设备后点「刷新」",
    },
    options: {
      systemDefault: "系统默认",
    },
    actions: {
      refreshing: "刷新中…",
    },
  },

  /** 分组：音效（10 段均衡器） */
  equalizer: {
    section: "音效",
    enabled: {
      title: "均衡器",
      description: "10 段均衡（31Hz ~ 16kHz），播放时实时调整音色；关闭后输出原声",
    },
    preset: {
      title: "预设",
      description: "快速套用常见音色，手动拖动滑杆后变为「自定义」",
    },
    options: {
      custom: "自定义",
    },
  },
};
