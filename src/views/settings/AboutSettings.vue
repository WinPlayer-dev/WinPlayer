<script setup lang="ts">
/**
 * 设置 → 关于。
 *
 * 三段式：Hero（品牌展示）→ 更新 → 开源与致谢，页脚一行版权。
 * Hero 故意不走 WpCard：它是品牌展示块，需要精确控制居中、展示框与图标尺寸，
 * 而 WpCard 在装了覆写 Card 的主题后会被整体替换成主题的卡片实现。
 * 上色全部走 token（--wp-accent-light / --wp-card / --wp-control-stroke），
 * 所以换肤、亮暗主题切换时 Hero 会自己跟着变。
 */
import { computed, onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getTauriVersion } from "@tauri-apps/api/app";
import { useIsAndroid, useIsMobile, useIsWindows } from "@/composables/useIsMobile";
import { usePluginsStore } from "@/stores/plugins";
import { useSettingsStore } from "@/stores/settings";
import { useUpdaterStore } from "@/stores/updater";
import { toast } from "@/services/toast";
import AppMark from "@/components/brand/AppMark.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const REPO_URL = "https://github.com/WinPlayer-dev/WinPlayer";
const ISSUES_URL = `${REPO_URL}/issues`;
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;

const settings = useSettingsStore();
const updater = useUpdaterStore();
const plugins = usePluginsStore();
const isMobile = useIsMobile();
const isWindows = useIsWindows();
const isAndroid = useIsAndroid();

/** 当前版本号：启动时由 updater.init() 读取；未就绪时回退占位 */
const versionText = computed(() => updater.currentVersion || "—");

const busy = computed(
  () =>
    updater.phase === "checking" ||
    updater.phase === "downloading" ||
    updater.phase === "installing",
);

/** 运行平台（用于 Hero 的元信息）：优先 UA，其次 updater 上报的平台名 */
const osLabel = computed(() => {
  if (isAndroid) return "Android";
  if (isWindows) return "Windows";
  const platform = updater.platform?.platform ?? "";
  return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "";
});

/** 架构：Rust 侧上报的是 x86_64 / aarch64，这里换成常见的 x64 / arm64 写法 */
const archLabel = computed(() => {
  const arch = updater.platform?.arch ?? "";
  const alias: Record<string, string> = { x86_64: "x64", aarch64: "arm64", i686: "x86" };
  return alias[arch] ?? arch;
});

const platformLabel = computed(() =>
  [osLabel.value, archLabel.value].filter(Boolean).join(" · "),
);

/** Tauri 运行时版本：桌面端才有，浏览器预览里拿不到 */
const tauriVersion = ref("");

onMounted(async () => {
  // 函数内判断宿主，别写成模块级常量：注入时机可能晚于模块求值
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    tauriVersion.value = await getTauriVersion();
  } catch {
    tauriVersion.value = "";
  }
});

/** WebView 版本：从 UA 里取主版本号即可，完整版本号太长且没有参考价值 */
const webviewLabel = computed(() => {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/(\d+)/);
  if (edge) return `WebView2 ${edge[1]}`;
  const chrome = ua.match(/Chrome\/(\d+)/);
  if (chrome) return isAndroid ? `WebView ${chrome[1]}` : `Chromium ${chrome[1]}`;
  const webkit = ua.match(/Version\/(\d+).*Safari/);
  if (webkit) return `WebKit ${webkit[1]}`;
  return "";
});

/** 已安装插件数（内置源不计入，与「插件」页口径一致） */
const pluginCount = computed(() => String(plugins.installedRecords.length));

/** 「检查更新」按钮文案 */
const checkButtonText = computed(() => {
  if (updater.phase === "checking") return "检查中…";
  if (updater.phase === "downloading") return "正在下载…";
  if (updater.phase === "installing") return "正在安装…";
  if (updater.hasUpdate) return "查看更新";
  return "检查更新";
});

/** 更新状态说明 */
const updateStatusText = computed(() => {
  if (updater.phase === "checking") return "正在检查更新…";
  if (updater.phase === "downloading") return "正在下载最新版本…";
  if (updater.phase === "installing") return "正在安装更新，应用即将重启…";
  if (updater.phase === "error") return updater.error ?? "检查更新失败";

  if (updater.hasUpdate && updater.info) {
    const base = `发现新版本 ${updater.info.version}`;
    return updater.ignoredVersion
      ? `${base}（已忽略自动提示，可手动更新）`
      : base;
  }
  if (updater.unsupportedVersion) {
    const target = updater.platform
      ? `${updater.platform.platform}-${updater.platform.arch}`
      : "当前平台";
    return `发现新版本 ${updater.unsupportedVersion}，但该版本没有 ${target} 的安装包`;
  }
  if (updater.phase === "done") return "更新已完成";

  if (!updater.canAutoUpdate) {
    return "当前平台不支持自动更新，可前往 Release 页面手动下载";
  }
  if (settings.lastUpdateCheckAt) {
    const at = new Date(settings.lastUpdateCheckAt).toLocaleString();
    return `当前已是最新版本 · 上次检查：${at}`;
  }
  return "尚未检查更新";
});

/** 页脚年份取运行期时间，避免每年回来改一次 */
const year = new Date().getFullYear();

/** 检查更新：已发现新版本时打开确认弹窗，否则重新查询 */
function onCheckUpdate(): void {
  if (updater.hasUpdate) updater.openPrompt();
  else void updater.check();
}

function openReleases(): void {
  const url = updater.platform?.releasesUrl ?? `${REPO_URL}/releases`;
  void openUrl(url);
}

function openRepo(): void {
  void openUrl(REPO_URL);
}

function openIssues(): void {
  void openUrl(ISSUES_URL);
}

function openNotices(): void {
  void openUrl(NOTICES_URL);
}

/** 点版本号复制：反馈 issue 时最常被要求提供的就是这个 */
async function copyVersion(): Promise<void> {
  const text = `v${versionText.value}`;
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制 ${text}`, "success");
  } catch {
    toast("复制失败，请手动选择版本号", "error");
  }
}

function restoreIgnored(): void {
  void updater.forgetIgnoredVersion();
}
</script>

<template>
  <div class="about-settings" :class="{ mobile: isMobile }">
    <!-- 品牌展示：图标展示框 + 名称 + 版本/平台 + 入口 + 运行信息 -->
    <section class="settings-section">
      <div class="about-hero">
        <div class="hero-mark-wrap">
          <span class="hero-glow" aria-hidden="true" />
          <AppMark class="hero-mark" />
        </div>

        <h2 class="hero-name">WinPlayer</h2>
        <p class="hero-tagline">基于插件的桌面音乐播放器</p>

        <div class="hero-chips">
          <button
            class="hero-chip accent chip-action"
            type="button"
            title="点击复制版本号"
            @click="copyVersion"
          >
            v{{ versionText }}
          </button>
          <span v-if="platformLabel" class="hero-chip">{{ platformLabel }}</span>
          <span class="hero-chip">MIT License</span>
        </div>

        <div class="hero-actions">
          <WpButton @click="openRepo">Github 主页</WpButton>
          <WpButton variant="standard" @click="openIssues">反馈问题</WpButton>
        </div>

        <dl class="hero-specs">
          <div class="spec">
            <dt class="spec-label">Tauri</dt>
            <dd class="spec-value">{{ tauriVersion || "—" }}</dd>
          </div>
          <div class="spec">
            <dt class="spec-label">WebView</dt>
            <dd class="spec-value">{{ webviewLabel || "—" }}</dd>
          </div>
          <div class="spec">
            <dt class="spec-label">已装插件</dt>
            <dd class="spec-value">{{ pluginCount }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 自动更新 -->
    <section class="settings-section">
      <h2 class="settings-section-title">更新</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">软件更新</div>
          <div class="card-description">{{ updateStatusText }}</div>
          <div v-if="settings.ignoredUpdateVersion" class="ignored-row">
            <span>已忽略版本 {{ settings.ignoredUpdateVersion }} 的自动提示</span>
            <WpButton variant="standard" class="small" @click="restoreIgnored">恢复提示</WpButton>
          </div>
        </div>
        <div class="update-actions">
          <WpButton variant="standard" class="small" :disabled="busy" @click="onCheckUpdate">
            {{ checkButtonText }}
          </WpButton>
          <WpButton variant="standard" class="small" @click="openReleases">Release 页面</WpButton>
        </div>
      </WpCard>
    </section>

    <!-- 开源与致谢 -->
    <section class="settings-section">
      <h2 class="settings-section-title">开源与致谢</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">第三方组件</div>
          <div class="card-description attribution">
            主要依赖：Tauri（MIT / Apache-2.0）、Vue（MIT）。完整列表与协议信息见仓库中的
            THIRD_PARTY_NOTICES.md。
          </div>
        </div>
        <WpButton variant="standard" class="small notices-button" @click="openNotices">查看完整声明</WpButton>
      </WpCard>
    </section>

    <p class="about-footer">© {{ year }} WinPlayer · MIT License</p>
  </div>
</template>

<style scoped>
/* ============================== Hero ============================== */

.about-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 顶部一层强调色薄雾：只靠渐变底，不额外叠伪元素，避免盖住文字 */
  background:
    radial-gradient(120% 90% at 50% -10%, var(--wp-accent-light), transparent 62%),
    var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
  padding: var(--space-3xl) var(--space-2xl) 0;
  text-align: center;
  animation: hero-in 420ms var(--ease-decelerate) both;
}

/* 顶部 1px 高光线，让卡片有「浮起」的质感 */
.about-hero::after {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--wp-control-stroke-secondary), transparent);
  pointer-events: none;
}

/* 图标 + 后面的柔光；不加边框与底板，图标直接浮在卡片上 */
.hero-mark-wrap {
  position: relative;
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
}

.hero-glow {
  position: absolute;
  inset: -32px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--wp-accent-light), transparent 70%);
  pointer-events: none;
  transition: opacity var(--duration-slow) var(--ease-standard);
}

.hero-mark {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform var(--duration-slow) var(--ease-decelerate);
}

.about-hero:hover .hero-mark {
  transform: translateY(-1px) scale(1.02);
}

.hero-name {
  margin: var(--space-xl) 0 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.2;
  color: var(--wp-text-primary);
}

.hero-tagline {
  margin: var(--space-sm) 0 0;
  font-size: 13px;
  color: var(--wp-text-secondary);
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-md);
  margin-top: var(--space-lg);
}

.hero-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: 11px;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-secondary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

/* 版本号是这里唯一需要「跳出来」的信息，同时做成可点击复制 */
.hero-chip.accent {
  border-color: transparent;
  background: var(--wp-accent-light);
  color: var(--wp-accent);
  font-weight: 600;
}

.chip-action {
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.chip-action:hover {
  background: var(--wp-accent);
  color: var(--wp-text-on-accent);
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-lg);
  margin-top: var(--space-2xl);
}

/* 运行信息：贴着 Hero 底部的一条规格栏 */
.hero-specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-self: stretch;
  margin: var(--space-2xl) 0 0;
  padding: var(--space-lg) 0;
  border-top: 1px solid var(--wp-control-stroke);
}

.spec {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  min-width: 0;
}

.spec + .spec {
  border-left: 1px solid var(--wp-control-stroke);
}

.spec-label {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.spec-value {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  padding: 0 var(--space-md);
}

@keyframes hero-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 系统开启「减少动效」时不做入场与 hover 位移 */
@media (prefers-reduced-motion: reduce) {
  .about-hero {
    animation: none;
  }

  .hero-mark {
    transition: none;
  }

  .about-hero:hover .hero-mark {
    transform: none;
  }
}

/* ============================== 其它卡片与页脚 ============================== */

.update-actions {
  display: flex;
  gap: var(--space-md);
  flex: none;
}

.ignored-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-md);
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.attribution {
  margin: 0;
}

.about-footer {
  margin: 0;
  text-align: center;
  font-size: 11px;
  color: var(--wp-text-tertiary);
}
</style>
