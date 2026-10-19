/**
 * 后台优化模式（Background Mode）。
 *
 * 当主窗口被「关闭到托盘」隐藏或最小化时，前端进入后台模式，降低渲染与
 * 轮询开销，但仍保持播放（含预加载无缝切歌）。窗口恢复前台后自动退出。
 *
 * 触发源（见 App.vue）：
 * - Rust 侧主动广播 `app://visibility`（首选，托盘隐藏/最小化/恢复都可靠）；
 * - 浏览器 `visibilitychange` / `focus` 作为兜底（例如非托盘的最小化）。
 *
 * 所有热点组件通过 `isThrottled()` 判断当前是否处于后台优化阶段。
 *
 * 注意：本模块与设置「后台优化」开关解耦——由 settings store 调用
 * `setOptimizeEnabled` 同步开关状态；`isThrottled()` 仅当「开关开启且窗口
 * 隐藏」时返回 true。
 */

let hidden = false;
let optimizeEnabled = true;

/** 物理窗口是否隐藏（由可见性事件驱动，独立于设置开关） */
function setHidden(value: boolean): void {
  if (hidden === value) return;
  hidden = value;
  // 挂到 <html> 上的类：停掉纯 CSS 动画与 backdrop-filter 的合成开销
  document.documentElement.classList.toggle("app-background", value);
}

/**
 * 后台模式总开关（对应「后台优化」设置项）。
 * 关闭后即使窗口隐藏也不做任何节流（完全保持前台行为）。
 */
export function setOptimizeEnabled(value: boolean): void {
  optimizeEnabled = value;
  // 关闭开关时同步摘掉隐藏态类（窗口仍隐藏但不再优化）
  if (!value) document.documentElement.classList.remove("app-background");
}

/** 前台/后台切换入口：后台优化 + 物理隐藏两个维度共同决定是否节流 */
export function setAppHidden(value: boolean): void {
  setHidden(value);
}

/**
 * 查询当前是否处于「可节流」的后台优化阶段。
 *
 * 仅当后台优化生效且窗口确实隐藏时为 true。合成器/动画/轮询据此跳过代价
 * 较高的逐帧工作；但**预加载与无缝切歌必须保留**（由 enginePosition 驱动，
 * 见 player store），所以这里只表达「渲染/轮询可省」，不触碰音频链路本身。
 */
export function isThrottled(): boolean {
  return optimizeEnabled && hidden;
}

/** 供开发者/调试：读取当前物理隐藏状态（不受开关影响） */
export function isAppHidden(): boolean {
  return hidden;
}