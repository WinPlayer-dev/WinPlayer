/**
 * 设置 › 外观。分组与 `views/settings/appearance/` 下的各段一一对应。
 *
 * 歌词样式的每一项（字号、对齐、缓动…）都有「名称 + 选项标签 + 说明」三件套，
 * 放在 `lyrics.*` 里；预览区的示例文本也在这里（预览要能看见长句折行效果）。
 *
 * 约定：分组名固定 `section`，卡片一律 `title` + `description`，
 * 下拉 / 分段按钮的选项标签放 `options` 子组。
 */
export default {
  /** 分组：配色与材质 */
  colors: {
    section: "配色与材质",
    scheme: {
      title: "配色模式",
      description: "选择应用的亮 / 暗外观，默认跟随系统",
      options: {
        system: "跟随系统",
        light: "浅色",
        dark: "深色",
      },
    },
    material: {
      title: "窗口材质",
      description: "使用系统 Mica / Acrylic 材质作为窗口背景；关闭则使用纯色背景",
      options: {
        mica: "Mica（推荐）",
        acrylic: "Acrylic",
      },
    },
    coverAccent: {
      title: "封面取色",
      description: "从当前封面提取主色作为强调色，按钮、进度条跟随变化",
    },
    coverNatural: {
      title: "按封面原始比例",
      description:
        "按原图比例显示封面，不再统一裁成正方形；卡片外框保持正方，多余区域用模糊封面填充",
      previewNatural: "16:9 封面完整显示",
      previewSquare: "裁切为 1:1 正方形",
    },
  },

  /** 分组：主题 */
  theme: {
    section: "主题",
    current: {
      title: "当前主题",
      description: "主题可改配色、圆角、背景，甚至重写标题栏 / 播放条等界面组件；切换后立即生效",
      /** 内置外观在下拉里的名字，也是「是否切回内置」的判定值 */
      defaultOption: "默认（WinUI）",
    },
    detail: {
      noDescription: "该主题没有提供描述",
      author: "作者",
      layout: "重写界面",
      control: "重写控件",
      fallback: "已回退",
    },
    actions: {
      browseMarket: "浏览主题市场",
      openMarket: "打开主题市场",
    },
    empty: {
      title: "还没有应用主题",
      description: "当前使用内置 WinUI 外观，可从主题市场安装或导入 .zip 主题包。",
    },
    /** 首次启用含可执行组件的主题前的信任提示 */
    trust: {
      title: "该主题包含可执行代码",
      confirm: "仍要启用",
      hint: "这个主题重写了内置界面组件（Vue 单文件组件）。启用后，主题代码将以完整权限运行在主界面中，可以读取你的曲库、设置与登录凭证。请只启用你信任来源的主题。",
    },
  },

  /** 分组：布局（仅手机端） */
  layout: {
    section: "布局",
    songList: {
      title: "歌曲列表布局",
      description:
        "歌单、专辑、歌手、我的喜欢、本地音乐等列表页在手机端的排版方式；点一下立即生效，桌面端不受影响",
    },
    options: {
      default: {
        name: "默认",
        hint: "封面与标题居中，列表平铺",
      },
      cloud: {
        name: "云端",
        hint: "封面主色渐变头部，白色圆角面板包住列表",
      },
    },
    /** 预留的空位卡片 */
    placeholder: {
      name: "敬请期待",
      hint: "后续布局会出现在这里",
    },
  },

  /** 分组：歌词样式 */
  lyrics: {
    section: "歌词样式",
    preview: {
      title: "实时预览",
      description:
        "沉浸式「正在播放」页面的歌词效果；手机全屏页与桌面正在播放页共用这套外观（桌面按 {scale} 倍字号显示），调下面任一选项都会立即反映在这里",
      /** 示例歌词：故意留一句长句与两句带翻译，能看出折行、对齐与副行效果 */
      lines: {
        first: "雨落下的声音",
        second: "把整座城市泡成一片模糊的蓝",
        third: "我在便利店门口站了很久",
        fourth: "等一句不会再来的晚安",
        fifth: "雨停之前",
      },
      translations: {
        second: "The rain dissolves the city into blue",
        third: "I waited outside the store",
        fifth: "Before the rain stops",
      },
    },
    fontSize: {
      title: "歌词字号",
      description: "常规行的字号，当前行按下面的比例放大或保持不变",
    },
    align: {
      title: "对齐方式",
      description: "短句适合居中，长句与说唱适合靠左；翻译副行跟随同一方向",
      options: {
        center: "居中",
        left: "靠左",
      },
    },
    anchor: {
      title: "当前行位置",
      options: {
        top: "靠上",
        center: "居中",
        bottom: "靠下",
      },
      hints: {
        top: "当前行靠上，下方留出更多「接下来要唱」的内容，适合跟唱",
        center: "当前行居中，上下各分一半，最平衡也最不容易疲劳",
        bottom: "当前行靠下，上方保留刚唱过的句子，适合边听边回看",
      },
    },
    scroll: {
      title: "歌词滚动",
      description:
        "切换歌词行时移动的快慢，以及当前行放大 / 加粗 / 变淡的过渡节奏；速度越快，行切换越利落",
      easingLabel: "缓动曲线",
      easingOptions: {
        out: "缓出",
        inout: "缓入缓出",
      },
      easingHints: {
        out: "起步快、收尾缓，跟唱时更跟手",
        inout: "两头慢、中间快，慢歌与长句更贴",
      },
    },
    font: {
      title: "歌词字体",
      /** 前半句是所选预设的说明，运行时插值 */
      description: "{hint}；只作用于歌词，不改界面字体",
      placeholder: '如 "Noto Serif SC" 或 "HarmonyOS Sans SC"',
      options: {
        default: {
          label: "跟随应用",
          hint: "与界面使用同一套字体，最稳",
        },
        sans: {
          label: "无衬线（黑体）",
          hint: "思源黑体 / HarmonyOS Sans 一类，清晰现代",
        },
        serif: {
          label: "衬线（宋体）",
          hint: "宋体 / Noto Serif，适合慢歌与老歌",
        },
        round: {
          label: "圆体",
          hint: "圆润可爱，系统没有圆体时回落到黑体",
        },
        kai: {
          label: "楷体",
          hint: "手写感，系统没有楷体时回落到宋体",
        },
        mono: {
          label: "等宽",
          hint: "数字与英文更整齐，适合电子 / 说唱",
        },
        custom: {
          label: "自定义",
          hint: "填系统里已安装的字体名",
        },
      },
    },
    weight: {
      title: "文字粗细",
      description: "所有歌词行的基础字重；系统缺少该字重时会就近取用（细 / 常规 / 中等 / 半粗 / 粗）",
      options: {
        thin: "细",
        normal: "常规",
        medium: "中等",
        semibold: "半粗",
        bold: "粗",
      },
    },
    activeBold: {
      title: "当前行加粗",
      description: "让正在播放的那一句用更重的字重突出（比常规字重至少加粗 300）",
    },
    enlarge: {
      title: "放大当前行",
      description: "关闭后所有行一样大，只靠亮度区分当前行，适合喜欢安静排版的人",
    },
    scale: {
      title: "放大比例",
      description: "当前行相对常规行的倍数；100% 等于不放大",
    },
    blur: {
      title: "模糊非当前行",
      description: "距离当前行越远越模糊，模拟视线焦点；关闭后仍然按亮度分层，不会整屏一样亮",
    },
    blurStrength: {
      title: "模糊强度",
      description: "1× 是默认手感；调高会形成「只有当前句清晰」的强焦点效果",
    },
    dim: {
      title: "非当前行亮度",
      description: "紧邻当前行那一句的不透明度，越远的行按比例更淡；调低会让焦点更集中",
    },
    lineGap: {
      title: "行间距",
      description: "每行歌词上下的留白；调大后一屏能看到的行数变少，但每句更透气",
    },
    translation: {
      title: "显示翻译",
      description: "有翻译的歌词在原文下方显示小字副行；关闭后只显示原文",
    },
    glow: {
      title: "当前行投影",
      description: "给正在播放的一句加柔和投影，压在亮色封面上也能看清；调到 0 则完全不加",
    },
    maskFade: {
      title: "上下边缘渐隐",
      description: "歌词在歌词区上下边缘淡入淡出；关闭后是一块干净的裁切边缘",
    },
    reset: {
      title: "恢复默认",
      description: "把上面所有选项恢复成初始外观，不影响歌词来源、偏移与其他设置",
    },
  },

  /** 分组：字体（界面全局字体） */
  font: {
    section: "字体",
    global: {
      title: "全局字体",
      description:
        "自定义应用字体，填入 CSS font-family 值（可含备选字体）；留空恢复默认，输入即预览",
      placeholder: '如 Microsoft YaHei 或 "HarmonyOS Sans SC", sans-serif',
    },
  },

  /** 分组：动效 */
  motion: {
    section: "动效",
    spring: {
      title: "弹簧手感",
      description:
        "把全站缓动换成带回弹的曲线：按钮、卡片、弹层、页面切换都会「Q 弹」一下；关闭则回到 WinUI 标准曲线",
    },
    strength: {
      title: "回弹幅度",
      description: "到达终点后多冲出去一点再落回；越大幅度越夸张，调好后可在下面直接试手感",
      /** 滑杆当前档位的中文手感描述 */
      options: {
        subtle: "克制",
        medium: "适中",
        strong: "明显",
        extreme: "很弹",
      },
    },
    demo: {
      replay: "点击重放",
      disabledHint: "开启弹簧手感后可预览",
    },
  },
};
