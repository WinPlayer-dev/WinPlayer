/**
 * 公共组件词条（`src/components/common/`）。
 *
 * 这里放**组件自述**的句子：对话框标题、空态说明、右键菜单的分组标题等。
 * 单个名词（「删除」「取消」）一律复用 `common.*`，别在这里再造一份。
 */
export default {
  /** 通用对话框（自动更新） */
  dialog: {
    updatePrompt: "发现新版本",
    updatePromptPrerelease: "发现新的预览版本",
    downloadAndInstall: "下载并安装",
    ignoreVersion: "忽略此版本",
    later: "稍后",
    prerelease: "预览版",
    updateNotesMissing: "该版本未提供更新说明",
    updateDevHint: "开发模式下不会真正执行安装",
    updateDownloading: "正在下载更新",
    updateInstalling: "正在安装更新",
    updateReady: "更新已就绪",
    updateInstallingHint: "安装程序已启动，应用即将自动关闭以完成更新，请稍候…",
    updateReadyHint: "更新已准备完成。",
    updateDownloadedSize: "已下载 {size}",
    cancelDownload: "取消下载",
    continueInBackground: "后台继续",
  },

  /** 歌曲列表 */
  songTable: {
    columnArtist: "艺术家",
    columnPlayCount: "播放",
    dragHandle: "拖动调整顺序",
    downloadedToLocal: "已下载到本地",
    viewArtist: "查看歌手「{name}」",
    viewAlbum: "查看专辑「{name}」",
    copyTrackNameLabel: "歌曲名",
    copyTrackAliasLabel: "歌曲别名",
  },

  /** 右键菜单项（曲目 / 歌单卡片共用同一套动作名） */
  contextMenu: {
    addToPlaylist: "添加到歌单",
    addToQueue: "添加到播放队列",
    like: "添加到我喜欢",
    unlike: "取消喜欢",
    downloadToLocal: "下载到本地",
    uploadToCloud: "上传到同频服务器",
    editTrackMeta: "编辑歌曲信息",
    copyTrackName: "复制歌曲名",
    copyTrackAlias: "复制歌曲别名",
    copyToLocal: "复制到本地",
    copyPlaylistName: "复制歌单名",
  },

  /** 自定义歌曲信息编辑框 */
  trackMeta: {
    unknownArtist: "未知艺术家",
    titleEdit: "自定义歌曲信息",
    titleSelectTemplate: "选择模板歌曲",
    titleSearchArtist: "搜索歌手",
    titleSearchCover: "搜索封面",
    saved: "已更新歌曲信息",
    restored: "已恢复原始信息",
    saveFailed: "保存失败：{error}",
    restoreFailed: "恢复失败：{error}",
    restoreOriginal: "恢复原始",
    coverSaved: "封面已保存到本地",
    coverUrlFallback: "封面下载失败，将直接使用该地址：{error}",
    coverImported: "封面已导入",
    coverImportFailed: "导入封面失败：{error}",
    templateApplied: "已套用模板，确认无误后点「保存」",
    noCover: "这首歌没有封面",
    pickCoverTitle: "选择封面图片",
    pickCoverFilter: "图片",
    noSearchSource: "没有可用的搜索源，先在「播放源管理」里装一个",
    noSearchResult: "没有找到结果，换个关键词试试",
    searchFailed: "搜索失败：{error}",
    coverPreview: "封面预览",
    localImage: "本地图片",
    searchCover: "搜索封面",
    coverUrlPlaceholder: "粘贴图片地址后回车",
    nameLabel: "歌曲名",
    artistsHint: "多个歌手用「 / 」分隔",
    artistLinkNote: "已关联歌手主页，保存后点歌手名可跳转",
    albumPlaceholder: "这张单曲没有专辑",
    albumLinkNote: "已关联专辑页，保存后点专辑名可跳转",
    useTemplate: "以歌曲为模板",
    templateHint: "歌名、歌手、专辑、封面一次套用",
    artistKeywordPlaceholder: "歌手名",
    keywordPlaceholder: "歌名 / 歌手",
    searching: "搜索中",
    searchInProgress: "正在搜索…",
    artistSearchHint: "输入歌手名，挑一个带主页的歌手",
    templateSearchHint: "搜一首歌，用它的信息当模板",
  },

  /** 歌单导入对话框 */
  playlistImport: {
    title: "导入歌单",
    hint: "支持 WinPlayer 歌单（.json）与标准播放列表（.m3u / .m3u8）。导入时按曲目去重，缺少来源信息的歌曲会自动跨插件重新搜索。",
    fileEmpty: "文件里没有找到任何歌曲",
    nameRequired: "歌单名称不能为空",
    reading: "正在读取…",
    pickFile: "选择歌单文件…",
    formatJson: "WinPlayer 歌单",
    formatM3u: "M3U 播放列表",
    needsResolve: "其中 {count} 首需重新搜索",
    newPlaylist: "新建歌单",
    namePlaceholder: "歌单名称",
    searching: "正在重新搜索歌曲…{percent}%",
    reselect: "重新选择",
    importing: "正在导入…",
    summaryAdded: "新增 {count} 首",
    summaryDuplicated: "跳过重复 {count} 首",
    summaryResolved: "重新搜到 {count} 首",
    summaryUnresolved: "{count} 首未找到",
    summaryToNew: "已导入到新歌单",
    summaryToExisting: "已合并到歌单",
  },

  /** 「添加到歌单」选择器 */
  trackPicker: {
    title: "添加到歌单",
    localPlaylist: "本地歌单",
    trackCountLocal: "{count} 首 · 本地",
    loading: "正在加载平台歌单…",
    added: "已添加到「{name}」",
  },

  /** 空态与占位词 */
  empty: {
    noSongs: "暂无歌曲",
    untitled: "未命名",
    noPlaylists: "还没有可用的歌单",
  },

  /** 媒体卡片（歌单 / 专辑 / 歌手） */
  mediaCard: {
    localSource: "本地",
    copyingToLocal: "正在复制「{name}」到本地…",
    noTracksToCopy: "该歌单没有可复制的歌曲",
    copiedToLocal: "已复制 {count} 首歌曲到本地歌单「{name}」",
    copyPlaylistNameLabel: "歌单名",
  },

  /** 睡眠定时器 */
  sleepTimer: {
    invalidMinutes: "请输入大于 0 的分钟数",
    invalidClock: "时间格式应为 23:30",
    stopsInMinutes: "将在 {count} 分钟后停止播放",
    stopsAt: "将在 {time} 停止播放",
    stopsAtTomorrow: "将在明天 {time} 停止播放",
    afterTrackToast: "播完当前曲目后停止播放",
    canceled: "已取消睡眠定时器",
    activeAfterTrack: "播完当前曲目后停止",
    remaining: "剩余 {time} 后停止",
    minutesPlaceholder: "分钟",
    stopAfterMinutes: "分钟后停止",
    stopAtClock: "到点停止",
    pastTimeHint: "该时刻今天已过，将在明天停止",
    clockHint: "24 小时制，如 23:30",
    afterTrack: "播完当前曲目后停止",
    cancelTimer: "取消定时",
  },

  /** 曲目列表工具条 */
  trackToolbar: {
    searchPlaceholder: "在列表中搜索歌名 / 歌手 / 专辑",
    clearSearch: "清空搜索",
    ascendingHint: "{label}：升序（点击切为降序）",
    descendingHint: "{label}：降序（点击切为升序）",
  },

  /** 桌面歌词窗口 */
  desktopLyrics: {
    unlockTitle: "解锁（恢复鼠标操作）",
    unlock: "解锁",
    lockTitle: "锁定：鼠标穿透到下层窗口（在主窗口解锁）",
    lock: "锁定",
    closeTitle: "关闭桌面歌词",
  },
};
