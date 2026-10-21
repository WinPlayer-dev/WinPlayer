/**
 * WinPlayer 插件协议类型定义
 *
 * 插件 = manifest.json + JavaScript 模块（或单文件 JSON：manifest 字段 + code）。
 * 插件运行于 Web Worker 沙箱中，网络请求经 Rust 后端代理，
 * 因此插件可以把任意来源的 API 适配为本协议定义的统一格式。
 */

/** 当前插件协议版本 */
export const PLUGIN_API_VERSION = 1;

/** 插件可声明的能力（manifest.capabilities） */
export type PluginCapability =
  | "search"
  | "songUrl"
  | "playlist"
  | "album"
  | "artist"
  | "recommend"
  | "lyrics"
  | "hotKeywords"
  | "login"
  | "avatar"
  | "myPlaylists"
  | "playRecord";

/**
 * 登录能力声明（manifest.login，能力为 login 时使用）
 *
 * 登录凭证是不透明字符串：插件扫码成功后回传 credential，宿主负责把它持久化到
 * `settings[credentialKey]` 指向的设置项（该设置项应声明为 password 类型），
 * 之后插件从 ctx.settings 里读回来即可。
 */
export interface PluginLoginConfig {
  /** 凭证写入的设置项 key，默认 "credential" */
  credentialKey?: string;
  /** 宿主轮询扫码状态的间隔（毫秒），默认 2000，最小 500 */
  pollInterval?: number;
  /** 二维码有效期（毫秒），默认 120000，超时后宿主停止轮询并标记过期 */
  expiresIn?: number;
}

/** 插件设置项（由插件 manifest 声明，插件管理页据此渲染表单） */
export interface PluginSettingItem {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "switch" | "select";
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
}

/** 插件清单 */
export interface PluginManifest {
  /** 唯一 ID，仅允许 [a-z0-9._-]，如 com.example.mysource */
  id: string;
  /** 显示名称 */
  name: string;
  /** 插件版本 */
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** 入口 JS 相对路径（目录型插件，缺省 main.js） */
  main?: string;
  /** 插件协议版本 */
  apiVersion: number;
  /** 声明的能力 */
  capabilities: PluginCapability[];
  /** 设置项定义 */
  settings?: PluginSettingItem[];
  /** 登录能力的额外声明（capabilities 含 login 时有效） */
  login?: PluginLoginConfig;
}

/** 单文件 JSON 插件：清单字段 + code */
export interface SingleFilePlugin extends PluginManifest {
  code: string;
}

/** 已安装插件条目（来自 Rust plugin_list 命令） */
export interface PluginEntry {
  id: string;
  manifest: PluginManifest;
  kind: "dir" | "file";
}

/* ------------------------------ 统一数据格式 ------------------------------ */

/** 统一歌曲结构 */
export interface UnifiedTrack {
  /** 来源内的歌曲 ID */
  id: string;
  name: string;
  /** 歌曲别名（如译名/港台名）。有值时列表在标题旁以浅色括号显示，空间不足时优先截断 */
  alias?: string;
  /** 是否需要 VIP。true 时歌曲标题最右侧显示 VIP 标识（空间不足时最后截断） */
  vip?: boolean;
  artists: string[];
  album?: string;
  cover?: string;
  /** 时长（毫秒） */
  duration?: number;
  /**
   * 所属专辑 ID（能力：album）。缺失时歌曲表里的专辑名退化为纯文本，不提供跳转
   */
  albumId?: string;
  /** 各艺术家的 ID（能力：artist），与 artists 一一对应；缺失的位置同样退化为纯文本 */
  artistIds?: string[];
  /** 来源插件 ID（主程序在返回给上层前统一补全） */
  sourceId?: string;
  /** 透传数据，仅插件自身可见 */
  extra?: Record<string, unknown>;
}

/** 统一歌单结构 */
export interface UnifiedPlaylist {
  id: string;
  name: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  creator?: string;
  pinned?: boolean;
  sourceId?: string;
}

/** 统一专辑结构（能力：album） */
export interface UnifiedAlbum {
  id: string;
  name: string;
  cover?: string;
  /** 专辑简介（可选，详情页会做截断展示） */
  description?: string;
  trackCount?: number;
  /** 发行时间（毫秒时间戳） */
  publishTime?: number;
  /** 专辑下的艺术家名，与 artistIds 对应 */
  artistNames?: string[];
  artistIds?: string[];
  /** 唱片公司 */
  company?: string;
  /** 专辑类型，如「录音室版」 */
  subType?: string;
  sourceId?: string;
}

/** 统一艺术家结构（能力：artist） */
export interface UnifiedArtist {
  id: string;
  name: string;
  /** 头像（歌手页会拿它做 banner 背景） */
  avatar?: string;
  briefDesc?: string;
  /** 别名，如 Jay Chou */
  alias?: string[];
  songCount?: number;
  albumCount?: number;
  sourceId?: string;
}

/** 搜索结果 */
export interface SearchResult {
  songs?: UnifiedTrack[];
  playlists?: UnifiedPlaylist[];
  albums?: UnifiedAlbum[];
  artists?: UnifiedArtist[];
  total?: number;
  hasMore?: boolean;
}

/** 播放直链 */
export interface SongUrlResult {
  url: string;
  quality?: string;
  /** 码率（bps），可选 */
  br?: number;
  /**
   * 播放该直链时必须携带的请求头（如防盗链的 `Referer`）。
   *
   * 部分音源（哔哩哔哩的 upos/bilivideo 节点等）按 Referer 防盗链，缺少即 403。
   * 宿主会把这里的头原样交给原生解码器，随每一次 Range 请求发出；插件自身的
   * 可播性探测也应使用同一套头，避免「探测被拦、实际可播」的误判。
   */
  headers?: Record<string, string>;
  /**
   * 音频编码（如 `aac` / `flac` / `ec-3`）。插件如实上报即可，**不要自行判断宿主
   * 能不能播**：宿主维护一份原生解码器支持的编码表，不支持的档位会自动降级到
   * 下一档（例如哔哩哔哩杜比全景声的 E-AC-3）。
   */
  codec?: string;
}

/** 歌单详情（含曲目） */
export interface PlaylistDetail extends UnifiedPlaylist {
  tracks: UnifiedTrack[];
}

/** 专辑详情（含曲目，能力：album） */
export interface AlbumDetail extends UnifiedAlbum {
  tracks: UnifiedTrack[];
}

/** 歌手详情（含热门歌曲，能力：artist）。完整作品请用 getArtistAlbums 分页拉取 */
export interface ArtistDetail extends UnifiedArtist {
  /** 服务端返回的热门歌曲（通常为前 50 首） */
  hotTracks: UnifiedTrack[];
}

/** 歌手专辑列表（能力：artist） */
export interface ArtistAlbumsResult {
  albums: UnifiedAlbum[];
  total?: number;
  hasMore?: boolean;
}

/** 歌词（LRC 文本） */
export interface LyricsResult {
  lrc: string;
  /** 翻译歌词（LRC 文本，可选） */
  translation?: string;
}

/** 推荐内容 */
export interface RecommendResult {
  songs?: UnifiedTrack[];
  playlists?: UnifiedPlaylist[];
}

/** 头像（能力：avatar）。宿主在窗口右上角预留的头像处展示 */
export interface AvatarResult {
  /**
   * 头像图片地址：http(s) URL 或 data: URI（base64）。
   * 宿主直接用作 <img src>；若来源有防盗链，插件应改为回传 data URI
   */
  image: string;
  /** 展示名称（如用户昵称），用作悬停提示 */
  label?: string;
}

/* ------------------------------ 登录（能力：login） ------------------------------ */

/** 插件回传给宿主的登录二维码 */
export interface LoginQr {
  /** 二维码内容（通常是一个 URL），由宿主在本地渲染为图片 */
  content: string;
  /**
   * 插件侧的会话标识，宿主会在轮询时原样回传。
   * 插件可以不使用它（自己在内部记住当前二维码也可以），但回传能让轮询在 Worker 重建后依然可用
   */
  key?: string;
  /** 有效期（毫秒），缺省取 manifest.login.expiresIn（再缺省 120000） */
  expiresIn?: number;
  /** 展示给用户的操作提示，如「使用网易云音乐 App 扫码」 */
  hint?: string;
}

/** 扫码轮询状态 */
export type LoginQrStatus =
  /** 等待扫码 */
  | "waiting"
  /** 已扫码，等待手机端确认 */
  | "confirming"
  /** 授权成功 */
  | "success"
  /** 二维码已过期，需重新生成 */
  | "expired"
  /** 出错，message 说明原因 */
  | "error";

/** 登录用户信息（用于在插件卡片上展示「已登录 xx」） */
export interface LoginProfile {
  id?: string;
  nickname?: string;
  avatar?: string;
}

/** 轮询扫码状态的结果 */
export interface LoginPollResult {
  status: LoginQrStatus;
  /** status 为 success 时的登录凭证（不透明字符串），宿主会写入 credentialKey 指向的设置项 */
  credential?: string;
  /** status 为 success 时可顺带回传用户信息，省去宿主再查一次 */
  profile?: LoginProfile;
  /** status 为 error / expired 时的原因 */
  message?: string;
}

/** 当前登录态 */
export interface LoginState {
  loggedIn: boolean;
  profile?: LoginProfile;
}

/* ------------------------------ 播放回传（能力：playRecord） ------------------------------ */

/**
 * 播放回传阶段：
 * - `start`：开始播放（对齐平台的 startplay 打点）
 * - `end`：本次播放结束（对齐平台的 play 打点，携带实际收听时长）
 */
export type PlayRecordPhase = "start" | "end";

/* ------------------------------ 运行时接口 ------------------------------ */

/** 经主程序代理的网络请求 */
export interface PluginRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 默认自动：尝试 JSON 解析，失败回退纯文本 */
  responseType?: "auto" | "json" | "text" | "base64";
  /** 超时（毫秒），默认 15000 */
  timeout?: number;
}

/** 代理请求响应 */
export interface PluginResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** responseType=json 时为解析后的对象 */
  data?: unknown;
  text?: string;
  /** responseType=base64 时的响应体 */
  base64?: string;
}

/** 插件初始化上下文 */
export interface PluginContext {
  /** 插件设置（manifest.settings 定义的表单值） */
  settings: Record<string, unknown>;
  /** 发起经主程序代理的网络请求（无 CORS 限制） */
  request(input: PluginRequest): Promise<PluginResponse>;
  /** 插件私有持久化存储（键值对，落盘于应用数据目录） */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  /** 向主程序日志面板输出（实际打印在 devtools 控制台） */
  log(...args: unknown[]): void;
}

/** 插件搜索参数 */
export interface PluginSearchParams {
  keyword: string;
  type?: "song" | "playlist" | "album" | "artist";
  page?: number;
  pageSize?: number;
}

/** 插件模块统一接口：默认导出实现本接口的对象即可 */
export interface PluginModule {
  /** 初始化（可选）。可在此读取 ctx.settings、发起请求预热等 */
  init?(ctx: PluginContext): Promise<void> | void;

  /** 搜索（能力：search）。type 为空时返回单曲与歌单（对应搜索页默认两个 Tab） */
  search?(params: PluginSearchParams): Promise<SearchResult>;

  /** 获取播放直链（能力：songUrl）。参数 id 为 UnifiedTrack.id */
  getSongUrl?(params: { id: string; quality?: string }): Promise<SongUrlResult | null>;

  /** 获取歌单详情（能力：playlist） */
  getPlaylist?(params: { id: string; page?: number }): Promise<PlaylistDetail | null>;

  /** 获取专辑详情（能力：album）。返回的 tracks 里应尽量补全 albumId / artistIds */
  getAlbum?(params: { id: string; page?: number }): Promise<AlbumDetail | null>;

  /** 获取歌手详情 + 热门歌曲（能力：artist） */
  getArtist?(params: { id: string }): Promise<ArtistDetail | null>;

  /** 获取歌手的专辑列表，分页（能力：artist） */
  getArtistAlbums?(params: { id: string; page?: number; pageSize?: number }): Promise<ArtistAlbumsResult | null>;

  /** 获取推荐内容（能力：recommend） */
  getRecommendations?(params?: { page?: number }): Promise<RecommendResult>;

  /** 获取歌词（能力：lyrics） */
  getLyrics?(params: { id: string }): Promise<LyricsResult | null>;

  /** 热搜词（能力：hotKeywords） */
  getHotKeywords?(): Promise<string[]>;

  /** 生成登录二维码（能力：login） */
  getLoginQr?(params?: { fresh?: boolean }): Promise<LoginQr | null>;

  /** 轮询扫码状态（能力：login），宿主按 manifest.login.pollInterval 定时调用 */
  pollLogin?(params: { key?: string }): Promise<LoginPollResult | null>;

  /** 查询当前登录态（能力：login） */
  getLoginState?(params?: {}): Promise<LoginState | null>;

  /** 退出登录（能力：login）。凭证由宿主从设置项中清除，插件无需关心持久化 */
  logout?(params?: {}): Promise<void | null>;

  /** 提供头像（能力：avatar）。宿主在窗口右上角预留的头像处展示，未登录/无头像时返回 null */
  getAvatar?(params?: {}): Promise<AvatarResult | null>;

  /**
   * 个人歌单（能力：myPlaylists）。返回插件平台当前账号的歌单列表（创建的 + 收藏的），
   * 未登录时抛出错误或返回空数组。宿主在「平台歌单」页聚合展示
   */
  getUserPlaylists?(params?: {}): Promise<UnifiedPlaylist[] | null>;

  /** 增：把歌曲加入平台歌单（能力：myPlaylists）。失败时抛出错误，由宿主 toast 提示 */
  addToUserPlaylist?(params: { playlistId: string; trackId: string }): Promise<void | null>;

  /** 减：把歌曲从平台歌单移除（能力：myPlaylists）。失败时抛出错误 */
  removeFromUserPlaylist?(params: { playlistId: string; trackId: string }): Promise<void | null>;

  /**
   * 播放回传（能力：playRecord）。
   *
   * 宿主在本地记一次播放（播放历史）的同时调用这里，把「听过了这首歌」告诉平台，
   * 于是平台官方客户端里的「最近播放」「听歌排行」能同步显示。
   *
   * 分两次调用，对应网易云等平台的 startplay / play 两条日志：
   * - `phase: "start"`：真正开始播放时（暂停后继续、seek 都不算新的一次），seconds 为 0；
   * - `phase: "end"`：这首被换下（切歌 / 播完）时，seconds 是本次实际收听的秒数。
   *
   * 这是纯附带的旁路能力：插件未登录、平台不支持或请求失败都不应抛错打断播放，
   * 宿主会忽略这里的异常。
   */
  reportPlay?(params: {
    track: UnifiedTrack;
    phase: PlayRecordPhase;
    /** 本次实际收听秒数（phase 为 end 时有效） */
    seconds?: number;
  }): Promise<void | null>;

  /** 插件卸载/重载前清理（可选） */
  dispose?(): Promise<void> | void;
}

/* ------------------------------ 插件市场 ------------------------------ */

/** 市场源（设置项里维护的索引地址列表） */
export interface MarketSource {
  name: string;
  url: string;
}

/** 市场索引中的插件条目 */
export interface MarketEntry {
  id: string;
  name: string;
  /**
   * 插件版本。市场索引不再提供此字段，由宿主从插件源头解析：
   * GitHub 仓库地址拉仓库内 manifest.json 的 version；直链 zip/json
   * 或解析失败时为 undefined（界面显示「版本未知」，提供重新安装按钮）
   */
  version?: string;
  description?: string;
  author?: string;
  /** 卡片大图地址（支持相对市场索引的相对路径），缺省时显示渐变占位 */
  banner?: string;
  /** 插件包地址（.zip / 单文件 .json / GitHub 仓库地址） */
  url: string;
  homepage?: string;
}

/** 市场索引文件格式 */
export interface MarketIndex {
  name?: string;
  plugins: MarketEntry[];
}
