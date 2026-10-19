# WinPlayer 主题开发指南

主题是一套**外观扩展包**：可以换配色、圆角、字体、动效，可以铺壁纸、加噪点，
也可以直接重写标题栏 / 侧边栏 / 播放条 / 媒体卡片 / 空状态 / 页面骨架这些界面组件。

主题与插件是两套独立机制：

| | 插件 | 主题 |
| --- | --- | --- |
| 作用 | 提供音乐来源（搜索、直链、歌词…） | 改变界面外观与布局 |
| 运行位置 | Web Worker 沙箱 | 主渲染进程（组件主题） |
| 文件格式 | `.zip` / 单文件 `.json` | `.zip` |
| 市场索引 | `market-index.json` | `theme-index.json` |

---

## 1. 主题包结构

主题包是一个 zip，根目录（或唯一的顶层目录）必须包含 `theme.json`：

```
my-theme.zip
├── theme.json            # 清单（必需）
├── theme.css             # 全局样式（可选，由 theme.json 的 css 指向）
├── preview.png           # 市场/设置页预览图（可选）
├── assets/               # 壁纸、字体、图片（可选）
│   └── wallpaper.jpg
└── components/           # 组件覆盖（可选）
    ├── PageShell.vue
    └── PlayerBar.vue
```

开发时也可以直接选目录安装（Rust 端会复制到应用数据目录），改完重新安装即可。

---

## 2. theme.json

```json
{
  "id": "com.example.midnight",
  "name": "Midnight",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "深蓝夜色，配极简播放条",
  "author": "Your Name",
  "homepage": "https://example.com/midnight",
  "preview": "preview.png",
  "tags": ["dark", "minimal"],

  "tokens": {
    "light": { "--wp-accent": "#005fb8" },
    "dark": { "--wp-accent": "#4cc2ff", "--wp-base": "#0d1420" }
  },

  "density": {
    "radiusScale": 2,
    "scale": 1,
    "fontFamily": "\"Noto Sans SC\", sans-serif",
    "motionScale": 0.8
  },

  "appearance": {
    "wallpaper": "assets/wallpaper.jpg",
    "wallpaperBlur": 24,
    "wallpaperOpacity": 0.6,
    "translucentSurfaces": true,
    "noise": 0.04,
    "vignette": 0.35
  },

  "css": "theme.css",

  "components": {
    "PlayerBar": "components/PlayerBar.vue"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一 ID，仅允许 `[a-z0-9._-]`，用于安装目录与去重 |
| `name` | string | 显示名称 |
| `version` | string | 语义化版本；市场用它判断「可更新」 |
| `apiVersion` | number | 主题协议版本，当前为 `1` |
| `preview` | string | 预览图，支持包内相对路径或远程 URL |
| `tags` | string[] | 市场筛选标签 |
| `tokens` | object | 深浅两套设计令牌，见第 3 节 |
| `density` | object | 圆角 / 间距 / 字体 / 动效的倍数覆盖，见第 3 节 |
| `appearance` | object | 壁纸与环境层，见第 4 节 |
| `css` | string | 全局 CSS 文件（包内相对路径） |
| `components` | object | 组件覆盖表，见第 5 节 |
| `variables` | object | 不区分深浅、直接写到 `:root` 的额外 CSS 变量 |

---

## 3. 设计令牌与密度

### 3.1 tokens

`tokens.light` / `tokens.dark` 是两个**独立**的令牌集合，分别作用于
`<html data-theme="light">` 与 `<html data-theme="dark">`。用户在设置里切换
「跟随系统 / 浅色 / 深色」时，主题会自动跟随，不需要主题自己处理。

键名即 CSS 变量名，`--wp-` 前缀可省略：

```json
"tokens": {
  "dark": {
    "accent": "#4cc2ff",
    "--wp-base": "#0d1420",
    "--wp-text-primary": "#e8eef6"
  }
}
```

常用令牌（完整清单见 `src/styles/tokens.css`）：

| 分组 | 令牌 |
| --- | --- |
| 强调色 | `--wp-accent` `--wp-accent-hover` `--wp-accent-active` `--wp-accent-light` `--wp-accent-text` |
| 背景层级 | `--wp-base` `--wp-layer` `--wp-layer-solid` `--wp-card` `--wp-card-hover` `--wp-flyout` |
| 控件 | `--wp-control-fill` `--wp-control-stroke` `--wp-control-solid` `--wp-subtle-secondary` |
| 文本 | `--wp-text-primary` `--wp-text-secondary` `--wp-text-tertiary` `--wp-text-on-accent` |
| 状态 | `--wp-danger` `--wp-success` `--wp-warning` |
| 圆角 | `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` |
| 阴影 | `--shadow-card` `--shadow-flyout` |

### 3.2 density

`density` 用**相对倍数**描述手感，宿主按内置基准值换算成绝对值：

| 字段 | 范围 | 作用 |
| --- | --- | --- |
| `radiusScale` | 0–3 | 全局圆角缩放（`2` = 圆角翻倍） |
| `scale` | 0.75–1.5 | 间距与标题栏 / 侧边栏 / 播放条尺寸 |
| `compact` | boolean | 紧凑列表行（额外压缩行高与控件高度） |
| `fontFamily` | string | 全局字体（CSS font-family 值） |
| `fontDisplay` | string | 标题字体（缺省同 `fontFamily`） |
| `fontScale` | 0.9–1.2 | 正文字号缩放 |
| `motionScale` | 0.5–2 | 动效时长倍数（越大越慢，`0` = 关闭动画） |
| `easing` | string | 全局缓动曲线（CSS timing-function） |

用户若在「设置 → 样式」里手动填了全局字体，主题的 `fontFamily` 会覆盖它。

---

## 4. 背景与环境层（appearance）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `wallpaper` | string | 壁纸：包内相对路径（`assets/bg.jpg`）、远程 URL 或 data URI |
| `wallpaperBlur` | number | 模糊半径（px，0–80） |
| `wallpaperOpacity` | number | 不透明度（0–1） |
| `wallpaperBlend` | string | 与底色的混合模式（`normal` / `overlay` / `luminosity` …） |
| `wallpaperSize` | string | `cover`（默认）/ `contain` / `auto` |
| `noise` | number | 噪点强度（0–1），用内联 SVG 生成，不额外请求资源 |
| `vignette` | number | 暗角强度（0–1） |
| `overlay` | string | 覆盖全屏的颜色层，可写 `linear-gradient(...)` |
| `translucentSurfaces` | boolean | 是否让内容层半透明以透出壁纸（默认 `true`） |
| `transparentBackground` | boolean | 窗口背景是否透明（默认 `true`） |

包内资源会自动解析为 `themeasset://<主题 id>/<相对路径>`，在主题组件里可以写：

```js
import { asset } from "@theme/host";
const wallpaper = asset("assets/bg.jpg");
```

---

## 5. 重写 Vue 组件

`components` 里的每个键对应一个宿主内置组件，值是包内的 `.vue` 文件路径。
可覆盖的键分两类：

### 5.0.1 界面骨架（6 个）

| 键 | 对应位置 | 典型改造 |
| --- | --- | --- |
| `PageShell` | 应用骨架（标题栏 + 导航 + 内容 + 播放条） | 换整体布局、加侧边栏抽屉 |
| `TitleBar` | 顶部标题栏 | 换搜索框样式、加按钮 |
| `SideNav` | 桌面端侧边导航 | 换导航组件、改歌单列表样式 |
| `PlayerBar` | 桌面端播放条 | 换播放控件、改成悬浮胶囊。**务必保留 `<QueuePanel />` / `<LyricsPanel />` / `<DownloadPanel />`**，并让播放条自身 `position: relative`（面板靠 absolute 锚定在它上方） |
| `MediaCard` | 歌单 / 专辑 / 歌手卡片 | 换卡片结构、加播放按钮 |
| `EmptyState` | 空状态占位 | 换插画、加引导操作 |

> 移动端（Android）的迷你播放条与底部导航**不在覆盖范围**内：它们紧贴系统手势区，
> 主题改它们很容易做出无法操作的界面。`PageShell` 可以整体接管移动端布局。

### 5.0.2 基础控件（7 个）

这七个键换掉的是**整个应用里所有对应的控件**——设置页、对话框、工具栏会一起变，
是「让主题看起来像另一套设计语言」最省力的方式：

| 键 | 契约 | 典型改造 |
| --- | --- | --- |
| `Button` | `variant: "accent" \| "standard"`、`size`、`danger`、`disabled`、默认插槽 | 换成 MD3 的 filled / tonal / outlined |
| `IconButton` | `active`、`disabled`、默认插槽放图标 | 换成 MD3 圆形图标按钮 |
| `TextBox` | `Text` / `PlaceholderText` / `MaxLength` / `IsReadOnly` / `IsEnabled`，`update:Text` | 换成 MD3 填充式输入框 |
| `ComboBox` | `ItemsSource` / `SelectedIndex` / `PlaceholderText`，`SelectionChanged(sender, { AddedItems: [label] })` | 换成 MD3 Select |
| `ToggleSwitch` | `IsOn` / `IsEnabled`，`Toggled({ IsOn })` | 换成 MD3 Switch |
| `Slider` | `Value` / `Minimum` / `Maximum` / `StepFrequency` / `Orientation`，`update:Value` | 换成 MD3 滑杆 |
| `NumberBox` | `Value` / `Minimum` / `Maximum` / `SmallChange`，`update:Value` | 换成 MD3 数字输入框 |

> **事件契约必须保持**：宿主按上表的形状取选中值 / 开关状态，
> 主题实现只要原样回传 payload 即可，不需要和宿主代码耦合。

### 5.0.3 容器与背景（2 个）

| 键 | 契约 | 典型改造 |
| --- | --- | --- |
| `Card` | `variant: "row" \| "column"`，默认插槽 | 换成 MD3 的 `<mdui-card>`；设置页、内容块会一起换 |
| `Background` | 无 props | 接管整个应用背景（可换成 MDUI 色板 / 渐变 / 图片） |

`Card` 覆盖后，**设置页里的每一张卡片**都会换成主题实现
（内置 MD3 主题用的就是 `<mdui-card variant="filled">`）。

`Background` 覆盖后，宿主会给 `<html>` 加上 `data-theme-background="custom"`，
并让 `.app-shell` / `body` 让出底色，因此主题可以完全自绘背景。
没有覆盖时渲染一个空节点，行为与原来完全一致（零影响）。

### 5.0.4 只想换形状？改令牌就够了

如果不需要替换结构，只改下面这些令牌就能把全局按钮与输入框改成另一种规格
（内置 Material You 主题就是这么做的）：

| 令牌 | 作用 |
| --- | --- |
| `--control-height` / `--control-height-sm` | 按钮高度（默认 32px） |
| `--control-padding-x` / `--control-radius` / `--control-font-size` | 按钮内边距、圆角、字号 |
| `--control-icon-size` / `--button-icon-radius` | 图标按钮尺寸与圆角 |
| `--button-accent-bg[-hover/-active]` / `--button-accent-fg` | 主按钮配色 |
| `--button-standard-bg[-hover/-active]` / `--button-standard-border` / `--button-standard-fg` | 次按钮配色 |
| `--input-height` / `--input-radius` / `--input-padding-x` | 输入框尺寸与形状 |

### 5.0.5 出错会怎样

主题组件在**渲染期**抛错时，宿主只把这个组件回退成内置实现并提示一次，
其余界面继续正常工作——不会出现「点着点着整个界面失灵」的情况。
编译期的错误（语法错、模块不在白名单）则在设置页列出组件名与原因。

### 5.1 组件写法

主题组件就是普通的 Vue 单文件组件，支持 `<script setup>`、`<style scoped>`、
`defineProps` / `defineEmits` / `defineSlots` 等编译宏。

```vue
<template>
  <footer class="bar">
    <mdui-avatar :src="player.currentTrack?.cover || undefined" icon="music_note" />
    <span class="title">{{ title }}</span>
    <mdui-button-icon icon="play_arrow" @click="player.togglePlay()" />
  </footer>
</template>

<script setup>
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import { trackTitle } from "@/types/player";

const player = usePlayerStore();
const title = computed(() => (player.currentTrack ? trackTitle(player.currentTrack) : "未在播放"));
</script>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--playerbar-height);
  padding: 0 16px;
  background: var(--wp-card);
}
</style>
```

注意事项：

- **不支持 `lang="ts"`**：浏览器里没有类型擦除器，请用普通 JavaScript；
- 只支持 `export default` 或 `<script setup>`，不支持其它 export 语法；
- `import "./Other.vue"` 可以引用**同一主题包内**的组件（会被递归编译）；
- scoped 样式由编译器生成的 `data-v-*` 属性隔离，不会污染宿主样式。

### 5.2 可用模块（白名单）

`import` 只能命中下列模块，其它说明符会直接报错：

| 说明符 | 提供 |
| --- | --- |
| `vue` | Vue 全部导出（`ref` / `computed` / `onMounted` …） |
| `vue-router` | `useRouter` / `useRoute` / `RouterLink` … |
| `@/stores/player` | `usePlayerStore`（曲目、队列、播放控制） |
| `@/stores/library` | `useLibraryStore`（喜欢、本地歌单） |
| `@/stores/settings` | `useSettingsStore`（配色、字体、外观） |
| `@/stores/plugins` | `usePluginsStore`（插件来源、封面归一化） |
| `@/stores/downloads` | `useDownloadsStore`（离线下载） |
| `@/services/toast` | `toast()` |
| `@/services/contextMenu` | `openContextMenu` / `openContextMenuAt` |
| `@/types/player` | `formatTime` / `formatDuration` / `trackTitle` / `trackArtist` / `PLAY_MODE_LABEL` / `playModeIcon` / `PLAYBACK_RATES` / `formatRate` / `createQueueUid` |
| `@/types/theme` | `THEME_COMPONENT_LABELS` |
| `@tauri-apps/api/window` | `getCurrentWindow()`（主题接管骨架后需要自己实现窗口按钮） |
| `@/components/winui` | 宿主自研 WinUI 控件（`ComboBox` / `Slider` / `TextBox` …） |
| `@/components/common/CachedImage.vue` | 带磁盘缓存的图片组件 |
| `@/components/theme/WpCard.vue` | 卡片分发层（主题实现 Card 时可复用它的语义） |
| `@/components/layout/QueuePanel.vue` | 播放队列面板（重写 PlayerBar 时务必带上，否则队列按钮无反应） |
| `@/components/layout/LyricsPanel.vue` | 歌词面板（同上） |
| `@/components/layout/DownloadPanel.vue` | 离线下载面板（同上） |
| `@theme/base`（各 `*Base.vue`） | 内置实现的「原件」，可「包一层再改一点」，不会递归 |
| `@/composables/useIsMobile` | `useIsMobile` / `useIsWindows` |
| `@/composables/useLongPress` | `useLongPress` |
| `@theme/host` | `asset()` / `themeId()` / `scheme()` / `setScheme()` / `manifest()` |
| `@theme/ui` | 同上（语义化别名） |

需要复用宿主内置实现时，请导入 **Base 版本**（它们不含主题分发逻辑，因此不会递归）：

```js
import TitleBarBase from "@/components/layout/TitleBarBase.vue";
import TextBoxBase from "@/components/winui/TextBoxBase.vue";
```

`@theme/host` 示例：

```js
import { asset, scheme, setScheme } from "@theme/host";

const wallpaper = asset("assets/bg.jpg"); // → themeasset://…
const dark = scheme() === "dark";
setScheme(dark ? "light" : "dark");
```

---

## 6. 使用 MDUI 组件（Material Design 3）

主题里可以直接写 `<mdui-*>` 组件。宿主在**首次加载带组件的主题**时会自动：

1. 引入 `mdui/mdui.css`（MD3 设计令牌）；
2. 注册全部 MDUI 自定义元素；
3. 引入 Material Icons 字体（`<mdui-icon name="…">` 靠字体连字显示图标）。

### 6.1 图标

```html
<mdui-icon name="search"></mdui-icon>
<mdui-icon name="favorite--rounded"></mdui-icon>
```

`name` 是 **Material Icons 的图标名**（不是 Fluent 图标码点），
可用变体后缀：`--outlined` / `--rounded` / `--sharp` / `--two-tone`。
图标名可在 [Material Icons 搜索](https://www.mdui.org/zh-cn/docs/2/components/icon#search) 里查。

> **图标字体由宿主自动提供**：`<mdui-icon name="…">` 内部其实是一个
> `font-family: "Material Icons"` 的 span，靠字体**连字**把 `search` 渲染成图标。
> 宿主在加载带组件的主题时会一并引入该字体（`@fontsource/material-icons`，
> 本地打包、离线可用），因此主题作者**不需要**再引 Google Fonts 的 `<link>`。
> 若图标显示成了文字，说明主题组件没有被宿主加载（检查设置页的编译错误）。

> 宿主内置组件用的是 Fluent Icons 字体码点（`&#xE852;` 这类），二者互不通用。
> 主题组件请一律用 Material Icons 名；确实要复用宿主图标时，
> 在 `<mdui-button-icon>` 里放一个 `.wp-icon` 元素也能正常显示（见内置 MD3 主题的 IconButton）。

### 6.2 MD3 配色跟随

MDUI 用 `.mdui-theme-light` / `.mdui-theme-dark` 切换配色，而 WinPlayer 用
`<html data-theme>`。内置的 Material You 主题在 `theme.css` 里做了桥接：

```css
:root[data-theme="dark"] {
  --mdui-color-primary: var(--mdui-color-primary-dark);
  /* …其余颜色令牌同理 */
}
```

自己写 MDUI 主题时可以直接抄这段（见 `src/themes/md3/theme.css`）。

---

## 7. 发布到主题市场

主题市场的索引是一个 JSON（默认源：
`https://raw.githubusercontent.com/WinPlayer-dev/plugin-market/main/theme-index.json`）：

```json
{
  "name": "WinPlayer 官方主题市场",
  "themes": [
    {
      "id": "com.example.midnight",
      "name": "Midnight",
      "version": "1.0.0",
      "description": "深蓝夜色",
      "author": "Your Name",
      "preview": "previews/midnight.png",
      "url": "https://example.com/themes/midnight-1.0.0.zip",
      "homepage": "https://example.com/midnight",
      "tags": ["dark"]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 与 `theme.json` 的 `id` 一致，用于判断是否已安装 |
| `name` | ✅ | 展示名 |
| `url` | ✅ | 主题包 zip 直链（GitHub 系地址会自动走镜像） |
| `version` | 推荐 | 与本地版本比较，决定显示「安装」还是「更新」 |
| `preview` | 推荐 | 预览图，支持相对索引地址的相对路径 |
| `description` / `author` / `homepage` / `tags` | 可选 | 展示信息 |

示例见 [docs/theme-index.example.json](./theme-index.example.json)。

市场源可在「插件管理 → 主题 → 市场源」里增删；官方源固定存在、不可删除。
GitHub 镜像源（设置 → 插件）对主题索引、预览图和主题包下载都生效。

---

## 8. 安全模型

- **纯样式主题**（只有 tokens / css / appearance）：不执行任何代码，安装即用；
- **组件主题**（`components` 非空）：`.vue` 会在运行时编译并执行，权限等同于
  主界面。宿主会在首次启用时弹窗提示，用户确认后才加载；
- 主题**不能**访问文件系统、发起任意网络请求或调用原生命令：模块白名单里没有这些能力。
  但它仍能读到 store 里的数据（曲库、设置等），因此**只安装可信来源的主题**。

组件编译失败不会让整个主题失效：其余组件与令牌照常生效，设置页会列出失败原因。

---

## 9. 调试建议

1. 把主题目录直接「从本地安装」，改完重新安装即可（无需重启应用）；
2. 编译错误会在「设置 → 样式」的当前主题卡片里显示组件名与原因；
3. 组件运行时报错请打开 DevTools（`Ctrl+Shift+I`）查看控制台；
4. 内置的 Material You 主题（`src/themes/md3/`）是一个完整的参考实现，
   包含 6 个组件重写与 MD3 全局样式，可直接对照。
