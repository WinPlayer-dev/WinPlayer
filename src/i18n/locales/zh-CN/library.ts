/**
 * 曲库词条：曲库、歌单、专辑、歌手、历史、离线、我的、推荐。
 *
 * 「歌单」在中文里既能指本地歌单也能指平台歌单，词条里用 `playlist` 统一表示，
 * 平台个人歌单用 `platformPlaylist` 区分。
 */
export default {
  /** 曲库各页共用的短动作与句式（避免同一句「播放全部」在六个页面各写一遍） */
  shared: {
    playAll: "播放全部",
    addToQueue: "加入队列",
    cacheAll: "缓存全部到本地",
    cacheHotTracks: "缓存热门歌曲到本地",
    expandDescription: "展开简介",
    collapseDescription: "收起",
    noMatchingSongs: "没有匹配的歌曲",
    discoverMusic: "去发现音乐",
    deletePlaylist: "删除歌单",
    fromSource: "来自 {source}",
    fromSourceWithCount: "来自 {source} · {count} 首",
    goToSourceManagement: "前往播放源管理",
    noSourceTitle: "还没有可用的播放源",
    noSourceDescription:
      "WinPlayer 的音乐完全来自播放源。可以先去播放源管理添加本地音乐文件夹，或安装一个在线播放源插件。",
  },

  library: {
    title: "曲库",
    subtitle: "{tracks} 首 · {albums} 张专辑 · {artists} 位歌手",
    scanning: "正在扫描…",
    viewTracks: "曲目",
    viewAlbums: "专辑",
    viewArtists: "歌手",
    action: {
      rescan: "重新扫描",
      rescanning: "扫描中…",
      addFolder: "添加文件夹",
      manageFolders: "管理文件夹",
      collapseFolders: "收起文件夹",
      configureWebdav: "去配置 WebDAV",
    },
    empty: {
      localTitle: "还没有添加音乐文件夹",
      localDescription:
        "添加本机文件夹后会自动扫描其中的音频文件（含子文件夹），读取标签、内嵌封面与同名 SRT / LRC 歌词。",
      webdavUnconfiguredTitle: "还没有配置 WebDAV 服务器",
      webdavUnconfiguredDescription: "在播放源管理里填好服务器地址与账号密码后，这里就能浏览远程曲库。",
      webdavEmptyTitle: "曲库还是空的",
      webdavEmptyDescription:
        "远程目录里没有找到可播放的音频文件，或者上次扫描没有完成。可以重新扫描一次。",
      noAlbums: "曲库里还没有专辑",
      noArtists: "曲库里还没有歌手",
      noMatch: "没有匹配的曲目",
    },
    search: {
      localPlaceholder: "搜索本地曲库（标题 / 歌手 / 专辑）",
      remotePlaceholder: "搜索远程曲库（标题 / 歌手 / 专辑）",
      emptyTip: "曲库还是空的，试试重新扫描",
    },
    toast: {
      foldersAdded: "已添加 {count} 个文件夹",
      folderRemoved: "已移除文件夹及其曲库记录",
      scanCompleted: "扫描完成，共 {count} 首",
    },
  },

  playlist: {
    title: "歌单",
    loading: "正在加载歌单…",
    loadFailed: "歌单加载失败",
    pluginEmpty: "插件没有返回这个歌单的内容",
    cacheUpdating: "缓存内容，正在更新…",
    namePlaceholder: "歌单名称",
    descriptionPlaceholder: "歌单简介（可选）",
    noMatchDescription: "「{keyword}」在这个歌单里没有找到。试试歌名、歌手或专辑名的一部分。",
    empty: {
      title: "歌单还是空的",
      remoteDescription: "这个歌单暂时没有可展示的歌曲，可能是插件没有登录或内容受地区限制。",
      localDescription: "在搜索结果或喜欢的音乐里，把歌曲添加到这个歌单吧。",
    },
    exportDialog: {
      title: "导出歌单",
      jsonName: "WinPlayer 歌单（.json）",
      jsonDescription: "保留完整曲目信息，导回本应用可原样恢复；体积较大",
      m3uName: "M3U8 播放列表（.m3u8）",
      m3uDescription: "标准格式，可给其他播放器使用；导入时需要重新搜索歌曲",
    },
    renameDialog: {
      title: "重命名歌单",
    },
    deleteDialog: {
      content: "删除后无法恢复，确定要删除这个歌单吗？",
    },
    toast: {
      pinned: "这是平台自动生成的歌单，不支持手动增删歌曲",
      removed: "已从「{name}」移除",
      exported: "歌单已导出",
      exportFailed: "导出失败: {error}",
      reorderHint: "请先在默认顺序下调整曲目位置（清空搜索并选择「默认顺序」）",
    },
  },

  album: {
    loading: "正在加载专辑…",
    loadFailed: "专辑加载失败",
    pluginEmpty: "插件没有返回这张专辑的内容",
    publishDate: "{year}年{month}月{day}日",
    empty: {
      title: "这张专辑还没有曲目",
      description: "可能是插件没有登录，或该专辑在当前地区不可用。",
    },
  },

  artist: {
    loading: "正在加载歌手…",
    loadFailed: "歌手页加载失败",
    pluginEmpty: "插件没有返回这个歌手的信息",
    songCount: "{count} 首歌曲",
    hotTracks: "热门歌曲",
    playHotTracks: "播放热门歌曲",
    noHotTracks: "插件没有返回热门歌曲。",
    noAlbums: "插件没有返回这位歌手的专辑。",
    noMoreAlbums: "没有更多专辑了",
  },

  history: {
    title: "最近播放",
    mostPlayed: "最常听",
    subtitle: "{tracks} 首 · 累计播放 {plays} 次 · 共 {duration}",
    viewAria: "历史视图",
    clear: "清空",
    noMatchDescription: "「{keyword}」在播放历史里没有找到。试试歌名、歌手或专辑名的一部分。",
    empty: {
      title: "还没有播放记录",
      description:
        "播放过的歌曲会自动出现在这里，按最近播放与播放次数排列，方便找回之前听过的东西。",
    },
    clearDialog: {
      title: "清空播放历史",
      content: "清空后播放次数与最近播放记录都会丢失，但不会影响歌单与喜欢的音乐。确定继续吗？",
    },
    toastCleared: "播放历史已清空",
  },

  liked: {
    title: "我喜欢的音乐",
    noMatchDescription: "「{keyword}」在喜欢的音乐里没有找到。试试歌名、歌手或专辑名的一部分。",
    empty: {
      title: "还没有喜欢的音乐",
      description: "浏览搜索结果或推荐，点击歌曲行的心形按钮即可收藏。",
    },
  },

  offline: {
    title: "离线音乐",
    subtitle: "{count} 首 · {size}",
    missingHint: "{count} 个文件已丢失",
    missingBanner: "有 {count} 个已下载文件不在了（可能被移动或删除），它们不会出现在下方列表。",
    cleanRecords: "清理记录",
    downloading: "正在下载",
    singleDownload: "单曲下载",
    ungrouped: "未分类",
    subLiked: "喜欢",
    subSingle: "单曲",
    hasLyrics: "含歌词",
    task: {
      paused: "已暂停",
      queued: "排队中",
    },
    action: {
      reveal: "在文件夹中显示",
      exportTo: "导出到…",
      remove: "从离线音乐移除",
    },
    empty: {
      title: "还没有离线音乐",
      description:
        "在歌曲上右键（移动端长按）选择「下载到本地」，或在歌单 / 专辑 / 我喜欢的音乐页点击「缓存全部」，下载后的歌曲可离线播放。",
    },
    removeDialog: {
      title: "移除「{name}」",
      content: "将从设备中删除该音频文件（含歌词），此操作不可撤销。",
    },
    toast: {
      cleaned: "已清理 {count} 条失效记录",
      nothingToClean: "没有可清理的记录",
    },
  },

  mine: {
    avatarNotLoggedIn: "未登录任何插件账户",
    accountFallback: "账户",
    avatarHint: "头像由已登录的插件提供",
    importTooltip: "导入歌单（.json / .m3u8）",
    newPlaylist: "新建歌单",
    create: "创建",
    platformPlaylists: "平台歌单",
    syncPlatform: "同步平台歌单",
    noPlaylists: "还没有歌单，点击 + 创建",
    syncing: "正在同步…",
    noPlatformPlaylists: "暂无平台歌单",
    deleteDialogTitle: "删除歌单「{name}」",
    deleteDialogContent: "歌单内的歌曲记录将一并删除，此操作不可撤销。",
  },

  recommend: {
    title: "推荐",
    searchPlaceholder: "搜索音乐、歌单",
    loading: "正在获取各来源的推荐…",
    cacheHint: "以下为缓存内容，正在更新为最新…",
    sourceFailed: "「{source}」加载失败：{error}",
    sectionSub: "的推荐",
    empty: {
      title: "暂无推荐内容",
      description: "已启用的插件没有提供推荐，试试搜索或稍后再来。",
    },
  },
};
