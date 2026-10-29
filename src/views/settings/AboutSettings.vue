<script setup lang="ts">
import { computed } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore } from "@/stores/settings";
import { useUpdaterStore } from "@/stores/updater";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const updater = useUpdaterStore();

/** 当前版本号：启动时由 updater.init() 读取；未就绪时回退占位 */
const versionText = computed(() => updater.currentVersion || "—");

const busy = computed(
  () =>
    updater.phase === "checking" ||
    updater.phase === "downloading" ||
    updater.phase === "installing",
);

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

/** 检查更新：已发现新版本时打开确认弹窗，否则重新查询 */
function onCheckUpdate(): void {
  if (updater.hasUpdate) updater.openPrompt();
  else void updater.check();
}

function openReleases(): void {
  const url = updater.platform?.releasesUrl ?? "https://github.com/WinPlayer-dev/WinPlayer/releases";
  void openUrl(url);
}

function restoreIgnored(): void {
  void updater.forgetIgnoredVersion();
}
</script>

<template>
  <div>
    <!-- 关于 -->
    <section class="settings-section">
      <h2 class="settings-section-title">关于</h2>
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">WinPlayer</div>
          <div class="card-description">
            版本 {{ versionText }} · 基于插件的桌面音乐播放器 · MIT License
          </div>
        </div>
        <WpButton variant="standard" class="small" @click="openUrl('https://github.com/WinPlayer-dev/WinPlayer')">Github 页面</WpButton>
      </WpCard>

      <!-- 自动更新 -->
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

      <WpCard variant="column">
        <div class="card-content">
          <div class="card-header">第三方组件</div>
          <div class="card-description attribution">
            <p>
              主要依赖：Tauri（MIT / Apache-2.0）、Vue（MIT）。完整列表与协议信息见仓库中的
              THIRD_PARTY_NOTICES.md。
            </p>
          </div>
        </div>
      </WpCard>
    </section>
  </div>
</template>

<style scoped>
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

.attribution p {
  margin: 0 0 var(--space-md) 0;
}

.attribution p:last-child {
  margin-bottom: 0;
}
</style>
