/**
 * 听完自动加歌单（实验性）。
 *
 * i18n-ignore-file：本文件里的中文是 **Vocaloid 关键词匹配表**（声库名、引擎名、
 * 系列名），属于匹配用数据而非界面文案——翻译它会让识别直接失效。
 *
 * 触发点只有「自然播完」：前端在引擎的 `ended` / `advanced` 事件里调用
 * `handleTrackFinished(上一首)`。手动切歌、播放中退出都不会触发。
 *
 * 判定规则：
 * - 固定模式：直接进用户指定的歌单；
 * - 自动分类：先看歌名 / 歌手 / 专辑里是否有 Vocaloid 特征（类型优先，
 *   命中就只进类型歌单），否则按歌词文字判断语种；歌词太短或取不到时，
 *   再用歌名 + 歌手 + 专辑的文字兜底。
 *
 * 目标歌单既可以是本地歌单，也可以是某个插件来源的平台个人歌单：平台歌单
 * 的曲目 id 只在同源内有效，所以只接收同来源的曲目，跨源直接跳过。
 *
 * 去重：处理过的曲目写进 `auto_playlist_done`（迁移 008 / 009），下次直接跳过，
 * 即使用户后来手动把它从歌单删掉也不会再被自动加回来。没有配置目标歌单时
 * 不写记录，等用户配置好后仍能补上。
 */

import { getDb } from "@/services/db";
import { toast } from "@/services/toast";
import { RECORDING_SOURCE_ID } from "@/services/recorder";
import { useDownloadsStore } from "@/stores/downloads";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import {
  autoPlaylistTargetKey,
  useSettingsStore,
  type AutoPlaylistConfig,
  type AutoPlaylistLanguage,
  type AutoPlaylistTarget,
} from "@/stores/settings";
import { useTrackMetaStore } from "@/stores/trackMeta";
import type { UnifiedTrack } from "@/types/plugin";

/** 记录在 auto_playlist_done.tag 里的归类结果 */
export type AutoPlaylistTag = "fixed" | "vocaloid" | AutoPlaylistLanguage;

/**
 * 系列 / 引擎名：直接子串匹配。
 *
 * 这类词本身没有歧义，而且常出现在组合写法里（openutau、Synthesizer V、
 * VoisoNA），所以不用词边界。
 */
const VOCALOID_SERIES_KEYWORDS = [
  "vocaloid",
  "ボカロ",
  "ボーカロイド",
  "utau",
  "synthv",
  "synthesizer v",
  "cevio",
  "voisona",
  "diffsinger",
] as const;

/**
 * 声库 / 虚拟歌手的日文与中文名：子串匹配，误判风险低。
 *
 * 只放辨识度足够高的名字：像「可不」「言和」这种本身是常用词的已经尽量
 * 靠完整名字区分（真正导致误判的是它们出现在普通歌名里，属于已知代价）。
 */
const VOCALOID_CJK_NAMES = [
  // 日系
  "初音",
  "ミク",
  "初音未来",
  "鏡音",
  "镜音",
  "巡音",
  "ルカ",
  "神威",
  "がくぽ",
  "重音テト",
  "重音teto",
  "亞北ネル",
  "亚北音留",
  "弱音ハク",
  "結月ゆかり",
  "结月缘",
  "東北ずん子",
  "东北俊子",
  "弦巻マキ",
  "琴葉茜",
  "琴叶茜",
  "琴葉葵",
  "小春六花",
  "さとうささら",
  "ついなちゃん",
  "鳴花ヒメ",
  "鳴花ミコト",
  "京町セイカ",
  "夜語トバリ",
  "花隈千冬",
  "夏色花梨",
  "宮舞モカ",
  "星界",
  "裏命",
  "狐子",
  "羽累",
  "可不",
  // 中文（含五维介质等中文声库）
  "洛天依",
  "天依",
  "乐正",
  "言和",
  "星尘",
  "心华",
  "墨清弦",
  "徵羽",
  "摩柯",
  "赤羽",
  "诗岸",
  "海伊",
  "苍穹",
] as const;

/**
 * 声库名的拉丁写法：按词边界匹配。
 *
 * 短名（IA / Rin / Len / Luka）如果按子串匹配会大面积误判——"ia" 命中
 * piano、"rin" 命中普通英文名，所以统一要求前后不是字母数字。
 * IA、Fukase、v flower 这些内置表里补上常见写法，覆盖网易云 / B站上的
 * 日文罗马音与英文目录写法。
 */
const VOCALOID_LATIN_NAMES = [
  "miku",
  "hatsune",
  "kagamine",
  "megurine",
  "meiko",
  "kaito",
  "gumi",
  "megpoid",
  "gakupo",
  "kamui",
  "teto",
  "kasane",
  "yuzuki",
  "zunko",
  "tsurumaki",
  "kotonoha",
  "koharu rikka",
  "sato sasara",
  "fukase",
  "v flower",
  "vflower",
  "kafu",
  "seeu",
  "ia",
] as const;

/** 转义正则里的元字符（关键词里有 "v flower" 这种带空格的，暂不需要，但留着防手误） */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 拉丁写法要求前后不是字母数字，避免 "ia" 命中 piano 这类误判 */
function latinMatcher(word: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`);
}

/** 预编译一次：每次判定要跑几十个词，别在播完歌时现造正则 */
const LATIN_MATCHERS: ReadonlyArray<RegExp> = VOCALOID_LATIN_NAMES.map(latinMatcher);

/**
 * 歌名 / 歌手 / 专辑里是否带 Vocaloid 特征。
 *
 * `extraKeywords` 是用户自定义词表，与内置词表同等对待：纯 ASCII 关键词
 * 按词边界、其它按子串匹配（与内置规则一致）。
 */
export function isVocaloid(text: string, extraKeywords: readonly string[] = []): boolean {
  const lower = (text ?? "").toLowerCase();
  if (!lower) return false;

  if (VOCALOID_SERIES_KEYWORDS.some((keyword) => lower.includes(keyword))) return true;
  if (VOCALOID_CJK_NAMES.some((keyword) => lower.includes(keyword))) return true;
  if (LATIN_MATCHERS.some((matcher) => matcher.test(lower))) return true;

  for (const keyword of extraKeywords) {
    const word = (keyword ?? "").trim().toLowerCase();
    if (!word) continue;
    // 纯 ASCII（含数字 / 空格 / 连字符）当拉丁写法处理，其余当 CJK 处理
    if (/^[\x20-\x7e]+$/.test(word)) {
      if (latinMatcher(word).test(lower)) return true;
    } else if (lower.includes(word)) {
      return true;
    }
  }
  return false;
}

/** 日文假名（含半角片假名） */
function countKana(text: string): number {
  return text.match(/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/g)?.length ?? 0;
}

/** 韩文谚文（含字母 / 兼容字母 / 音节） */
function countHangul(text: string): number {
  return text.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g)?.length ?? 0;
}

/** 汉字（含扩展 A 与兼容表意文字） */
function countHan(text: string): number {
  return text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
}

/** 拉丁字母 */
function countLatin(text: string): number {
  return text.match(/[A-Za-z]/g)?.length ?? 0;
}

/**
 * 按文字构成判断语种；样本太短（几乎没有可用字符）时返回 null，
 * 交给调用方换一份文本再试。
 *
 * 顺序很重要：日语歌词里必然有大量汉字，所以先看假名；韩语同理先看谚文。
 */
export function detectLanguage(text: string): AutoPlaylistLanguage | null {
  const source = text ?? "";
  const kana = countKana(source);
  const hangul = countHangul(source);
  const han = countHan(source);
  const latin = countLatin(source);
  const total = kana + hangul + han + latin;
  if (total < 8) return null;

  const ratio = (count: number): number => count / total;
  if (ratio(hangul) >= 0.1) return "korean";
  if (ratio(kana) >= 0.05) return "japanese";
  if (ratio(han) >= 0.3) return "chinese";
  if (ratio(latin) >= 0.5) return "english";

  // 混合歌词（比如副歌一半外语）：按占比最高的一方归类，都不到三成算「其他」
  const ranked: Array<[AutoPlaylistLanguage, number]> = [
    ["chinese", han],
    ["japanese", kana],
    ["korean", hangul],
    ["english", latin],
  ];
  const [bestLanguage, bestCount] = ranked.reduce((best, item) =>
    item[1] > best[1] ? item : best,
  );
  return bestCount >= total * 0.3 ? bestLanguage : "other";
}

/** 去掉 LRC 时间戳与逐字标签，只留歌词正文 */
function plainLyric(raw: string): string {
  return (raw ?? "").replace(/\[[^\]]*\]/g, " ").replace(/<[^>]*>/g, " ");
}

/** 歌名 + 歌手 + 专辑，用于特征匹配与无歌词时的语种兜底 */
function metaTextOf(track: UnifiedTrack): string {
  return [track.name, ...(track.artists ?? []), track.album ?? ""].filter(Boolean).join(" ");
}

/** 取歌词原文：已下载的读本地边车文件，否则走歌词源 */
async function readLyricText(track: UnifiedTrack): Promise<string> {
  try {
    const local = await useDownloadsStore().readLyrics(track);
    if (local) return local;
  } catch {
    // 本地读取失败照常走在线取词
  }
  try {
    const result = await usePluginsStore().getLyrics(track);
    return result?.lrc ?? "";
  } catch {
    return "";
  }
}

/* ------------------------------ 处理记录 ------------------------------ */

async function isProcessed(track: UnifiedTrack): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ track_id: string }>>(
    "select track_id from auto_playlist_done where source_id = $1 and track_id = $2 limit 1",
    [track.sourceId ?? "", track.id],
  );
  return (rows?.length ?? 0) > 0;
}

async function markProcessed(
  track: UnifiedTrack,
  target: AutoPlaylistTarget,
  tag: AutoPlaylistTag,
): Promise<void> {
  const db = await getDb();
  // 平台歌单没有数字主键，playlist_id 写 0，真正的引用放 playlist_ref
  const playlistId = target.kind === "local" ? target.id : 0;
  await db.execute(
    `insert into auto_playlist_done (source_id, track_id, playlist_id, playlist_ref, tag, added_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict(source_id, track_id) do update set
       playlist_id = $3,
       playlist_ref = $4,
       tag = $5,
       added_at = $6`,
    [track.sourceId ?? "", track.id, playlistId, autoPlaylistTargetKey(target), tag, Date.now()],
  );
}

/** 已处理曲目数（设置页展示用） */
export async function countProcessedTracks(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ total: number }>>(
    "select count(*) as total from auto_playlist_done",
  );
  return Number(rows?.[0]?.total ?? 0);
}

/** 清空处理记录：之后听完的歌会重新走一遍自动添加 */
export async function resetProcessedTracks(): Promise<void> {
  const db = await getDb();
  await db.execute("delete from auto_playlist_done");
}

/* ------------------------------ 主流程 ------------------------------ */

/** 同一首歌的并发保护（ended 与 advanced 理论上不会同时来，仍留一道保险） */
const pending = new Set<string>();

function resolveTarget(
  config: AutoPlaylistConfig,
  lyricText: string,
  track: UnifiedTrack,
): { target: AutoPlaylistTarget | null; tag: AutoPlaylistTag } {
  if (config.mode === "fixed") {
    return { target: config.fixedTarget, tag: "fixed" };
  }
  const meta = metaTextOf(track);
  if (isVocaloid(meta, config.vocaloidKeywords)) {
    return { target: config.vocaloidTarget, tag: "vocaloid" };
  }
  const language = detectLanguage(lyricText) ?? detectLanguage(meta) ?? "other";
  return { target: config.languageTargets[language], tag: language };
}

/**
 * 一首歌自然播完后调用（传入刚播完的那首）。
 *
 * `knownLyricText` 是播放器里已经取到的歌词原文：传了就复用，省掉一次
 * 歌词请求（传空串表示「确认没有歌词」，同样不再重复取词）；不传才自己取。
 *
 * 全程 try/catch：自动整理的失败不能影响播放器的正常换曲。
 */
export async function handleTrackFinished(
  track: UnifiedTrack | null | undefined,
  knownLyricText?: string,
): Promise<void> {
  if (!track?.id) return;
  // 录音作品没有可靠元数据 / 歌词，直接跳过
  if (track.sourceId === RECORDING_SOURCE_ID) return;

  const settings = useSettingsStore();
  const config = settings.autoPlaylist;
  if (!config.enabled) return;

  const key = `${track.sourceId ?? ""}:${track.id}`;
  if (pending.has(key)) return;
  pending.add(key);

  try {
    if (await isProcessed(track)) return;

    // 展示层用自定义信息（用户改过的歌名 / 歌手）判断更贴合实际听感
    const display = useTrackMetaStore().decorate(track);
    const rawLyric = knownLyricText ?? (await readLyricText(track));
    const lyricText = plainLyric(rawLyric);
    const { target, tag } = resolveTarget(config, lyricText, display);

    // 没给这类歌配置歌单：不写记录，等配置好以后再听仍会补上
    if (!target) return;

    if (target.kind === "remote") {
      // 平台歌单的曲目 id 只在同一来源内有效：跨源添加没有意义，直接跳过
      // （不写记录——配置本身没错，换个来源的歌来听时仍要能加）
      if (!track.sourceId || track.sourceId !== target.sourceId) return;
      await usePluginsStore().addToUserPlaylist(target.sourceId, target.id, track.id);
      await markProcessed(track, target, tag);
      toast(`已加入歌单「${target.name || "平台歌单"}」`, "success");
      return;
    }

    const library = useLibraryStore();
    if (!library.playlists.length) await library.loadPlaylists();
    const playlist = library.playlists.find((item) => item.id === target.id);
    if (!playlist) return; // 歌单已被删除

    const added = await library.addTracksToPlaylist(target.id, [track]);
    await markProcessed(track, target, tag);
    // 已经在歌单里（added === 0）就不打扰用户
    if (added > 0) toast(`已加入歌单「${playlist.name}」`, "success");
  } catch (error) {
    console.warn("[autoPlaylist] 自动加歌单失败", error);
  } finally {
    pending.delete(key);
  }
}
