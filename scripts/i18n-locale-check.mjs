#!/usr/bin/env node
/**
 * 多语种一致性检查（以 zh-CN 为基准语种）。
 *
 * 检查四类问题：
 *  1. **结构**：缺 key / 多 key / 叶子类型不一致（字符串 vs 复数对象）；
 *  2. **占位符**：`{count}`、`{name}` 这类参数集合两边必须完全相等
 *     （少一个就是界面里漏显示数据，多一个就是永远不替换的字面量）；
 *  3. **复数对象**：只能有 `one` / `other`，都不能为空，且原文里必须真有 `{count}`；
 *  4. **空词条**：值只剩空白（翻译漏了）。
 *
 * 用法：
 *   node scripts/i18n-locale-check.mjs              # 检查所有已注册语种
 *   node scripts/i18n-locale-check.mjs en-US        # 只查某个语种
 *   node scripts/i18n-locale-check.mjs en-US common # 只查某个词条文件
 *   node scripts/i18n-locale-check.mjs --json       # 机器可读输出
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LOCALES_DIR = join(ROOT, "src/i18n/locales");
const BASE_LOCALE = "zh-CN";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("--"));
const onlyLocale = positional[0];
const onlyFile = positional[1];

/* --------------------------- 词条文件解析 --------------------------- */

/**
 * 极简对象字面量解析器：只认 `key: "字符串"` 与 `key: { ... }`，跳过注释。
 * 词条文件格式统一，够用了；遇到不认识的字符直接抛错而不是猜。
 */
function parseObjectLiteral(source, startIndex) {
  const start = source.indexOf("{", startIndex);
  if (start < 0) throw new Error("找不到对象字面量起点");
  const root = {};
  const stack = [root];
  let pendingKey = null;
  let i = start + 1;

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

/** 列出语种目录下的词条文件（跳过 `index.ts` 总装文件） */
function localeFiles(localeDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) {
        const rel = relative(localeDir, full).replace(/\\/g, "/").replace(/\.ts$/, "");
        if (!rel.split("/").pop().startsWith("index")) out.push(rel);
      }
    }
  };
  walk(localeDir);
  return out;
}

function readTree(localeDir, rel) {
  const source = readFileSync(join(localeDir, `${rel}.ts`), "utf8");
  const at = source.indexOf("export default");
  if (at < 0) return null;
  return parseObjectLiteral(source, at);
}

/* ------------------------------ 比较 ------------------------------ */

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(text) {
  return new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
}

function diffPlaceholders(baseText, text) {
  const a = placeholders(baseText);
  const b = placeholders(text);
  const missing = [...a].filter((name) => !b.has(name));
  const extra = [...b].filter((name) => !a.has(name));
  return { missing, extra };
}

/**
 * 递归比较两棵词条树。
 *
 * @returns 问题列表，每项 `{ path, kind, detail }`
 */
function compare(baseNode, node, path, issues) {
  const baseKeys = Object.keys(baseNode);
  const keys = Object.keys(node ?? {});

  for (const key of baseKeys) {
    if (!(key in (node ?? {}))) {
      issues.push({ path: path ? `${path}.${key}` : key, kind: "missing", detail: "缺少词条" });
    }
  }
  for (const key of keys) {
    if (!(key in baseNode)) {
      issues.push({ path: path ? `${path}.${key}` : key, kind: "extra", detail: "多余的词条" });
    }
  }

  for (const key of baseKeys) {
    if (!(key in (node ?? {}))) continue;
    const baseValue = baseNode[key];
    const value = node[key];
    const childPath = path ? `${path}.${key}` : key;

    if (typeof baseValue === "object") {
      if (typeof value !== "object" || value === null) {
        issues.push({ path: childPath, kind: "shape", detail: "应为对象" });
        continue;
      }
      compare(baseValue, value, childPath, issues);
      continue;
    }

    // 基准语种是字符串：译文可以是字符串，或复数对象 { one, other }
    if (typeof value === "string") {
      if (!value.trim()) issues.push({ path: childPath, kind: "empty", detail: "空词条" });
      for (const name of diffPlaceholders(baseValue, value).missing) {
        issues.push({ path: childPath, kind: "placeholder", detail: `缺少占位符 {${name}}` });
      }
      for (const name of diffPlaceholders(baseValue, value).extra) {
        issues.push({ path: childPath, kind: "placeholder", detail: `多了占位符 {${name}}` });
      }
      continue;
    }

    if (typeof value !== "object" || value === null) {
      issues.push({ path: childPath, kind: "shape", detail: "应为字符串或 { one, other }" });
      continue;
    }

    const formKeys = Object.keys(value);
    for (const form of formKeys) {
      if (form !== "one" && form !== "other") {
        issues.push({ path: childPath, kind: "plural", detail: `未知复数形式 ${form}` });
      }
    }
    for (const form of ["one", "other"]) {
      if (!(form in value)) {
        issues.push({ path: childPath, kind: "plural", detail: `复数对象缺少 ${form}` });
        continue;
      }
      if (typeof value[form] !== "string" || !value[form].trim()) {
        issues.push({ path: childPath, kind: "plural", detail: `${form} 应为非空字符串` });
        continue;
      }
      const { missing, extra } = diffPlaceholders(baseValue, value[form]);
      for (const name of missing) {
        issues.push({ path: `${childPath}.${form}`, kind: "placeholder", detail: `缺少占位符 {${name}}` });
      }
      for (const name of extra) {
        issues.push({ path: `${childPath}.${form}`, kind: "placeholder", detail: `多了占位符 {${name}}` });
      }
    }
    if (!placeholders(baseValue).has("count")) {
      issues.push({
        path: childPath,
        kind: "plural",
        detail: "基准语种没有 {count}，不该用复数对象（英文里不会随数量变化就写字符串）",
      });
    }
  }
}

/* ------------------------------ 主流程 ------------------------------ */

const locales = onlyLocale
  ? [onlyLocale]
  : readdirSync(LOCALES_DIR).filter((name) => statSync(join(LOCALES_DIR, name)).isDirectory());

if (!existsSync(join(LOCALES_DIR, BASE_LOCALE))) {
  console.error(`找不到基准语种目录：${LOCALES_DIR}/${BASE_LOCALE}`);
  process.exit(1);
}

const baseDir = join(LOCALES_DIR, BASE_LOCALE);
const baseFiles = localeFiles(baseDir).filter((rel) => !onlyFile || rel === onlyFile || rel.startsWith(`${onlyFile}/`));

const report = { base: BASE_LOCALE, baseFiles: baseFiles.length, locales: {}, total: 0 };

for (const locale of locales) {
  if (locale === BASE_LOCALE) continue;
  const dir = join(LOCALES_DIR, locale);
  if (!existsSync(dir)) {
    report.locales[locale] = { error: `目录不存在：src/i18n/locales/${locale}` };
    report.total += 1;
    continue;
  }

  const files = localeFiles(dir);
  const issues = [];
  for (const rel of baseFiles) {
    if (!files.includes(rel)) {
      issues.push({ path: `${rel}.ts`, kind: "missingFile", detail: "整个词条文件缺失" });
      continue;
    }
    const baseTree = readTree(baseDir, rel);
    const tree = readTree(dir, rel);
    if (!baseTree) continue;
    if (!tree) {
      issues.push({ path: `${rel}.ts`, kind: "parse", detail: "找不到 export default 对象" });
      continue;
    }
    compare(baseTree, tree, "", issues);
  }
  for (const rel of files) {
    if (onlyFile && rel !== onlyFile && !rel.startsWith(`${onlyFile}/`)) continue;
    if (!baseFiles.includes(rel)) {
      issues.push({ path: `${rel}.ts`, kind: "extraFile", detail: "基准语种没有这个文件" });
    }
  }

  report.locales[locale] = { files: files.length, issues };
  report.total += issues.length;
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [locale, result] of Object.entries(report.locales)) {
    if (result.error) {
      console.log(`\n${locale}: ${result.error}`);
      continue;
    }
    if (!result.issues.length) {
      console.log(`\n${locale}: 与 ${BASE_LOCALE} 一致（${result.files} 个词条文件）`);
      continue;
    }
    console.log(`\n${locale}: ${result.issues.length} 个问题`);
    const byKind = {};
    for (const issue of result.issues) (byKind[issue.kind] ??= []).push(issue);
    for (const [kind, list] of Object.entries(byKind)) {
      console.log(`  [${kind}] ${list.length}`);
      for (const issue of list.slice(0, 40)) console.log(`    ${issue.path} — ${issue.detail}`);
      if (list.length > 40) console.log(`    …还有 ${list.length - 40} 条`);
    }
  }
}

process.exit(report.total ? 1 : 0);
