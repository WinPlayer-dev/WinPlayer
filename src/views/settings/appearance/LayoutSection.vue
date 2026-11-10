<script setup lang="ts">
/**
 * 设置 → 外观 → 布局。
 *
 * 三张大卡片：上方是布局的迷你预览，下方是名称。预览用纯 CSS 画的示意图，
 * 不加载任何截图资源 —— 这样跟随主题配色、任意分辨率都不糊，也不会让设置页
 * 多出一堆图片请求。
 *
 * 只影响手机端（桌面端窗口宽、表头列多，套这套排版反而难用），
 * 因此整个分组在桌面端不渲染，由 AppearancePanel 控制。
 */
import { useSettingsStore, type SongListLayout } from "@/stores/settings";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();

interface LayoutOption {
  key: SongListLayout;
  name: string;
  hint: string;
}

/** 已有布局：卡片顺序即展示顺序 */
const OPTIONS: readonly LayoutOption[] = [
  { key: "default", name: "默认", hint: "封面与标题居中，列表平铺" },
  { key: "cloud", name: "云端", hint: "封面主色渐变头部，白色圆角面板包住列表" },
];

async function choose(key: SongListLayout): Promise<void> {
  if (settings.songListLayout === key) return;
  await settings.setSongListLayout(key);
}
</script>

<template>
  <SettingsSection id="appearance-layout" title="布局">
    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">歌曲列表布局</div>
        <div class="card-description">
          歌单、专辑、歌手、我的喜欢、本地音乐等列表页在手机端的排版方式；点一下立即生效，桌面端不受影响
        </div>
      </div>

      <div class="layout-grid">
        <button
          v-for="option in OPTIONS"
          :key="option.key"
          class="layout-card"
          :class="{ active: settings.songListLayout === option.key }"
          :title="option.hint"
          @click="choose(option.key)"
        >
          <!-- 预览：默认布局（居中封面 + 平铺列表） -->
          <span v-if="option.key === 'default'" class="preview preview-default">
            <span class="mini-cover" />
            <span class="mini-line w70" />
            <span class="mini-line w40 dim" />
            <span class="mini-rows">
              <span v-for="row in 3" :key="row" class="mini-row">
                <span class="mini-dot" />
                <span class="mini-bar" />
              </span>
            </span>
          </span>

          <!-- 预览：云端布局（渐变头部 + 白色圆角面板） -->
          <span v-else class="preview preview-cloud">
            <span class="cloud-head">
              <span class="cloud-avatar" />
              <span class="cloud-text">
                <span class="cloud-line w80" />
                <span class="cloud-line w50" />
              </span>
              <span class="cloud-pills">
                <span /><span /><span />
              </span>
            </span>
            <span class="cloud-panel">
              <span v-for="row in 3" :key="row" class="mini-row tall">
                <span class="mini-dot" />
                <span class="mini-bar" />
              </span>
            </span>
          </span>

          <span class="card-label">
            {{ option.name }}
            <span class="card-hint">{{ option.hint }}</span>
          </span>
          <span v-if="settings.songListLayout === option.key" class="card-check" aria-hidden="true">
            <span class="check-mark" />
          </span>
        </button>

        <!-- 空位：保持三列节奏，不做成可点按钮 -->
        <div class="layout-card placeholder" aria-hidden="true">
          <span class="preview preview-empty">
            <span class="plus-mark" />
          </span>
          <span class="card-label">
            敬请期待
            <span class="card-hint">后续布局会出现在这里</span>
          </span>
        </div>
      </div>
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
/* 三列大卡片：预览在上、名称在下 */
.layout-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-sm);
  width: 100%;
}

.layout-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: 6px;
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);
}

.layout-card:active {
  background: var(--wp-card-active);
}

.layout-card.active {
  border-color: var(--wp-accent);
  background: var(--wp-accent-light, rgba(0, 120, 212, 0.12));
}

.layout-card.placeholder {
  cursor: default;
  background: transparent;
  border-style: dashed;
  border-color: var(--wp-divider);
  border-width: 1px;
}

/* 预览框：竖屏比例，内部用 flex 画出迷你界面 */
.preview {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--wp-base-solid, var(--wp-base));
}

/* ---- 默认布局预览 ---- */
.preview-default {
  align-items: center;
  gap: 4px;
  padding: 10px 8px 6px;
}

.mini-cover {
  width: 38%;
  aspect-ratio: 1;
  border-radius: 5px;
  background: var(--wp-control-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--wp-divider);
}

.mini-line {
  height: 4px;
  border-radius: 2px;
  background: var(--wp-text-secondary);
  opacity: 0.5;
}

.mini-line.dim {
  opacity: 0.28;
}

.w70 {
  width: 70%;
}

.w40 {
  width: 40%;
}

.w80 {
  width: 80%;
}

.w50 {
  width: 50%;
}

.mini-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  margin-top: auto;
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mini-row.tall {
  gap: 6px;
}

.mini-dot {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--wp-control-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--wp-divider);
}

.mini-row.tall .mini-dot {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.mini-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--wp-text-secondary);
  opacity: 0.32;
}

/* ---- 云端布局预览 ---- */
.preview-cloud {
  background: var(--wp-base-solid, var(--wp-base));
}

.cloud-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  padding: 8px 6px 14px;
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--wp-accent) 82%, #ffffff),
    var(--wp-accent)
  );
}

.cloud-avatar {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
}

.cloud-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.cloud-line {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.9);
}

.cloud-line.w50 {
  background: rgba(255, 255, 255, 0.55);
}

.cloud-pills {
  grid-column: 1 / -1;
  display: flex;
  gap: 4px;
  margin-top: 5px;
}

.cloud-pills > span {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.26);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

/* 白色面板：负 margin 向上盖住渐变的底部圆角，和真实布局同一手法 */
.cloud-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  margin-top: -8px;
  padding: 8px 6px 0;
  border-radius: 8px 8px 0 0;
  background: var(--wp-base-solid, var(--wp-base));
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.16);
}

/* ---- 空位预览 ---- */
.preview-empty {
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--wp-text-tertiary);
  font-size: 18px;
  border-radius: var(--radius-sm);
}

/* ---- 卡片底部名称 ---- */
.card-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 2px 2px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.card-hint {
  font-size: 10px;
  font-weight: 400;
  line-height: 1.35;
  color: var(--wp-text-tertiary);
  /* 三列很窄，说明文字最多两行，避免卡片高度被拉得参差 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.card-check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--wp-accent);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 对勾用 CSS 画：.wp-icon 是 Fluent 字体，随手抄的码位很容易变成无关图标 */
.check-mark {
  width: 8px;
  height: 4px;
  margin-top: -2px;
  border-left: 1.6px solid currentColor;
  border-bottom: 1.6px solid currentColor;
  transform: rotate(-45deg);
}

/* 空位的加号同样用 CSS 画（两条线），不依赖字体码位 */
.plus-mark {
  position: relative;
  width: 16px;
  height: 16px;
  color: var(--wp-text-tertiary);
}

.plus-mark::before,
.plus-mark::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  background: currentColor;
  border-radius: 1px;
  transform: translate(-50%, -50%);
}

.plus-mark::before {
  width: 14px;
  height: 1.5px;
}

.plus-mark::after {
  width: 1.5px;
  height: 14px;
}
</style>
