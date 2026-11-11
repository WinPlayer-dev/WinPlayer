/**
 * 首次引导词条（`views/WelcomeView.vue`）。
 *
 * 引导页是用户看到的第一个界面，文案量比一般页面大，单独成域。
 * 插件名、插件简介、市场地址属于插件作者，不在这里。
 */
export default {
  /** 第 1 步：开屏 */
  welcome: {
    lead: "欢迎使用 WinPlayer",
    subtitle: "一个由插件驱动的音乐播放器——音乐来自哪里、怎么播放，全都由你决定。",
    start: "开始使用",
    hint: "只需装一个播放源插件，大约 1 分钟",
  },

  /** 第 2 步：文案骨架 */
  step: {
    badge: "第 {current} 步 · 共 {total} 步",
    sourceTitle: "添加你的第一个播放源",
    sourceDesc: "插件决定音乐从哪里来。装一个提供「播放直链」能力的插件，就能搜索、播放与下载。",
  },

  /** 内嵌插件市场 */
  plugin: {
    selectSource: "选择播放源",
    entering: "正在进入 WinPlayer…",
    availableCount: "{count} 个可用插件",
    fetchingIndex: "正在获取插件市场索引…",
    loadFailed: "加载插件市场失败：{error}",
    emptyIndex: "市场索引为空，可在「插件市场」里从 URL 或本地安装",
    noDescription: "无简介",
    installed: "已安装",
    install: "安装",
    installing: "安装中…",
    footHint: "列表来自插件市场索引。需要从 URL 或本地文件安装？稍后可在「播放源」里完成。",
    skipHint: "也可以稍后在「播放源」里随时添加或更换播放源",
  },

  /** 结束引导 */
  finish: {
    saveFailed: "引导状态保存失败，下次启动可能还会看到此页",
  },
};
