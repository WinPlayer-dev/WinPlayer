/**
 * 设置页**搜索索引**的摘要文案。
 *
 * 与各面板卡片里的 `description` 不是同一句话：卡片描述讲「这个开关做什么」，
 * 这里讲「你这个搜索词为什么命中它」，所以更富关键词（同义词、别名、使用场景）。
 * 分开是**有意为之**——合并会让搜索命中率下降，或者让卡片描述变得又长又像说明书。
 *
 * key 结构：`<分类>.<条目 id 去掉分类段后转小驼峰>`，由
 * `scripts/i18n-settings-index-keys.mjs` 生成，条目 id 改名时记得同步。
 */
export default {
  general: {
    privacyDemoMode: "录屏 / 截图时使用：播放源名称统一显示为「在线音乐」，侧边栏与「我的」页里的歌单、平台歌单入口一并隐藏",
    updateAutoCheck: "启动时静默检查新版本，有更新时提示；关闭后仍可在「关于」页手动检查",
    updateFrequency: "「每次启动」每次打开都检查，「每 24 小时」每天只检查一次，「仅手动」只在「关于」页检查",
  },
  shortcut: {
  },
  appearance: {
    layoutSongList: "手机端歌单 / 专辑 / 歌手 / 我的喜欢 / 离线音乐等列表页的排版；「云端」会变成封面主色渐变头部 + 白色圆角面板",
    lyricsPreview: "手机全屏页与桌面正在播放页的歌词效果，调下面任一选项都会立即反映在这里",
    lyricsFontSize: "全屏播放页歌词的字号，当前行按放大比例缩放",
    lyricsAlign: "歌词居中或靠左显示；短句适合居中，长句与说唱适合靠左",
    lyricsPosition: "当前正在唱的那一行停在播放页的靠上 / 居中 / 靠下位置；靠下适合回看刚唱过的句子",
    lyricsScroll: "切换歌词行时移动的快慢，以及放大 / 加粗 / 变淡的缓动曲线；速度越快，行切换也越利落",
    lyricsFont: "歌词使用的字体：跟随应用、黑体、宋体、圆体、楷体、等宽，或填系统里已装的字体名",
    lyricsWeight: "所有歌词行的基础字重：细 / 常规 / 中等 / 半粗 / 粗",
    lyricsActiveBold: "正在播放的那一句用更重的字重突出",
    lyricsEnlarge: "关闭后所有歌词一样大，只靠亮度区分当前行",
    lyricsScale: "当前行相对常规行的倍数，100% 等于不放大",
    lyricsBlur: "距离当前行越远越模糊，模拟视线焦点；关闭后仍按亮度分层",
    lyricsBlurStrength: "非当前行模糊的力度，调高会形成只有当前句清晰的强焦点效果",
    lyricsDim: "紧邻当前行那一句的不透明度，越远的行按比例更淡",
    lyricsGap: "每行歌词上下留白，越大越透气，一屏能看到的行数越少",
    lyricsTranslation: "有翻译的歌词在原文下方显示小字副行",
    lyricsGlow: "给当前行加柔和投影，压在亮色封面上也看得清；调到 0 完全不加",
    lyricsMask: "歌词在歌词区上下边缘淡入淡出；关闭后是干净的裁切边缘",
    lyricsReset: "把歌词样式恢复成初始外观，不影响歌词来源与偏移",
  },
  playback: {
    sourceSearchFormat: "播放源、歌词源重新搜曲的关键词格式，支持 {歌曲名}、{歌手名}、{专辑名}、{别名}",
    gaplessGapless: "自动切歌零间隙接续下一曲，关闭淡入淡出后生效",
  },
  plugins: {
    marketMirror: "为经 GitHub 下载的内容（插件安装、市场索引、图片）加速，例如 https://ghproxy.net/",
    marketSources: "每个源是一个 JSON 索引地址，插件市场会聚合展示所有源",
  },
  data: {
    cachePolicy: "选择需要缓存的内容（页面数据 / 封面图片）；切换后立即清除被关闭类型的缓存",
    cacheClear: "清除封面图片与页面数据缓存，下次访问时重新下载",
    downloadDir: "下载的音频与歌词存放位置；修改目录不影响已下载的文件",
    downloadTemplate: "用变量组合文件名，/ 可建立子目录（如 {artist}/{album}/{name}）；非法字符自动移除",
    downloadTags: "下载时把标题 / 歌手 / 专辑 / 封面 / 歌词写进音频文件，同时保存同名 .lrc",
    downloadOffline: "查看已下载的曲库、导出文件或定位到文件夹",
    backupExport: "把设置、歌单、喜欢的音乐、离线索引与播放队列导出为 JSON",
    backupCredentials: "勾选后会把插件 Cookie / Token 一并写入备份。备份是明文 JSON，分享前请取消勾选",
    backupImport: "按名称合并歌单、按曲目去重；不会删除现有内容，重复导入也不会产生重复数据",
    cloudServer: "填你自建服务器（Docker 部署后就是 http://IP:3456）。地址存在本机，换服务器只需改这里重新登录",
    cloudAccount: "同一个账号在多台设备登录后，喜欢、歌单、播放历史与歌曲自定义信息会互相同步",
    cloudLibrary: "上传本地文件到云端曲库，查看占用与已上传数量",
    cloudSync: "同步喜欢、歌单（含顺序）、播放历史与歌曲自定义信息",
  },
  experimental: {
    autoPlaylistEnabled: "一首歌播放到结尾后按下面的规则加入本地歌单，手动切歌不计入",
    autoPlaylistGroups: "给每个语种 / 类型各选一个歌单，选「不自动添加」表示这一类不处理",
    autoPlaylistKeywords: "在内置词表之外追加：按歌名、歌手与专辑做子串匹配，命中就只进 Vocaloid 歌单",
    autoPlaylistReset: "清空记录不会动歌单内容，只是让之后听完的歌重新走一次判定",
  },
  about: {
    updateCheck: "手动检查新版本，或前往 Release 页面下载",
    noticesThirdParty: "主要依赖 Tauri、Vue 的协议信息与完整声明",
  },
};
