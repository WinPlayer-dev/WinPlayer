/**
 * i18n 走查预览（仅开发期使用）。
 *
 * 目的：真实挂载 `SettingsView`，逐个分类渲染，检查
 *   1. 有没有词条漏翻（DOM 里出现 `settings.general.title` 这种 key 原文）；
 *   2. 有没有空文本（`t()` 返回空串）；
 *   3. 布局是否因迁移被撑坏。
 *
 * 页面上暴露 `window.__i18nAudit()`，截图脚本调用它收集问题。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/views/settings/settings.css";
import SettingsView from "@/views/SettingsView.vue";
import { installHarnessStubs } from "./harness";

installHarnessStubs();

const params = new URLSearchParams(window.location.search);
const mobile = params.get("mobile") === "1";

const Host = defineComponent({
  name: "I18nCheckHost",
  setup: () => () =>
    h(
      "div",
      {
        class: ["app-shell", mobile ? "mobile-shell" : ""],
        style: mobile
          ? "box-sizing:border-box;width:100%;max-width:420px;margin:0 auto;height:100vh;overflow:auto;color:var(--wp-text-primary);background:var(--wp-base)"
          : "box-sizing:border-box;width:100%;height:100vh;overflow:auto;color:var(--wp-text-primary);background:var(--wp-base)",
      },
      [h(SettingsView)],
    ),
});

/*
 * 必须真的有一条 `/settings` 路由：`SettingsView` 里切换分类 / 搜索跳转用的是
 * `router.replace({ query })`（不带 path），落到通配路由上地址栏会变成 `#/?tab=…`，
 * 看不出跳转是否生效。
 */
const Blank = { render: () => null };
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/settings" },
    { path: "/settings", component: Blank },
    { path: "/:pathMatch(.*)*", component: Blank },
  ],
});

const app = createApp(Host);
app.use(createPinia());
app.use(router);
app.mount("#app");

if (params.get("theme") === "dark") document.documentElement.dataset.theme = "dark";

/* ------------------------------ 走查审计 ------------------------------ */

/** 形如 `settings.shell.title` 的 key 原文 */
const KEY_LIKE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
/** 被检查的可见属性 */
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

interface AuditResult {
  /** 疑似漏翻：DOM 里直接出现 key 原文 */
  rawKeys: string[];
  /** `aria-label` 等属性里的 key 原文 */
  rawAttrKeys: string[];
  /** 元素数量异常少：说明整块没渲染出来 */
  textNodes: number;
  texts: string[];
}

function audit(): AuditResult {
  const rawKeys: string[] = [];
  const rawAttrKeys: string[] = [];
  const texts: string[] = [];
  const root = document.querySelector(".settings-page") ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) {
        texts.push(text);
        if (KEY_LIKE.test(text)) rawKeys.push(text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      for (const attr of ATTRS) {
        const value = el.getAttribute(attr);
        if (value && KEY_LIKE.test(value.trim())) rawAttrKeys.push(`${attr}="${value}"`);
      }
    }
    node = walker.nextNode();
  }

  return { rawKeys, rawAttrKeys, textNodes: texts.length, texts };
}

(window as unknown as { __i18nAudit: () => AuditResult }).__i18nAudit = audit;
