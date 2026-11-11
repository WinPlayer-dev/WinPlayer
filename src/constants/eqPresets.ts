/**
 * 均衡器（EQ）10 段频率与预设表。
 *
 * 频率表须与 Rust 端 eq.rs 的 EQ_FREQS 一致（31Hz ~ 16kHz）；
 * 增益范围 -12 ~ +12 dB，由后端 player_set_eq 做 clamp。
 */

import { t } from "@/i18n";

/** 10 段中心频率（Hz） */
export const EQ_FREQS: readonly number[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;

/** 平直增益（全 0） */
export const FLAT_GAINS: number[] = EQ_FREQS.map(() => 0);

export interface EqPreset {
  id: string;
  name: string;
  /** 10 段增益（dB） */
  gains: number[];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: t("player.eqPreset.flat"), gains: [...FLAT_GAINS] },
  { id: "pop", name: t("player.eqPreset.pop"), gains: [-1, 2, 4, 4, 2, 0, -1, -1, -1, -2] },
  { id: "rock", name: t("player.eqPreset.rock"), gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  { id: "classical", name: t("player.eqPreset.classical"), gains: [4, 3, 2, 1, -1, -1, 0, 1, 2, 3] },
  { id: "jazz", name: t("player.eqPreset.jazz"), gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: "electronic", name: t("player.eqPreset.electronic"), gains: [5, 4, 1, 0, -1, 1, 2, 3, 4, 5] },
  { id: "vocal", name: t("player.eqPreset.vocal"), gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { id: "bass", name: t("player.eqPreset.bass"), gains: [6, 5, 4, 2, 1, 0, 0, 0, 0, 0] },
];

/** 手动改动滑杆后的预设标识 */
export const EQ_CUSTOM_PRESET_ID = "custom";

/** 频率标签：≥1kHz 用 kHz 显示 */
export function formatEqFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

/** 按 ID 查预设，找不到（如「自定义」）返回 null */
export function findEqPreset(id: string): EqPreset | null {
  return EQ_PRESETS.find((preset) => preset.id === id) ?? null;
}
