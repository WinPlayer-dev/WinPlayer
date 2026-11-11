/** 主题页词条：主题列表、外观包、导入导出。 */
export default {
  /** 工具栏、空态、市场源对话框 */
  page: {
    refresh: "刷新市场",
    installFromFile: "从本地安装",
    marketSource: "市场源",
    officialSource: "官方主题市场",
    count: "{count} 个主题",
    applying: "正在应用主题…",
    emptyInstalled: "还没有安装任何主题",
    marketLoadingIndex: "正在加载市场索引…",
    marketIndexEmpty: "市场索引为空或加载失败",
    loadFailed: "加载主题市场失败：{error}",
    sourceDialog: {
      title: "主题市场源",
      namePlaceholder: "名称（可选）",
      urlRequired: "请输入市场源地址",
    },
  },

  /** 分区标题 */
  tab: {
    installed: "已安装",
    market: "主题市场",
  },

  /** 主题卡片、清单校验、安装 / 应用结果 */
  theme: {
    using: "使用中",
    hasComponents: "含组件",
    unknownAuthor: "未知作者",
    builtin: "内置",
    noDescription: "无简介",
    styleOnly: "仅样式",
    installedHint: "已安装",
    fileDialogTitle: "选择主题包（.zip）",
    filterName: "WinPlayer 主题包",
    loadingList: "加载主题列表失败: {error}",
    installSuccess: "主题「{name}」安装成功",
    /** 内置主题的描述（`services/builtinThemes.ts` 里声明，列表页展示） */
    md3Description: "基于 MDUI 的 Material Design 3 主题：导航轨、药丸按钮、FAB 播放键与动态取色",
    installFailed: "安装主题失败: {error}",
    uninstalled: "主题「{name}」已卸载",
    uninstallFailed: "卸载主题失败: {error}",
    applied: "已应用主题「{name}」",
    applyFailed: "应用主题失败：{message}",
    componentsFailed: "以下组件未生效：{components}",
    notFound: "未找到主题「{id}」，可能已被卸载",
    invalidManifest: "主题清单有误：{problems}",
    uninstallTitle: "卸载主题",
    uninstallConfirm: "卸载后主题文件会被删除，若正在使用会先切回默认外观。",
    securityTitle: "该主题包含可执行代码",
    securityConfirm: "仍要启用",
    securityBody:
      "这个主题重写了内置界面组件（Vue 单文件组件）。启用后，主题代码将以完整权限运行在主界面中，可以读取你的曲库、设置与登录凭证。请只启用你信任来源的主题。",
    /** 主题包清单校验（给主题作者看的报错） */
    manifest: {
      missingId: "缺少 id",
      missingName: "缺少 name",
      missingVersion: "缺少 version（建议语义化版本，如 1.0.0）",
      missingApiVersion: "缺少 apiVersion",
      apiVersionTooHigh: "apiVersion {version} 高于当前宿主支持的 {supported}，可能无法正常工作",
      invalidComponent: "components.{key} 不是可覆盖的组件（可用：{keys}）",
      missingComponentFile: "主题包内找不到 {path}",
    },
    /** 可被主题覆盖的组件名 */
    component: {
      titleBar: "标题栏",
      sideNav: "侧边导航",
      playerBar: "播放条",
      mediaCard: "媒体卡片",
      emptyState: "空状态",
      pageShell: "页面框架（背景 / 内容区）",
      button: "按钮（主 / 次）",
      iconButton: "图标按钮",
      textBox: "文本输入框",
      comboBox: "下拉选择框",
      toggleSwitch: "开关",
      slider: "滑杆",
      numberBox: "数字输入框",
      card: "卡片容器（设置项 / 内容块）",
      background: "应用背景层",
    },
    /** 主题运行时编译错误（给主题作者看的报错） */
    compile: {
      componentFailed: "主题组件「{component}」编译失败：{message}",
      invalidRelativePath: "非法相对路径：{path}",
      unsupportedExport: "主题组件只支持 `export default` 或 `<script setup>`，不支持其它 export 语法",
      missingTemplate: "缺少 <template>",
      noTypeScript: '主题组件暂不支持 lang="ts"（浏览器内没有类型擦除器），请改用普通 JavaScript',
      onlyVueImport: "只支持导入 .vue 组件，收到：{path}",
      missingDependency: "找不到依赖文件：{path}",
      unparsableImport: "无法解析 import 语句：{clause}",
      circular: "检测到循环引用：{path}",
      moduleNotAllowed:
        "不允许导入模块「{specifier}」。主题只能使用宿主提供的模块或主题包内的 .vue 文件，详见 docs/THEME-DEVELOPMENT.md",
      generateFailed: "生成组件代码失败：{error}",
      invalidComponentObject: "编译产物不是有效的组件对象（是否缺少默认导出？）",
      contextNotReady: "主题运行时上下文尚未初始化",
    },
  },

  /** 壁纸 / 环境层（本域暂无独立文案，留给主题背景设置扩展） */
  wallpaper: {},

  /** 主题操作按钮 */
  action: {
    apply: "应用",
    install: "安装",
    installing: "安装中…",
    update: "更新",
    updating: "更新中…",
    uninstall: "卸载",
    homepage: "主页",
    source: "来源",
  },
};
