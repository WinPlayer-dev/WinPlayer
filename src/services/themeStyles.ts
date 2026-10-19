/**
 * 主题样式的注入与清理。
 *
 * 单独成文件是为了把「纯 DOM 操作」与「SFC 编译器」隔开：
 * 编译器体积大（约 1.7MB），只有主题真的带 .vue 组件时才需要下载；
 * 而切回默认主题、卸载主题时必须能同步清理样式，不能等编译器加载完。
 */

/**
 * 注入一段主题样式。
 *
 * 用 `<style data-theme-style>` 标记，便于卸载时一次性清理干净；
 * 同一 id 重复调用会覆盖内容而不是叠加，避免切换主题残留旧规则。
 */
export function injectThemeStyle(styleId: string, css: string): void {
  if (!css.trim()) {
    removeThemeStyle(styleId);
    return;
  }
  let element = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = styleId;
    element.dataset.themeStyle = "1";
    document.head.appendChild(element);
  }
  element.textContent = css;
}

/** 移除某个注入的样式 */
export function removeThemeStyle(styleId: string): void {
  document.getElementById(styleId)?.remove();
}

/** 移除全部主题注入的样式（切回默认主题 / 卸载时调用） */
export function removeAllThemeStyles(): void {
  for (const element of document.querySelectorAll("style[data-theme-style]")) element.remove();
}
