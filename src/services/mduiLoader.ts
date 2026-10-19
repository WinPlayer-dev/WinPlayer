/**
 * MDUI 组件库的按需加载。
 *
 * 内置的 Material You 主题用 `<mdui-*>` 自定义元素搭建界面。自定义元素必须
 * 先 `customElements.define` 才能渲染，而主题文件是运行时读进来的，无法在构建期
 * 分析出用了哪些标签——因此这里在**主题真的带有 MDUI 组件时**才整体引入。
 *
 * 默认外观下这些模块不会执行，主包体不受影响（见 vite build 的 chunk 拆分）。
 */

let loading: Promise<void> | null = null;
let ready = false;

/**
 * 确保 MDUI 已注册（幂等）。
 *
 * 三件事缺一不可：
 * 1. `mdui/mdui.css`：设计令牌 + 主题变量（浅/深两套）；
 * 2. `mdui`：注册所有 `<mdui-*>` 自定义元素（内部是 Lit，自带样式隔离）；
 * 3. Material Icons 字体：`<mdui-icon name="…">` 靠字体连字显示图标，
 *    缺字体时会把图标名当作普通文字渲染。
 */
export function ensureMduiLoaded(): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    await Promise.all([import("mdui/mdui.css"), import("@/services/mduiIcons")]);
    await import("mdui");
    ready = true;
  })();
  return loading;
}

/** 是否已经注册过（同步查询，供渲染前判断） */
export function isMduiReady(): boolean {
  return ready;
}
