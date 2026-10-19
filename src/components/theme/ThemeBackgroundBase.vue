<script setup lang="ts">
/**
 * 应用背景层的默认实现：什么都不画。
 *
 * 应用的底色一直由 `.app-shell { background: var(--wp-base) }` 提供，
 * 这里留空是为了让「主题接管背景」成为纯增量能力：
 * 没有主题（或主题不覆盖 Background）时，渲染结果与以前完全一致。
 *
 * 需要自定义背景的主题请覆盖 `components.Background`
 * （例如内置的 Material You 主题用 MDUI 色板绘制，见 src/themes/md3/components/Background.vue）。
 */
</script>

<template>
  <div class="theme-background-empty" aria-hidden="true" />
</template>

<style scoped>
.theme-background-empty {
  display: none;
}
</style>
