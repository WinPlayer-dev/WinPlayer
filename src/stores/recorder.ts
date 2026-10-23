/**
 * 录音棚状态：设备选择、监听参数、录音计时与作品列表。
 *
 * 录音本身跑在原生侧（`src-tauri/src/recorder/`），这里只负责保持 UI 与
 * 后端一致：页面切走再回来时用 `isRecording()` 校准，避免出现「后端在录、
 * 界面显示未录」的错位。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  deleteRecording,
  exportMix,
  isRecording,
  listInputDevices,
  listRecordings,
  micLevel,
  openMicSettings,
  probeMicrophone,
  recordingUrl,
  startRecording,
  stopRecording,
  type MixOptions,
  type ProbeReport,
  type RecordingItem,
} from "@/services/recorder";
import { toast } from "@/services/toast";

const PREFS_KEY = "winplayer.recorder.prefs";

interface RecorderPrefs {
  device: string | null;
  monitor: boolean;
  /** 0–100 的监听音量（存百分比，UI 与滑杆一致） */
  monitorVolume: number;
}

function readPrefs(): RecorderPrefs {
  const fallback: RecorderPrefs = { device: null, monitor: false, monitorVolume: 70 };
  try {
    const text = localStorage.getItem(PREFS_KEY);
    if (!text) return fallback;
    const parsed = JSON.parse(text) as Partial<RecorderPrefs>;
    return {
      device: typeof parsed.device === "string" ? parsed.device : null,
      monitor: Boolean(parsed.monitor),
      monitorVolume:
        typeof parsed.monitorVolume === "number"
          ? Math.min(100, Math.max(0, parsed.monitorVolume))
          : fallback.monitorVolume,
    };
  } catch {
    return fallback;
  }
}

export const useRecorderStore = defineStore("recorder", () => {
  const prefs = readPrefs();

  const devices = ref<string[]>([]);
  const device = ref<string | null>(prefs.device);
  const monitor = ref(prefs.monitor);
  const monitorVolume = ref(prefs.monitorVolume);

  const recording = ref(false);
  const busy = ref(false);
  const items = ref<RecordingItem[]>([]);
  const loading = ref(false);

  /** 麦克风实时电平（0–1），录音时由 ticker 刷新 */
  const level = ref(0);
  const probing = ref(false);
  /** 最近一次试音结果：用于区分「没权限」与「没说话」 */
  const probeReport = ref<ProbeReport | null>(null);

  /** 本次录音已进行的毫秒数（录音中由定时器推动） */
  const elapsed = ref(0);
  let startedAt = 0;
  let ticker: number | null = null;

  const hasDevices = computed(() => devices.value.length > 0);
  const latest = computed(() => items.value[0] ?? null);

  function persist(): void {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          device: device.value,
          monitor: monitor.value,
          monitorVolume: monitorVolume.value,
        }),
      );
    } catch {
      // 存不下不影响使用
    }
  }

  function startTicker(): void {
    startedAt = Date.now();
    elapsed.value = 0;
    stopTicker();
    ticker = window.setInterval(() => {
      elapsed.value = Date.now() - startedAt;
      // 顺带刷新电平：10Hz 足够画电平条，也不必为它单开一条定时器
      void micLevel().then((value) => {
        level.value = typeof value === "number" && Number.isFinite(value) ? value : 0;
      });
    }, 100);
  }

  function stopTicker(): void {
    if (ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
    level.value = 0;
  }

  /** 试音：确认麦克风真的能出声（系统禁权时设备照样能打开，只有电平能看出来） */
  async function probe(): Promise<ProbeReport | null> {
    if (probing.value || recording.value) return null;
    probing.value = true;
    try {
      const report = await probeMicrophone(device.value);
      probeReport.value = report;
      return report;
    } catch (error) {
      toast(String(error), "error");
      return null;
    } finally {
      probing.value = false;
    }
  }

  async function showMicSettings(): Promise<void> {
    try {
      await openMicSettings();
    } catch (error) {
      toast(String(error), "error");
    }
  }

  async function loadDevices(): Promise<void> {
    const list = await listInputDevices();
    devices.value = Array.isArray(list) ? list : [];
    // 之前选的设备不在了：回落到系统默认，避免一直录不出声
    if (device.value && !devices.value.includes(device.value)) {
      device.value = null;
      persist();
    }
  }

  async function loadItems(): Promise<void> {
    loading.value = true;
    try {
      const list = await listRecordings();
      items.value = Array.isArray(list) ? list : [];
    } catch (error) {
      console.error("[recorder] 读取录音列表失败", error);
    } finally {
      loading.value = false;
    }
  }

  /** 与后端校准录音状态（进入页面时调用） */
  async function sync(): Promise<void> {
    const active = await isRecording();
    recording.value = active;
    if (active) {
      if (ticker === null) startTicker();
    } else {
      stopTicker();
      elapsed.value = 0;
    }
  }

  /**
   * 开始录音。`track` 提供伴奏信息（可为空 = 纯人声录音）。
   * 录音期间伴奏由调用方负责开始播放。
   */
  async function start(track?: { title: string; artist: string; cover?: string; source?: string } | null): Promise<boolean> {
    if (recording.value || busy.value) return false;
    busy.value = true;
    try {
      await startRecording({
        device: device.value,
        monitor: monitor.value,
        monitorVolume: monitorVolume.value / 100,
        title: track?.title ?? "清唱录音",
        artist: track?.artist ?? "",
        cover: track?.cover ?? null,
        source: track?.source ?? null,
      });
      recording.value = true;
      startTicker();
      return true;
    } catch (error) {
      toast(String(error), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** 停止并混音，成功后把成品插到列表最前 */
  async function stop(): Promise<RecordingItem | null> {
    if (!recording.value || busy.value) return null;
    busy.value = true;
    try {
      const item = await stopRecording();
      recording.value = false;
      stopTicker();
      elapsed.value = 0;
      items.value = [item, ...items.value];
      // 后端发现麦克风全程静音：这不是「录坏了」，是权限或设备选错，必须说清楚
      if (item.warning) toast(item.warning, "error");
      return item;
    } catch (error) {
      recording.value = false;
      stopTicker();
      toast(String(error), "error");
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteRecording(id);
      items.value = items.value.filter((item) => item.id !== id);
      toast("录音已删除", "success");
    } catch (error) {
      toast(String(error), "error");
    }
  }

  async function remix(id: string, options: MixOptions): Promise<RecordingItem | null> {
    try {
      const updated = await exportMix(id, options);
      items.value = items.value.map((item) => (item.id === id ? updated : item));
      toast("混音已更新", "success");
      return updated;
    } catch (error) {
      toast(String(error), "error");
      return null;
    }
  }

  return {
    devices,
    device,
    monitor,
    monitorVolume,
    recording,
    busy,
    items,
    loading,
    elapsed,
    level,
    probing,
    probeReport,
    hasDevices,
    latest,
    persist,
    loadDevices,
    loadItems,
    sync,
    probe,
    showMicSettings,
    start,
    stop,
    remove,
    remix,
    recordingUrl,
  };
});
