/**
 * 快捷键词条：动作目录（设置 → 快捷键）的显示名与说明，以及按键展示名。
 *
 * 动作的 `id` 与默认绑定属于数据，不在这里；这里只有展示文案。
 * 「上一首 / 下一首 / 音量加 / 音量减」等通用动作名如果与别处重复，
 * 优先复用 `common.action.*`——这里保留完整句是为了动作目录能独立成立。
 */
export default {
  /** 单个按键的展示文本（其余按键名如 Esc / Enter 是通用写法，不翻译） */
  key: {
    space: "空格",
  },

  /** 应用内可配置动作 */
  action: {
    prev: {
      label: "上一首",
      description: "切换到播放队列中的上一首",
    },
    next: {
      label: "下一首",
      description: "切换到播放队列中的下一首",
    },
    volumeUp: {
      label: "音量加",
      description: "提高播放音量（每次 5%）",
    },
    volumeDown: {
      label: "音量减",
      description: "降低播放音量（每次 5%）",
    },
    cycleMode: {
      label: "播放模式切换",
      description: "在顺序播放 / 列表循环 / 单曲循环 / 随机播放之间切换",
    },
  },

  /** 系统级全局快捷键（窗口在后台也生效） */
  global: {
    playPause: {
      label: "播放 / 暂停（全局）",
      description: "任意应用中按下都能播放或暂停；窗口隐藏到托盘时同样有效",
    },
    prev: {
      label: "上一首（全局）",
      description: "任意应用中切换到上一首",
    },
    next: {
      label: "下一首（全局）",
      description: "任意应用中切换到下一首",
    },
  },
};
