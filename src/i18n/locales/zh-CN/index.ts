/**
 * 简体中文词条总表。
 *
 * 按**域**拆文件：一个文件对应界面里的一块（设置页 / 播放器 / 曲库…）。
 * 新增域时在这里挂上并同步 `docs/I18N.md` 的表格。
 *
 * `zh-CN` 是**基准语种**：它的结构就是 `I18nKey` 类型本身，其它语种必须与之同构
 * （`LocaleMessages` 会强制校验）。
 */
import common from "./common";
import nav from "./nav";
import components from "./components";
import layout from "./layout";
import player from "./player";
import library from "./library";
import search from "./search";
import plugins from "./plugins";
import settings from "./settings";
import cloud from "./cloud";
import studio from "./studio";
import themes from "./themes";
import onboarding from "./onboarding";
import errors from "./errors";
import shortcuts from "./shortcuts";
import type { I18nLeaf } from "../../index";

const zhCN = {
  common,
  nav,
  components,
  layout,
  player,
  library,
  search,
  plugins,
  settings,
  cloud,
  studio,
  themes,
  onboarding,
  errors,
  shortcuts,
};

/**
 * 词条的结构类型（叶子是 `string`，英文这类语种可以用 `{ one, other }`）。
 *
 * 新增语种时用它约束：`const en: LocaleMessages = {...}`，少一个 key 就报错。
 */
type DeepLocale<T> = {
  [K in keyof T]: T[K] extends string ? I18nLeaf : DeepLocale<T[K]>;
};

export type LocaleMessages = DeepLocale<typeof zhCN>;

export default zhCN;
