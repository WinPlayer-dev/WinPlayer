/**
 * 音质选择（Quick Quality Switch）。
 *
 * 设计要点：
 * - **不新增全局设置**：音质是「来源相关」的偏好，各插件 manifest 的 settings
 *   里已经声明了自己的 `quality` 下拉（如 netease / bilibili）。播放条上的快速
 *   切换入口写入的仍是插件自己的设置项，插件设置页与运行时共用同一份值，
 *   不会出现两套音质设置互相覆盖的问题。
 * - **能力探测**：只有插件声明了 `type: "select"` 且 `key === "quality"` 的设置项，
 *   才认为它支持音质切换；播放条据此决定是否显示入口。
 * - **自动降级**：见 [`QUALITY_DESCENT`]。真正的降级重试在
 *   `stores/plugins.ts` 的 `getSongUrl()` 里完成（那里才知道当前生效的来源），
 *   这里只导出共用的档位顺序与能力描述。
 */

import { computed } from "vue";
import { usePluginsStore, type PluginRecord } from "@/stores/plugins";
import type { UnifiedTrack } from "@/types/plugin";

/** 插件 manifest 中用于音质的设置项 key */
export const QUALITY_SETTING_KEY = "quality";

/**
 * 从高到低的降级顺序。
 *
 * 与其他音源协议的常见命名保持一致：hires（Hi-Res 无损）→ dolby（杜比全景声）→
 * lossless（无损）→ exhigh（极高）→ higher（较高）→ standard（标准）。
 * 插件选项里没有的档位会被跳过，实际降级链见 [`qualityChainOf`]。
 */
export const QUALITY_DESCENT = ["hires", "dolby", "lossless", "exhigh", "higher", "standard"] as const;

/** 一档可选音质 */
export interface QualityOption {
  /** 传给插件 getSongUrl / 写入插件设置的值 */
  value: string;
  /** 展示名（优先用插件 manifest 里的 label） */
  label: string;
}

/** 某来源的音质能力描述 */
export interface QualitySupport {
  sourceId: string;
  /** 来源展示名 */
  sourceName: string;
  /** 可选档位（按插件 manifest 声明顺序） */
  options: QualityOption[];
  /** 当前值（插件设置里的 quality） */
  current: string;
}

/**
 * 查询某个插件的音质能力；插件没有 quality 设置项时返回 null。
 */
export function qualitySupportOf(record: PluginRecord | undefined): QualitySupport | null {
  if (!record) return null;
  const item = (record.entry.manifest.settings ?? []).find(
    (entry) => entry.key === QUALITY_SETTING_KEY && entry.type === "select",
  );
  if (!item?.options?.length) return null;
  const current = String(record.settings[QUALITY_SETTING_KEY] ?? item.default ?? "");
  return {
    sourceId: record.entry.id,
    sourceName: record.entry.manifest.name,
    options: item.options.map((option) => ({ value: option.value, label: option.label })),
    current: current || item.options[0].value,
  };
}

/**
 * 某来源从当前档位起的降级候选链（含自身，按高→低）。
 *
 * 候选来自**该插件自己声明的 quality 选项**（顺序按 [`QUALITY_DESCENT`] 归一），
 * 因此新增档位（杜比 / 无损等）只需改插件 manifest，宿主无需跟着改；插件没声明
 * quality 或当前值不在声明里时返回空数组，由调用方决定「只请求它自己」。
 */
export function qualityChainOf(record: PluginRecord | undefined, current: string): string[] {
  const declared = (record?.entry.manifest.settings ?? [])
    .find((entry) => entry.key === QUALITY_SETTING_KEY && entry.type === "select")
    ?.options?.map((option) => option.value);
  const pool = declared?.length ? declared : [...QUALITY_DESCENT];
  const rank = (value: string) => {
    const index = (QUALITY_DESCENT as readonly string[]).indexOf(value);
    return index >= 0 ? index : QUALITY_DESCENT.length; // 未登记档位排在最后，保持声明顺序
  };
  const ordered = pool
    .map((value, index) => ({ value, index }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.index - b.index)
    .map((item) => item.value);
  const start = ordered.indexOf(current);
  return start >= 0 ? ordered.slice(start) : [];
}

/**
 * 当前曲目实际会用到的播放源：配置了「播放源」偏好时是它，否则是曲目自身来源。
 * 与 `plugins.getSongUrl()` 的解析顺序保持一致。
 */
export function effectivePlaySourceId(track: UnifiedTrack | null, playSourceId: string): string {
  if (!track) return "";
  if (playSourceId && playSourceId !== track.sourceId) return playSourceId;
  return track.sourceId ?? "";
}

/** 播放条用的音质状态（跟随当前曲目实际用到的播放源） */
export function useQualityControl(track: () => UnifiedTrack | null) {
  const plugins = usePluginsStore();

  /** 当前生效的播放源插件 ID */
  const activeSourceId = computed(() =>
    effectivePlaySourceId(track(), plugins.playSourcePreference),
  );

  /** 当前来源的音质能力（不支持时 null，播放条隐藏入口） */
  const support = computed<QualitySupport | null>(() => {
    const id = activeSourceId.value;
    if (!id) return null;
    return qualitySupportOf(plugins.records.find((record) => record.entry.id === id));
  });

  /** 当前档位（能力不存在时为空串） */
  const current = computed(() => support.value?.current ?? "");

  /** 切换音质：写回插件设置并重建运行时，下一次取直链即生效 */
  async function setQuality(value: string): Promise<void> {
    const info = support.value;
    if (!info || value === info.current) return;
    const record = plugins.records.find((entry) => entry.entry.id === info.sourceId);
    if (!record) return;
    await plugins.updateSettings(record.entry.id, {
      ...record.settings,
      [QUALITY_SETTING_KEY]: value,
    });
  }

  return { support, current, activeSourceId, setQuality };
}
