<script setup lang="ts">
/**
 * 首次引导页（路由 /welcome，meta.bare 全屏裸页）。
 *
 * 两步：
 *  1. 开屏：LOGO + 欢迎语 + 「开始使用」
 *  2. 添加第一个播放源：直接展示插件市场列表（装完即完成），
 *     下方是整宽的「跳过」
 *
 * 完成（装好播放源 / 跳过）会写入 settings.onboardingDone，之后启动不再进入；
 * 设置 → 通用 的「重新查看新手引导」带 query.from=settings 进入，结束时回到设置页。
 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePluginsStore } from "@/stores/plugins";
import { useSettingsStore } from "@/stores/settings";
import WpButton from "@/components/theme/WpButton.vue";
import { toast } from "@/services/toast";
import type { MarketEntry } from "@/types/plugin";

const route = useRoute();
const router = useRouter();
const plugins = usePluginsStore();
const settings = useSettingsStore();

const step = ref<"intro" | "source">("intro");

/** 内嵌市场列表：进入第 2 步即默认展示，无需再点按钮展开 */
const marketLoading = ref(false);
const marketError = ref("");
const entries = ref<MarketEntry[]>([]);
/** 正在安装的条目（id + url，同一插件可能有多个来源） */
const installingId = ref("");
/** 安装成功后的短暂「已就绪」态，让用户看清结果再跳转 */
const installed = ref(false);

/** 从设置页进入：结束引导后回到「设置 → 通用」而不是首页 */
const fromSettings = computed(() => route.query.from === "settings");

/** 本地已安装记录（用于把已装的条目显示为「已安装」） */
const installedIds = computed(() => new Set(plugins.records.map((record) => record.entry.id)));

function entryKey(entry: MarketEntry): string {
  return `${entry.id}::${entry.url}`;
}

function goSource(): void {
  step.value = "source";
  // 列表默认就在页面上，进入第 2 步立刻拉取
  if (!entries.value.length) void loadMarket();
}

async function loadMarket(): Promise<void> {
  if (marketLoading.value) return;
  marketLoading.value = true;
  marketError.value = "";
  try {
    entries.value = await plugins.fetchMarketEntries();
    if (!entries.value.length) marketError.value = "市场索引为空，可在「插件市场」里从 URL 或本地安装";
  } catch (error) {
    marketError.value = error instanceof Error ? error.message : String(error);
  } finally {
    marketLoading.value = false;
  }
}

async function install(entry: MarketEntry): Promise<void> {
  if (installingId.value || installed.value) return;
  installingId.value = entryKey(entry);
  try {
    const ok = await plugins.installFromUrl(entry.url);
    if (!ok) return;
    // 装好即视为完成引导：给一帧成功反馈再进主界面
    installed.value = true;
    window.setTimeout(() => void finish(), 650);
  } finally {
    installingId.value = "";
  }
}

/** 结束引导：跳过与装好播放源共用一个出口 */
async function finish(): Promise<void> {
  try {
    await settings.setOnboardingDone(true);
  } catch (error) {
    // 写库失败不该把用户困在引导页
    console.warn("[welcome] 保存引导完成标记失败：", error);
    toast("引导状态保存失败，下次启动可能还会看到此页", "error");
  }
  if (fromSettings.value) {
    await router.replace({ name: "settings", query: { tab: "general" } });
  } else {
    await router.replace({ path: "/" });
  }
}

function retryMarket(): void {
  marketError.value = "";
  void loadMarket();
}
</script>

<template>
  <div class="welcome">
    <!-- 背景：底部两团强调色光晕，跟随主题色 -->
    <div class="welcome-glow glow-a" aria-hidden="true" />
    <div class="welcome-glow glow-b" aria-hidden="true" />

    <div class="welcome-stage">
      <!--
        两步都常驻、按当前步骤切显隐（而不是 v-if + <transition>）：
        步骤切换不依赖 transitionend / rAF，窗口被遮挡或后台节流时也不会卡在「离场中」，
        入场动画由 .stage-inner.on 上的 rise 动画承担。
      -->
      <section class="stage-inner intro" :class="{ on: step === 'intro' }">
        <div class="logo-wrap">
          <div class="logo-halo" aria-hidden="true" />
          <svg class="logo-mark" viewBox="0 0 1024 1024" role="img" aria-label="WinPlayer">
            <defs>
              <linearGradient id="wp-welcome-logo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="var(--wp-accent-hover)" />
                <stop offset="100%" stop-color="var(--wp-accent)" />
              </linearGradient>
              <mask id="wp-welcome-logo-mask">
                <polygon
                  points="285,270 285,755 700,512"
                  fill="#fff"
                  stroke="#fff"
                  stroke-width="120"
                  stroke-linejoin="round"
                />
                <line
                  x1="545"
                  y1="762"
                  x2="812"
                  y2="616"
                  stroke="#fff"
                  stroke-width="86"
                  stroke-linecap="round"
                />
                <rect x="330" y="406" width="92" height="92" rx="6" fill="#000" />
                <rect x="432" y="406" width="92" height="92" rx="6" fill="#000" />
                <rect x="330" y="508" width="92" height="92" rx="6" fill="#000" />
                <rect x="432" y="508" width="92" height="92" rx="6" fill="#000" />
              </mask>
            </defs>
            <rect
              width="1024"
              height="1024"
              fill="url(#wp-welcome-logo)"
              mask="url(#wp-welcome-logo-mask)"
            />
          </svg>
        </div>

        <h1 class="brand">WinPlayer</h1>
        <p class="lead">欢迎使用 WinPlayer</p>
        <p class="sub">
          一个由插件驱动的音乐播放器——音乐来自哪里、怎么播放，全都由你决定。
        </p>

        <WpButton class="primary-action" @click="goSource">
          开始使用<span class="arrow" aria-hidden="true">→</span>
        </WpButton>

        <div class="dots" aria-hidden="true">
          <span class="dot active" />
          <span class="dot" />
        </div>
        <p class="tiny-hint">只需装一个播放源插件，大约 1 分钟</p>
      </section>

      <!-- 第 2 步：添加第一个播放源 -->
      <section class="stage-inner source" :class="{ on: step === 'source' }">
        <span class="step-badge">第 2 步 · 共 2 步</span>
        <h2 class="source-title">添加你的第一个播放源</h2>
        <p class="source-desc">
          插件决定音乐从哪里来。装一个提供「播放直链」能力的插件，就能搜索、播放与下载。
        </p>

        <!-- 内嵌市场：默认展示，装好一个即完成引导 -->
        <div class="source-panel">
          <div class="panel-head">
            <span class="panel-title">{{ installed ? "已就绪" : "选择播放源" }}</span>
            <span class="panel-sub">
              {{ marketLoading ? "正在加载…" : installed ? "正在进入 WinPlayer…" : `${entries.length} 个可用插件` }}
            </span>
            <div class="panel-tools">
              <button class="ghost" type="button" :disabled="marketLoading" @click="loadMarket">
                刷新
              </button>
            </div>
          </div>

          <div v-if="marketLoading && !entries.length" class="panel-hint">正在获取插件市场索引…</div>

          <div v-else-if="marketError" class="panel-hint error">
            <span>加载插件市场失败：{{ marketError }}</span>
            <button class="ghost" type="button" @click="retryMarket">重试</button>
          </div>

          <div v-else class="source-list">
            <div
              v-for="entry in entries"
              :key="entryKey(entry)"
              class="source-row"
              :class="{ active: installingId === entryKey(entry), done: installedIds.has(entry.id) }"
            >
                <div class="source-thumb">
                  <img v-if="entry.banner" :src="entry.banner" alt="" loading="lazy" />
                  <!-- 无封面：用内联音符而不是图标字体，避免字体缺字时显示成方块 -->
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true" class="thumb-icon">
                    <path
                      d="M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0 0V6.8a1 1 0 0 1 .8-1l8.4-1.7a1 1 0 0 1 1.2 1v11.6a2.5 2.5 0 1 1-2.5-2.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <div class="source-info">
                  <div class="source-name-row">
                    <span class="source-name">{{ entry.name }}</span>
                    <span v-if="entry.version" class="source-version">v{{ entry.version }}</span>
                    <span v-if="entry.author" class="source-author">{{ entry.author }}</span>
                  </div>
                  <div class="source-meta">
                    <span class="source-desc-text">{{ entry.description || "无简介" }}</span>
                  </div>
                </div>
              <WpButton
                v-if="installedIds.has(entry.id)"
                size="small"
                variant="standard"
                :disabled="true"
              >
                已安装
              </WpButton>
              <WpButton
                v-else
                size="small"
                :disabled="Boolean(installingId) || installed"
                @click="install(entry)"
              >
                {{ installingId === entryKey(entry) ? "安装中…" : "安装" }}
              </WpButton>
            </div>
          </div>

          <p class="panel-foot">
            列表来自插件市场索引。需要从 URL 或本地文件安装？稍后可在「设置 → 插件」里完成。
          </p>
        </div>

        <!-- 跳过：整宽按钮，是这一步唯一的次级出口 -->
        <div class="source-actions">
          <WpButton class="skip-button" variant="standard" :disabled="installed" @click="finish">
            跳过
          </WpButton>
        </div>

        <p class="tiny-hint">也可以稍后在「设置 → 插件」里随时添加或更换播放源</p>
      </section>
    </div>

    <footer class="welcome-foot">
      <span>WinPlayer</span>
      <span class="foot-sep" aria-hidden="true">·</span>
      <span>MIT License</span>
    </footer>
  </div>
</template>

<style scoped>
.welcome {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ------------------------------ 背景光晕 ------------------------------ */

.welcome-glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(80px);
  opacity: 0.55;
  z-index: 0;
}

.glow-a {
  width: 520px;
  height: 520px;
  top: -180px;
  left: 50%;
  transform: translateX(-70%);
  background: radial-gradient(circle, var(--wp-accent-light), transparent 68%);
}

.glow-b {
  width: 420px;
  height: 420px;
  bottom: -200px;
  right: 8%;
  background: radial-gradient(circle, var(--wp-accent-light), transparent 70%);
}

/* ------------------------------ 舞台布局 ------------------------------ */

.welcome-stage {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow-y: auto;
  padding: var(--space-3xl) var(--space-2xl);
}

/* margin:auto 居中：内容超出一屏时也不会把顶部裁掉（justify-content:center 会） */
.stage-inner {
  display: none;
  margin: auto;
  width: 100%;
  max-width: 680px;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* 当前步骤：显示并播放一次入场动画（切换步骤时类名变化会重新触发动画） */
.stage-inner.on {
  display: flex;
  animation: rise 260ms var(--ease-decelerate) both;
}

/* ------------------------------ 第 1 步 ------------------------------ */

.logo-wrap {
  position: relative;
  width: 128px;
  height: 128px;
  display: grid;
  place-items: center;
  margin-bottom: var(--space-2xl);
}

.logo-halo {
  position: absolute;
  inset: -28px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--wp-accent-light), transparent 70%);
  animation: halo-in 700ms var(--ease-decelerate) both;
}

.logo-mark {
  position: relative;
  width: 100%;
  height: 100%;
  animation: logo-in 620ms var(--ease-decelerate) both;
}

.brand {
  margin: 0;
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -1px;
  line-height: 1.1;
  animation: rise 520ms var(--ease-decelerate) 80ms both;
}

.lead {
  margin: var(--space-lg) 0 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--wp-text-primary);
  animation: rise 520ms var(--ease-decelerate) 140ms both;
}

.sub {
  margin: var(--space-md) 0 0;
  max-width: 480px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wp-text-secondary);
  /* 避免最后一行只剩一两个字 */
  text-wrap: pretty;
  animation: rise 520ms var(--ease-decelerate) 200ms both;
}

.primary-action {
  /* 内置按钮是 inline-flex 且不居中内容：整宽时文字会贴在左边 */
  justify-content: center;
  margin-top: var(--space-2xl);
  height: 40px;
  padding: 0 28px;
  font-size: 14px;
  animation: rise 520ms var(--ease-decelerate) 260ms both;
}

.arrow {
  font-size: 15px;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.primary-action:hover .arrow {
  transform: translateX(3px);
}

.dots {
  display: flex;
  gap: var(--space-md);
  margin-top: var(--space-2xl);
  animation: rise 520ms var(--ease-decelerate) 320ms both;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  /* 未选中态用三级文字色降透明度：control-stroke 在浅色下几乎看不见 */
  background: var(--wp-text-tertiary);
  opacity: 0.45;
  transition:
    width var(--duration-normal) var(--ease-standard),
    background var(--duration-normal) var(--ease-standard),
    opacity var(--duration-normal) var(--ease-standard);
}

.dot.active {
  width: 18px;
  border-radius: 3px;
  background: var(--wp-accent);
  opacity: 1;
}

.tiny-hint {
  margin: var(--space-lg) 0 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
  animation: rise 520ms var(--ease-decelerate) 380ms both;
}

/* ------------------------------ 第 2 步 ------------------------------ */

.step-badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--wp-accent);
  background: var(--wp-accent-light);
  border-radius: 10px;
  padding: 3px 10px;
}

.source-title {
  margin: var(--space-lg) 0 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.5px;
}

.source-desc {
  margin: var(--space-md) 0 var(--space-2xl);
  max-width: 560px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wp-text-secondary);
  /* 避免末行只剩一两个字（如「曲。」单独成行） */
  text-wrap: pretty;
}

.source-actions {
  width: 100%;
  margin-top: var(--space-xl);
}

/* 跳过：这一步只剩它一个按钮，整宽铺满内容列 */
.skip-button {
  width: 100%;
  height: 40px;
  justify-content: center;
  font-size: 13px;
}

/* ------------------------------ 内嵌市场 ------------------------------ */

.source-panel {
  width: 100%;
  text-align: left;
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-xl);
  padding: var(--space-lg);
  animation: rise 260ms var(--ease-decelerate) both;
}

.panel-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  padding: 0 var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--wp-divider);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
}

.panel-sub {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.panel-tools {
  margin-left: auto;
  display: flex;
  gap: var(--space-sm);
}

.ghost {
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.ghost:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.ghost:disabled {
  color: var(--wp-text-disabled);
  cursor: default;
  background: transparent;
}

.panel-hint {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-sm);
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.panel-hint.error {
  color: var(--wp-danger);
  flex-wrap: wrap;
}

.source-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-sm) 0;
}

.source-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-sm);
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard);
}

.source-row:hover {
  background: var(--wp-card-hover);
}

/* 行内按钮用紧凑尺寸（WpButton 的 size="small" 只挂 class，全局没有对应规则） */
.source-row :deep(.wp-accent-button),
.source-row :deep(.wp-standard-button) {
  height: 28px;
  font-size: 12px;
  padding: 0 12px;
  flex: none;
}

.source-row.done {
  opacity: 0.72;
}

.source-thumb {
  width: 44px;
  height: 44px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: linear-gradient(135deg, var(--wp-accent-light), var(--wp-control-fill-secondary));
  color: var(--wp-text-tertiary);
  font-size: 20px;
}

.source-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-icon {
  width: 20px;
  height: 20px;
}

.source-info {
  flex: 1;
  min-width: 0;
}

.source-name-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  min-width: 0;
}

.source-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-version {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  flex: none;
}

.source-author {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-meta {
  margin-top: 2px;
  min-width: 0;
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.source-desc-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wp-text-tertiary);
}

.panel-foot {
  margin: 0;
  padding: var(--space-lg) var(--space-sm) var(--space-xs);
  border-top: 1px solid var(--wp-divider);
  font-size: 12px;
  color: var(--wp-text-tertiary);
  line-height: 1.5;
}

/* ------------------------------ 页脚 ------------------------------ */

.welcome-foot {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-md);
  padding: 0 var(--space-2xl) var(--space-xl);
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.foot-sep {
  opacity: 0.6;
}

/* ------------------------------ 动效 ------------------------------ */

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes logo-in {
  from {
    opacity: 0;
    transform: scale(0.86);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes halo-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stage-inner.on,
  .logo-mark,
  .logo-halo,
  .brand,
  .lead,
  .sub,
  .primary-action,
  .dots,
  .tiny-hint,
  .source-panel {
    animation: none;
  }
}

/* ------------------------------ 移动端 ------------------------------ */

@media (max-width: 520px) {
  .welcome-stage {
    padding: var(--space-xl) var(--space-lg);
  }

  .logo-wrap {
    width: 96px;
    height: 96px;
    margin-bottom: var(--space-xl);
  }

  .brand {
    font-size: 32px;
  }

  .source-title {
    font-size: 22px;
  }

  .source-desc {
    margin-bottom: var(--space-xl);
  }

  .primary-action {
    width: 100%;
    height: 44px;
    animation: none;
  }

  /* 市场列表变窄：行内只保留名称与安装按钮，简介折到第二行 */
  .source-list {
    max-height: 46vh;
  }

  .source-row {
    align-items: flex-start;
  }

  .source-meta {
    margin-top: 2px;
  }

  .source-desc-text {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .source-actions {
    width: 100%;
  }

  /* 移动端按钮都是整宽长条：文字必须居中（内置按钮默认靠左） */
  .skip-button {
    height: 44px;
    justify-content: center;
  }
}
</style>
