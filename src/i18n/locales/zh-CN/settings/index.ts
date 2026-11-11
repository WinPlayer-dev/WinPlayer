/**
 * 设置页词条总装。
 *
 * 拆成「一分类一文件」，与 `views/settings/` 下各面板目录一一对应：
 * 改某个面板的文案只需打开同名文件，不用在 1200 条里翻。
 *
 * 每个分类文件的结构约定（`general.ts` 是范本）：
 *
 * ```ts
 * export default {
 *   startup: {
 *     section: "启动与引导",          // 分组标题，与 <SettingsSection title> 同源
 *     page: {
 *       title: "打开时页面",          // 卡片标题，与 .card-header 同源
 *       description: "…",            // 卡片描述
 *     },
 *   },
 * };
 * ```
 *
 * **分组标题与卡片标题必须只有一处定义**：`settingsIndex.ts` 里的搜索索引
 * 引用的是同一批 key（`*Key` 字段），不另抄一份字面量——否则改文案必漏。
 */
import shell from "./shell";
import general from "./general";
import shortcut from "./shortcut";
import appearance from "./appearance";
import playback from "./playback";
import plugins from "./plugins";
import data from "./data";
import experimental from "./experimental";
import about from "./about";
import searchHints from "./searchHints";

export default {
  /** 分类导航名（桌面端左侧、移动端分类面板） */
  category: shell.category,
  /** 移动端分类面板的一行副标题 */
  categorySubtitle: shell.categorySubtitle,
  /** 页面外壳：标题、搜索框、空结果 */
  shell: shell.shell,

  general,
  shortcut,
  appearance,
  playback,
  plugins,
  data,
  experimental,
  about,

  /** 搜索索引的摘要（与卡片描述不同，见 searchHints.ts 顶部说明） */
  searchHints,
};
