/** 设置 › 快捷键。分组与 `panels/ShortcutPanel.vue` 一致。 */
export default {
  /** 录制交互：两个分组共用的按键框文案 */
  record: {
    recording: "请按下组合键…",
    unset: "未设置",
    clearBinding: "清除绑定",
  },

  /** 分组：应用内快捷键 */
  app: {
    section: "快捷键",
    hint: "点击右侧按键框后按下组合键即可录制；Esc 取消，Backspace / Delete 清除。仅窗口在前台时生效。",
    // 各动作的显示名与说明在 `shortcuts.ts`（动作目录的唯一真源，
    // types/shortcut.ts 与设置面板共用），这里不再重复一份
  },

  /** 分组：系统级全局快捷键 */
  global: {
    section: "全局快捷键",
    hint: "由系统注册的热键，窗口在后台或托盘中也生效；组合键必须带 Ctrl / Alt / Shift / Win，被其他程序占用时会提示「{failed}」。",
    /** 搜索索引专用：这一组是若干热键行的集合，页面上没有对应的卡片标题 */
    actionsTitle: "全局播放快捷键",
    actionsHint: "播放 / 暂停、上一首、下一首的系统级热键，窗口在后台或托盘中也生效",
    enabled: {
      title: "启用全局快捷键",
      description:
        "关闭后立即注销所有系统热键，仅保留窗口内快捷键；重新开启后按下面的设置恢复注册",
    },
    status: {
      registered: "已生效",
      failed: "注册失败",
    },
    actions: {
      playPause: {
        title: "播放 / 暂停（全局）",
        description: "任意应用中按下都能播放或暂停；窗口隐藏到托盘时同样有效",
      },
      prev: {
        title: "上一首（全局）",
        description: "任意应用中切换到上一首",
      },
      next: {
        title: "下一首（全局）",
        description: "任意应用中切换到下一首",
      },
    },
  },
};
