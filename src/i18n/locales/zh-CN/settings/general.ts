/**
 * 设置 › 通用。
 *
 * 分组顺序与 `views/settings/panels/GeneralPanel.vue` 的模板一致。
 * 分组 key 与 `<SettingsSection id="general-*">` 的后半段对齐，搜索索引按同一批 key 取值。
 */
export default {
  /** 分组：语言 */
  language: {
    section: "语言",
    interface: {
      title: "界面语言",
      description: "切换后立即生效，无需重启",
    },
  },

  /** 分组：启动与引导 */
  startup: {
    section: "启动与引导",
    page: {
      title: "打开时页面",
      description: "每次启动应用后直接进入所选页面",
      /** 桌面端追加的半句（「我的」是移动端专属入口） */
      descriptionDesktopSuffix: "。桌面端不提供「我的」",
      /** 偏好仍是「我的」时的下拉占位文案 */
      placeholderMobileOnly: "仅移动端可选",
      options: {
        recommend: "推荐",
        liked: "我喜欢的音乐",
        offline: "离线音乐",
        mine: "我的",
      },
    },
    onboarding: {
      title: "欢迎引导",
      description: "重新查看欢迎页与添加播放源引导，不影响已装插件与现有设置",
      action: "重新查看",
    },
  },

  /** 分组：窗口与系统 */
  window: {
    section: "窗口与系统",
    remember: {
      title: "记住窗口大小与位置",
      description: "退出时记住窗口尺寸、位置与最大化状态，下次启动还原",
      resetSuccess: "窗口已恢复默认大小并居中",
      resetFailed: "重置失败: {error}",
    },
    closeBehavior: {
      title: "关闭按钮行为",
      description: "关闭窗口时收进托盘继续播放、最小化到任务栏或直接退出",
      options: {
        tray: "关闭到系统托盘",
        minimize: "最小化到任务栏",
        quit: "直接退出",
      },
    },
    background: {
      title: "后台优化",
      description: "窗口隐藏时暂停动画与轮询以降低占用，播放不受影响",
    },
    smtc: {
      title: "系统媒体传输控件（SMTC）",
      description: "在系统媒体浮出窗、锁屏与蓝牙设备上显示曲目和进度，并响应系统播放控制",
    },
  },

  /** 分组：车载模式 */
  car: {
    section: "车载模式",
    lyrics: {
      title: "歌词显示在媒体控件上",
      description: "媒体控件标题显示当前歌词行，没有歌词时显示歌名；需开启系统媒体控件",
    },
  },

  /** 分组：触感反馈 */
  feedback: {
    section: "触感反馈",
    vibration: {
      title: "震动反馈",
      description: "长按菜单、下拉刷新、收藏等操作时轻微震动",
    },
  },

  /** 分组：搜索 */
  search: {
    section: "搜索",
    aggregate: {
      title: "聚合搜索",
      description: "搜索页多出一个「全部」Tab，聚合所有插件的结果",
    },
  },

  /** 分组：隐私 */
  privacy: {
    section: "隐私",
    history: {
      title: "记录播放历史",
      description: "记录播放次数与最近播放时间；关闭后不再记录，已有数据保留",
    },
    demoMode: {
      title: "隐藏来源名与歌单",
      description:
        "录屏 / 截图时使用：播放源名称统一显示为「在线音乐」，侧边栏与「我的」页里的歌单、平台歌单入口一并隐藏。只影响显示，不会删除歌单，也不改变插件的启用状态",
    },
  },

  /** 分组：更新 */
  update: {
    section: "更新",
    auto: {
      title: "自动检查更新",
      description: "启动时静默检查新版本，有更新时提示；关闭后仍可在",
      /** 描述里的行内跳转链接 */
      link: "「关于」页",
      descriptionAfterLink: "手动检查",
    },
    frequency: {
      title: "自动检查频率",
      description: "「{startup}」每次打开都检查，「{daily}」每天只检查一次，「{manual}」只在「关于」页检查",
      options: {
        startup: "每次启动",
        daily: "每 24 小时",
        manual: "仅手动",
      },
    },
    prerelease: {
      title: "接收预览版本（Beta）",
      description: "同时检查预发布版本，可提前体验新功能，但可能不够稳定",
    },
  },
};
