/**
 * 音乐云词条：登录、上传、同步、服务器配置。
 *
 * 服务端（WinPlayer-Server）返回的错误消息是中文原文，客户端**原样展示**，
 * 不在本文件里翻译——除非前端把错误码映射成了自己的文案。
 */
export default {
  session: {
    /** 服务器地址为空 */
    missingUrl: "请先填写服务器地址",
    notConfigured: "未配置服务器地址",
    notLoggedIn: "未登录同频服务器",
    /** 上传等入口发现未登录时的提示 */
    loginFirst: "请先在 设置 → 同步 登录",
    /** 刷新曲库时 token 失效 */
    expired: "同频服务器登录已失效，请重新登录",
    /** 曲库面板里的状态文案（比 notLoggedIn 更短） */
    notLoggedInShort: "尚未登录同频服务器",
  },

  upload: {
    inFlight: "这首歌正在上传",
    noDirectUrl: "这个播放源没有返回可用的直链",
    /** `{track}` 为歌名 */
    uploading: "正在上传《{track}》…",
    duplicate: "《{track}》已在同频服务器里（内容相同，未重复占用空间）",
    done: "已上传《{track}》到同频服务器",
    failed: "上传失败：{error}",
  },

  sync: {},

  server: {
    /** 服务器自己没报名字时的兜底显示名（也用作曲库的文件夹名） */
    defaultName: "同频服务器",
  },
};
