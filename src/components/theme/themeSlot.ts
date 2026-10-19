/**
 * 主题组件覆盖注册表 + 运行时错误边界。
 *
 * 宿主在需要「可被主题替换」的位置渲染主题插槽（`themeSlot()`，或直接读取
 * `getThemeComponentOverride()`），主题应用 / 卸载时由 themes store 写入或清空。
 *
 * 为什么要错误边界：
 * 主题组件在渲染期抛错时，Vue 的默认行为是让**整棵子树**失效——表现出来就是
 * 「界面点几次之后没反应」「播放条忽然消失」。这里对每个主题组件单独兜底：
 * 某个组件出错只让该组件回到内置实现，其余界面继续正常工作。
 */

import {
  computed,
  defineComponent,
  h,
  onErrorCaptured,
  ref,
  shallowReactive,
  type Component,
  type Slots,
} from "vue";
import type { ThemeComponentKey } from "@/types/theme";
import { toast } from "@/services/toast";

/** key → 主题提供的组件；缺失则宿主用内置实现 */
const overrides = shallowReactive<Partial<Record<ThemeComponentKey, Component>>>({});

/** 已因运行时报错被禁用的组件：避免每次渲染都重复抛错刷屏 */
const broken = shallowReactive<Partial<Record<ThemeComponentKey, string>>>({});

/** 当前覆盖了哪些组件（供设置页展示） */
export function themedComponentKeys(): ThemeComponentKey[] {
  return Object.keys(overrides) as ThemeComponentKey[];
}

/** 运行时出错的组件（键 → 错误信息），供设置页提示 */
export function brokenComponentKeys(): Array<{ key: ThemeComponentKey; message: string }> {
  return Object.entries(broken).map(([key, message]) => ({
    key: key as ThemeComponentKey,
    message: String(message),
  }));
}

export function setThemeComponentOverride(key: ThemeComponentKey, component: Component): void {
  overrides[key] = component;
  // 重新注册（通常来自主题更新）时清掉旧的禁用标记
  delete broken[key];
}

export function clearThemeComponentOverrides(): void {
  for (const key of Object.keys(overrides) as ThemeComponentKey[]) delete overrides[key];
  for (const key of Object.keys(broken) as ThemeComponentKey[]) delete broken[key];
}

export function getThemeComponentOverride(key: ThemeComponentKey): Component | undefined {
  // 已判定损坏的覆盖不再参与渲染，直接回落内置实现
  if (broken[key]) return undefined;
  return overrides[key];
}

/**
 * 生成一个「主题插槽」组件：有覆盖用覆盖，没有用内置实现。
 *
 * 属性与插槽原样透传，因此主题组件需要与内置组件保持同样的 props 契约
 * （见 docs/THEME-DEVELOPMENT.md 的组件契约表）。
 */
export function themeSlot(key: ThemeComponentKey, fallback: Component): Component {
  return defineComponent({
    name: `ThemeSlot_${key}`,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      /**
       * 渲染代次：组件抛错后自增，强制重新渲染以切回内置实现。
       * 不用 shallowRef 存组件，避免把响应式对象塞进 h() 的第一个参数。
       */
      const generation = ref(0);

      onErrorCaptured((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[theme] 组件「${key}」渲染失败，已回退到内置实现：`, error);
        broken[key] = message;
        generation.value += 1;
        toast(`主题组件「${key}」出错，已临时回退为内置样式`, "error");
        // 阻止错误继续向上冒泡，避免整棵界面树被卸载
        return false;
      });

      const target = computed(() => {
        // 读取 generation 以建立依赖：出错后这里会重新求值
        void generation.value;
        return getThemeComponentOverride(key) ?? fallback;
      });

      return () => h(target.value, attrs, slots as Slots);
    },
  });
}
