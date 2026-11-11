/** 搜索页词条：输入框、Tab、聚合搜索结果、空态。 */
export default {
  hotKeywords: "热门搜索",
  clear: "清空",
  placeholder: {
    inSource: "在 {source} 中搜索",
    aggregate: "输入关键词，同时检索所有已启用的插件源",
    pluginFallback: "插件",
  },
  tab: {
    song: "单曲",
    playlist: "歌单",
    album: "专辑",
    artist: "歌手",
    sourceAria: "搜索来源",
  },
  result: {
    searching: "正在搜索{target}…",
    allSources: "所有插件源",
  },
  empty: {
    song: "没有找到相关单曲",
    playlist: "没有找到相关歌单",
    album: "没有找到相关专辑",
    artist: "没有找到相关歌手",
    noSourceTitle: "没有可用的搜索来源",
    noSourceDescription:
      "搜索页会为每个启用了搜索能力的播放源生成一个 Tab。可以在播放源管理里添加本地音乐文件夹，或安装在线插件。",
  },
};
