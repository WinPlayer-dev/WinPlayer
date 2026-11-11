# 为 WinPlayer 做贡献

感谢你对本项目的兴趣！🎉

## 开发流程

1. Fork 本仓库并克隆到本地
2. 确保环境已就绪（Node.js 20.19+、pnpm、Rust + MSVC 工具链）
3. 安装依赖并启动开发模式：

   ```bash
   pnpm install
   pnpm tauri dev
   ```

4. 创建分支进行开发：`git checkout -b feat/my-feature`
5. 提交更改并发起 Pull Request

## 代码规范

- 前端：Vue 3 `<script setup>` + TypeScript，组件文件使用 PascalCase 命名
- Rust：遵循 `rustfmt` 默认格式
- 提交信息使用简洁的英文或中文描述，建议采用 `类型: 描述` 格式（如 `feat: 新增播放队列拖拽排序`）

### 界面文案

**不要在模板或脚本里写中文界面文案**，一律走 i18n 词条：

```vue
<script setup lang="ts">
import { useI18n } from "@/i18n";
const { t } = useI18n();
</script>

<template>
  <button>{{ t("common.action.confirm") }}</button>
</template>
```

词条按域放在 `src/i18n/locales/zh-CN/`，key 写错会在 `pnpm typecheck` 时报错。
规范、命名、什么该翻什么不该翻见 [docs/I18N.md](docs/I18N.md)；
`pnpm i18n:scan` 可以列出还剩多少硬编码文案。

## 插件贡献

欢迎贡献示例插件（位于 `plugins/` 目录）！插件协议与开发指南见 [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md)。

## 行为准则

请保持友善与尊重，共同维护良好的社区氛围。
