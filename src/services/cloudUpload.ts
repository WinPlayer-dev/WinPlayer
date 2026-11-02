/**
 * 「上传到同频服务器」——把任意来源的曲目推到自己服务器上。
 *
 * 三种音频来路都要照顾到：
 * 1. 已下载 / 离线曲目：直接读本地文件（最快，也不消耗流量）；
 * 2. 本地音乐：曲目 id 就是绝对路径；
 * 3. 插件源（网易云 / 哔哩哔哩…）：解析出直链交给 Rust 拉取，**带上防盗链请求头**，
 *    否则 upos 这类节点会 403。
 *
 * 歌词单独处理：插件源的歌词不在文件里，必须从当前播放源取到 LRC 后一并上传，
 * 否则这首歌上了云就没歌词了。
 */

import { useCloudStore } from "@/stores/cloud";
import { useDownloadsStore } from "@/stores/downloads";
import { usePluginsStore } from "@/stores/plugins";
import { CLOUD_SOURCE_ID, type CloudUploadSource } from "@/services/cloud";
import { LOCAL_MUSIC_SOURCE_ID } from "@/stores/localMusic";
import { RECORDING_SOURCE_ID, recordingPlayPath } from "@/services/recorder";
import { toast } from "@/services/toast";
import type { UnifiedTrack } from "@/types/plugin";

/** 正在上传的曲目（`sourceId:id`），防止连点造成重复上传 */
const inFlight = new Set<string>();

function extOfPath(path: string): string {
  const clean = path.split("?")[0];
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** 直链拿不到扩展名时按编码猜（服务端只收这几种） */
function extOfCodec(codec: string | undefined): string {
  switch ((codec ?? "").toLowerCase()) {
    case "flac":
      return "flac";
    case "aac":
      return "m4a";
    case "vorbis":
      return "ogg";
    case "pcm":
      return "wav";
    default:
      return "mp3";
  }
}

/** 文件名去掉非法字符（服务端只用它取扩展名与兜底标题，但也不该带斜杠） */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

export function canUploadToCloud(track: UnifiedTrack | null | undefined): boolean {
  if (!track) return false;
  const cloud = useCloudStore();
  // 已经在同频服务器里的歌再传一次没有意义
  if (track.sourceId === CLOUD_SOURCE_ID) return false;
  return cloud.configured;
}

export async function uploadTrackToCloud(track: UnifiedTrack): Promise<void> {
  const cloud = useCloudStore();
  const downloads = useDownloadsStore();
  const plugins = usePluginsStore();

  if (!cloud.configured) {
    toast("请先在 设置 → 同步（温韵同频） 登录", "error");
    return;
  }
  const key = `${track.sourceId ?? ""}:${track.id}`;
  if (inFlight.has(key)) {
    toast("这首歌正在上传", "info");
    return;
  }
  inFlight.add(key);

  try {
    let source: CloudUploadSource | null = null;
    let ext = "mp3";

    // 1. 离线索引（下载过 / 录音导出过的文件）
    const localUrl = downloads.localUrl(track);
    if (localUrl?.startsWith("local://")) {
      const path = localUrl.slice("local://".length);
      source = { kind: "path", path };
      ext = extOfPath(path) || ext;
    }

    // 2. 本地音乐：曲目 id 就是绝对路径
    if (!source && track.sourceId === LOCAL_MUSIC_SOURCE_ID && track.id) {
      source = { kind: "path", path: track.id };
      ext = extOfPath(track.id) || ext;
    }

    // 3. 录音棚作品：主进程给绝对路径
    if (!source && track.sourceId === RECORDING_SOURCE_ID) {
      const raw = await recordingPlayPath(track.id);
      const path = raw.startsWith("local://") ? raw.slice("local://".length) : raw;
      source = { kind: "path", path };
      ext = extOfPath(path) || "wav";
    }

    // 4. 插件源：解析直链（带请求头）
    if (!source) {
      const result = await plugins.getSongUrl(track);
      if (!result?.url) throw new Error("这个播放源没有返回可用的直链");
      if (result.url.startsWith("local://")) {
        const path = result.url.slice("local://".length);
        source = { kind: "path", path };
        ext = extOfPath(path) || ext;
      } else {
        source = { kind: "url", url: result.url, headers: result.headers };
        ext = extOfPath(result.url) || extOfCodec(result.codec);
      }
    }

    const artist = (track.artists ?? []).join(" / ");
    const baseName = safeName(
      [artist, track.name].filter(Boolean).join(" - ") || track.name || track.id,
    );
    const filename = `${baseName || "track"}.${ext}`;

    // 歌词：插件源能取就带上（服务端不会自己去插件那儿找）
    let lyrics = "";
    try {
      const found = await plugins.getLyrics(track);
      lyrics = found?.lrc?.trim() ?? "";
    } catch {
      /* 没歌词也能传 */
    }

    toast(`正在上传《${track.name}》…`, "info");
    const result = await cloud.upload({ filename, source, lyrics });

    if (result.duplicate) {
      toast(`《${track.name}》已在同频服务器里（内容相同，未重复占用空间）`, "info");
    } else {
      toast(`已上传《${track.name}》到同频服务器`, "success");
    }
    await cloud.refresh();
  } catch (error) {
    toast(`上传失败：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    inFlight.delete(key);
  }
}
