#!/usr/bin/env node
/**
 * 找出**没有任何引用的词条**。
 *
 * 迁移期间是多批并行改的，很容易出现「面板改成新 key，旧 key 没人删」的情况；
 * 词典里留着死条目，将来翻译时既费工又会翻出永远看不到的文案。
 *
 * 用法：`node scripts/i18n-unused.mjs`
 * 判定方式：在 `src/`（排除 `src/i18n`）里找不到 `"<key>"` 或 `'<key>'` 字面量。
 * 动态拼 key（`tDynamic`）无法静态识别，这类会误报，报告里会单独提示。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LOCALE_DIR = join(ROOT, "src/i18n/locales/zh-CN");

/* --------------------------- 词条文件解析 --------------------------- */

function parseObjectLiteral(source, startIndex) {
  let i = source.indexOf("{", startIndex);
  const root = {};
  const stack = [root];
  let pendingKey = null;
  i++;

  const skip = () => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source.startsWith("//", i)) {
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }
      if (source.startsWith("/*", i)) {
        i = source.indexOf("*/", i) + 2;
        continue;
      }
      return;
    }
  };

  for (;;) {
    skip();
    if (i >= source.length) return root;
    const ch = source[i];
    if (ch === "{") {
      const child = {};
      stack[stack.length - 1][pendingKey] = child;
      stack.push(child);
      pendingKey = null;
      i++;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i++;
      if (!stack.length) return root;
      skip();
      if (source[i] === ",") i++;
      continue;
    }
    if (ch === ",") {
      i++;
      continue;
    }
    let key = "";
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (source[i] !== quote) key += source[i++];
      i++;
    } else {
      while (i < source.length && /[\w$-]/.test(source[i])) key += source[i++];
    }
    skip();
    while (source[i] !== ":") i++;
    i++;
    skip();
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      i++;
      let value = "";
      while (source[i] !== quote) {
        if (source[i] === "\\") {
          i++;
        }
        value += source[i++];
      }
      i++;
      stack[stack.length - 1][key] = value;
      continue;
    }
    pendingKey = key;
  }
}

function flatten(tree, prefix, out) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push(path);
    else flatten(value, path, out);
  }
  return out;
}

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(name)) out.push(full);
  }
  return out;
}

const locales = walk(LOCALE_DIR, (n) => n.endsWith(".ts"));
const keys = [];
for (const file of locales) {
  const rel = file
    .slice(LOCALE_DIR.length)
    .replace(/\\/g, "/")
    .replace(/^\//, "")
    .replace(/\.ts$/, "");
  if (rel.endsWith("index")) continue;
  const parts = rel.split("/");
  const prefix =
    parts[0] === "settings" ? (parts[1] === "shell" ? "settings" : `settings.${parts[1]}`) : parts[0];
  const source = readFileSync(file, "utf8");
  const at = source.indexOf("export default");
  if (at < 0) continue;
  flatten(parseObjectLiteral(source, at), prefix, keys);
}

/* ------------------------------ 引用统计 ------------------------------ */

const sources = walk(
  join(ROOT, "src"),
  (n) => /\.(vue|ts)$/.test(n),
)
  .filter((file) => !file.replace(/\\/g, "/").includes("/src/i18n/"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const dead = keys.filter((key) => !sources.includes(`"${key}"`) && !sources.includes(`'${key}'`));

console.log(`词条总数：${keys.length}`);
console.log(`没有字面量引用：${dead.length}`);

if (dead.length) {
  writeFileSync(join(ROOT, ".workbuddy/i18n-dead-keys.txt"), dead.join("\n") + "\n");
  const byGroup = new Map();
  for (const key of dead) {
    const head = key.split(".").slice(0, 2).join(".");
    byGroup.set(head, (byGroup.get(head) ?? 0) + 1);
  }
  console.log("\n按分组：");
  for (const [head, count] of [...byGroup].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${head}.*`);
  }
  console.log("\n明细已写入 .workbuddy/i18n-dead-keys.txt");
  console.log("注意：由 tDynamic / 变量拼出来的 key 会误报，删之前先确认。");
}
