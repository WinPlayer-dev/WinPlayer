/** 设置 › 关于：版本、更新、致谢、第三方许可。 */
export default {
  /** 品牌区：软件名与许可证名不翻，这里只有说明与按钮 */
  hero: {
    tagline: "基于插件的桌面音乐播放器",
    copyVersionTitle: "点击复制版本号",
    actions: {
      repo: "Github 主页",
      feedback: "反馈问题",
    },
    specs: {
      plugins: "已装插件",
    },
    /**
     * 搜索索引专用。
     *
     * 品牌区没有 `.card-header`（大标题就是应用名），这三条是「版本号」「主页与反馈」
     * 两个入口在搜索结果里显示的名字，以及该分组的归属行文本——页面上不渲染。
     */
    section: "版本信息",
    versionTitle: "版本号",
    versionHint: "点击可复制版本号，反馈问题时常用",
    linksTitle: "Github 主页与反馈",
    linksHint: "打开项目主页或提交 issue",
  },

  /** 分组：更新 */
  update: {
    section: "更新",
    software: {
      title: "软件更新",
    },
    /** 更新状态说明 */
    status: {
      checking: "正在检查更新…",
      downloading: "正在下载最新版本…",
      installing: "正在安装更新，应用即将重启…",
      failed: "检查更新失败",
      found: "发现新版本 {version}",
      foundIgnored: "发现新版本 {version}（已忽略自动提示，可手动更新）",
      unsupported: "发现新版本 {version}，但该版本没有 {platform} 的安装包",
      done: "更新已完成",
      noAutoUpdate: "当前平台不支持自动更新，可前往 Release 页面手动下载",
      upToDate: "当前已是最新版本 · 上次检查：{time}",
      unchecked: "尚未检查更新",
    },
    actions: {
      check: "检查更新",
      checking: "检查中…",
      downloading: "正在下载…",
      installing: "正在安装…",
      view: "查看更新",
      releasePage: "Release 页面",
      restorePrompt: "恢复提示",
    },
    /** 版本被忽略时的提示行 */
    ignored: "已忽略版本 {version} 的自动提示",
    copySuccess: "已复制 {version}",
    copyFailed: "复制失败，请手动选择版本号",
    /** 平台信息缺失时的兜底名 */
    currentPlatform: "当前平台",
  },

  /** 分组：开源与致谢 */
  notices: {
    section: "开源与致谢",
    thirdParty: {
      title: "第三方组件",
      description:
        "主要依赖：Tauri（MIT / Apache-2.0）、Vue（MIT）。完整列表与协议信息见仓库中的 THIRD_PARTY_NOTICES.md。",
      action: "查看完整声明",
    },
  },
};
