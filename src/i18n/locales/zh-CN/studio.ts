/**
 * 录音棚词条：录音、回放、导出。
 *
 * 「开始 / 结束 / 处理中」这类通用动词走 `common.*`；这里只放录音棚特有的
 * 麦克风、试音、混音术语。
 */
export default {
  /** 页面头部与作品列表 */
  page: {
    title: "录音棚",
    experimental: "（实验性）",
    mobileTitle: "录音棚（实验性）",
    subtitle: "用当前播放的歌曲当伴奏，唱完直接混成一条音轨",
    recordings: "我的录音",
    recordingsCount: "{count} 条",
    empty: "还没有录音。选一首歌，点上面的按钮开始唱。",
  },

  /** 麦克风、试音与录音状态 */
  record: {
    microphone: "麦克风",
    inputLevel: "输入电平",
    probe: "试音",
    probing: "试音中…",
    probeBusy: "正在采集，请对着麦克风说句话…",
    probeNoSound: "没有收到任何声音：系统可能没允许应用使用麦克风，或当前设备选错了",
    probeWeak: "有声音但偏小（峰值 {db}），可以离麦克风近一点",
    probeOk: "麦克风正常（峰值 {db}）",
    silent: "静音",
    monitor: "耳机监听",
    monitorHint: "戴耳机再开，避免啸叫",
    monitorVolume: "监听音量",
    openSystemSettings: "打开系统设置",
    startHint: "点击开始录音",
    stopWithTime: "点击结束并混音 · {time}",
    liveWithTime: "正在录音 · {time}",
    savedWithDuration: "录音已保存 · {time}",
    untitled: "未命名录音",
    acapella: "清唱",
    acapellaRecording: "清唱录音",
    deleted: "录音已删除",
    noVocalTag: "无人声伴奏",
    playbackBlocked: "录音回放 · 换一首歌才能继续录",
    playbackBlockedShort: "当前是录音回放，不能当伴奏",
  },

  /** 作品回放 */
  playback: {
    noTrack: "还没有选择伴奏",
    pickHint: "在播放器里挑一首歌，它就会出现在这里",
  },

  /** 混音与文件操作 */
  export: {
    open: "混音",
    dialogTitle: "混音调整",
    regenerate: "重新生成",
    hint: "人声与伴奏已经按录音时间戳自动对齐，如果听起来「人声偏早/偏晚」，用对齐微调补一点。",
    offset: "对齐微调",
    voice: "人声",
    song: "伴奏",
    reveal: "在文件夹中显示",
    deleteTitle: "删除录音",
    deleteConfirm: "删除后无法恢复，确定要删除「{name}」吗？",
    deleteFallbackName: "这条录音",
    updated: "混音已更新",
  },

  /** 录音相关的错误提示 */
  error: {
    noSound: "麦克风没有收到声音，请检查系统麦克风权限或换一个输入设备",
    playbackAsBacking: "现在放的是录音成品，换一首歌再录",
    appOnly: "录音功能需要在应用内使用",
  },
};
