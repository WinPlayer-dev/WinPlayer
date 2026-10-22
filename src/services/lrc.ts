/**
 * LRC 歌词解析
 */

import type { LyricLine } from "@/types/player";

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * 解析 LRC 文本为按时间排序的歌词行。
 * 支持一行多时间标签（[00:12.00][01:24.00]重复副歌）与元信息行（[ar:] 等，自动忽略）。
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  if (!lrc) return lines;

  for (const raw of lrc.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) continue;

    TIME_TAG.lastIndex = 0;
    const matches = [...text.matchAll(TIME_TAG)];
    if (!matches.length) continue; // 无时间标签（含元信息行）

    const content = text.replace(TIME_TAG, "").trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ?? "0";
      // 亚秒位：2 位按百分之一秒，3 位按千分之一秒
      const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
      lines.push({
        time: minutes * 60_000 + seconds * 1000 + ms,
        text: content,
      });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** 翻译与原文的时间轴容差（毫秒）：不同来源的毫秒位常被截断或取整 */
const TRANSLATION_TOLERANCE_MS = 500;

/**
 * 合并翻译歌词：把翻译挂到**时间轴对得上**的那一行上。
 *
 * 平台返回的翻译歌词常常只包含「有翻译的行」（前奏、纯音乐段、人声重复段都可能缺失），
 * 行数与原曲不一致。因此只有真正配对成功的行才带翻译，配不上的行保持无翻译——
 * 不能按「时间最接近」硬塞，否则前几句会重复显示第一句翻译。
 *
 * 配对优先级：
 * 1. 行数与原文完全一致 → 按行序一一对照（同源完整翻译，最可靠）
 * 2. 时间戳完全一致 → 取该条翻译
 * 3. 容差内就近配对（每条翻译最多用一次）
 * 4. 翻译没有时间轴 → 行数一致时按行序对齐，否则无法可靠对照，直接忽略翻译
 */
export function mergeTranslation(lines: LyricLine[], translation?: string): LyricLine[] {
  if (!translation || !lines.length) return lines;

  // 只保留有实际文案的翻译行：空白翻译不应产生副行
  const translated = parseLrc(translation).filter((row) => row.text.trim());

  if (!translated.length) {
    // 无时间轴的纯文本翻译
    const plain = translation
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean);
    if (plain.length !== lines.length) return lines;
    return lines.map((line, index) => withTranslation(line, plain[index]));
  }

  if (translated.length === lines.length) {
    return lines.map((line, index) => withTranslation(line, translated[index].text));
  }

  const used = new Array<boolean>(translated.length).fill(false);
  const merged = lines.map((line) => ({ ...line }));

  // 1) 时间戳完全一致
  for (let i = 0; i < merged.length; i++) {
    const hit = translated.findIndex((row, index) => !used[index] && row.time === merged[i].time);
    if (hit < 0) continue;
    used[hit] = true;
    merged[i] = withTranslation(merged[i], translated[hit].text);
  }

  // 2) 容差内就近配对（毫秒位差异），配不上就不带翻译
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].translation) continue;
    let best = -1;
    let bestDelta = TRANSLATION_TOLERANCE_MS;
    for (let index = 0; index < translated.length; index++) {
      if (used[index]) continue;
      const delta = Math.abs(translated[index].time - merged[i].time);
      if (delta <= bestDelta) {
        bestDelta = delta;
        best = index;
      }
    }
    if (best < 0) continue;
    used[best] = true;
    merged[i] = withTranslation(merged[i], translated[best].text);
  }

  return merged;
}

/** 给歌词行附加翻译（文案为空则原样返回，不产生空的翻译副行） */
function withTranslation(line: LyricLine, translation?: string): LyricLine {
  const text = translation?.trim();
  return text ? { ...line, translation: text } : line;
}

/** 二分查找当前时间对应的歌词行索引（-1 表示尚未开始） */
export function findLyricIndex(lines: LyricLine[], timeMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= timeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/* ------------------------------ SRT 转换 ------------------------------ */

/** SRT 时间轴：`00:01:02,500 --> 00:01:05,000`（毫秒分隔符容忍 `,` 与 `.`） */
const SRT_TIME =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/**
 * 把 SubRip（`.srt`）字幕转成 LRC 文本。
 *
 * 本地音乐的歌词常常是视频/字幕工具产出的 SRT：有序号、`hh:mm:ss,mmm` 时间轴与
 * 可多行的正文。这里只取每条 cue 的**开始时间**与正文（多行合并为一行），
 * 生成与 LRC 同构的文本，直接喂给 [`parseLrc`](./index) 即可滚动显示。
 */
export function srtToLrc(text: string): string {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const lines: string[] = [];

  for (const block of blocks) {
    const rows = block
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean);
    if (!rows.length) continue;

    const timeIndex = rows.findIndex((row) => row.includes("-->"));
    if (timeIndex < 0) continue;
    const match = SRT_TIME.exec(rows[timeIndex]);
    if (!match) continue;

    const content = rows.slice(timeIndex + 1).join(" ").trim();
    if (!content) continue;

    const totalMinutes = Number(match[1]) * 60 + Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4].padEnd(3, "0").slice(0, 3));
    lines.push(
      `[${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
        millis,
      ).padStart(3, "0")}]${content}`,
    );
  }

  return lines.join("\n");
}
