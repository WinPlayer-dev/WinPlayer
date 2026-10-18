/**
 * 音频引擎：原生 Rust 播放引擎桥接。
 *
 * 后端（src-tauri/src/player）负责解码（symphonia，支持 FLAC/OGG 等
 * 更多格式）、10 段均衡器 DSP 与音频输出；前端只通过 Tauri 命令与
 * 事件控制播放，对上层（store / UI）暴露与旧 HTML5 Audio 相同的接口。
 *
 * 非 Tauri 环境（纯浏览器开发预览）下降级为 no-op。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AudioEngineEvents {
  timeupdate: (currentTime: number, duration: number) => void;
  durationchange: (duration: number) => void;
  ended: () => void;
  /** 已无缝衔接至预加载曲目（crossfade 起点 / gapless 衔接点），携带预加载 URL */
  advanced: (url: string) => void;
  error: (message: string) => void;
  playing: () => void;
  paused: () => void;
  waiting: () => void;
}

type EventName = keyof AudioEngineEvents;

/** seek 后等待引擎到达目标的最长时长（毫秒），超时恢复常规进度跟随 */
const SEEK_SETTLE_MS = 30_000;

export class AudioEngine {
  private readonly listeners = new Map<EventName, Set<(...args: never[]) => void>>();
  private readonly inTauri: boolean;
  private unlisteners: Array<() => void> = [];

  private _currentTime = 0;
  private _duration = 0;
  private _paused = true;
  private _volume = 0.8;
  private _muted = false;
  /** 最近一次 seek 的时间与时刻（用于过滤回跳进度） */
  private seekTarget = 0;
  private seekAt = 0;

  constructor() {
    this.inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (this.inTauri) {
      void this.bindNativeEvents();
    }
  }

  private async bindNativeEvents(): Promise<void> {
    const on = async (event: string, handler: (payload: unknown) => void) => {
      this.unlisteners.push(await listen(event, (e) => handler(e.payload)));
    };
    try {
      await on("player://progress", (payload) => {
        const p = payload as { currentTime?: number; duration?: number };
        const time = typeof p.currentTime === "number" ? p.currentTime : 0;
        // seek 后忽略旧位置的进度，直到引擎时间到达目标附近（Coarse 对齐
        // 可能滞后数秒；全量下载模式等待可达数十秒）。兜底 30s 防目标
        // 不可达时永久卡死。
        const guardActive =
          this.seekAt > 0 &&
          Date.now() - this.seekAt < SEEK_SETTLE_MS &&
          (time < this.seekTarget - 4 || time > this.seekTarget + 10);
        if (guardActive) return;
        this.seekAt = 0; // 已到达目标附近，恢复常规进度跟随
        this._currentTime = time;
        if (typeof p.duration === "number" && p.duration > 0 && p.duration !== this._duration) {
          this._duration = p.duration;
          this.emit("durationchange", p.duration);
        }
        this.emit("timeupdate", time, this._duration);
      });
      await on("player://duration", (payload) => {
        const d = (payload as { duration?: number }).duration;
        if (typeof d === "number" && d > 0 && d !== this._duration) {
          this._duration = d;
          this.emit("durationchange", d);
        }
      });
      await on("player://state", (payload) => {
        const state = (payload as { state?: string }).state;
        if (state === "playing") {
          this._paused = false;
          this.emit("playing");
        } else if (state === "paused") {
          this._paused = true;
          this.emit("paused");
        } else if (state === "buffering") {
          if (!this._paused) this.emit("waiting");
        } else if (state === "idle") {
          this._currentTime = 0;
          this._duration = 0;
          this._paused = true;
          this.emit("paused");
        }
      });
      await on("player://ended", () => {
        // 自然播完后引擎已停止推进：复位暂停位，否则后续点播放会被当成
        // 「暂停」处理（togglePlay 依赖 engine.paused 判断），一直不出声
        this._paused = true;
        this.emit("ended");
      });
      await on("player://advanced", (payload) => {
        const url = (payload as { url?: string }).url;
        this.emit("advanced", typeof url === "string" ? url : "");
      });
      await on("player://error", (payload) => {
        const message = (payload as { message?: string }).message ?? "播放出错";
        this._paused = true;
        this.emit("error", message);
      });
    } catch (error) {
      console.error("[audio] 原生播放事件监听失败", error);
    }
  }

  get currentTime(): number {
    return this._currentTime;
  }

  get duration(): number {
    return this._duration;
  }

  get paused(): boolean {
    return this._paused;
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = Math.min(1, Math.max(0, value));
    this.applyVolume();
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    this._muted = value;
    this.applyVolume();
  }

  /** 静音走音量归零（后端 Sink 只有音量参数） */
  private applyVolume(): void {
    if (!this.inTauri) return;
    const effective = this._muted ? 0 : this._volume;
    void invoke("player_set_volume", { volume: effective }).catch(() => {});
  }

  /** 设置播放源并加载（后端开始缓冲，不自动播放） */
  load(src: string): void {
    console.log(`[audio] load src(${src.length}): ${src.slice(0, 200)}`);
    this._currentTime = 0;
    this._duration = 0;
    this._paused = true;
    if (!this.inTauri) {
      console.warn("[audio] 非 Tauri 环境，原生播放引擎不可用");
      return;
    }
    void invoke("player_load", { url: src }).catch((error) => {
      this.emit("error", `加载音频失败: ${error}`);
    });
  }

  async play(): Promise<void> {
    this._paused = false;
    if (!this.inTauri) return;
    await invoke("player_play");
  }

  pause(): void {
    this._paused = true;
    if (!this.inTauri) return;
    void invoke("player_pause").catch(() => {});
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const target = Math.max(0, seconds);
    this._currentTime = target;
    this.seekTarget = target;
    this.seekAt = Date.now();
    if (!this.inTauri) return;
    void invoke("player_seek", { seconds: target }).catch(() => {});
  }

  stop(): void {
    this._currentTime = 0;
    this._duration = 0;
    this._paused = true;
    if (!this.inTauri) return;
    void invoke("player_stop").catch(() => {});
  }

  /** 设置均衡器（10 段，-12 ~ +12 dB） */
  setEq(enabled: boolean, gains: number[]): void {
    if (!this.inTauri) return;
    void invoke("player_set_eq", { enabled, gains }).catch(() => {});
  }

  /** 设置播放倍速（0.5–2.0）：后端做保持音调的时间伸缩 */
  setRate(rate: number): void {
    if (!this.inTauri) return;
    void invoke("player_set_rate", { rate }).catch(() => {});
  }

  /** 预加载下一首（后端并行解码，衔接时机由引擎决定） */
  preload(src: string): void {
    if (!this.inTauri) return;
    void invoke("player_preload", { url: src }).catch(() => {});
  }

  /** 丢弃预加载（队列/模式变更导致预载目标失效时） */
  cancelPreload(): void {
    if (!this.inTauri) return;
    void invoke("player_cancel_preload").catch(() => {});
  }

  /** 横向淡入淡出配置（关闭后自动切歌仍走 Gapless 无缝衔接） */
  setCrossfade(enabled: boolean, seconds: number): void {
    if (!this.inTauri) return;
    void invoke("player_set_crossfade", { enabled, seconds }).catch(() => {});
  }

  on<K extends EventName>(event: K, listener: AudioEngineEvents[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (...args: never[]) => void);
    return () => {
      set?.delete(listener as (...args: never[]) => void);
    };
  }

  private emit<K extends EventName>(event: K, ...args: Parameters<AudioEngineEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}

let engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}
