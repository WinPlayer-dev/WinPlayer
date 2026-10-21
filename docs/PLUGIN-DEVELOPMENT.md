# WinPlayer 插件开发指南

WinPlayer 的音乐完全来自插件。插件负责把任意音乐来源（HTTP API、爬虫、私有协议等）适配为 WinPlayer 的**统一插件协议**，主程序只与统一协议打交道。

```
┌────────────┐   统一协议    ┌──────────────┐   RPC    ┌───────────────┐
│  主程序 UI  │ ◄──────────► │  插件沙箱      │ ◄──────► │ Rust 后端代理  │
│ (Vue/Pinia)│              │ (Web Worker)  │          │ (HTTP/存储)   │
└────────────┘              └──────┬───────┘          └───────┬───────┘
                                   │ import(插件代码)          │ 转发请求
                                   ▼                          ▼
                            ┌──────────────┐           任意来源 API
                            │  插件 JS 代码 │
                            └──────────────┘
```

## 安全模型

- 插件代码运行在 **Web Worker 沙箱**中：无 DOM、无 `window`、无法访问主程序状态
- 插件的**所有网络请求**必须通过 `ctx.request()`，由 Rust 后端代理转发（无 CORS 限制，也无法绕过）
- 插件只能访问自己的**私有存储** `ctx.storage`
- 可调用的方法有白名单限制（`search` / `getSongUrl` / `getPlaylist` / `getAlbum` / `getArtist` / `getArtistAlbums` / `getRecommendations` / `getLyrics` / `getHotKeywords` / `getLoginQr` / `pollLogin` / `getLoginState` / `logout` / `getAvatar` / `getUserPlaylists` / `addToUserPlaylist` / `removeFromUserPlaylist` / `reportPlay`）

## 插件包格式

### 目录型插件（推荐开发时使用）

```
my-plugin/
├── manifest.json
└── main.js          # 入口文件，路径由 manifest.main 指定
```

分发时压缩为 `.zip`（`manifest.json` 位于 zip 根目录，或位于唯一的顶层文件夹内）。

### 单文件 JSON 插件

`manifest.json` 的全部字段 + `code` 字段（入口 JS 源码字符串），扩展名 `.json`。适合市场/URL 分发。

> 可运行 `node scripts/build-demo-plugin.mjs` 从目录版示例生成单文件版本。

### manifest.json 字段

```jsonc
{
  "id": "com.example.mysource",   // 必填，唯一 ID，仅允许 [a-z0-9._-]，≤64 字符
  "name": "我的音源",              // 必填，显示名称
  "version": "1.0.0",             // 必填，版本号
  "description": "简介",           // 可选
  "author": "作者",                // 可选
  "homepage": "https://...",      // 可选
  "main": "main.js",              // 可选，入口文件（默认 main.js，仅限插件目录内相对路径）
  "apiVersion": 1,                // 必填，插件协议版本（当前为 1）
  "capabilities": ["search", "songUrl", "recommend", "lyrics", "hotKeywords", "playlist", "album", "artist", "login", "avatar", "myPlaylists", "playRecord"],
  "login": {                     // 可选，capabilities 含 "login" 时生效
    "credentialKey": "token",    // 凭证写入的设置项 key，默认 "credential"
    "pollInterval": 2000,        // 主程序轮询扫码状态的间隔（毫秒），默认 2000，最小 500
    "expiresIn": 120000          // 二维码有效期（毫秒），默认 120000
  },
  "settings": [                   // 可选，声明设置项，主程序自动生成配置表单
    { "key": "token",  "label": "API Token", "type": "password", "description": "用于鉴权" },
    { "key": "area",   "label": "音质", "type": "select", "default": "standard",
      "options": [ { "label": "标准", "value": "standard" }, { "label": "高品", "value": "high" } ] },
    { "key": "debug",  "label": "调试日志", "type": "switch", "default": false }
  ]
}
```

`settings` 支持的 `type`：`text` / `password` / `number` / `switch` / `select`。
用户填写的值会以 `ctx.settings` 传入插件。

> **音质档位**：`quality` 下拉的选项即该来源支持的全部档位，宿主会按它们生成
> 「高 → 低」的降级链（顺序参照 `hires` > `dolby` > `lossless` > `exhigh` >
> `higher` > `standard`），取不到当前档位时自动往下试，不需要插件自己实现降级。
> 插件只需在 `getSongUrl` 里把 `params.quality` 映射到自己的码率即可。

## 插件模块接口

入口文件**默认导出**一个实现以下接口的对象（ESM `export default {...}`，兼容 `module.exports = {...}`）：

```js
export default {
  /** 初始化（可选）。此处可读取设置、预热请求 */
  async init(ctx) {},

  /**
   * 搜索（能力：search）
   *
   * 主程序默认调用时不传 type（一次并行返回单曲 + 歌单）；
   * 只有用户点开「专辑」「歌手」Tab 时才带 type 调用一次，因此这四种返回值都是可选的。
   */
  async search({ keyword, type, page = 1, pageSize = 20 }) {
    return {
      songs: [/* UnifiedTrack */],
      playlists: [/* UnifiedPlaylist */],
      albums: [/* UnifiedAlbum，仅 type === "album" 时返回 */],
      artists: [/* UnifiedArtist，仅 type === "artist" 时返回 */],
      total: 100,        // 可选
      hasMore: true,     // 可选
    };
  },

  /** 获取播放直链（能力：songUrl）。参数 id 即 UnifiedTrack.id */
  async getSongUrl({ id, quality }) {
    // 防盗链直链（如哔哩哔哩 upos 节点）可附带必需请求头：宿主会把 headers
    // 原样交给原生解码器（播放 / 预载 / 锁屏连播 / 下载都带），缺 Referer 的
    // 直链会被 CDN 拒成 403；插件自身的可播性探测也应使用同一套头
    return {
      url: "https://.../song.mp3",
      quality: "standard",
      headers: { Referer: "https://www.bilibili.com/" },
      // 编码如实上报即可（aac / flac / ec-3 …）：宿主有自己的解码能力表，
      // 解不了的档位会自动降级到下一档，插件不用自己判断能不能播
      codec: "aac",
    };
    // 无法获取时返回 null
  },

  /** 歌单详情（能力：playlist） */
  async getPlaylist({ id, page }) {
    return { id, name, cover, description, trackCount, tracks: [/* UnifiedTrack */] };
  },

  /** 专辑详情（能力：album）。返回的曲目里尽量补全 albumId / artistIds，歌曲表会据此渲染跳转链接 */
  async getAlbum({ id, page }) {
    return {
      id, name, cover, description, trackCount, publishTime,
      artistNames: ["歌手名"], artistIds: ["歌手ID"],
      tracks: [/* UnifiedTrack */],
    };
  },

  /** 歌手详情 + 热门歌曲（能力：artist）。完整作品用 getArtistAlbums 分页拉取 */
  async getArtist({ id }) {
    return { id, name, avatar, briefDesc, alias: [], songCount, albumCount, hotTracks: [/* UnifiedTrack */] };
  },

  /** 歌手专辑列表（能力：artist），宿主滚动到底部时会带着 page 继续调用 */
  async getArtistAlbums({ id, page, pageSize }) {
    return { albums: [/* UnifiedAlbum */], total: 100, hasMore: true };
  },

  /** 推荐内容（能力：recommend）——显示在“推荐”页 */
  async getRecommendations({ page } = {}) {
    return { songs: [], playlists: [] };
  },

  /** 歌词（能力：lyrics）——LRC 文本 */
  async getLyrics({ id }) {
    return { lrc: "[00:00.00] 第一行\n[00:05.00] 第二行", translation: "可选的翻译 LRC" };
  },

  /** 热搜词（能力：hotKeywords） */
  async getHotKeywords() {
    return ["关键词1", "关键词2"];
  },

  /* ---------- 以下四项均为可选，capabilities 含 "login" 时实现 ---------- */

  /** 生成登录二维码。content 是二维码内容（通常是一段 URL），主程序在本地渲染成图片 */
  async getLoginQr({ fresh } = {}) {
    return {
      content: "https://example.com/login?codekey=xxx",
      key: "插件侧会话标识",   // 可选，主程序会在轮询时原样回传
      expiresIn: 120000,      // 可选，缺省取 manifest.login.expiresIn
      hint: "使用手机 App 扫码", // 可选，展示给用户的操作提示
    };
  },

  /** 轮询扫码状态。主程序按 manifest.login.pollInterval 定时调用 */
  async pollLogin({ key } = {}) {
    return { status: "waiting" };    // 等待扫码
    // return { status: "confirming" };  // 已扫码，等待手机确认
    // return { status: "expired", message: "二维码已过期" };
    // return { status: "error", message: "具体原因" };
    // return { status: "success", credential: "不透明凭证串", profile: { nickname: "昵称", avatar: "https://..." } };
  },

  /** 查询当前登录态，用于在插件卡片上展示「已登录 xx」 */
  async getLoginState() {
    return { loggedIn: false };      // 或 { loggedIn: true, profile: { nickname, avatar } }
  },

  /** 退出登录。凭证由主程序从设置项中清除，插件不必自己持久化 */
  async logout() {},

  /* ---------- 以下均为可选，capabilities 含对应能力时实现 ---------- */

  /** 提供头像（能力：avatar）。主程序在窗口右上角预留的头像处展示；未登录/无头像时返回 null */
  async getAvatar() {
    return {
      image: "https://example.com/avatar.jpg", // 支持 http(s) URL 或 data: URI（来源有防盗链时用 data URI）
      label: "用户昵称",                        // 可选，悬停提示
    };
    // return null; // 不提供头像，主程序回退默认占位
  },

  /** 平台个人歌单列表（能力：myPlaylists）。返回账号创建的 + 收藏的歌单；未登录时抛出错误或返回空数组 */
  async getUserPlaylists() {
    return [/* UnifiedPlaylist[] */];
  },

  /** 把歌曲加入平台歌单（能力：myPlaylists）。失败时抛出错误，主程序会 toast 提示 */
  async addToUserPlaylist({ playlistId, trackId }) {},

  /** 把歌曲从平台歌单移除（能力：myPlaylists）。失败时抛出错误 */
  async removeFromUserPlaylist({ playlistId, trackId }) {},

  /**
   * 播放回传（能力：playRecord）。
   * phase=start：开始播放；phase=end：这首被换下，seconds 为实际收听秒数。
   * 失败静默即可，宿主会忽略这里的异常，绝不影响播放。
   */
  async reportPlay({ track, phase, seconds }) {},

  /** 卸载/重载前清理（可选） */
  async dispose() {},
};
```

### 扫码登录（能力：login）

登录是一个**宿主与插件协作**的流程，插件只负责与来源站交互，凭证的持久化由主程序统一完成：

1. 插件管理页对声明了 `"login"` 能力的插件展示登录区
2. 用户点击「扫码登录」→ 主程序调用 `getLoginQr()` 拿到 `content`，用本地 QR 库渲染成图片（插件无 DOM，不可能自己画图）
3. 主程序按 `manifest.login.pollInterval` 反复调用 `pollLogin({ key })`，直到返回 `success` / `expired` / `error`
4. 拿到 `success` 后，主程序把 `credential` 写入 `settings[credentialKey]`（该设置项建议声明为 `password` 类型），随后**重建插件 Worker**
5. 此后插件从 `ctx.settings[credentialKey]` 读回凭证；`logout()` 被调用后主程序会把该设置项清空

要点：

- `credential` 对插件是**不透明字符串**，可以是 Cookie 串、token 或任意格式，主程序不解析它
- 凭证写入会重建 Worker，因此主程序在收到 `success` 后**不再继续轮询**
- 凭证回传的格式不要求 JSON，登录态查询（`getLoginState`）才需要结构化的 `profile`

### 头像（能力：avatar）

声明 `"avatar"` 能力并实现 `getAvatar()` 后，主程序会把返回的图片显示在**窗口右上角预留的头像处**：

- 按插件启用顺序取第一个成功返回结果的插件；未登录/无头像返回 `null` 时继续找下一个，全部为空则回退默认占位头像
- `image` 直接用作 `<img src>`，支持 http(s) URL 或 `data:` URI；若来源 CDN 有防盗链（Referer 校验），请改为在插件内下载后回传 `data:` URI（`responseType: "base64"`）
- `label` 建议传用户昵称，会拼进悬停提示
- 插件启停、配置变更（如 Cookie 更新）会触发主程序重新调用 `getAvatar()`

### 个人歌单（能力：myPlaylists）

声明 `"myPlaylists"` 能力后，主程序会在侧边栏展示**「平台歌单」分组**，把插件平台账号的歌单直接列为导航项：

1. 主程序调用 `getUserPlaylists()` 聚合各插件结果（挂载时、插件配置变化时、用户点同步按钮时）
2. 用户点击歌单项进入歌单详情页，曲目走常规的 `getPlaylist()` 加载（个人歌单通常就是平台歌单 ID，无需新接口）
3. 歌单详情页对这类歌单启用编辑：移除歌曲调用 `removeFromUserPlaylist({ playlistId, trackId })`
4. 歌曲表的「添加到歌单」选择器会列出平台歌单，选中后调用 `addToUserPlaylist({ playlistId, trackId })`

要点：

- 未登录时 `getUserPlaylists()` 抛出错误即可，主程序会把错误显示在对应插件的分组内，不影响其它插件
- 增删失败时抛出带可读信息的 `Error`（如「歌曲已在歌单里」），主程序会原样 toast 给用户
- 歌单 ID 必须与 `getUserPlaylists()` 返回的 `UnifiedPlaylist.id` 一致，主程序按它回传 `playlistId`

### 播放记录回传（能力：playRecord）

声明 `"playRecord"` 能力后，主程序会在**本地记一次播放历史的同时**把这次播放回传给平台，
让平台官方客户端里的「最近播放 / 听歌排行」等数据与在本播放器听歌保持一致：

1. 真正开始播放时调用 `reportPlay({ track, phase: "start" })`（暂停后续播、seek、缓冲都不算新的一次）
2. 这首被换下时调用 `reportPlay({ track, phase: "end", seconds })`，`seconds` 是本次实际收听秒数；
   换歌、播完、队列播完、睡眠定时停止都会触发结算
3. 只回传给**曲目自身所属的插件**（跨源换播时曲目 ID 只在原来源有效），其它插件收不到这个调用

要点：

- 这是**纯旁路能力**：未登录、平台不支持、请求被风控拦截都请安静返回，宿主会忽略异常；
  不要因为回传失败影响播放，也不要抛错到界面
- 建议在 `settings` 里提供一个开关（如 `syncPlayRecord`）让用户关闭回传，默认开启
- 网易云音源的实际实现见 `plugins/netease-source/main.js` 的 `reportPlay`（`/weapi/feedback/weblog`，
  成对上报 `startplay` 与 `play`）
- 条目可带 `pinned: true`：会排到「平台歌单」最上方，并作为系统歌单处理（详情页不提供移除、选择器里不列出）。
  适合「每日推荐」这类没有真实歌单 ID 的虚拟歌单：`getUserPlaylists()` 里返回固定假 ID，
  `getPlaylist({ id })` 认出该 ID 后返回内容即可

### 统一数据格式

```ts
// UnifiedTrack —— 所有来源的歌曲都转换为该结构
{
  id: string;          // 来源内唯一 ID（必填）
  name: string;        // 歌名（必填）
  artists: string[];   // 艺术家列表（必填）
  album?: string;      // 专辑名
  cover?: string;      // 封面图 URL
  duration?: number;   // 时长（毫秒）
  alias?: string;      // 歌曲别名（如译名/港台名）。有值时歌曲表在标题旁以浅色括号显示，空间不足时优先截断
  vip?: boolean;       // 是否需要 VIP。true 时歌曲标题最右侧显示 VIP 标识（空间不足时最后截断）；不传则不显示
  // 能力：album / artist。填了这两个 ID，歌曲表里的歌手名、专辑名就会变成可点击的跳转入口；
  // 缺失时退化为纯文本，不影响功能
  albumId?: string;
  artistIds?: string[];    // 与 artists 一一对应，某个位置为空串即该歌手不可跳转
  extra?: object;      // 透传数据，仅你自己可见（如原始 ID、版权信息）
}

// UnifiedPlaylist
{
  id: string;
  name: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  creator?: string;
  pinned?: boolean;       // 置顶到「平台歌单」最上方，并视为系统歌单（不可手动增删）
}

// UnifiedAlbum（能力：album）
{
  id: string;
  name: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  publishTime?: number;    // 毫秒时间戳
  artistNames?: string[];
  artistIds?: string[];    // 与 artistNames 对应，专辑页的歌手名据此跳转
  company?: string;
  subType?: string;        // 如「录音室版」
}

// UnifiedArtist（能力：artist）
{
  id: string;
  name: string;
  avatar?: string;         // 歌手页会拿它铺 banner 背景与圆形头像
  briefDesc?: string;      // 歌手页只展示前两行
  alias?: string[];
  songCount?: number;
  albumCount?: number;
}
```

> `sourceId` 由主程序自动补全，插件无需（也不应）设置。
>
> 路由约定：插件歌单 `/playlist/:source/:id`、专辑 `/album/:source/:id`、歌手 `/artist/:source/:id`，
> 其中 `:source` 就是 `sourceId`。卡片与歌曲表的跳转都由主程序按这个约定拼 URL，插件只负责回传 ID。

### 上下文对象 ctx

```js
async init(ctx) {
  // 1. 用户在插件管理页填写的配置
  ctx.settings.token; // "abc123"

  // 2. 网络请求（经 Rust 后端代理，无 CORS；禁止使用 fetch/XMLHttpRequest）
  const res = await ctx.request({
    url: "https://api.example.com/search",
    method: "GET",                 // 默认 GET
    headers: { Authorization: `Bearer ${ctx.settings.token}` },
    body: undefined,               // 请求体（字符串）
    responseType: "auto",          // "auto"(默认,尝试 JSON) | "text" | "json" | "base64"
    timeout: 15000,                // 毫秒，默认 15000，最大 120000
  });
  res.status;   // HTTP 状态码
  res.ok;       // 2xx?
  res.headers;  // 响应头
  res.data;     // responseType 为 auto/json 时的解析结果
  res.text;     // 文本响应体
  res.base64;   // responseType=base64 时的响应体

  // 3. 私有持久化存储（键值对，落盘于应用数据目录，仅本插件可读写）
  const cached = await ctx.storage.get("cachedToken");
  await ctx.storage.set("lastSearch", { keyword: "xxx", at: Date.now() });

  // 4. 日志（输出到应用控制台）
  ctx.log("初始化完成");
}
```

## 最小可用插件

```js
// manifest.json: { "id": "demo.hello", "name": "Hello", "version": "1.0.0",
//                  "apiVersion": 1, "capabilities": ["search", "songUrl"] }
export default {
  async search({ keyword }) {
    return {
      songs: [{ id: "1", name: `来自 ${keyword} 的歌`, artists: ["歌手"], duration: 180000 }],
    };
  },
  async getSongUrl({ id }) {
    return { url: "https://example.com/audio.mp3" };
  },
};
```

打包为 zip 或单文件 JSON 后，在「插件管理 → 从本地安装 / 从 URL 安装」中安装即可。

## 插件市场索引格式

市场源是一个 JSON 文件的 URL（官方内置源固定存在，可在设置页追加多个）。`url` 支持插件包直链（.zip / 单文件 .json）或 GitHub 仓库地址（自动下载默认分支代码安装）；经 GitHub 下载时会自动拼接设置里配置的 GitHub 镜像源前缀。

```json
{
  "name": "我的市场",
  "plugins": [
    {
      "id": "com.example.mysource",
      "name": "我的音源",
      "version": "1.2.0",
      "description": "简介",
      "author": "作者",
      "banner": "banners/my-source.png",
      "url": "https://example.com/my-plugin.zip",
      "homepage": "https://example.com"
    }
  ]
}
```

`banner` 为可选的卡片大图地址（约 2:1 比例），支持相对市场索引的相对路径，缺省时显示渐变占位。

示例见 [market-index.example.json](./market-index.example.json)。

## 调试

1. `pnpm tauri dev` 启动开发模式
2. 在插件管理页安装 `plugins/demo-source`（或 `plugins/dist/demo-source-1.0.0.json`）
3. 右键窗口 → 检查（DevTools）查看 `[插件 com.winplayer.demo]` 日志
4. 修改插件后重新安装（同 ID 覆盖安装）即可生效

> 仓库内 `plugins/netease-source`（网易云音乐音源）是一个调用真实第三方 API 的完整示例，
> 涵盖分页搜索、直链换取、批量补全曲目、错误码处理、Cookie 登录、头像与个人歌单增删，可作为接入真实来源的参考。

## 常见问题

- **插件里能用 fetch 吗？** 不能。必须用 `ctx.request`，它经后端代理，可跨域、可自定义请求头。
- **音频播放需要处理 CORS 吗？** `getSongUrl` 返回直链后由主程序的 `<audio>` 直接播放，无需 CORS 头；若来源要求 Referer/UA 校验，请在插件里换取宽松的直链。
- **如何实现登录？** 在插件设置中让用户填写 Cookie/Token（`type: "password"`），或在 `init` 里用 `ctx.request` + `ctx.storage` 完成登录流程并缓存会话。
- **多大的超时？** 网络请求默认 15 秒；方法调用（如 search）主程序侧 45 秒超时，请避免长时间阻塞。
