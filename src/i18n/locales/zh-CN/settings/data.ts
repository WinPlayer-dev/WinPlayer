/**
 * 设置 › 数据。分组与 `views/settings/data/` 下的各段一一对应。
 *
 * 卡片统一 `title` + `description`；下拉/分段选项放 `options`；
 * 按钮文案优先复用 `common.action.*` / `common.state.*`，这里只放本页独有的动作词。
 * 带路径或内联 `<code>` 的描述会写成 `…Before` / `…After` 两段，由模板把中间的元素插回去。
 */
export default {
  /** 分组：存储与缓存 */
  cache: {
    section: "存储与缓存",
    /** 缓存项（ComboBox 选择要缓存的内容） */
    policy: {
      title: "缓存项",
      description: "选择需要缓存的内容（页面数据 / 封面图片）；切换后立即清除被关闭类型的缓存。",
      options: {
        playlist: "歌单",
        images: "图片",
        both: "歌单与图片",
        none: "不缓存",
      },
      /** 切换策略后的提示 */
      updated: "缓存设置已更新，已清除被关闭类型的缓存",
    },
    /** 清除缓存 */
    clear: {
      title: "清除缓存",
      description: "当前占用：{summary}。清除后将在下次访问时重新下载。",
      action: "清除缓存",
      done: "缓存已清除",
      failed: "清除缓存失败: {error}",
    },
    /** 占用摘要：封面图片体积与张数 + 页面数据体积 */
    summary: "封面图片 {size}（{count} 张） · 页面数据 {dataSize}",
  },

  /** 分组：下载与离线 */
  download: {
    section: "下载与离线",
    /** 下载目录（桌面端可选；移动端固定为应用私有目录） */
    dir: {
      title: "下载目录",
      choose: "选择目录",
      chooseDialogTitle: "选择下载目录",
      /** 描述被路径 <span> 切成两段 */
      mobileBefore: "保存在应用私有目录（",
      mobileAfter: "），可在「离线音乐」页导出。",
      desktopBefore: "下载的音频与歌词存放位置：",
      desktopAfter: "。修改目录不影响已下载的文件。",
      updated: "下载目录已更新，已下载的文件不会移动",
      chooseFailed: "选择目录失败: {error}",
      resetDone: "已恢复默认下载目录",
    },
    /** 文件名模板（`/` 建子目录，带实时预览） */
    template: {
      title: "文件名模板",
      /** 描述里的示例模板用 <code> 强调，切成三段 */
      beforeSlash: "用变量组合文件名，",
      afterSlash: " 可建立子目录（如 ",
      afterExample: "）；非法字符自动移除。",
      varsLabel: "可用变量",
      previewLabel: "预览",
      /** 预览用示例数据：不是用户数据，跟着界面语言走 */
      sample: {
        name: "夜曲",
        artist: "周杰伦",
        album: "十一月的萧邦",
        source: "示例插件",
      },
    },
    /** 写入歌曲标签（元数据进文件 vs 只进数据库） */
    writeTags: {
      title: "写入歌曲标签",
      /** 描述里的 `.lrc` 用 <code> 强调，切成两段 */
      beforeLrc: "下载时把标题 / 歌手 / 专辑 / 封面 / 歌词写进音频文件，同时保存同名",
      afterLrc: "。离线曲库直接读文件，换目录、换设备都还在；关闭后元数据只存在数据库里。",
    },
    /** 离线音乐入口 */
    offline: {
      title: "离线音乐",
      description: "查看已下载的曲库、导出文件或定位到文件夹。",
    },
  },

  /** 分组：备份与还原 */
  backup: {
    section: "备份与还原",
    /** 导出备份 */
    export: {
      title: "导出备份",
      description: "把{scope}导出为 JSON。离线音乐只备份索引，音频文件需重新下载。",
      action: "导出备份",
      busy: "导出中…",
      /** 备份范围：统计未就绪 / 就绪后带数量 */
      scopeFallback: "设置、本地曲库与播放队列",
      scope: "设置、{playlists} 个歌单、{liked} 首喜欢的音乐、{offline} 条离线索引与播放队列",
    },
    /** 是否包含插件登录凭证 */
    credentials: {
      title: "包含插件登录凭证",
      description: "勾选后会把插件 Cookie / Token 一并写入备份。备份是明文 JSON，分享前请取消勾选。",
    },
    /** 导入备份（含确认弹窗与结果弹窗） */
    import: {
      title: "导入备份",
      description: "按名称合并歌单、按曲目去重；不会删除现有内容，重复导入也不会产生重复数据。",
      action: "选择文件导入",
      busy: "导入中…",
      confirmContent:
        "导入会向当前曲库合并备份里的歌单与曲目，并覆盖同名的设置项。现有内容不会被删除。确定继续吗？",
      confirmPrimary: "开始导入",
      doneTitle: "导入完成",
      donePrimary: "知道了",
      reloaded: "曲库与队列已更新，重新打开相关页面即可看到",
    },
  },

  /** 分组：同步（自建服务器 / 同频） */
  cloud: {
    section: "同步",
    /** 服务器地址 */
    server: {
      title: "服务器地址",
      /** 描述里的示例地址用 <code> 强调，切成两段；示例 URL 本身不翻 */
      descriptionBefore: "填你自建服务器（Docker 部署后就是",
      descriptionAfter: "）。地址存在本机，换服务器只需改这里重新登录。",
      probe: "检测连接",
      probing: "检测中…",
      connected: "已连接",
      registrationOpen: "注册开放",
      registrationClosed: "注册关闭",
      needsInvite: "需要邀请码",
      probeConnected: "已连接：{name}",
      probeFailed: "连接失败：{error}",
      firstUser: "这台服务器还没有账号，注册的第一个用户会成为管理员",
    },
    /** 账号：登录 / 注册 / 已登录态 */
    account: {
      title: "账号",
      login: "登录",
      register: "注册",
      admin: "管理员",
      description: "同一个账号在多台设备登录后，喜欢、歌单、播放历史与歌曲自定义信息会互相同步。",
      logout: "退出登录",
      usernamePlaceholder: "用户名",
      passwordPlaceholder: "密码（至少 6 位）",
      invitePlaceholder: "邀请码",
      toRegister: "去注册",
      toLogin: "去登录",
      registrationClosed: "这台服务器没有开放注册，需要管理员在后台建号或打开注册开关。",
      urlRequired: "请先填写服务器地址",
      invalidInput: "用户名不能为空，密码至少 6 位",
      loginSuccess: "登录成功",
      registerSuccess: "注册成功，已自动登录",
      loggedOut: "已退出同频服务器",
    },
    /** 云端曲库：统计 / 上传 / 刷新 */
    library: {
      title: "曲库",
      description: "{tracks} 首 · {albums} 张专辑 · 已用 {used}",
      upload: "上传本地文件",
      uploading: "上传中…",
      uploadingProgress: "上传中 {progress}",
      fetchingProgress: "拉取音频 {progress}",
      preparing: "准备中…",
      refresh: "刷新曲库",
      refreshing: "刷新中…",
      uploadDialogTitle: "选择要上传到同频服务器的音频",
      /** 文件对话框的过滤器名 */
      audioFilter: "音频",
      uploadDone: "已上传 {count} 首",
      uploadFailed: "{filename}: {error}",
      refreshed: "曲库已更新：{count} 首",
    },
    /** 账号数据同步 */
    sync: {
      title: "账号数据同步",
      description: "同步喜欢、歌单（含顺序）、播放历史与歌曲自定义信息。上次同步：{time}",
      action: "立即同步",
      syncing: "同步中…",
      reset: "重置同步状态",
      summary: "推送 {pushed} 条 · 拉取 {pulled} 条",
      never: "尚未同步",
      notRun: "同步未执行（未登录或未配置服务器）",
      done: "同步完成",
      failed: "同步失败：{error}",
      resetDone: "同步状态已重置，下次同步会重新合并",
      hint: "登录后自动同步每 2 分钟跑一次；「重置同步状态」只清本机的同步游标与快照，不会删除任何音乐或云端数据。",
      resetConfirmTitle: "重置同步状态",
      resetConfirmContent:
        "本机的同步游标与快照会被清空，下次同步会重新做一次全量合并（并集 + 服务器较新者胜）。你的喜欢、歌单与云端曲库都不会被删除。",
    },
  },
};
