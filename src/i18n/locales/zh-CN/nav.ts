/**
 * 导航词条：侧边栏、页面标题、路由相关。
 *
 * 页面标题同时用于 `document.title` 与页面头部的大标题，所以这里的文案
 * 要能「单独成立」——不要写成「查看全部歌曲」这种带上下文的句子。
 */
export default {
  /**
   * 侧边栏条目标签。
   *
   * 目前侧边栏与底部标签栏由 `layout.sideNav.*` 提供（同一批文案，避免两处各写一份），
   * 这里保留空分组作为域结构；将来若有只属于导航、不与页面标题共享的文案再放进来。
   */
  sidebar: {},

  /** 路由 `meta.title`：document.title 与页头大标题共用 */
  page: {
    recommend: "推荐",
    mine: "我的",
    search: "搜索",
    liked: "我喜欢的音乐",
    offline: "离线音乐",
    studio: "录音棚（实验性）",
    history: "最近播放",
    playlist: "歌单",
    album: "专辑",
    artist: "歌手",
    local: "本地音乐",
    library: "曲库",
    plugins: "播放源管理",
    settings: "设置",
    welcome: "欢迎",
  },

  /**
   * 播放源显示名里的通用文案。
   *
   * 演示模式（录屏 / 截图）会把所有插件来源统一显示成「在线音乐」，
   * 这里的值会直接出现在侧边栏与播放条上。
   */
  source: {
    onlineMusic: "在线音乐",
  },
};
