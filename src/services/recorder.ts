/**
 * 录音棚桥接：麦克风采集 + 伴奏分流 + 混音导出。
 *
 * 后端实现见 `src-tauri/src/recorder/`：伴奏从原生播放引擎的出声口分流，
 * 人声走 cpal 采集，停止时按两条轨的首帧时间戳对齐并混音成 `mix.wav`。
 *
 * 成品回放走专用协议 `http://recording.localhost/?id=<id>&f=mix.wav`
 * （支持 Range，长录音也能拖进度），不占用主播放器的解码会话。
 */

import { invoke } from "@tauri-apps/api/core";

/** 一条录音工程 */
export interface RecordingItem {
  id: string;
  title: string;
  artist: string;
  cover: string | null;
  source: string | null;
  /** 开始录音的毫秒时间戳 */
  createdAt: number;
  /** 成品时长（毫秒） */
  durationMs: number;
  /** 自动测得的对齐偏移：正 = 人声晚于伴奏 */
  offsetMs: number;
  /** 手动微调（毫秒），叠加在 offsetMs 之上 */
  syncMs: number;
  hasMix: boolean;
  hasSong: boolean;
  dir: string;
  /** `local://` 前缀的本地路径（交给原生引擎时可用） */
  mixPath: string | null;
  voicePath: string | null;
  /** 录音质量提醒（如「麦克风全程静音」），只在刚录完时返回 */
  warning?: string;
}

/** 试音结果 */
export interface ProbeReport {
  /** 试音窗口内的峰值（0.0–1.0） */
  peak: number;
  sampleRate: number;
}

export interface StartRecordingOptions {
  /** 麦克风设备名，空 = 系统默认 */
  device?: string | null;
  monitor: boolean;
  /** 监听音量 0–1 */
  monitorVolume: number;
  title: string;
  artist: string;
  cover?: string | null;
  source?: string | null;
}

export interface MixOptions {
  offsetMs: number;
  voiceGainDb: number;
  songGainDb: number;
}

/** 运行时判断宿主：模块级常量会在「Tauri 注入晚于模块求值」时误判 */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function ensure(): void {
  if (!inTauri()) throw new Error("录音功能需要在应用内使用");
}

/** 枚举可用麦克风设备名 */
export async function listInputDevices(): Promise<string[]> {
  if (!inTauri()) return [];
  try {
    return await invoke<string[]>("recorder_list_devices");
  } catch (error) {
    console.error("[recorder] 枚举麦克风失败", error);
    return [];
  }
}

/** 当前是否正在录音（后端状态，页面刷新后仍准确） */
export async function isRecording(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    return await invoke<boolean>("recorder_status");
  } catch {
    return false;
  }
}

/** 开始录音（会自动挂载伴奏分流并让播放引擎重建当前曲目） */
export async function startRecording(options: StartRecordingOptions): Promise<void> {
  ensure();
  await invoke("recorder_start", { options });
}

/** 停止录音并自动混音，返回成品条目 */
export async function stopRecording(): Promise<RecordingItem> {
  ensure();
  return invoke<RecordingItem>("recorder_stop");
}

/** 列出全部录音（按创建时间倒序） */
export async function listRecordings(): Promise<RecordingItem[]> {
  if (!inTauri()) return [];
  return invoke<RecordingItem[]>("recorder_list");
}

/** 重新混音（调整对齐与两条轨的增益） */
export async function exportMix(id: string, options: MixOptions): Promise<RecordingItem> {
  ensure();
  return invoke<RecordingItem>("recorder_export_mix", { id, options });
}

export async function deleteRecording(id: string): Promise<void> {
  ensure();
  await invoke("recorder_delete", { id });
}

export async function revealRecording(id: string): Promise<void> {
  ensure();
  await invoke("recorder_reveal", { id });
}

/**
 * 试音：采集 1.5 秒并返回峰值电平。
 *
 * 系统禁止麦克风访问时设备仍然「能打开」，回调全是 0，所以只能靠电平
 * 区分「没权限」和「没说话」——这也是用户排查「录不到声音」的唯一入口。
 */
export async function probeMicrophone(device?: string | null): Promise<ProbeReport> {
  ensure();
  return invoke<ProbeReport>("recorder_probe_mic", { device: device ?? null });
}

/** 录音中的实时电平（0.0–1.0） */
export async function micLevel(): Promise<number> {
  if (!inTauri()) return 0;
  try {
    return await invoke<number>("recorder_level");
  } catch {
    return 0;
  }
}

/** 打开系统麦克风隐私设置（Windows：ms-settings:privacy-microphone） */
export async function openMicSettings(): Promise<void> {
  ensure();
  await invoke("recorder_open_mic_settings");
}

/**
 * 录音在播放器里的虚拟来源 id。
 *
 * 录音不是插件曲目，但它要能被队列 / 正在播放 / 锁屏识别，
 * 所以给它一个固定的来源 id；地址由主进程按 id 查出来。
 */
export const RECORDING_SOURCE_ID = "recording";

/** 成品/分轨的 WebView 播放地址（`<a>` / `<img>` / 网页 `<audio>` 用） */
export function recordingUrl(
  id: string,
  file: "mix.wav" | "voice.wav" | "song.wav" = "mix.wav",
): string {
  return `http://recording.localhost/?id=${encodeURIComponent(id)}&f=${file}`;
}

/** id → `local://` 地址：成品路径不会变，缓存一份省掉每次换曲的 IPC */
const playPaths = new Map<string, string>();

/**
 * 主播放器用的地址。
 *
 * 原生解码器只认 `local://`（自定义协议是 WebView 层的东西，Rust 侧取不到流），
 * 所以这里问主进程要绝对路径，而不是复用 `recordingUrl()`。
 */
export async function recordingPlayPath(id: string): Promise<string> {
  const cached = playPaths.get(id);
  if (cached) return cached;
  ensure();
  const path = await invoke<string>("recorder_play_path", { id });
  playPaths.set(id, path);
  return path;
}
