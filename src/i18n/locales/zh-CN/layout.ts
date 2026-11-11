/**
 * 布局词条（`src/components/layout/`）：标题栏、侧边栏、播放条、
 * 手机全屏播放页、下载面板、桌面歌词窗。
 *
 * 这一层是用户**一直看着**的地方，文案要最短：按钮两个汉字、菜单三到五个字。
 * 长句尽量往 `player.*` / `library.*` 里的具体页面挪。
 *
 * 复用约定：确定/取消/关闭/上一首/下一首/移除 等一律走 `common.*`，
 * 这里只补布局层特有的词。
 */
export default {
  /** 自绘标题栏（含沉浸页顶栏的窗口按钮） */
  titleBar: {
    account: "账户",
    searchPlaceholder: "搜索音乐、歌单",
    minimize: "最小化",
    maximize: "最大化",
    restore: "还原",
    /** 主题包（md3）标题栏角落的明暗切换按钮 */
    switchToLight: "切换到浅色",
    switchToDark: "切换到深色",
  },

  /** 侧边导航 + 手机底部标签栏 */
  sideNav: {
    recommend: "推荐",
    likedMusic: "我喜欢的音乐",
    recentlyPlayed: "最近播放",
    offlineMusic: "离线音乐",
    studio: "录音棚",
    studioRecording: "录音中",
    studioRecordingTitle: "正在录音",
    playlists: "歌单",
    platformPlaylists: "平台歌单",
    syncPlatformPlaylists: "同步平台歌单",
    syncing: "正在同步…",
    noPlatformPlaylists: "暂无平台歌单",
    manageSources: "播放源管理",
    settings: "设置",
    importPlaylist: "导入歌单（.json / .m3u8）",
    newPlaylist: "新建歌单",
    createPlaylistConfirm: "创建",
    playlistName: "歌单名称",
    playlistDescription: "歌单简介（可选）",
    renamePlaylist: "重命名歌单",
    deletePlaylist: "删除歌单",
    deletePlaylistConfirm: "删除后无法恢复，确定要删除歌单「{name}」吗？",
    dropToLike: "松手收藏",
    dropToAdd: "松手添加",
    emptyPlaylists: "还没有歌单，点击 + 创建",
    emptyPlaylistsDrag: "还没有歌单，点 + 新建后就能拖进来",
    alreadyLiked: "这些歌曲已经在「我喜欢的音乐」中",
    likedCount: "已喜欢 {count} 首歌曲",
    addedToPlaylist: "已添加 {count} 首到「{name}」",
    alreadyInPlaylist: "「{name}」中已有这些歌曲",
    platformReadOnly: "「{name}」由平台自动生成，不支持手动添加歌曲",
    platformNotWritable: "该平台歌单不支持添加歌曲",
    sameSourceOnly: "只能把「{name}」的歌曲添加到该平台的歌单",
    addFailed: "添加到「{name}」失败",
    ariaLabel: "侧边导航",
    openNavigation: "打开导航",
    createPlaylistFailed: "创建歌单失败：{error}",
  },

  /** 手机底部标签栏（设置复用 sideNav.settings） */
  mobileTabBar: {
    home: "首页",
    mine: "我的",
    plugins: "插件",
  },

  /** 桌面播放条 + 其浮层（队列 / 下载 / 更多） */
  playerBar: {
    notPlaying: "未在播放",
    discoverHint: "从插件来源发现音乐",
    openNowPlaying: "打开正在播放页",
    viewArtist: "查看歌手「{name}」",
    like: "添加到我喜欢",
    unlike: "取消喜欢",
    mute: "静音",
    unmute: "取消静音",
    lyrics: "歌词",
    queue: "播放队列",
    clearQueue: "清空",
    queueEmpty: "队列为空，去发现音乐吧",
    addToPlaylist: "添加到歌单",
    addToQueue: "添加到播放队列",
    copyTrackName: "复制歌曲名",
    copyTrackAlias: "复制歌曲别名",
    trackNameLabel: "歌曲名",
    trackAliasLabel: "歌曲别名",
    playbackRate: "播放速度",
    outputDevice: "输出设备",
    systemDefault: "系统默认",
    audioQuality: "播放音质",
    defaultQuality: "默认",
    qualityHint: "写入 {source} 的音质设置；取不到时自动降级",
    abLoop: "A-B 循环",
    notSet: "未设置",
    abNotMarked: "未打点",
    abMarkA: "打 A 点（当前位置）",
    abMarkB: "打 B 点（当前位置）",
    abRemarkA: "重新打 A 点",
    abMarkAShort: "打 A 点",
    abMarkBShort: "打 B 点",
    abResetAShort: "重设 A 点",
    abQuick30: "快速循环当前 30 秒",
    abActiveHint: "已生效：播到 B 点会跳回 A 点继续循环",
    abIdleHint: "打满 A、B 两点后即开始循环",
    abClear: "清除 A-B 循环",
    sleepTimer: "睡眠定时器",
    sleepAfterTrack: "播完当前曲",
    desktopLyrics: "桌面歌词",
    desktopLyricsEnable: "开启桌面歌词",
    desktopLyricsDisable: "关闭桌面歌词",
    desktopLyricsClosed: "关闭",
    desktopLyricsShowing: "显示中",
    desktopLyricsLocked: "已锁定",
    lyricsLock: "锁定（鼠标穿透）",
    lyricsStyle: "歌词样式",
    lyricsStylePlain: "纯文字",
    lyricsStyleCard: "歌曲卡片",
    lyricsFontSize: "字号",
    lyricsFontSmaller: "缩小",
    lyricsFontLarger: "放大",
    lyricsHint: "歌词窗可拖动；锁定后鼠标穿透到下层窗口，需回主窗口解锁",
    volume: "音量",
    playMode: "播放模式",
  },

  /** 手机全屏播放页 + 迷你播放条 */
  mobilePlayer: {
    lyricOffset: "歌词偏移",
    lyricOffsetHint: "歌词比音乐早出现时按 + ，整体后移",
    resetOffset: "重置偏移",
    rateHint: "保持音调变速，适合播客 / 有声书",
    sleepHint: "到点后暂停播放，不会退出应用",
    qualityHint: "{source} · 取不到该档位时自动降级",
    dragToSort: "拖动排序",
  },

  /** 桌面沉浸式「正在播放」整页 */
  nowPlaying: {
    title: "正在播放",
    collapseWithEsc: "收起（Esc）",
  },

  /** 下载管理浮层 */
  downloadPanel: {
    title: "下载管理",
    activeCount: "{count} 项进行中",
    downloadedCount: "已下载 {count} 首",
    pauseAll: "暂停全部",
    resumeAll: "继续全部",
    clearFinished: "清除已完成",
    empty: "还没有下载任务，在歌曲上右键选择「下载到本地」",
    queued: "排队中",
    fetching: "正在获取…",
    paused: "已暂停",
    doneWithSize: "已完成 · {size}",
    failed: "下载失败",
    failedWithError: "失败：{error}",
    footerCount: "{count} 首 · {size}",
  },

  /** 移动端下拉刷新指示器 */
  pullToRefresh: {
    refreshing: "正在刷新…",
    release: "松开刷新",
    pull: "下拉刷新",
  },
};
