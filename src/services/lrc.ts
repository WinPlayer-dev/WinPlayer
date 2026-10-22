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

/** 合并翻译歌词（按行序对齐到原文时间轴） */
export function mergeTranslation(lines: LyricLine[], translation?: string): LyricLine[] {
  if (!translation) return lines;
  const translated = parseLrc(translation);
  if (!translated.length) return lines;

  // 若翻译行带有自身时间轴且数量一致，按时间就近对齐；否则按行序对齐
  return lines.map((line, index) => {
    const target =
      translated.length === lines.length
        ? translated[index]
        : translated.reduce((best, cur) =>
            Math.abs(cur.time - line.time) < Math.abs(best.time - line.time) ? cur : best,
          );
    return target?.text ? { ...line, text: `${line.text}\n${target.text}` } : line;
  });
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
