/**
 * 下拉刷新：当前页面注册的刷新动作。
 *
 * 全局手势（见 MobilePullToRefresh.vue）在触发时调用 runActiveRefresh()，
 * 由「当前在栈顶的页面」通过 useRefreshable() 注册具体要做什么。
 * 路由过渡是 out-in，所以旧页面先卸载（置空）→ 新页面再挂载（注册），
 * 同一时刻只会有一个处理器。
 */
type RefreshHandler = () => void | Promise<void>;

let active: RefreshHandler | null = null;

/** 注册当前页面的刷新动作（传 null 表示清除） */
export function setActiveRefresh(handler: RefreshHandler | null): void {
  active = handler;
}

/**
 * 当前页面是否注册了刷新动作。
 * 设置页、插件页等没有可刷新内容的页面靠它让手势直接不接管，
 * 否则用户下拉会看到完整的「下拉刷新 → 正在刷新…」动画却什么也没发生。
 */
export function hasActiveRefresh(): boolean {
  return active !== null;
}

/** 执行当前页面注册的刷新动作；没有则直接返回 */
export async function runActiveRefresh(): Promise<void> {
  if (!active) return;
  await active();
}
