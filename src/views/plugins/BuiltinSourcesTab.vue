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
import type { WebdavConfig } from "@/services/webdav";

const plugins = usePluginsStore();
const localMusic = useLocalMusicStore();
const webdav = useWebdavStore();
const router = useRouter();
const isMobile = useIsMobile();

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
      summary = `扫描中… ${webdav.progress.dirs} 个目录 / ${webdav.progress.files} 首`;
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
  if (added) toast(`已添加 ${added} 个文件夹`, "success");
}

async function removeLocalFolder(folder: string): Promise<void> {
  await localMusic.removeFolder(folder);
  toast("已移除文件夹及其曲库记录", "success");
}

async function rescanLocal(): Promise<void> {
  await localMusic.scan();
  if (!localMusic.scanning) toast(`扫描完成，共 ${localMusic.trackCount} 首`, "success");
}

/** 上次扫描时间的简短展示 */
function scanTimeText(timestamp: number): string {
  if (!timestamp) return "尚未扫描";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
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
    draftError.value = "请先填写服务器地址";
    return;
  }
  testing.value = true;
  draftError.value = "";
  try {
    const ok = await webdav.testConnection(draft.value);
    if (ok) toast("连接成功", "success");
    else draftError.value = webdav.error || "连接失败";
  } finally {
    testing.value = false;
  }
}

async function saveWebdav(): Promise<void> {
  if (!draft.value.url.trim()) {
    draftError.value = "请先填写服务器地址";
    return;
  }
  await webdav.saveConfig(draft.value);
  // 保存后立即开扫（网络遍历可能较久，进度在卡片上展示）
  void webdav.scan();
  toast("已保存，正在扫描远程目录…", "info");
}

/** 重新扫描当前已保存的配置 */
function rescanWebdav(): void {
  if (!webdav.configured) {
    toast("请先配置服务器地址", "error");
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
        <span class="builtin-icon" :style="{ background: card.def.accent }">
          <span class="wp-icon">{{ card.def.icon }}</span>
        </span>
        <span class="builtin-text">
          <span class="builtin-name">
            {{ card.def.name }}
            <span class="builtin-badge">内置</span>
            <span v-if="!card.enabled" class="builtin-off">已停用</span>
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
      内置播放源由应用自带，无需安装，也不会出现在「已安装的插件」里。点击卡片可以配置。
    </div>

    <!-- 本地音乐配置 -->
    <ContentDialog
      ref="localDialogRef"
      Title="本地音乐"
      CloseButtonText="关闭"
      DefaultButton="Close"
    >
      <div class="dlg">
        <div class="dlg-row">
          <div>
            <div class="dlg-label">启用此播放源</div>
            <div class="dlg-sub">停用后不会出现在搜索页与播放源下拉里</div>
          </div>
          <ToggleSwitch
            :IsOn="isEnabled(LOCAL_MUSIC_SOURCE_ID)"
            @Toggled="toggleSource(LOCAL_MUSIC_SOURCE_ID, $event)"
          />
        </div>

        <div class="dlg-stats">
          {{ localMusic.trackCount }} 首 · {{ localMusic.albumCount }} 张专辑 ·
          {{ localMusic.artistCount }} 位歌手 · {{ scanTimeText(localMusic.lastScanAt) }}
        </div>

        <div class="dlg-block">
          <div class="dlg-block-head">
            <span>音乐文件夹</span>
            <WpButton class="small" variant="standard" @click="addLocalFolders">添加文件夹</WpButton>
          </div>
          <div v-if="localMusic.folders.length" class="folder-list">
            <div v-for="folder in localMusic.folders" :key="folder" class="folder-row">
              <span class="wp-icon folder-icon">&#xF419;</span>
              <span class="folder-path" :title="folder">{{ folder }}</span>
              <span class="folder-count">{{ localMusic.folderCounts.get(folder) ?? 0 }} 首</span>
              <button class="folder-remove" @click="removeLocalFolder(folder)">移除</button>
            </div>
          </div>
          <div v-else class="dlg-empty">
            还没有添加文件夹。添加后会自动扫描其中的音频文件（含子文件夹）。
          </div>
        </div>

        <div class="dlg-actions">
          <WpButton class="small" variant="standard" :disabled="localMusic.scanning" @click="rescanLocal">
            {{ localMusic.scanning ? "扫描中…" : "重新扫描" }}
          </WpButton>
          <WpButton class="small" variant="standard" @click="openLibrary(LOCAL_MUSIC_SOURCE_ID)">
            打开曲库
          </WpButton>
        </div>

        <div class="dlg-hint">
          支持 mp3 / flac / m4a / aac / ogg / wav；同名 <code>.lrc</code> 优先，其次
          <code>.srt</code> 与内嵌歌词。
        </div>
      </div>
    </ContentDialog>

    <!-- WebDAV 配置 -->
    <ContentDialog
      ref="webdavDialogRef"
      Title="WebDAV"
      PrimaryButtonText="保存并扫描"
      CloseButtonText="关闭"
      DefaultButton="Primary"
    >
      <div class="dlg">
        <div class="dlg-row">
          <div>
            <div class="dlg-label">启用此播放源</div>
            <div class="dlg-sub">仅在配置完成后才会出现在搜索页与播放源下拉里</div>
          </div>
          <ToggleSwitch
            :IsOn="isEnabled(WEBDAV_SOURCE_ID)"
            @Toggled="toggleSource(WEBDAV_SOURCE_ID, $event)"
          />
        </div>

        <label class="field">
          <span class="field-label">服务器地址</span>
          <TextBox
            :Text="draft.url"
            PlaceholderText="https://dav.example.com/dav"
            @update:Text="field('url', $event)"
          />
        </label>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">用户名</span>
            <TextBox
              :Text="draft.username"
              PlaceholderText="留空表示匿名访问"
              @update:Text="field('username', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">密码</span>
            <TextBox
              :Text="draft.password"
              PlaceholderText="Basic Auth 密码"
              InputType="password"
              @update:Text="field('password', $event)"
            />
          </label>
        </div>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">起始目录（可选）</span>
            <TextBox
              :Text="draft.rootPath"
              PlaceholderText="如 Music，留空表示根目录"
              @update:Text="field('rootPath', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">显示名称（可选）</span>
            <TextBox
              :Text="draft.name"
              PlaceholderText="如我的网盘"
              @update:Text="field('name', $event)"
            />
          </label>
        </div>

        <div class="dlg-actions">
          <WpButton class="small" variant="standard" :disabled="testing" @click="testWebdavConnection">
            {{ testing ? "连接中…" : "测试连接" }}
          </WpButton>
          <WpButton class="small" variant="standard" :disabled="!webdav.configured" @click="rescanWebdav">
            重新扫描
          </WpButton>
          <WpButton
            class="small"
            variant="standard"
            :disabled="!webdav.configured"
            @click="openLibrary(WEBDAV_SOURCE_ID)"
          >
            打开曲库
          </WpButton>
        </div>

        <div v-if="draftError" class="dlg-error">{{ draftError }}</div>
        <div v-else-if="webdav.error" class="dlg-error">{{ webdav.error }}</div>
        <div v-else-if="webdav.scanning" class="dlg-progress">
          正在扫描：{{ webdav.progress.dirs }} 个目录，已发现 {{ webdav.progress.files }} 首
        </div>
        <div v-else-if="webdav.configured" class="dlg-stats">
          {{ webdav.trackCount }} 首 · {{ webdav.albumCount }} 张专辑 ·
          {{ webdav.artistCount }} 位歌手
          <template v-if="webdav.lastScanAt"> · {{ scanTimeText(webdav.lastScanAt) }}扫描</template>
        </div>

        <div class="dlg-hint">
          曲目信息按「文件夹 = 专辑、文件名 = 艺术家 - 标题」推断，同目录的
          <code>cover.jpg</code> 作封面、同名 <code>.lrc</code> / <code>.srt</code> 作歌词。
          服务器需要支持 WebDAV 的 PROPFIND 与 Range 请求（群晖、坚果云、Nextcloud 等均支持）。
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

.builtin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  flex: none;
  color: #fff;
}

.builtin-icon .wp-icon {
  font-size: 22px;
  color: #fff;
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
