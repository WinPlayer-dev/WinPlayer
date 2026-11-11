/**
 * 通用词条：按钮动词、状态词、单位、时间。
 *
 * 这里是**全站共享**的词汇表，各域迁移时优先复用，别在域文件里另造一份
 * （同一个「删除」出现两种写法会让界面看着像两个人做的）。
 *
 * 命名规范（详见 `docs/I18N.md`）：
 * - 动词短语用祈使或名词短语，不带句号
 * - 带参数的词条用 `{name}` 占位，参数名写全（`{count}` 而不是 `{n}`）
 * - 不写「请点击…」这类客套话，按钮就叫「删除」
 */
export default {
  /** 动作：按钮 / 菜单项 */
  action: {
    confirm: "确定",
    cancel: "取消",
    close: "关闭",
    save: "保存",
    add: "添加",
    delete: "删除",
    remove: "移除",
    clear: "清除",
    reset: "重置",
    retry: "重试",
    refresh: "刷新",
    import: "导入",
    export: "导出",
    open: "打开",
    play: "播放",
    pause: "暂停",
    next: "下一首",
    previous: "上一首",
    shuffle: "随机播放",
    more: "更多",
    collapse: "收起",
    rename: "重命名",
    back: "返回",
    done: "完成",
    skip: "跳过",
    continue: "继续",
    search: "搜索",
    sort: "排序",
    restoreDefault: "恢复默认",
  },

  /** 状态：标签、空态、进度 */
  state: {
    loading: "加载中…",
    processing: "处理中…",
    none: "无",
    unknown: "未知",
    unknownArtist: "未知歌手",
    unknownAlbum: "未知专辑",
    ready: "就绪",
    failed: "失败",
    warning: "警告",
    all: "全部",
    completed: "已完成",
    downloaded: "已下载",
  },

  /** 单位与量词 */
  unit: {
    minute: "{count} 分钟",
    track: "{count} 首",
    album: "{count} 张专辑",
    artist: "{count} 位歌手",
  },

  /** 相对时间：列表里的「刚刚 / 3 分钟前」 */
  time: {
  },

  /** 通用提示 */
  hint: {
    noResult: "没有找到相关内容",
    copyFailed: "复制失败",
    /** 安卓：再按一次返回键才退出 */
    androidExitHint: "再按一次返回键退出应用",
    /** 初始化部分失败：仍放行首屏，但要告诉用户数据可能不全 */
    initPartialFailed: "初始化未完全成功，部分数据可能不可用",
  },

  /** 输入校验 / 表单 */
  form: {
  },

  /** 播放器与列表里的通用列名 */
  column: {
    title: "标题",
    artist: "歌手",
    album: "专辑",
    duration: "时长",
    source: "来源",
    addedAt: "添加时间",
  },
};
