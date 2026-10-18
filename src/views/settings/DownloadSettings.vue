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

const settings = useSettingsStore();
const downloads = useDownloadsStore();
const router = useRouter();
const isMobile = useIsMobile();

/* ------------------------------ 下载目录 ------------------------------ */

/** 生效目录：自定义优先，否则平台默认 */
const resolvedDir = computed(() => downloads.resolvedDir || settings.downloadDir.trim());

async function chooseDir(): Promise<void> {
  try {
    const result = await open({
      directory: true,
      multiple: false,
      title: "选择下载目录",
    });
    if (!result || Array.isArray(result)) return;
    await settings.setDownloadDir(result);
    toast("下载目录已更新，已下载的文件不会移动", "success");
  } catch (error) {
    toast(`选择目录失败: ${error}`, "error");
  }
}

async function resetDir(): Promise<void> {
  await settings.setDownloadDir("");
  await downloads.ensureDefaultDir();
  toast("已恢复默认下载目录", "success");
}

/* ------------------------------ 文件名模板 ------------------------------ */

/** 预览用示例变量 */
const SAMPLE_VARS: Record<string, string> = {
  name: "夜曲",
  artist: "周杰伦",
  album: "十一月的萧邦",
  source: "示例插件",
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

function onLyricsToggle(event: { IsOn: boolean }): void {
  void settings.setDownloadSaveLyrics(Boolean(event?.IsOn));
}

function onMetaToggle(event: { IsOn: boolean }): void {
  void settings.setDownloadSaveMeta(Boolean(event?.IsOn));
}

function openOffline(): void {
  void router.push({ name: "offline" });
}
</script>

<template>
  <div>
    <!-- 存储位置 -->
    <section class="settings-section">
      <h2 class="settings-section-title">存储位置</h2>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">下载目录</div>
          <div class="card-description">
            <template v-if="isMobile">
              移动端下载文件保存在应用私有目录（<span class="dir-path">{{ resolvedDir }}</span>），
              可在「离线音乐」页导出到公共目录。
            </template>
            <template v-else>
              下载的音频与歌词存放位置：<span class="dir-path">{{ resolvedDir }}</span>。
              修改目录不影响已下载的文件。
            </template>
          </div>
        </div>
        <div v-if="!isMobile" class="dir-actions">
          <button class="wp-standard-button small" @click="chooseDir">
            <span class="wp-icon">&#xF42F;</span>选择目录
          </button>
          <button
            v-if="settings.downloadDir.trim()"
            class="wp-standard-button small"
            @click="resetDir"
          >
            恢复默认
          </button>
        </div>
      </div>
    </section>

    <!-- 文件名 -->
    <section class="settings-section">
      <h2 class="settings-section-title">文件名</h2>
      <div class="settings-card column">
        <div class="card-content">
          <div class="card-header">文件名模板</div>
          <div class="card-description">
            用变量组合下载文件的命名，用 <code>/</code> 可建立子目录（例如
            <code>{artist}/{album}/{name}</code>）。非法字符会被自动移除，同名文件自动加序号。
          </div>
        </div>
        <div class="template-row">
          <TextBox
            class="template-input"
            :Text="templateInput"
            :PlaceholderText="DEFAULT_DOWNLOAD_NAME_TEMPLATE"
            @update:Text="(value: unknown) => (templateInput = String(value ?? ''))"
          />
          <button class="wp-standard-button small" @click="resetTemplate">恢复默认</button>
        </div>
        <div class="template-vars">
          <span class="vars-label">可用变量</span>
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
          <span class="preview-label">预览</span>
          <span class="preview-value">{{ previewName }}</span>
        </div>
      </div>
    </section>

    <!-- 下载内容 -->
    <section class="settings-section">
      <h2 class="settings-section-title">下载内容</h2>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">同时保存歌词</div>
          <div class="card-description">
            下载时把歌词写入同名 <code>.lrc</code> 文件，离线播放时自动读取（不含翻译）。
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.downloadSaveLyrics" @Toggled="onLyricsToggle" />
      </div>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">缓存封面等元数据</div>
          <div class="card-description">
            下载时把封面写入图片缓存，供「离线音乐」列表在无网络时展示封面。
          </div>
        </div>
        <ToggleSwitch :IsOn="settings.downloadSaveMeta" @Toggled="onMetaToggle" />
      </div>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">离线音乐</div>
          <div class="card-description">查看已下载的曲库、导出文件或在文件夹中定位。</div>
        </div>
        <button class="wp-standard-button small" @click="openOffline">
          <span class="wp-icon">&#xF151;</span>打开
        </button>
      </div>
    </section>
  </div>
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
