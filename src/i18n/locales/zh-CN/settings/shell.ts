/**
 * 设置页外壳：分类导航名、移动端副标题、搜索框与空态。
 *
 * 分类的 `key` / `icon` / 深链别名是**代码**，在 `views/settings/categories.ts`；
 * 这里只有显示文案。
 */
export default {
  category: {
    general: "通用",
    shortcut: "快捷键",
    appearance: "外观",
    playback: "播放",
    plugins: "插件",
    data: "数据",
    experimental: "实验性",
    about: "关于",
  },

  categorySubtitle: {
    general: "启动、窗口、隐私、更新",
    shortcut: "窗口内与应用外热键",
    appearance: "配色、材质、主题、字体",
    playback: "来源、歌词、输出、音效",
    plugins: "市场源与下载镜像",
    data: "存储、下载、备份、同步",
    experimental: "录音棚、自动歌单",
    about: "版本、更新与致谢",
  },

  shell: {
    /** 页面大标题 */
    title: "设置",
    /** 设置搜索框与结果下拉 */
    search: {
      label: "搜索设置",
      shortcut: "搜索设置（Ctrl+F）",
      placeholder: "搜索设置项，如「托盘」「歌词字号」",
      empty: "没有匹配的设置项。换个说法试试，比如「托盘」「缓存」「歌词」「均衡器」。",
    },
    /** 桌面端左侧分类导航的无障碍标签 */
    navLabel: "设置分类",
    /** 移动端分类按钮的无障碍标签 */
    categorySwitch: "切换设置分类",
    /** 分类内分组 chips 的无障碍标签 */
    sectionNavLabel: "本页分组",
    /** `?focus=` 指向当前平台不存在的设置项时的提示 */
    focusUnavailable: "该项在当前平台不可用，已跳到分类顶部",
    /** 移动端底部选择分类的面板 */
    categoryPicker: {
      title: "选择设置分类",
    },
  },
};
