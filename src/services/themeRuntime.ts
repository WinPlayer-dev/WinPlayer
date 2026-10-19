/**
 * 主题组件的运行时 SFC 编译。
 *
 * 主题包里的 `.vue` 是普通 Vue 单文件组件源码，安装时不做任何构建，由宿主在
 * 运行时用 `@vue/compiler-sfc` 的浏览器构建编译成渲染函数后注册为组件。
 *
 * 为什么值得：
 * - 主题作者能用熟悉的 `<template>` / `<script setup>` / `<style scoped>` 写布局，
 *   而不是拼接 render 函数字符串；
 * - scoped 样式通过编译器生成的 `data-v-<hash>` 属性隔离，不会污染宿主样式。
 *
 * 能力边界：
 * - `import "vue"`、`"@/stores/player"` 等**裸模块**只能命中宿主白名单
 *   （见 themeModules.ts）；
 * - `import "./PlayerBar.vue"` 这类**相对路径**会在主题包内解析、递归编译，
 *   这样 PageShell 可以把同一主题里的 TitleBar / PlayerBar 组合起来；
 * - 编译产物用 `new Function` 求值：主题因此拥有主渲染进程权限，
 *   安装与启用时都会显式告知用户。
 */

import { parse, compileScript, compileTemplate, compileStyleAsync } from "@vue/compiler-sfc";
import type { BindingMetadata } from "@vue/compiler-sfc";
import type { Component } from "vue";

/** 单个组件编译后的结果 */
export interface CompiledThemeComponent {
  /** 组件定义（可直接传给 `<component :is>`） */
  component: Component;
  /** 编译后的样式（含 scoped 属性选择器），挂载时注入 <style> */
  css: string;
  /** 该组件的 scopeId，如 `data-v-abc123` */
  scopeId: string;
}

/** 编译失败时抛出的可读错误（带组件名） */
export class ThemeCompileError extends Error {
  constructor(
    message: string,
    readonly component: string,
  ) {
    super(`主题组件「${component}」编译失败：${message}`);
    this.name = "ThemeCompileError";
  }
}

/** 模块解析函数：把裸模块说明符映射为导出对象，返回 null 表示不允许 */
export type ThemeModuleResolver = (specifier: string) => Record<string, unknown> | null;

/** 编译上下文：相对路径解析与依赖缓存都走这里 */
export interface ThemeCompileContext {
  /** 当前组件在主题包内的相对路径，如 `components/PageShell.vue` */
  path: string;
  /** 读取主题包内的文本文件 */
  readFile: (path: string) => Promise<string | null>;
  /** 宿主模块白名单解析 */
  resolveModule: ThemeModuleResolver;
  /** 同一主题内的编译缓存（路径 → 结果） */
  cache: Map<string, CompiledThemeComponent>;
  /** 正在编译中的路径，用于检测循环引用 */
  compiling: Set<string>;
}

/** 生成稳定的 scope id（同一主题同一文件每次编译结果一致，便于缓存） */
function hashScope(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 8);
}

/** 归一化错误信息：编译器错误可以是字符串、数组或对象 */
export function describeThemeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (Array.isArray(error)) return error.map(describeThemeError).join("；");
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/* ------------------------------ 路径解析 ------------------------------ */

/** 归一化主题包内相对路径（不处理 `..`，越界直接报错） */
export function normalizeThemePath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

/** 把 `from` 中相对 import 的说明符解析成主题包内路径 */
export function resolveThemeRelativePath(fromPath: string, specifier: string): string {
  const baseDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const combined = baseDir ? `${baseDir}/${specifier}` : specifier;
  const resolved = normalizeThemePath(combined);
  if (!resolved) throw new Error(`非法相对路径：${specifier}`);
  return resolved;
}

/** 提取源码里的 import 说明符（编译前的原始文本） */
export function extractImportSpecifiers(script: string): string[] {
  const result: string[] = [];
  const pattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?(["'])([^"']+)\1/g;
  for (const match of script.matchAll(pattern)) {
    if (!result.includes(match[2])) result.push(match[2]);
  }
  return result;
}

/* ------------------------------ 模块语法改写 ------------------------------ */

/**
 * 把编译产物里的 ESM 语法改写成在函数体内合法的写法。
 *
 * `compileScript` / `compileTemplate` 输出的是模块代码（顶层 `import ... from`、
 * `export function render`），不能直接塞进 `new Function` 的函数体。这里做最小
 * 改写：import 变成对 `__theme_require__` 的解构，export 去掉前缀。
 * 因为输入永远是编译器生成的、格式稳定的代码，正则改写足够可靠。
 */
export function rewriteModuleSyntax(code: string): string {
  if (!code.trim()) return "";

  // import { a as b, c } from "spec" / import foo, { c } from "spec" / import * as ns from "spec"
  let output = code.replace(
    /\bimport\s+([^;]+?)\s+from\s+(["'])([^"']+)\2\s*;?/g,
    (_match, clause: string, _quote: string, specifier: string) =>
      importClauseToConst(clause.trim(), specifier),
  );

  // 纯副作用 import（如 import "./x.css"）：主题里没有可执行的副作用模块，直接丢弃
  output = output.replace(/\bimport\s+(["'])([^"']+)\1\s*;?/g, "");

  // export function render / export const foo
  output = output.replace(/\bexport\s+(async\s+function|function|const|let|var|class)\b/g, "$1");

  if (/\bexport\b/.test(output)) {
    throw new Error("主题组件只支持 `export default` 或 `<script setup>`，不支持其它 export 语法");
  }
  return output;
}

/** `import` 子句 → 解构常量声明 */
function importClauseToConst(clause: string, specifier: string): string {
  const mod = `__theme_require__(${JSON.stringify(specifier)})`;
  const statements: string[] = [];

  const namespaceMatch = /^\*\s+as\s+([\w$]+)$/.exec(clause);
  if (namespaceMatch) return `const ${namespaceMatch[1]} = ${mod};`;

  const braces = clause.indexOf("{");
  if (braces === -1) {
    const name = clause.replace(/,\s*$/, "").trim();
    if (name) statements.push(`const ${name} = ${mod}.default;`);
    return statements.join(" ");
  }

  const before = clause.slice(0, braces).replace(/,\s*$/, "").trim();
  if (before) statements.push(`const ${before} = ${mod}.default;`);

  const after = clause.slice(braces);
  const closes = after.lastIndexOf("}");
  if (closes === -1) throw new Error(`无法解析 import 语句：${clause}`);
  const inner = after.slice(1, closes).trim();

  if (inner) {
    const binding = inner
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const alias = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(part);
        return alias ? `${alias[1]}: ${alias[2]}` : part;
      })
      .join(", ");
    statements.push(`const { ${binding} } = ${mod};`);
  }
  return statements.join(" ");
}

/* ------------------------------ 编译 ------------------------------ */

/** 运行时可识别的自定义元素（MDUI 等 Web Components 不会被当作 Vue 组件解析） */
const CUSTOM_ELEMENT_PATTERN = /^(mdui|md-|ion-|sl-|ui5-)/i;

function isCustomElement(tag: string): boolean {
  return CUSTOM_ELEMENT_PATTERN.test(tag);
}

/**
 * 编译一个 .vue 源码为组件（含相对路径依赖的递归编译）。
 *
 * @param component 组件键（仅用于错误提示）
 * @param source    .vue 文件内容
 * @param ctx       编译上下文
 */
export async function compileThemeComponent(
  component: string,
  source: string,
  ctx: ThemeCompileContext,
): Promise<CompiledThemeComponent> {
  const path = normalizeThemePath(ctx.path);
  const cached = ctx.cache.get(path);
  if (cached) return cached;
  if (ctx.compiling.has(path)) {
    throw new ThemeCompileError(`检测到循环引用：${path}`, component);
  }
  ctx.compiling.add(path);

  try {
    const result = await compileSource(component, source, path, ctx);
    ctx.cache.set(path, result);
    return result;
  } finally {
    ctx.compiling.delete(path);
  }
}

async function compileSource(
  component: string,
  source: string,
  path: string,
  ctx: ThemeCompileContext,
): Promise<CompiledThemeComponent> {
  const id = hashScope(`${path}:${source}`);
  const scopeId = `data-v-${id}`;

  const { descriptor, errors } = parse(source, { filename: path });
  if (errors.length) throw new ThemeCompileError(describeThemeError(errors[0]), component);
  if (!descriptor.template) throw new ThemeCompileError("缺少 <template>", component);

  if (descriptor.scriptSetup?.lang === "ts" || descriptor.script?.lang === "ts") {
    throw new ThemeCompileError(
      '主题组件暂不支持 lang="ts"（浏览器内没有类型擦除器），请改用普通 JavaScript',
      component,
    );
  }

  // 1) 先把相对路径依赖编译出来（脚本与模板里的 import 都要扫）
  const localModules = new Map<string, Record<string, unknown>>();
  const rawScript = [descriptor.script?.content, descriptor.scriptSetup?.content]
    .filter(Boolean)
    .join("\n");
  const specifiers = new Set([
    ...extractImportSpecifiers(rawScript),
    ...extractImportSpecifiers(descriptor.template.content),
  ]);
  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) continue;
    const targetPath = resolveThemeRelativePath(path, specifier);
    if (!targetPath.endsWith(".vue")) {
      throw new ThemeCompileError(`只支持导入 .vue 组件，收到：${targetPath}`, component);
    }
    const text = await ctx.readFile(targetPath);
    if (text === null) {
      throw new ThemeCompileError(`找不到依赖文件：${targetPath}`, component);
    }
    const dependency = await compileThemeComponent(
      targetPath.split("/").pop() ?? targetPath,
      text,
      { ...ctx, path: targetPath },
    );
    localModules.set(specifier, { default: dependency.component });
  }

  // 2) 脚本：编译为带 setup() 的组件对象（宏 defineProps / defineEmits 由编译器处理）
  let scriptCode = "";
  let bindings: BindingMetadata | undefined;
  if (descriptor.script || descriptor.scriptSetup) {
    try {
      const compiled = compileScript(descriptor, {
        id,
        genDefaultAs: "__theme_component__",
        inlineTemplate: false,
        templateOptions: { compilerOptions: { scopeId, isCustomElement } },
      });
      scriptCode = compiled.content;
      bindings = compiled.bindings as unknown as BindingMetadata | undefined;
    } catch (error) {
      throw new ThemeCompileError(describeThemeError(error), component);
    }
  }

  // 3) 模板：编译为独立的 render 函数
  let templateCode = "";
  try {
    const template = compileTemplate({
      id,
      filename: path,
      source: descriptor.template.content,
      scoped: true,
      compilerOptions: { bindingMetadata: bindings, scopeId, isCustomElement },
    });
    if (template.errors.length) {
      throw new ThemeCompileError(describeThemeError(template.errors[0]), component);
    }
    templateCode = template.code;
  } catch (error) {
    if (error instanceof ThemeCompileError) throw error;
    throw new ThemeCompileError(describeThemeError(error), component);
  }

  // 4) 求值脚本 + 模板，拼出组件对象
  let component_: Component;
  try {
    component_ = evaluate(component, scriptCode, templateCode, localModules, ctx);
  } catch (error) {
    if (error instanceof ThemeCompileError) throw error;
    throw new ThemeCompileError(describeThemeError(error), component);
  }

  // 5) 样式：scoped 样式带上 data-v 属性选择器，与组件自身隔离
  const styles: string[] = [];
  for (const styleBlock of descriptor.styles) {
    try {
      const result = await compileStyleAsync({
        id,
        filename: path,
        source: styleBlock.content,
        scoped: Boolean(styleBlock.scoped),
      });
      if (result.errors.length) {
        throw new ThemeCompileError(describeThemeError(result.errors[0]), component);
      }
      styles.push(result.code);
    } catch (error) {
      if (error instanceof ThemeCompileError) throw error;
      throw new ThemeCompileError(describeThemeError(error), component);
    }
  }

  // scoped 样式依赖组件上的 __scopeId：Vue 据此给 vnode 打 data-v 属性，
  // 否则编译出来的 `.foo[data-v-xxx]` 规则永远匹配不到元素。
  if (descriptor.styles.some((block) => block.scoped)) {
    (component_ as { __scopeId?: string }).__scopeId = scopeId;
  }

  return { component: component_, css: styles.join("\n"), scopeId };
}

/** 用 `new Function` 求值编译产物，import 由主题内模块与宿主白名单共同满足 */
function evaluate(
  component: string,
  scriptCode: string,
  templateCode: string,
  localModules: Map<string, Record<string, unknown>>,
  ctx: ThemeCompileContext,
): Component {
  const requireModule = (specifier: string): Record<string, unknown> => {
    const local = localModules.get(specifier);
    if (local) return local;
    const resolved = ctx.resolveModule(specifier);
    if (!resolved) {
      throw new Error(
        `不允许导入模块「${specifier}」。主题只能使用宿主提供的模块或主题包内的 .vue 文件，详见 docs/THEME-DEVELOPMENT.md`,
      );
    }
    return resolved;
  };

  const body = `"use strict";
${rewriteModuleSyntax(scriptCode)}
${rewriteModuleSyntax(templateCode)}
const __theme_base__ = typeof __theme_component__ === "object" && __theme_component__ ? __theme_component__ : {};
if (typeof render === "function") __theme_base__.render = render;
return __theme_base__;`;

  let factory: (require: (specifier: string) => Record<string, unknown>) => Component;
  try {
    factory = new Function("__theme_require__", body) as typeof factory;
  } catch (error) {
    throw new ThemeCompileError(`生成组件代码失败：${describeThemeError(error)}`, component);
  }

  const result = factory(requireModule);
  if (!result || typeof result !== "object") {
    throw new ThemeCompileError("编译产物不是有效的组件对象（是否缺少默认导出？）", component);
  }
  return result;
}

// 样式注入与清理见 services/themeStyles.ts（与编译器分离，保证默认外观下不加载本模块）
