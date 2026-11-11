/** 设置 › 插件：市场源与下载镜像。 */
export default {
  market: {
    section: "插件市场",

    /** 卡片：GitHub 镜像源 */
    mirror: {
      title: "GitHub 镜像源",
      description:
        "为经 GitHub 下载的内容（插件安装、市场索引、图片）加速，例如 https://ghproxy.net/ ；留空直连。",
      saved: "GitHub 镜像源已保存",
    },

    /** 卡片：市场源列表 */
    sources: {
      title: "市场源列表",
      description:
        "每个源是一个 JSON 索引地址（格式见 docs/PLUGIN-DEVELOPMENT.md），插件市场会聚合展示所有源。",
      namePlaceholder: "名称（可选）",
      builtin: "内置",
    },

    errors: {
      urlRequired: "请输入市场源地址",
    },
  },
};
