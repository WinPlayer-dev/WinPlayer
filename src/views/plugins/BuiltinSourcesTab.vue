<script setup lang="ts">
/**
 * 内置播放源面板（播放源管理 → 内置播放源）。
 *
 * 每个内置源是一个「左边图标 + 说明 + 状态」的按钮，点击弹出该源的配置弹窗：
 * - 本地音乐：管理音乐文件夹、重新扫描、打开曲库；
 * - WebDAV：服务器地址 / 账号密码 / 起始目录，测试连接与保存并扫描。
 *
 * 弹窗内容刻意按源定制，不强行抽象成「通用配置表单」——两种源的可配置项
 * 差别太大（选目录 vs 填服务器），抽象反而会让用户多点几层。
 */

import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ContentDialog from "@/components/winui/ContentDialog.vue";
import TextBox from "@/components/winui/TextBox.vue";
import ToggleSwitch from "@/components/winui/ToggleSwitch.vue";
import WpButton from "@/components/theme/WpButton.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { BUILTIN_SOURCE_DEFS } from "@/services/builtinSources";
import { toast } from "@/services/toast";
import { usePluginsStore } from "@/stores/plugins";
import { LOCAL_MUSIC_SOURCE_ID, useLocalMusicStore } from "@/stores/localMusic";
import { WEBDAV_SOURCE_ID, useWebdavStore } from "@/stores/webdav";
import { useI18n } from "@/i18n";
import type { WebdavConfig } from "@/services/webdav";

const plugins = usePluginsStore();
const localMusic = useLocalMusicStore();
const webdav = useWebdavStore();
const router = useRouter();
const isMobile = useIsMobile();
const { t } = useI18n();

interface DialogRef {
  ShowAsync: () => Promise<string>;
}

const localDialogRef = ref<DialogRef | null>(null);
const webdavDialogRef = ref<DialogRef | null>(null);

/** 卡片数据：状态文案随扫描进度变化 */
onMounted(async () => {
  // 卡片上的计数来自两个 store 的索引：先读本地缓存（不发网络请求）
  if (!localMusic.loaded) await localMusic.load();
  if (!webdav.loaded) await webdav.load();
});

const cards = computed(() =>
  BUILTIN_SOURCE_DEFS.map((def) => {
    const stats = def.stats();
    const enabled = plugins.records.find((record) => record.entry.id === def.id)?.enabled ?? true;
    let summary = stats.summary;
    if (def.id === WEBDAV_SOURCE_ID && webdav.scanning) {
      summary = t("plugins.builtin.webdav.scanProgress", {
        dirs: webdav.progress.dirs,
        files: webdav.progress.files,
      });
    }
    return { def, stats, enabled, summary };
  }),
);

function isEnabled(id: string): boolean {
  return plugins.records.find((record) => record.entry.id === id)?.enabled ?? true;
}

function toggleSource(id: string, event: { IsOn: boolean }): void {
  void plugins.togglePlugin(id, Boolean(event?.IsOn));
}

async function openSource(id: string): Promise<void> {
  if (id === LOCAL_MUSIC_SOURCE_ID) {
    await localDialogRef.value?.ShowAsync();
    return;
  }
  if (id === WEBDAV_SOURCE_ID) {
    const dialog = webdavDialogRef.value;
    if (!dialog) return;
    draft.value = { ...webdav.config };
    draftError.value = "";
    testing.value = false;
    // ContentDialog 的按钮只会关闭弹窗并回传结果，保存动作放在这里做
    if ((await dialog.ShowAsync()) === "Primary") await saveWebdav();
  }
}

function openLibrary(id: string): void {
  void router.push({ name: "library", params: { source: id } });
}

/* ------------------------------ 本地音乐 ------------------------------ */

async function addLocalFolders(): Promise<void> {
  const added = await localMusic.addFolders();
  if (added) toast(t("plugins.builtin.local.foldersAdded", { count: added }), "success");
}

async function removeLocalFolder(folder: string): Promise<void> {
  await localMusic.removeFolder(folder);
  toast(t("plugins.builtin.local.folderRemoved"), "success");
}

async function rescanLocal(): Promise<void> {
  await localMusic.scan();
  if (!localMusic.scanning)
    toast(t("plugins.builtin.local.scanDone", { count: localMusic.trackCount }), "success");
}

/** 上次扫描时间的简短展示 */
function scanTimeText(timestamp: number): string {
  if (!timestamp) return t("plugins.builtin.local.neverScanned");
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay
    ? t("plugins.builtin.local.scannedToday", { time })
    : t("plugins.builtin.local.scannedDate", {
        month: date.getMonth() + 1,
        day: date.getDate(),
        time,
      });
}

/* ------------------------------ WebDAV ------------------------------ */

/** 弹窗里的编辑草稿（关闭弹窗不清空，方便「测试连接」后继续修改） */
const draft = ref<WebdavConfig>({ name: "", url: "", username: "", password: "", rootPath: "" });
const draftError = ref("");
const testing = ref(false);

function field(key: keyof WebdavConfig, value: unknown): void {
  draft.value = { ...draft.value, [key]: String(value ?? "") };
}

async function testWebdavConnection(): Promise<void> {
  if (!draft.value.url.trim()) {
    draftError.value = t("plugins.builtin.webdav.urlRequired");
    return;
  }
  testing.value = true;
  draftError.value = "";
  try {
    const ok = await webdav.testConnection(draft.value);
    if (ok) toast(t("plugins.builtin.webdav.testSuccess"), "success");
    else draftError.value = webdav.error || t("plugins.builtin.webdav.testFailed");
  } finally {
    testing.value = false;
  }
}

async function saveWebdav(): Promise<void> {
  if (!draft.value.url.trim()) {
    draftError.value = t("plugins.builtin.webdav.urlRequired");
    return;
  }
  await webdav.saveConfig(draft.value);
  // 保存后立即开扫（网络遍历可能较久，进度在卡片上展示）
  void webdav.scan();
  toast(t("plugins.builtin.webdav.saved"), "info");
}

/** 重新扫描当前已保存的配置 */
function rescanWebdav(): void {
  if (!webdav.configured) {
    toast(t("plugins.builtin.webdav.notConfigured"), "error");
    return;
  }
  void webdav.scan();
}
</script>

<template>
  <div class="builtin-panel" :class="{ mobile: isMobile }">
    <div class="builtin-list">
      <button
        v-for="card in cards"
        :key="card.def.id"
        class="builtin-item"
        :class="{ disabled: !card.enabled }"
        @click="openSource(card.def.id)"
      >
        <span class="builtin-icon" aria-hidden="true">
          <span class="wp-icon">{{ card.def.icon }}</span>
        </span>
        <span class="builtin-text">
          <span class="builtin-name">
            {{ card.def.name }}
            <span class="builtin-badge">{{ t("plugins.builtin.badge") }}</span>
            <span v-if="!card.enabled" class="builtin-off">{{
              t("plugins.builtin.disabled")
            }}</span>
          </span>
          <span class="builtin-desc">{{ card.def.description }}</span>
        </span>
        <span class="builtin-state">
          <span class="state-pill" :class="{ muted: !card.stats.configured }">{{ card.summary }}</span>
          <span class="chevron" aria-hidden="true"></span>
        </span>
      </button>
    </div>

    <div class="builtin-hint">
      {{ t("plugins.builtin.hint") }}
    </div>

    <!-- 本地音乐配置 -->
    <ContentDialog
      ref="localDialogRef"
      :Title="t('plugins.builtin.local.name')"
      :CloseButtonText="t('common.action.close')"
      DefaultButton="Close"
    >
      <div class="dlg">
        <div class="dlg-row">
          <div>
            <div class="dlg-label">{{ t("plugins.builtin.enableLabel") }}</div>
            <div class="dlg-sub">{{ t("plugins.builtin.local.disableHint") }}</div>
          </div>
          <ToggleSwitch
            :IsOn="isEnabled(LOCAL_MUSIC_SOURCE_ID)"
            @Toggled="toggleSource(LOCAL_MUSIC_SOURCE_ID, $event)"
          />
        </div>

        <div class="dlg-stats">
          {{ t("common.unit.track", { count: localMusic.trackCount }) }} ·
          {{ t("common.unit.album", { count: localMusic.albumCount }) }} ·
          {{ t("common.unit.artist", { count: localMusic.artistCount }) }} ·
          {{ scanTimeText(localMusic.lastScanAt) }}
        </div>

        <div class="dlg-block">
          <div class="dlg-block-head">
            <span>{{ t("plugins.builtin.local.foldersTitle") }}</span>
            <WpButton class="small" variant="standard" @click="addLocalFolders">{{
              t("plugins.builtin.local.addFolder")
            }}</WpButton>
          </div>
          <div v-if="localMusic.folders.length" class="folder-list">
            <div v-for="folder in localMusic.folders" :key="folder" class="folder-row">
              <span class="wp-icon folder-icon">&#xF419;</span>
              <span class="folder-path" :title="folder">{{ folder }}</span>
              <span class="folder-count">{{
                t("common.unit.track", { count: localMusic.folderCounts.get(folder) ?? 0 })
              }}</span>
              <button class="folder-remove" @click="removeLocalFolder(folder)">
                {{ t("common.action.remove") }}
              </button>
            </div>
          </div>
          <div v-else class="dlg-empty">
            {{ t("plugins.builtin.local.emptyFolders") }}
          </div>
        </div>

        <div class="dlg-actions">
          <WpButton class="small" variant="standard" :disabled="localMusic.scanning" @click="rescanLocal">
            {{ localMusic.scanning ? t("plugins.builtin.local.scanning") : t("plugins.builtin.local.rescan") }}
          </WpButton>
          <WpButton class="small" variant="standard" @click="openLibrary(LOCAL_MUSIC_SOURCE_ID)">
            {{ t("plugins.builtin.local.openLibrary") }}
          </WpButton>
        </div>

        <div class="dlg-hint">
          {{ t("plugins.builtin.local.formatHintLead") }} <code>.lrc</code>
          {{ t("plugins.builtin.local.formatHintPrefer") }} <code>.srt</code>
          {{ t("plugins.builtin.local.formatHintEmbedded") }}
        </div>
      </div>
    </ContentDialog>

    <!-- WebDAV 配置 -->
    <ContentDialog
      ref="webdavDialogRef"
      :Title="t('plugins.builtin.webdav.name')"
      :PrimaryButtonText="t('plugins.builtin.webdav.saveAndScan')"
      :CloseButtonText="t('common.action.close')"
      DefaultButton="Primary"
    >
      <div class="dlg">
        <div class="dlg-row">
          <div>
            <div class="dlg-label">{{ t("plugins.builtin.enableLabel") }}</div>
            <div class="dlg-sub">{{ t("plugins.builtin.webdav.disableHint") }}</div>
          </div>
          <ToggleSwitch
            :IsOn="isEnabled(WEBDAV_SOURCE_ID)"
            @Toggled="toggleSource(WEBDAV_SOURCE_ID, $event)"
          />
        </div>

        <label class="field">
          <span class="field-label">{{ t("plugins.builtin.webdav.url") }}</span>
          <TextBox
            :Text="draft.url"
            PlaceholderText="https://dav.example.com/dav"
            @update:Text="field('url', $event)"
          />
        </label>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">{{ t("plugins.builtin.webdav.username") }}</span>
            <TextBox
              :Text="draft.username"
              :PlaceholderText="t('plugins.builtin.webdav.usernamePlaceholder')"
              @update:Text="field('username', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ t("plugins.builtin.webdav.password") }}</span>
            <TextBox
              :Text="draft.password"
              :PlaceholderText="t('plugins.builtin.webdav.passwordPlaceholder')"
              InputType="password"
              @update:Text="field('password', $event)"
            />
          </label>
        </div>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">{{ t("plugins.builtin.webdav.rootPath") }}</span>
            <TextBox
              :Text="draft.rootPath"
              :PlaceholderText="t('plugins.builtin.webdav.rootPathPlaceholder')"
              @update:Text="field('rootPath', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ t("plugins.builtin.webdav.displayName") }}</span>
            <TextBox
              :Text="draft.name"
              :PlaceholderText="t('plugins.builtin.webdav.displayNamePlaceholder')"
              @update:Text="field('name', $event)"
            />
          </label>
        </div>

        <div class="dlg-actions">
          <WpButton class="small" variant="standard" :disabled="testing" @click="testWebdavConnection">
            {{ testing ? t("plugins.builtin.webdav.testing") : t("plugins.builtin.webdav.test") }}
          </WpButton>
          <WpButton class="small" variant="standard" :disabled="!webdav.configured" @click="rescanWebdav">
            {{ t("plugins.builtin.local.rescan") }}
          </WpButton>
          <WpButton
            class="small"
            variant="standard"
            :disabled="!webdav.configured"
            @click="openLibrary(WEBDAV_SOURCE_ID)"
          >
            {{ t("plugins.builtin.local.openLibrary") }}
          </WpButton>
        </div>

        <div v-if="draftError" class="dlg-error">{{ draftError }}</div>
        <div v-else-if="webdav.error" class="dlg-error">{{ webdav.error }}</div>
        <div v-else-if="webdav.scanning" class="dlg-progress">
          {{
            t("plugins.builtin.webdav.scanning", {
              dirs: webdav.progress.dirs,
              files: webdav.progress.files,
            })
          }}
        </div>
        <div v-else-if="webdav.configured" class="dlg-stats">
          {{ t("common.unit.track", { count: webdav.trackCount }) }} ·
          {{ t("common.unit.album", { count: webdav.albumCount }) }} ·
          {{ t("common.unit.artist", { count: webdav.artistCount }) }}
          <template v-if="webdav.lastScanAt">
            · {{ t("plugins.builtin.webdav.scannedAt", { time: scanTimeText(webdav.lastScanAt) }) }}</template>
        </div>

        <div class="dlg-hint">
          {{ t("plugins.builtin.webdav.hintLead") }} <code>cover.jpg</code>
          {{ t("plugins.builtin.webdav.hintCover") }} <code>.lrc</code> / <code>.srt</code>
          {{ t("plugins.builtin.webdav.hintLyrics") }}
        </div>
      </div>
    </ContentDialog>
  </div>
</template>

<style scoped>
.builtin-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* 一行一个源：左图标 + 说明 + 状态，整行可点 */
.builtin-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  width: 100%;
  padding: var(--space-lg) var(--space-xl);
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.builtin-item:hover {
  background: var(--wp-card-hover);
  border-color: var(--wp-accent);
}

.builtin-item.disabled .builtin-text {
  opacity: 0.6;
}

/* 停用态图标同步降色（没有底色可去，只能靠颜色区分） */
.builtin-item.disabled .builtin-icon {
  color: var(--wp-text-tertiary);
}

/* 无底色：直接用 Fluent 图标字体，颜色跟随主题文字色（暗色主题下自动变白） */
.builtin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 固定列宽，保证图标与右侧文字的对齐（移动端 .builtin-state 的缩进也按此推算） */
  width: 44px;
  height: 44px;
  flex: none;
  color: var(--wp-text-primary);
}

.builtin-icon .wp-icon {
  font-size: 24px;
  color: inherit;
}

.builtin-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.builtin-name {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 14px;
  font-weight: 600;
  color: var(--wp-text-primary);
}

.builtin-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--wp-text-secondary);
  background: var(--wp-control-fill-secondary);
  border: 1px solid var(--wp-control-stroke);
}

.builtin-off {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.builtin-desc {
  font-size: 12px;
  color: var(--wp-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.builtin-state {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex: none;
}

.state-pill {
  font-size: 12px;
  color: var(--wp-text-secondary);
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--wp-control-fill-secondary);
}

.state-pill.muted {
  color: var(--wp-text-tertiary);
}

/* 用 CSS 画箭头：图标字体各版本码位有漂移，这里不依赖字体 */
.chevron {
  width: 7px;
  height: 7px;
  border-top: 1.5px solid var(--wp-text-tertiary);
  border-right: 1.5px solid var(--wp-text-tertiary);
  transform: rotate(45deg);
  flex: none;
}

.builtin-hint {
  margin-top: var(--space-lg);
  font-size: 12px;
  color: var(--wp-text-tertiary);
  line-height: 1.6;
}

/* ------------------------------ 弹窗内容 ------------------------------ */

.dlg {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  width: 100%;
}

.dlg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
}

.dlg-label {
  font-size: 13px;
  color: var(--wp-text-primary);
}

.dlg-sub {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  margin-top: 2px;
}

.dlg-stats {
  font-size: 12px;
  color: var(--wp-text-secondary);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
}

.dlg-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.dlg-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--wp-text-primary);
}

.folder-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folder-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
  font-size: 12px;
}

.folder-icon {
  font-size: 15px;
  color: var(--wp-text-secondary);
  flex: none;
}

.folder-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  color: var(--wp-text-tertiary);
  flex: none;
}

.folder-remove {
  flex: none;
  border: none;
  background: transparent;
  color: var(--wp-text-tertiary);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.folder-remove:hover {
  color: var(--wp-danger);
  background: var(--wp-card-hover);
}

.dlg-empty {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill-secondary);
}

.dlg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.field-label {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.field-pair {
  display: flex;
  gap: var(--space-lg);
}

.dlg-error {
  font-size: 12px;
  color: var(--wp-danger);
  line-height: 1.5;
}

.dlg-progress {
  font-size: 12px;
  color: var(--wp-accent);
}

.dlg-hint {
  font-size: 11px;
  color: var(--wp-text-tertiary);
  line-height: 1.7;
}

.dlg-hint code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--wp-control-fill-secondary);
  font-size: 10px;
}

/* ------------------------------ 移动端 ------------------------------ */

.builtin-panel.mobile .builtin-item {
  align-items: flex-start;
  flex-wrap: wrap;
  padding: var(--space-md);
  gap: var(--space-md);
}

.builtin-panel.mobile .builtin-desc {
  white-space: normal;
}

.builtin-panel.mobile .builtin-state {
  width: 100%;
  justify-content: space-between;
  padding-left: 56px;
}

.builtin-panel.mobile .dlg {
  width: 100%;
}

.builtin-panel.mobile .field-pair {
  flex-direction: column;
  gap: var(--space-md);
}

.builtin-panel.mobile .folder-row {
  flex-wrap: wrap;
  row-gap: 2px;
}

.builtin-panel.mobile .folder-path {
  flex: 1 1 100%;
  order: 3;
  white-space: normal;
  word-break: break-all;
}
</style>
