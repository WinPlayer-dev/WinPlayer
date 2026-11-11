/** 设置 › 实验性。默认关闭的功能，文案里要讲清楚「为什么要谨慎」。 */
export default {
  /** 面板顶部说明 */
  note: "这些功能仍在打磨，界面与行为可能随版本调整。关闭开关只是隐藏入口，已有数据不会删除。",

  /** 分组：录音棚 */
  studio: {
    section: "录音棚",
    enabled: {
      title: "显示录音棚入口",
      description:
        "开启后侧边栏与「更多」菜单出现「录音棚」，可用当前歌曲伴奏录人声并混音；关闭只隐藏入口，作品仍保留",
    },
  },

  /** 分组：听完自动加歌单 */
  autoPlaylist: {
    section: "听完自动加歌单",
    enabled: {
      title: "自然播完后自动整理",
      description:
        "一首歌播放到结尾后按下面的规则加入本地歌单，手动切歌不计入。每首歌只会处理一次，处理过的歌不会再被自动添加",
    },
    mode: {
      title: "添加方式",
      description: "固定歌单适合把所有听完的歌攒在一起；自动分类会按歌词与歌手判断语种和类型",
    },
    target: {
      title: "目标歌单",
      description: "听完的歌全部加入这个歌单，本地歌单与已登录平台的个人歌单都能选",
    },
    groups: {
      title: "分类歌单",
      description:
        "给每个语种 / 类型各选一个歌单（本地或平台个人歌单），选「不自动添加」表示这一类不处理。识别为 Vocaloid 的歌只进类型歌单，不再按语种分流；没有歌词时按歌名、歌手与专辑判断。平台歌单只接收同一来源的歌曲",
      language: "语种",
      type: "类型",
    },
    keywords: {
      title: "Vocaloid 自定义关键词",
      description:
        "在内置词表之外追加：按歌名、歌手与专辑做子串匹配（忽略大小写），命中就只进 Vocaloid 歌单。多个词用逗号、顿号或换行分隔，输入后自动保存",
      placeholder: "例如：Fukase、v flower、星尘Infinity",
      saved: "已保存 {count} 个自定义关键词",
      tip: "（与内置词表同时生效）",
    },
    reset: {
      title: "已处理记录",
      description: "共 {count} 首。清空记录不会动歌单内容，只是让之后听完的歌重新走一次判定",
      action: "清空记录",
      done: "已清空自动歌单处理记录",
    },
    options: {
      mode: {
        fixed: "添加到指定歌单",
        auto: "按语种和类型自动分类",
      },
      noPlaylist: "不自动添加",
      /** 语种标签 */
      languages: {
        english: "英语",
        chinese: "华语",
        japanese: "日语",
        korean: "韩语",
        other: "其他",
      },
      remotePlaylist: "平台歌单",
      deletedPlaylist: "已删除的歌单",
    },
    /** 已保存但当前拉不到的目标歌单 */
    unavailable: "{name}（不可用）",
    loading: "正在加载平台歌单…",
    empty: "还没有可选歌单：先在「我的 → 歌单」里创建一个本地歌单，或在插件里登录平台账号。",
    loadFailed: "{sources}的歌单加载失败，可稍后重新打开本页重试",
    platformLoadFailed: "平台歌单加载失败：{message}",
    /** 多个来源名的连接符 */
    listSeparator: "、",
  },
};
