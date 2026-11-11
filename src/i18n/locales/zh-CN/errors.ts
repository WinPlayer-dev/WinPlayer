/**
 * 错误与警告词条：**前端自己产生的**提示文案。
 *
 * 两类来源不在这里：
 * - Rust 命令返回的错误（原生侧仍是中文，原样透传）
 * - 服务端 / 插件返回的错误消息
 *
 * 词条里不要带「错误：」前缀，展示层会按场景加标题。
 *
 * 说明：服务层 / store 里还有少量「操作成功」类 toast（喜欢、歌单、自动更新），
 * 它们同样由前端直接产生、且没有独立的域文件，统一放在 `generic` 下，
 * 命名按动作描述（`likeAdded` / `updateCanceled` …），不要按页面命名。
 */
export default {
  generic: {
    /** 桌面歌词窗口打开失败 */
    desktopLyricsOpenFailed: "无法打开桌面歌词窗口",

    /** 剪贴板复制（`{label}` 由调用方给出，如「歌曲名」） */
    clipboardEmpty: "没有可复制的{label}",
    clipboardCopied: "已复制{label}",
    clipboardDefaultLabel: "内容",

    /** 喜欢 / 取消喜欢（stores/library） */
    likeAdded: "已添加到我喜欢的音乐",
    likeRemoved: "已取消喜欢",

    /** 本地歌单创建 / 删除（stores/library） */
    playlistCreated: "歌单「{name}」创建成功",
    playlistDeleted: "歌单已删除",

    /**
     * 曲目列表排序菜单（`services/trackQuery.ts` 的 TRACK_SORT_OPTIONS）。
     * 其余字段名复用 `common.column.*`；这两项没有通用词条，暂放这里。
     */
    trackSortDefault: "默认顺序",
    trackSortName: "歌曲名",

    /** 自动更新流程（stores/updater、services/updater） */
    update: {
      unsupportedPlatform: "当前平台不支持自动更新，请前往 Release 页面手动下载",
      /** 页面上的平台名取不到时的兜底说法 */
      platformFallback: "当前平台",
      noAssetForPlatform:
        "发现新版本 {version}，但该版本没有 {target} 的安装包，请前往 Release 页面下载",
      upToDate: "当前已是最新版本 {version}",
      installStarted: "已开始安装更新，请在系统提示中完成安装",
      canceled: "已取消更新下载",
      versionIgnored: "已忽略版本 {version}，之后不再自动提示",

      /** 安装包类型（services/updater 的 INSTALLER_LABELS） */
      installer: {
        windowsNsis: "Windows 安装程序",
        windowsMsi: "Windows 安装包（MSI）",
        macosDmg: "macOS 磁盘映像",
        linuxAppImage: "Linux AppImage",
        linuxDeb: "Linux deb 包",
        linuxRpm: "Linux rpm 包",
        androidApk: "Android 安装包",
      },
    },
  },

  network: {
    /** 响应体 / 错误体无法按 JSON 解析 */
    invalidJson: "响应不是合法的 JSON",
    serverInvalidJson: "服务器返回的不是合法的 JSON",
    /** WebDAV 未配置时点扫描 / 打开曲库 */
    webdavNotConfigured: "尚未配置 WebDAV 服务器",
  },

  audio: {
    /** 引擎未给出错误原文时的兜底 */
    playbackError: "播放出错",
    loadFailed: "加载音频失败: {error}",
    outputDeviceFailed: "切换输出设备失败: {error}",
    /** 自动重试用尽（`{message}` 为引擎原文） */
    retryExhausted: "{message}（已重试 {count} 次，可手动点击播放重试）",
    autoRetrying: "播放出错，已自动重试（{count}/{total}）",
    cannotPlay: "无法播放「{track}」: {error}",
    playFailed: "播放失败: {error}",
  },

  file: {
    /** 文件内容不是合法 JSON（备份与歌单共用） */
    invalidJson: "不是合法的 JSON 文件",

    /** 整库备份（services/backup） */
    backup: {
      saveTitle: "导出 WinPlayer 备份",
      openTitle: "选择 WinPlayer 备份文件",
      filter: "WinPlayer 备份",
      emptyOrUnreadable: "备份文件为空或无法读取",
      empty: "备份内容为空",
      notWinPlayer: "这不是 WinPlayer 的备份文件",
      missingVersion: "备份缺少版本号",
      versionTooNew: "备份版本 {version} 高于当前应用支持的 {supported}，请先升级",
      /** 还原时跳过的项目说明（写进导入摘要） */
      skipPlaylistExists: "歌单「{name}」已存在，已合并曲目",
      skipOrphanTracks: "曲目所属歌单（#{id}）不在备份中，已跳过",
      /** 导入结果 toast */
      exported: "备份已导出",
      restored: "已恢复：{parts}",
      nothingToRestore: "备份里没有可恢复的内容",
      skippedCount: "有 {count} 项被跳过：{first}",
      exportFailed: "导出失败: {error}",
      importFailed: "导入失败: {error}",
      /** 恢复摘要里的分项（`{count}` 为条目数） */
      summary: {
        settings: "{count} 项设置",
        liked: "{count} 首喜欢",
        playlists: "{count} 个歌单",
        playlistTracks: "{count} 首歌单曲目",
        offline: "{count} 条离线索引",
        history: "{count} 条播放历史",
        trackMeta: "{count} 首自定义信息",
        queue: "播放队列",
      },
    },

    /** 单个歌单的导入 / 导出（services/playlistIO） */
    playlist: {
      saveTitle: "导出歌单",
      openTitle: "导入歌单",
      filterWinPlayer: "WinPlayer 歌单",
      filterM3u: "M3U8 播放列表",
      filterAll: "歌单文件",
      /** 导出空歌单时的提示 */
      noTracksInPlaylist: "这个歌单还没有歌曲",
      emptyFile: "文件是空的",
      emptyContent: "文件内容为空",
      notWinPlayer: "这不是 WinPlayer 的歌单文件（整库备份请在设置 → 备份与还原里导入）",
      missingVersion: "歌单文件缺少版本号",
      versionTooNew: "歌单文件版本 {version} 高于当前应用支持的 {supported}，请先升级",
      unreadable: "无法读取这个文件（可能不是文本文件）",
      noTracksInFile: "文件里没有找到任何歌曲",
      targetMissing: "目标歌单不存在",
      preparing: "正在准备歌曲信息…",
      /**
       * 导入时新建歌单的默认名（会作为**用户数据**写进数据库）。
       * 展示在「我的」页歌单列表里，所以要翻。
       */
      defaultName: "导入的歌单",
    },

    /** 本地音乐：系统目录选择框标题 */
    pickMusicFolder: "选择音乐文件夹",
  },

  plugin: {},

  download: {
    /** 单曲下载的分组名 / 曲目名兜底 */
    singleTrack: "单曲",
    unknownTrack: "未知曲目",

    /** 加入下载队列的结果 toast（`skippedSuffix` 接在 `added` 后面） */
    added: "已加入 {count} 首到下载队列",
    skippedSuffix: "（{count} 首已下载，自动跳过）",
    allDownloaded: "所选歌曲均已下载",
    nothingToDownload: "没有可下载的歌曲",

    /** 离线文件操作 */
    deleteFailed: "删除文件失败: {error}",
    removed: "已从离线音乐移除",
    exported: "已导出所选文件",
    exportFailed: "导出失败: {error}",
  },

  media: {},
};
