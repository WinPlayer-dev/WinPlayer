<script setup lang="ts">
/**
 * 主题市场（插件页第三个标签）。
 *
 * 与插件市场并列：同一个市场索引生态（theme-index.json），但主题是「宿主外观」，
 * 安装前会明确提示它是否包含可执行组件代码。
 *
 * 交互：
 * - 顶部：刷新、主题市场源设置入口、从本地安装；
 * - 已安装区：当前生效主题高亮，支持应用 / 卸载；
 * - 市场区：卡片列表，展示预览图、作者、来源市场、安装状态。
 */
import { computed, onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ContentDialog } from "@/components/winui";
import { useThemesStore } from "@/stores/themes";
import { useIsMobile } from "@/composables/useIsMobile";
import { toast } from "@/services/toast";
import WpButton from "@/components/theme/WpButton.vue";
import {
  THEME_COMPONENT_LABELS,
  type ThemeComponentKey,
  type ThemeEntry,
  type ThemeMarketEntry,
} from "@/types/theme";

const themes = useThemesStore();
const isMobile = useIsMobile();

/** ContentDialog 通过 ShowAsync() 打开 */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}

const confirmDialogRef = ref<DialogRef | null>(null);
const trustedDialogRef = ref<DialogRef | null>(null);
const sourceDialogRef = ref<DialogRef | null>(null);
const pendingThemeId = ref("");
const pendingTrustId = ref("");

/** 从本地安装（.zip 主题包） */
async function installFromFile(): Promise<void> {
  const ok = await themes.installFromDialog();
  if (!ok) return;
}

/** 点击安装 / 更新市场主题 */
async function installFromMarket(entry: ThemeMarketEntry): Promise<void> {
  if (installingId.value) return;
  installingId.value = entry.id;
  try {
    await themes.installFromUrl(entry.url);
  } finally {
    installingId.value = "";
  }
}

const installingId = ref("");

/** 应用主题；含可执行组件且未确认过时先弹安全提示 */
async function applyTheme(entry: ThemeEntry): Promise<void> {
  if (themes.activeId === entry.id) return;
  const needsTrust = themes.needsAcknowledgement(entry.id);
  if (needsTrust) {
    pendingTrustId.value = entry.id;
    const result = await trustedDialogRef.value?.ShowAsync();
    if (result !== "Primary") return;
    await themes.acknowledge(entry.id);
  }
  await themes.applyTheme(entry.id);
}

async function uninstall(entry: ThemeEntry): Promise<void> {
  pendingThemeId.value = entry.id;
  const result = await confirmDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  await themes.uninstall(entry.id);
}

/** 市场条目的安装状态 */
function marketStatus(entry: ThemeMarketEntry): "none" | "installed" | "updatable" {
  return themes.marketStatus(entry);
}

function isActive(id: string): boolean {
  return themes.activeId === id;
}

/** 主题覆盖了哪些内置组件（展示用） */
function componentSummary(entry: ThemeEntry): string {
  const keys = Object.keys(entry.manifest.components ?? {}) as ThemeComponentKey[];
  if (!keys.length) return "仅样式";
  return keys.map((key) => THEME_COMPONENT_LABELS[key]).join(" / ");
}

function supportsComponents(entry: ThemeEntry): boolean {
  return Object.keys(entry.manifest.components ?? {}).length > 0;
}

function openHomepage(url?: string): void {
  if (url) void openUrl(url);
}

/** 主题市场源设置（简版：列出 + 删除 + 新增） */
const newSourceName = ref("");
const newSourceUrl = ref("");

function addSource(): void {
  const url = newSourceUrl.value.trim();
  if (!url) {
    toast("请输入市场源地址", "error");
    return;
  }
  void themes.setMarketSources([
    ...themes.marketSources,
    { name: newSourceName.value.trim() || url, url },
  ]);
  newSourceName.value = "";
  newSourceUrl.value = "";
}

function removeSource(index: number): void {
  void themes.setMarketSources(themes.marketSources.filter((_, i) => i !== index));
}

async function openSourceDialog(): Promise<void> {
  await sourceDialogRef.value?.ShowAsync();
}

/** 已安装的第三方主题（内置主题来自应用包，不可卸载） */
const removableThemes = computed(() =>
  themes.installed.filter((entry) => Boolean(entry.path)),
);

async function refreshMarket(): Promise<void> {
  try {
    await themes.fetchMarketEntries();
  } catch (error) {
    toast(`加载主题市场失败：${error}`, "error");
  }
}

onMounted(async () => {
  if (!themes.loaded) await themes.loadInstalled();
  await themes.loadMarketSources();
  if (!themes.marketEntries.length) await refreshMarket();
});
</script>

<template>
  <div class="themes-tab" :class="{ mobile: isMobile }">
    <div class="theme-toolbar">
      <WpButton class="small" :disabled="themes.marketLoading" @click="refreshMarket" variant="standard">
        <span class="wp-icon">&#xF13E;</span>
        {{ themes.marketLoading ? "加载中…" : "刷新市场" }}
      </WpButton>
      <WpButton class="small" @click="installFromFile" variant="standard">
        <span class="wp-icon">&#xF42F;</span>从本地安装
      </WpButton>
      <WpButton class="small" @click="openSourceDialog" variant="standard">
        <span class="wp-icon">&#xF13D;</span>市场源
      </WpButton>
      <span class="toolbar-spacer" />
      <span class="theme-count">{{ themes.installed.length }} 个主题</span>
    </div>

    <!-- 已安装 -->
    <section class="theme-section">
      <h2 class="theme-section-title">已安装</h2>
      <div v-if="themes.applying" class="hint">正在应用主题…</div>
      <div v-if="!themes.installed.length && !themes.applying" class="hint">还没有安装任何主题</div>

      <div v-else class="installed-grid">
        <article
          v-for="entry in themes.installed"
          :key="entry.id"
          class="theme-card"
          :class="{ active: isActive(entry.id) }"
        >
          <div class="theme-preview">
            <img v-if="entry.manifest.preview" :src="themes.resolveAsset(entry.manifest.preview)" alt="" />
            <span v-else class="wp-icon preview-fallback">&#xF2F6;</span>
            <span v-if="isActive(entry.id)" class="active-badge">使用中</span>
            <span v-if="supportsComponents(entry)" class="component-badge">含组件</span>
          </div>
          <div class="theme-body">
            <div class="theme-title-row">
              <span class="theme-name">{{ entry.manifest.name }}</span>
              <span class="theme-version">v{{ entry.manifest.version }}</span>
            </div>
            <div class="theme-author">
              {{ entry.manifest.author || "未知作者" }}
              <template v-if="!entry.path"> · 内置</template>
            </div>
            <div class="theme-desc">{{ entry.manifest.description || "无简介" }}</div>
            <div class="theme-meta">{{ componentSummary(entry) }}</div>

            <div v-if="themes.activeId === entry.id && themes.lastError" class="theme-error">
              {{ themes.lastError }}
            </div>

            <div class="theme-actions">
              <WpButton
                v-if="!isActive(entry.id)" class="small"
                :disabled="themes.applying"
                @click="applyTheme(entry)"
               variant="accent">
                应用
              </WpButton>
              <WpButton
                v-else class="small"
                :disabled="themes.applying"
                @click="themes.applyTheme('')"
               variant="standard">
                恢复默认
              </WpButton>
              <WpButton
                v-if="entry.manifest.homepage" class="small"
                @click="openHomepage(entry.manifest.homepage)"
               variant="standard">
                主页
              </WpButton>
              <WpButton
                v-if="removableThemes.some((item) => item.id === entry.id)"
                variant="standard"
                class="small danger"
                @click="uninstall(entry)"
              >
                卸载
              </WpButton>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 市场 -->
    <section class="theme-section">
      <h2 class="theme-section-title">主题市场</h2>
      <div v-if="!themes.marketEntries.length" class="hint">
        {{ themes.marketLoading ? "正在加载市场索引…" : "市场索引为空或加载失败" }}
      </div>
      <div v-else class="market-grid">
        <article
          v-for="entry in themes.marketEntries"
          :key="entry.id + entry.url"
          class="theme-card"
        >
          <div class="theme-preview">
            <img v-if="entry.preview" :src="entry.preview" alt="" loading="lazy" />
            <span v-else class="wp-icon preview-fallback">&#xF2F6;</span>
            <span class="source-badge">{{ entry.sourceName }}</span>
          </div>
          <div class="theme-body">
            <div class="theme-title-row">
              <span class="theme-name">{{ entry.name }}</span>
              <span v-if="entry.version" class="theme-version">v{{ entry.version }}</span>
            </div>
            <div class="theme-author">{{ entry.author || "未知作者" }}</div>
            <div class="theme-desc">{{ entry.description || "无简介" }}</div>
            <div v-if="entry.tags?.length" class="theme-tags">
              <span v-for="tag in entry.tags" :key="tag" class="theme-tag">{{ tag }}</span>
            </div>
            <div class="theme-actions">
              <WpButton
                v-if="marketStatus(entry) === 'none'" class="small"
                :disabled="installingId === entry.id"
                @click="installFromMarket(entry)"
               variant="accent">
                {{ installingId === entry.id ? "安装中…" : "安装" }}
              </WpButton>
              <WpButton
                v-else-if="marketStatus(entry) === 'updatable'" class="small"
                :disabled="installingId === entry.id"
                @click="installFromMarket(entry)"
               variant="accent">
                {{ installingId === entry.id ? "更新中…" : "更新" }}
              </WpButton>
              <span v-else class="installed-hint">已安装</span>
              <WpButton
                v-if="entry.homepage" class="small"
                @click="openHomepage(entry.homepage)"
               variant="standard">
                来源
              </WpButton>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 安全提示：主题含可执行组件 -->
    <ContentDialog
      ref="trustedDialogRef"
      Title="该主题包含可执行代码"
      PrimaryButtonText="仍要启用"
      CloseButtonText="取消"
    >
      <div class="dialog-hint">
        这个主题重写了内置界面组件（Vue 单文件组件）。启用后，主题代码将以完整权限运行在主界面中，
        可以读取你的曲库、设置与登录凭证。请只启用你信任来源的主题。
      </div>
    </ContentDialog>

    <!-- 卸载确认 -->
    <ContentDialog
      ref="confirmDialogRef"
      Title="卸载主题"
      PrimaryButtonText="卸载"
      CloseButtonText="取消"
    >
      <div class="dialog-hint">卸载后主题文件会被删除，若正在使用会先切回默认外观。</div>
    </ContentDialog>

    <!-- 市场源管理 -->
    <ContentDialog ref="sourceDialogRef" Title="主题市场源" CloseButtonText="关闭">
      <div class="source-dialog">
        <ul class="source-list">
          <li v-for="source in themes.allMarketSources()" :key="source.url" class="source-item">
            <div class="source-info">
              <div class="source-name">
                {{ source.name }}
                <span v-if="!themes.marketSources.some((s) => s.url === source.url)" class="builtin-badge">
                  内置
                </span>
              </div>
              <div class="source-url ellipsis">{{ source.url }}</div>
            </div>
            <WpButton
              v-if="themes.marketSources.some((s) => s.url === source.url)"
              variant="standard"
              class="small danger"
              @click="removeSource(themes.marketSources.findIndex((s) => s.url === source.url))"
            >
              移除
            </WpButton>
          </li>
        </ul>

        <div class="source-add">
          <input v-model="newSourceName" class="wp-input" placeholder="名称（可选）" />
          <input v-model="newSourceUrl" class="wp-input grow" placeholder="https://example.com/theme-index.json" />
          <WpButton class="small" @click="addSource" variant="standard">添加</WpButton>
        </div>
      </div>
    </ContentDialog>
  </div>
</template>

<style scoped>
.themes-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xl);
}

/* ------------------------------ 工具栏 ------------------------------ */

.theme-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.toolbar-spacer {
  flex: 1;
}

.theme-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

/* ------------------------------ 分区 ------------------------------ */

.theme-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.theme-section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.hint {
  padding: var(--space-2xl);
  text-align: center;
  color: var(--wp-text-tertiary);
  font-size: 13px;
}

.installed-grid,
.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-lg);
}

/* ------------------------------ 卡片 ------------------------------ */

.theme-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-xl);
  background: var(--wp-card);
  overflow: hidden;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-normal) var(--ease-decelerate);
}

.theme-card:hover {
  border-color: var(--wp-accent);
  transform: translateY(-2px);
}

.theme-card.active {
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 1px var(--wp-accent) inset;
}

.theme-preview {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--wp-control-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.theme-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-fallback {
  font-size: 36px;
  color: var(--wp-text-tertiary);
}

.active-badge,
.component-badge,
.source-badge {
  position: absolute;
  top: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
}

.active-badge {
  left: 8px;
  background: var(--wp-accent);
  color: var(--wp-text-on-accent);
}

.component-badge {
  right: 8px;
  background: var(--wp-warning);
  color: var(--wp-base);
}

.source-badge {
  left: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.theme-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-lg);
}

.theme-title-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
}

.theme-name {
  font-size: 15px;
  font-weight: 600;
}

.theme-version {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.theme-author,
.theme-meta {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.theme-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--wp-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.theme-meta {
  margin-top: 4px;
  color: var(--wp-text-tertiary);
}

.theme-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.theme-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-subtle-secondary);
  font-size: 11px;
  color: var(--wp-text-secondary);
}

.theme-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--wp-danger);
}

.theme-actions {
  display: flex;
  gap: var(--space-md);
  margin-top: var(--space-md);
}

.installed-hint {
  font-size: 12px;
  color: var(--wp-text-tertiary);
  align-self: center;
}

/* ------------------------------ 市场源对话框 ------------------------------ */

.source-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  min-width: 420px;
}

.source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.source-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md);
  background: var(--wp-control-fill-secondary);
  border-radius: var(--radius-sm);
}

.source-info {
  flex: 1;
  min-width: 0;
}

.source-name {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  font-size: 13px;
}

.source-url {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.builtin-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--wp-accent-light);
  color: var(--wp-accent);
  font-size: 10px;
}

.source-add {
  display: flex;
  gap: var(--space-md);
}

.wp-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill);
  color: var(--wp-text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

.wp-input:focus {
  border-color: var(--wp-accent);
}

.grow {
  flex: 1;
  min-width: 0;
}

.dialog-hint {
  font-size: 13px;
  line-height: 1.6;
  color: var(--wp-text-secondary);
}

/* 移动端：卡片单列 */
.themes-tab.mobile .installed-grid,
.themes-tab.mobile .market-grid {
  grid-template-columns: 1fr;
}

.themes-tab.mobile .source-dialog {
  min-width: 0;
}
</style>
