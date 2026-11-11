<script setup lang="ts">
/**
 * 设置页「下载与离线」分类：
 * - 下载目录（桌面可选目录，移动端固定为应用私有目录）；
 * - 文件名模板（`/` 建子目录，附实时预览）；
 * - 下载内容（歌词 / 封面等元数据）。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { TextBox, ToggleSwitch } from "@/components/winui";
import { toast } from "@/services/toast";
import {
  DEFAULT_DOWNLOAD_NAME_TEMPLATE,
  DOWNLOAD_TEMPLATE_VARS,
  useSettingsStore,
} from "@/stores/settings";
import { useDownloadsStore } from "@/stores/downloads";
import { useIsMobile } from "@/composables/useIsMobile";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const downloads = useDownloadsStore();
const router = useRouter();
const isMobile = useIsMobile();
const { t } = useI18n();

/* ------------------------------ 下载目录 ------------------------------ */

/** 生效目录：自定义优先，否则平台默认 */
const resolvedDir = computed(() => downloads.resolvedDir || settings.downloadDir.trim());

async function chooseDir(): Promise<void> {
  try {
    const result = await open({
      directory: true,
      multiple: false,
      title: t("settings.data.download.dir.chooseDialogTitle"),
    });
    if (!result || Array.isArray(result)) return;
    await settings.setDownloadDir(result);
    toast(t("settings.data.download.dir.updated"), "success");
  } catch (error) {
    toast(t("settings.data.download.dir.chooseFailed", { error: String(error) }), "error");
  }
}

async function resetDir(): Promise<void> {
  await settings.setDownloadDir("");
  await downloads.ensureDefaultDir();
  toast(t("settings.data.download.dir.resetDone"), "success");
}

/* ------------------------------ 文件名模板 ------------------------------ */

/** 预览用示例变量 */
const SAMPLE_VARS: Record<string, string> = {
  name: t("settings.data.download.template.sample.name"),
  artist: t("settings.data.download.template.sample.artist"),
  album: t("settings.data.download.template.sample.album"),
  source: t("settings.data.download.template.sample.source"),
  id: "123456",
};

/** 与 Rust 侧一致的非法字符清洗 */
function sanitize(part: string): string {
  return part.replace(/[\\/:*?"<>|]/g, "").trim();
}

/** 展开模板后的示例文件名（含子目录） */
const previewName = computed(() => {
  const template = templateInput.value.trim() || DEFAULT_DOWNLOAD_NAME_TEMPLATE;
  let output = template;
  for (const [key, value] of Object.entries(SAMPLE_VARS)) {
    output = output.replaceAll(`{${key}}`, value);
  }
  output = output.replaceAll("{track}", SAMPLE_VARS.name);
  const parts = output
    .split("/")
    .map((part) => sanitize(part))
    .filter(Boolean);
  return `${parts.join(" / ") || SAMPLE_VARS.name}.mp3`;
});

/** 本地输入值：击键实时预览，防抖后落库 */
const templateInput = ref(settings.downloadNameTemplate);

let templateDebounce = 0;

watch(templateInput, (value) => {
  window.clearTimeout(templateDebounce);
  templateDebounce = window.setTimeout(() => void settings.setDownloadNameTemplate(value), 400);
});

// 其他入口（恢复默认）改动 store 时同步回输入框
watch(
  () => settings.downloadNameTemplate,
  (value) => {
    if (value !== templateInput.value) templateInput.value = value;
  },
);

function resetTemplate(): void {
  window.clearTimeout(templateDebounce);
  templateInput.value = DEFAULT_DOWNLOAD_NAME_TEMPLATE;
  void settings.setDownloadNameTemplate(DEFAULT_DOWNLOAD_NAME_TEMPLATE);
}

onBeforeUnmount(() => window.clearTimeout(templateDebounce));

/* ------------------------------ 内容开关 ------------------------------ */

function onWriteTagsToggle(event: { IsOn: boolean }): void {
  void settings.setDownloadWriteTags(Boolean(event?.IsOn));
}

function openOffline(): void {
  void router.push({ name: "offline" });
}
</script>

<template>
  <SettingsSection id="data-download" :title="t('settings.data.download.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.download.dir.title") }}</div>
        <div class="card-description">
          <template v-if="isMobile">
            {{ t("settings.data.download.dir.mobileBefore") }}<span class="dir-path">{{ resolvedDir }}</span>{{ t("settings.data.download.dir.mobileAfter") }}
          </template>
          <template v-else>
            {{ t("settings.data.download.dir.desktopBefore") }}<span class="dir-path">{{ resolvedDir }}</span>{{ t("settings.data.download.dir.desktopAfter") }}
          </template>
        </div>
      </div>
      <div v-if="!isMobile" class="dir-actions">
        <WpButton variant="standard" class="small" @click="chooseDir">
          <span class="wp-icon">&#xF42F;</span>{{ t("settings.data.download.dir.choose") }}
        </WpButton>
        <WpButton variant="standard"
          v-if="settings.downloadDir.trim()"
          class="small"
          @click="resetDir"
        >
          {{ t("common.action.restoreDefault") }}
        </WpButton>
      </div>
    </WpCard>

    <WpCard variant="column">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.download.template.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.download.template.beforeSlash") }}<code>/</code>{{ t("settings.data.download.template.afterSlash") }}<code>{artist}/{album}/{name}</code>{{ t("settings.data.download.template.afterExample") }}
        </div>
      </div>
      <div class="template-row">
        <TextBox
          class="template-input"
          :Text="templateInput"
          :PlaceholderText="DEFAULT_DOWNLOAD_NAME_TEMPLATE"
          @update:Text="(value: unknown) => (templateInput = String(value ?? ''))"
        />
        <WpButton variant="standard" class="small" @click="resetTemplate">
          {{ t("common.action.restoreDefault") }}
        </WpButton>
      </div>
      <div class="template-vars">
        <span class="vars-label">{{ t("settings.data.download.template.varsLabel") }}</span>
        <button
          v-for="variable in DOWNLOAD_TEMPLATE_VARS"
          :key="variable"
          class="var-chip"
          type="button"
          @click="templateInput = `${templateInput}${variable}`"
        >
          {{ variable }}
        </button>
      </div>
      <div class="template-preview">
        <span class="preview-label">{{ t("settings.data.download.template.previewLabel") }}</span>
        <span class="preview-value">{{ previewName }}</span>
      </div>
    </WpCard>

    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.download.writeTags.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.download.writeTags.beforeLrc") }}
          <code>.lrc</code>{{ t("settings.data.download.writeTags.afterLrc") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.downloadWriteTags" @Toggled="onWriteTagsToggle" />
    </WpCard>
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.download.offline.title") }}</div>
        <div class="card-description">{{ t("settings.data.download.offline.description") }}</div>
      </div>
      <WpButton variant="standard" class="small" @click="openOffline">
        <span class="wp-icon">&#xF151;</span>{{ t("common.action.open") }}
      </WpButton>
    </WpCard>
  </SettingsSection>
</template>

<style scoped>
.dir-path {
  color: var(--wp-text-primary);
  word-break: break-all;
}

.dir-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex: none;
}

.small {
  height: 28px;
  font-size: 12px;
  padding: 0 12px;
}

.template-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-md);
}

.template-input {
  flex: 1;
  min-width: 0;
}

.template-vars {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.vars-label {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.var-chip {
  border: 1px solid var(--wp-control-stroke);
  border-radius: 12px;
  background: var(--wp-card);
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 12px;
  padding: 2px 10px;
  cursor: pointer;
}

.var-chip:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.template-preview {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  margin-top: var(--space-md);
  font-size: 12px;
}

.preview-label {
  flex: none;
  color: var(--wp-text-secondary);
}

.preview-value {
  color: var(--wp-accent);
  word-break: break-all;
}

code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--wp-control-fill-secondary);
  font-size: 12px;
}

/* 移动端：模板输入整行，动作按钮换行 */
.settings-page.mobile .dir-actions,
.settings-page.mobile .template-row {
  flex: 1 1 100%;
  width: 100%;
  flex-wrap: wrap;
}

.settings-page.mobile .template-input {
  flex: 1 1 100%;
  width: 100%;
}
</style>
