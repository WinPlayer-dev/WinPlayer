/**
 * i18n 运行时（自研，零依赖）。
 *
 * 设计取舍见 `docs/I18N.md`，这里只记三条硬约束：
 *
 * 1. **词条是普通 TS 对象**，不是 JSON。`I18nKey` 由词条结构递归推导出来，
 *    写错 key 是编译期错误；改词条名则是全量重构，不会漏改。
 * 2. **不注册全局 `$t`**。应用有三类入口（主窗口 / 桌面歌词窗口 / 主题预览脚手架），
 *    它们各自 `createApp`，走 `app.config.globalProperties` 就得每个入口装一次，
 *    漏一个就是「模板里 $t 未定义」。改用 `const { t } = useI18n()` 后，
 *    `<script setup>` 的绑定直接可见，任何入口都不用初始化。
 * 3. **`t()` 内部必然读一次 `locale.value`**。模板里调用 `t(...)` 时这次读取发生在
 *    渲染副作用里，切换语言才会自动重渲染——别把它「优化」成读常量。
 */

import { ref } from "vue";
import zhCN from "./locales/zh-CN";

/* ---------------------------------- 语种 ---------------------------------- */

/**
 * 已接入的语种。`value` 同时是 `<html lang>` 的值与 Intl 的 locale 参数，
 * 必须是合法 BCP 47 标签；`label` 用**该语言自己的写法**（不翻译）。
 *
 * 新增语种时：在 `locales/<value>/` 下建一套同构词条，在下面的 MESSAGES 里注册，
 * 再往 LOCALES 里加一项即可——`LocaleMessages` 类型会逼着新词条补齐所有 key。
 */
const MESSAGES = {
  "zh-CN": zhCN,
} as const;

export type Locale = keyof typeof MESSAGES;

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
];

/** 当前语种。模板 / computed 里读它即可获得响应式；写它请走 `setLocale()`。 */
export const locale = ref<Locale>(DEFAULT_LOCALE);

/* ------------------------------- 词条路径类型 ------------------------------- */

/**
 * 把嵌套词条对象拍平成点分路径的联合类型。
 *
 * 只递归到字符串叶子；中间节点是对象。空对象分支产出 `never`（不会污染联合）。
 */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** 所有合法词条 key，例如 `"common.action.confirm"`、`"settings.general.title"`。 */
export type I18nKey = LeafPaths<typeof zhCN>;

/** 插值参数：`t("x.y", { count: 3 })` 对应词条里的 `{count}`。 */
export type I18nParams = Record<string, string | number>;

/** 复数形式：`{count}` 会随数量改变名词形态的语种用它（英文就 `one` / `other` 两种） */
export interface PluralForm {
  one: string;
  other: string;
}

/** 一个叶子词条：普通字符串，或复数形式表 */
export type I18nLeaf = string | PluralForm;

/* --------------------------------- 查表 --------------------------------- */

function lookup(key: string): I18nLeaf | undefined {
  let node: unknown = MESSAGES[locale.value];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || isPluralForm(node) ? (node as I18nLeaf) : undefined;
}

function isPluralForm(value: unknown): value is PluralForm {
  return typeof value === "object" && value !== null && ("one" in value || "other" in value);
}

function interpolate(template: string, params?: I18nParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * 复数选择：`count === 1` 取 `one`，其余取 `other`。
 *
 * 只覆盖英文这类「单/复数二分」的规则。真要接俄语、波兰语（多分档）时，
 * 把这里换成 `Intl.PluralRules`，词条结构也跟着分档——现在没必要。
 */
function pickForm(node: I18nLeaf, params?: I18nParams): string {
  if (typeof node === "string") return node;
  const count = Number(params?.count ?? NaN);
  if (Number.isNaN(count) && import.meta.env.DEV) {
    console.warn("[i18n] 复数词条缺少 {count} 参数，按 other 取词");
  }
  return count === 1 ? node.one : node.other;
}

/**
 * 取词条。key 写错是编译期错误；缺词条时返回 key 本身（界面上直接看见，
 * 比静默回退成空串好排查），并在 DEV 下打一条警告。
 */
export function t(key: I18nKey, params?: I18nParams): string {
  const raw = lookup(key);
  if (raw !== undefined) return interpolate(pickForm(raw, params), params);
  if (import.meta.env.DEV) console.warn(`[i18n] 缺少词条：${key}`);
  return key;
}

/**
 * 取动态 key 的词条（key 由运行时拼出来，如 `settings.${panel}.title`）。
 *
 * 这类调用拿不到编译期校验，**能不用就不用**：优先把结构写进词条里，
 * 让 key 是个字面量。
 */
export function tDynamic(key: string, params?: I18nParams): string {
  const raw = lookup(key);
  if (raw !== undefined) return interpolate(pickForm(raw, params), params);
  if (import.meta.env.DEV) console.warn(`[i18n] 缺少词条：${key}`);
  return key;
}

/** 试取词条：不存在时返回 `fallback`，用于「用户可覆盖的默认文案」这类场景 */
export function tOr(key: string, fallback: string, params?: I18nParams): string {
  const raw = lookup(key);
  return interpolate(raw === undefined ? fallback : pickForm(raw, params), params);
}

/* ------------------------------- 格式化 ------------------------------- */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** 按当前语种格式化数字 / 单位（内部缓存 Intl 实例，格式化在列表里会被高频调用） */
export function n(value: number, options?: Intl.NumberFormatOptions): string {
  const cacheKey = `${locale.value}|${JSON.stringify(options ?? {})}`;
  let formatter = numberFormats.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale.value, options);
    numberFormats.set(cacheKey, formatter);
  }
  return formatter.format(value);
}

/** 按当前语种格式化日期时间 */
export function d(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  const cacheKey = `${locale.value}|${JSON.stringify(options ?? {})}`;
  let formatter = dateFormats.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale.value, options);
    dateFormats.set(cacheKey, formatter);
  }
  return formatter.format(value);
}

/* ------------------------------- 切换语种 ------------------------------- */

function applyDocumentLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale.value;
}

/**
 * 切换语种。
 *
 * 只改内存与 `<html lang>`，**不落库**——持久化归 `settings` store
 * （`settings.language`）。这样 i18n 模块不依赖任何 store / 数据库，
 * 桌面歌词窗口这类没有 Pinia 的入口也能直接用。
 */
export function setLocale(next: Locale): void {
  if (!(next in MESSAGES)) {
    if (import.meta.env.DEV) console.warn(`[i18n] 未注册的语种：${next}`);
    return;
  }
  locale.value = next;
  applyDocumentLang();
}

/** 把非法的持久化值收敛成已注册语种（读库 / 读配置时用） */
export function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && value in MESSAGES ? (value as Locale) : DEFAULT_LOCALE;
}

applyDocumentLang();

/* ------------------------------- 组合式入口 ------------------------------- */

/**
 * 组件里的标准用法：
 *
 * ```vue
 * <script setup lang="ts">
 * import { useI18n } from "@/i18n";
 * const { t } = useI18n();
 * </script>
 * <template><button>{{ t("common.action.confirm") }}</button></template>
 * ```
 *
 * 不要在 `setup` 顶层把 `t(...)` 的结果存进常量（那是一次性快照，
 * 切换语言不会更新）；要复用就包 `computed(() => t(...))`。
 */
export function useI18n() {
  return { t, tDynamic, tOr, n, d, locale, setLocale, LOCALES };
}
