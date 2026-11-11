#!/usr/bin/env node
/**
 * i18n 文案扫描器。
 *
 * 两个用途：
 *  1. `node scripts/i18n-scan.mjs`        → 统计还有多少硬编码中文（迁移进度）
 *  2. `node scripts/i18n-scan.mjs --strict` → 有新增硬编码中文时报错退出（防回归）
 *
 * 只认**用户可见**的中文，注释、SQL、正则、日志一律不算：
 *  - .vue：只扫 `<template>` 块里的文本节点与指定属性值；`<script>` 块按 TS 规则扫
 *  - .ts / .tsx：先剥注释，再找含中文的字符串字面量
 *
 * 判定为「不该翻译」的白名单见 SKIP_PATTERNS：日志、console、正则、SQL、
 * 调试名、插件 id 之类。宁可漏报也不要误报——误报会让防回归脚本天天狼来了。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const CJK = /[\u4e00-\u9fa5\u3400-\u4dbf]/;

/** 整体跳过的路径片段（第三方运行时、主题预览脚手架不参与翻译） */
const SKIP_PATH = [
  "node_modules",
  "dist",
  "src/plugin-runtime/", // 插件沙箱里的第三方代码
  "src/assets/",
  "src/i18n/", // 运行时与词条文件本身就是中文（DEV 警告、语种自称名）
  "src/theme-preview/", // 本地截图走查用的脚手架：宿主桩 + 假数据，不进生产包
  "src/winui-preview/",
];

/** 模板里需要翻译的属性 */
const I18N_ATTRS = new Set([
  "title",
  "placeholder",
  "label",
  "alt",
  "aria-label",
  "aria-description",
  "subtitle",
  "description",
  "tooltip",
  "empty-text",
  "confirm-text",
  "cancel-text",
  "header",
  "text",
]);

/** 含这些片段的行视为非 UI 文案（日志 / 正则 / SQL / 调试） */
const SKIP_LINE = [
  /console\.(log|warn|error|info|debug)/,
  /\/\*\*?[^*]*$/, // 行内块注释开头
  /new RegExp|\.test\(|\.match\(|\.replace\(|\.split\(/,
  /SELECT |INSERT |UPDATE |DELETE FROM|CREATE TABLE/,
  /throw new Error\(.*[\u4e00-\u9fa5]/,
  /@ts-|@typedef|TODO|FIXME|NOTE:/,
  // 搜索索引里的口语词 / 英文同义词：是**匹配用的数据**，不是显示文案。
  // 它们在 zh 词条里天然是中文，换成别的语种由该语种自己的条目提供。
  /^\s*aliases:\s*\[/,
  /^\s*keywords:\s*\[/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_PATH.some((p) => full.replace(/\\/g, "/").includes(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if ([".vue", ".ts", ".tsx"].includes(extname(name))) out.push(full);
  }
  return out;
}

/** 去掉 TS 注释（保留字符串内的 // 不误伤：做个简化状态机） */
function stripComments(code) {
  let out = "";
  let i = 0;
  let quote = null;
  /** 上一个有效字符：用来判断 `/` 是除号还是正则开头 */
  let prev = "";
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      prev = c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // 正则字面量：`/` 出现在操作符/逗号/括号之后时按正则整体跳过。
    // 不处理的话，`/[\\/:*?"<>|]/` 里的引号会被当成字符串起点，
    // 把它后面的中文整段吞成"字符串"→ 误报。
    if (c === "/" && (!prev || "([{,;:!&|?=+-*%~^<>".includes(prev))) {
      i++;
      let inClass = false;
      while (i < code.length) {
        const rc = code[i];
        if (rc === "\\") {
          i += 2;
          continue;
        }
        if (rc === "[") inClass = true;
        else if (rc === "]") inClass = false;
        else if (rc === "/" && !inClass) {
          i++;
          break;
        } else if (rc === "\n") break;
        i++;
      }
      out += " ";
      prev = "r";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    out += c;
    i++;
  }
  return out;
}

/** 从 SFC 里切出某块的**内容**（不含标签行） */
function sfcBlock(source, tag) {
  const open = new RegExp(`<${tag}[^>]*>`, "i").exec(source);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = source.lastIndexOf(`</${tag}>`);
  if (end < start) return null;
  return { code: source.slice(start, end), line: source.slice(0, start).split("\n").length };
}

function lineOf(source, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") n++;
  return n;
}

const findings = [];

function add(file, line, raw, kind, context = "") {
  const text = raw.trim();
  if (!text || !CJK.test(text)) return;
  if (SKIP_LINE.some((re) => re.test(text))) return;
  // 按**上下文**再判一次：`console.error("…")`、`aliases: ["…"]`、`SELECT … JSON`
  // 这类只看命中的字符串是判不出来的。用索引往前取一段，避开行号错位。
  if (context && SKIP_LINE.some((re) => re.test(context))) return;
  if (context && /console\.\w+\([^)]*$/.test(context)) return;
  // 日志前缀：`[audio] …` / `[app] …`
  if (/^["'`]\[/.test(text)) return;
  // 纯占位符：`{歌曲名}` / `{歌曲名} - {歌手名}` 这类是查询模板里的字段名，
  // 去掉花括号内容后不再有汉字 → 不是文案
  if (/^["'`].*\{[^{}]+\}.*["'`]$/.test(text)) {
    const outside = text.replace(/\{[^{}]*\}/g, "");
    if (!CJK.test(outside)) return;
  }
  // 单个汉字：多是头像占位首字（`DisplayName="音"`）或图标，不构成文案
  if ([...text].filter((ch) => CJK.test(ch)).length <= 1 && text.length <= 4) return;
  // 超长字面量：几乎都是 SQL / 正则 / HTML 片段，不是界面文案
  if (text.length > 100) return;
  // 模板表达式里跨标签的匹配（含 < >）是解析错位，不是文案
  if (kind === "expr" && /[<>]/.test(text)) return;
  // 与原生 / 第三方错误文案做字符串比较的地方（`String(err).includes("已取消")`）：
  // 那是**比对数据**，不是界面文案
  if (context && /\.includes\([^)]*$/.test(context)) return;
  findings.push({
    file: relative(ROOT, file).replace(/\\/g, "/"),
    line,
    kind,
    text: text.replace(/\s+/g, " ").slice(0, 120),
  });
}

/** 扫模板：文本节点 + 白名单属性 */
function scanTemplate(file, code, baseLine) {
  // 去 HTML 注释
  const clean = code.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  const ctxAt = (index) => clean.slice(Math.max(0, index - 160), index);

  // 文本节点：>...<
  for (const m of clean.matchAll(/>([^<>]+)</g)) {
    const value = m[1];
    if (!CJK.test(value)) continue;
    // 纯空白 + 中文即可；排除单字符标点噪声
    if (value.trim().length <= 1) continue;
    add(file, baseLine + lineOf(clean, m.index), value, "text", ctxAt(m.index));
  }

  // 字符串属性：name="中文" / :name="'中文'"
  for (const m of clean.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) {
    const attr = m[1].replace(/^:|^v-bind:/, "");
    const value = m[2];
    if (!CJK.test(value)) continue;
    if (!I18N_ATTRS.has(attr)) continue;
    add(file, baseLine + lineOf(clean, m.index), value, `attr:${attr}`, ctxAt(m.index));
  }

  // JS 表达式里的字面量：{{ "中文" }} 或 :label="cond ? 'A' : 'B'"
  for (const m of clean.matchAll(/'([^']*[\u4e00-\u9fa5][^']*)'|"([^"]*[\u4e00-\u9fa5][^"]*)"/g)) {
    add(file, baseLine + lineOf(clean, m.index), m[0], "expr", ctxAt(m.index));
  }
}

/** 扫 TS：剥注释后的字符串字面量 */
function scanScript(file, code, baseLine) {
  // 搜索索引里的口语词 / 同义词是**匹配数据**，先整块抹掉（都是单行数组），
  // 否则每条都会报一次
  const clean = stripComments(code)
    .replace(/aliases:\s*\[[^\]]*\]/g, "aliases: []")
    .replace(/keywords:\s*\[[^\]]*\]/g, "keywords: []");
  const ctxAt = (index) => clean.slice(Math.max(0, index - 160), index);
  for (const m of clean.matchAll(/'([^'\\]*[\u4e00-\u9fa5][^'\\]*)'|"([^"\\]*[\u4e00-\u9fa5][^"\\]*)"|`([^`]*[\u4e00-\u9fa5][^`]*)`/g)) {
    add(file, baseLine + lineOf(clean, m.index), m[0], "string", ctxAt(m.index));
  }
}

for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  // 整文件豁免：文件头 30 行内出现 `i18n-ignore-file` 就跳过。
  // 用于「中文是匹配数据 / 关键词表」这类文件（如 autoPlaylist 的 Vocaloid 词表）。
  if (source.split("\n", 30).join("\n").includes("i18n-ignore-file")) continue;
  if (file.endsWith(".vue")) {
    const tpl = sfcBlock(source, "template");
    if (tpl) scanTemplate(file, tpl.code, tpl.line - 1);
    const script = sfcBlock(source, "script");
    if (script) scanScript(file, script.code, script.line - 1);
  } else {
    scanScript(file, source, 0);
  }
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

if (process.argv.includes("--json")) {
  writeFileSync(join(ROOT, ".workbuddy/i18n-report.json"), JSON.stringify(findings, null, 2));
}

if (process.argv.includes("--strict")) {
  if (findings.length) {
    console.error(`发现 ${findings.length} 处硬编码中文：`);
    for (const [file, list] of ranked.slice(0, 20)) {
      console.error(`  ${file}  (${list.length})`);
      for (const item of list.slice(0, 3)) console.error(`    :${item.line}  ${item.text}`);
    }
    process.exit(1);
  }
  console.log("没有硬编码中文文案。");
  process.exit(0);
}

console.log(`硬编码中文文案：${findings.length} 处，分布在 ${byFile.size} 个文件\n`);
for (const [file, list] of ranked.slice(0, 30)) {
  console.log(`${String(list.length).padStart(4)}  ${file}`);
}
if (ranked.length > 30) console.log(`... 另有 ${ranked.length - 30} 个文件`);
