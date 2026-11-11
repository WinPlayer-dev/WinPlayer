#!/usr/bin/env node
/**
 * 一次性 codemod：把 `views/settings/settingsIndex.ts` 里的字面量文案换成词条 key。
 *
 * 背景：设置页的搜索索引里 `title` / `description` / 分组 `title` 与各面板模板里的
 * `.card-header` / `.card-description` 是同一句话。迁移后这两处必须**引用同一个 key**，
 * 否则改文案必漏一处。手改 100 项 × 3 字段不现实，所以：
 *
 *  1. 解析 `src/i18n/locales/zh-CN/**` 得到「key 路径 → 文案」的扁平表
 *  2. 解析 settingsIndex.ts 的 SETTINGS_SECTIONS / SETTINGS_ITEMS 条目
 *  3. 按「同分类 + 文案完全相等 + 叶子名匹配」反查 key，唯一命中才替换
 *  4. 有歧义或找不到的条目原样保留并打印出来，交人工处理
 *
 * 用法：`node scripts/i18n-settings-index-keys.mjs [--write]`
 * 不带 --write 只报告，不改文件。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LOCALE_DIR = join(ROOT, "src/i18n/locales/zh-CN");
const TARGET = join(ROOT, "src/views/settings/settingsIndex.ts");
const WRITE = process.argv.includes("--write");

/* --------------------------- 词条文件解析 --------------------------- */

/**
 * 极简对象字面量解析器：只认 `key: "字符串"` 与 `key: { ... }`，跳过注释。
 * 词条文件是我手写的、格式统一，够用了；遇到不认识的字符直接抛错而不是猜。
 */
function parseObjectLiteral(source, startIndex) {
  let i = source.indexOf("{", startIndex);
  if (i < 0) throw new Error("找不到对象字面量起点");
  const root = {};
  const stack = [root];
  let pendingKey = null;
  i++; // 跳过根对象的 `{`

  const skipTrivia = () => {
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
    skipTrivia();
    if (i >= source.length) throw new Error("词条文件括号不配对");
    const ch = source[i];

    if (ch === "{") {
      const child = {};
      if (!pendingKey) throw new Error(`位置 ${i} 的对象没有 key`);
      stack[stack.length - 1][pendingKey] = child;
      stack.push(child);
      pendingKey = null;
      i++;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i++;
      if (stack.length === 0) return root;
      skipTrivia();
      if (source[i] === ",") i++;
      continue;
    }
    if (ch === ",") {
      i++;
      continue;
    }

    // key：标识符或带引号的字符串
    let key = "";
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (source[i] !== quote) key += source[i++];
      i++;
    } else {
      while (i < source.length && /[\w$]/.test(source[i])) key += source[i++];
    }
    skipTrivia();
    if (source[i] !== ":") throw new Error(`位置 ${i} 期望冒号，实际 ${source[i]}`);
    i++;
    skipTrivia();

    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      i++;
      let value = "";
      while (source[i] !== quote) {
        if (source[i] === "\\") {
          value += source[i] + source[i + 1];
          i += 2;
          continue;
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
    if (typeof value === "string") out.push({ path, value });
    else flatten(value, path, out);
  }
  return out;
}

function collectLocaleFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectLocaleFiles(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const entries = [];
for (const file of collectLocaleFiles(LOCALE_DIR)) {
  const rel = file
    .slice(LOCALE_DIR.length)
    .replace(/\\/g, "/")
    .replace(/^\//, "")
    .replace(/\.ts$/, "");
  // index.ts 是总装文件（只做 import 与展开，不定义文案），跳过
  if (rel.endsWith("index")) continue;

  const parts = rel.split("/");
  let prefix;
  if (parts[0] === "settings") {
    // settings/shell.ts 自己就带 category / categorySubtitle / shell 三层
    prefix = parts[1] === "shell" ? "settings" : `settings.${parts[1]}`;
  } else {
    prefix = parts[0];
  }

  const source = readFileSync(file, "utf8");
  const at = source.indexOf("export default");
  if (at < 0) continue;
  const tree = parseObjectLiteral(source, at);
  flatten(tree, prefix, entries);
}

/* --------------------------- settingsIndex 改写 --------------------------- */

const target = readFileSync(TARGET, "utf8");
const missing = [];
const ambiguous = [];
/** 索引自己的「搜索摘要」：与卡片描述不是同一句话，单独成条 */
const searchHints = new Map();
let replaced = 0;

/** `general.startup.page` → `startupPage`：去掉分类段后转小驼峰 */
function hintKeyOf(id) {
  const parts = id.split(".").slice(1);
  return parts
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

/** 同分类下按文案+叶子名反查 key；唯一才认 */
function lookup(category, value, leaf, preferGroup) {
  const pool = entries.filter(
    (e) => e.value === value && e.path.startsWith(`settings.${category}.`) && e.path.endsWith(`.${leaf}`),
  );
  if (pool.length === 1) return pool[0].path;
  if (pool.length > 1 && preferGroup) {
    const narrowed = pool.filter((e) => e.path.includes(`settings.${category}.${preferGroup}.`));
    if (narrowed.length === 1) return narrowed[0].path;
  }
  if (pool.length > 1) ambiguous.push({ category, value, leaf, candidates: pool.map((e) => e.path) });
  return null;
}

let output = target;

// 1) SETTINGS_SECTIONS：{ id, category, title } → titleKey
output = output.replace(
  /(\{\s*id:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*title:\s*")([^"]+)(")/g,
  (match, head, id, category, title, tail) => {
    const group = id.split("-")[1] ?? "";
    const key = lookup(category, title, "section", group);
    if (!key) {
      missing.push({ kind: "section", id, category, title });
      return match;
    }
    replaced++;
    // 注意不要再拼 tail：tail 就是原来 title 字面量的收尾引号
    return `${head.slice(0, -"title: \"".length)}titleKey: "${key}"`;
  },
);

// 2) SETTINGS_ITEMS：title / description → titleKey / descriptionKey
output = output.replace(
  /id:\s*"([^"]+)",\s*\n(\s*)category:\s*"([^"]+)",\s*\n\s*sectionId:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)",\s*\n\s*description:\s*\n?\s*"([^"]+)",/g,
  (match, id, indent, category, sectionId, title, description) => {
    const group = sectionId.split("-")[1] ?? "";
    const titleKey = lookup(category, title, "title", group);
    let descriptionKey = lookup(category, description, "description", sectionId);

    // 卡片描述与索引摘要往往不是同一句话：给索引摘要单独建词条，
    // 否则只能留着中文字面量（那就等于没迁）
    if (!descriptionKey) {
      const hint = hintKeyOf(id);
      descriptionKey = `settings.searchHints.${category}.${hint}`;
      searchHints.set(descriptionKey, description);
    }

    if (!titleKey) {
      missing.push({ kind: "item-title", id, category, sectionId, title });
      return match;
    }
    replaced += 1;
    return `id: "${id}",\n${indent}category: "${category}",\n${indent}sectionId: "${sectionId}",\n${indent}titleKey: "${titleKey}",\n${indent}descriptionKey: "${descriptionKey}",`;
  },
);

if (WRITE) {
  writeFileSync(TARGET, output);

  if (searchHints.size) {
    const grouped = new Map();
    for (const [path, value] of searchHints) {
      const [, , category, key] = path.split(".");
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push([key, value]);
    }
    const body = [...grouped]
      .map(([category, list]) => {
        const rows = list
          .map(([key, value]) => `    ${key}: "${value.replace(/"/g, '\\"')}",`)
          .join("\n");
        return `  ${category}: {\n${rows}\n  },`;
      })
      .join("\n");
    const file = `/**
 * 设置页**搜索索引**的摘要文案。
 *
 * 与各面板卡片里的 \`description\` 不是同一句话：卡片描述讲「这个开关做什么」，
 * 这里讲「你这个搜索词为什么命中它」，所以更富关键词（同义词、别名、使用场景）。
 * 分开是**有意为之**——合并会让搜索命中率下降，或者让卡片描述变得又长又像说明书。
 *
 * key 结构：\`<分类>.<条目 id 去掉分类段后转小驼峰>\`，由
 * \`scripts/i18n-settings-index-keys.mjs\` 生成，条目 id 改名时记得同步。
 */
export default {
${body}
};
`;
    writeFileSync(join(ROOT, "src/i18n/locales/zh-CN/settings/searchHints.ts"), file);
    console.log(`搜索摘要词条：${searchHints.size} 条 → settings/searchHints.ts`);
  }
}
console.log(`替换字段：${replaced}${WRITE ? "（已写入）" : "（预演，加 --write 才写文件）"}`);
console.log(`词条表：${entries.length} 条`);

if (missing.length) {
  console.log(`\n未匹配 ${missing.length} 处（需人工处理）：`);
  for (const m of missing.slice(0, 40)) console.log(" ", JSON.stringify(m));
}
if (ambiguous.length) {
  console.log(`\n有歧义 ${ambiguous.length} 处（同一文案在本分类出现多次）：`);
  for (const a of ambiguous.slice(0, 20)) console.log(" ", a.value, "→", a.candidates.join(" | "));
}
