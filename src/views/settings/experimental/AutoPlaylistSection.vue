<script setup lang="ts">
/**
 * 设置 → 实验性 → 听完自动加歌单。
 *
 * 从原「实验性」大文件（786 行）里拆出来：主题已搬到「外观」，录音棚单独成组，
 * 这里只剩自动加歌单本身的配置与处理记录。
 */
import { computed, onMounted, ref, watch } from "vue";
import { ComboBox, TextBox, ToggleSwitch } from "@/components/winui";
import {
  useSettingsStore,
  AUTO_PLAYLIST_LANGUAGES,
  autoPlaylistTargetKey,
  type AutoPlaylistLanguage,
  type AutoPlaylistTarget,
} from "@/stores/settings";
import { useLibraryStore } from "@/stores/library";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/services/toast";
import { countProcessedTracks, resetProcessedTracks } from "@/services/autoPlaylist";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const library = useLibraryStore();
const plugins = usePluginsStore();
const { t } = useI18n();

/** 歌单下拉的「不添加」项：放在第 0 位，其余按本地歌单 → 平台歌单的顺序排 */
const NO_PLAYLIST_LABEL = computed(() => t("settings.experimental.autoPlaylist.options.noPlaylist"));

const MODE_LABELS = computed(() => [
  t("settings.experimental.autoPlaylist.options.mode.fixed"),
  t("settings.experimental.autoPlaylist.options.mode.auto"),
]);
/** 模板里直接用稳定引用，避免每次渲染都生成新数组导致下拉框重建 */
const modeOptions = computed(() => [...MODE_LABELS.value]);

/** 语种标签：与 AUTO_PLAYLIST_LANGUAGES 的 value 一一对应 */
const LANGUAGE_LABEL_KEYS = {
  english: "settings.experimental.autoPlaylist.options.languages.english",
  chinese: "settings.experimental.autoPlaylist.options.languages.chinese",
  japanese: "settings.experimental.autoPlaylist.options.languages.japanese",
  korean: "settings.experimental.autoPlaylist.options.languages.korean",
  other: "settings.experimental.autoPlaylist.options.languages.other",
} as const;

function languageLabel(language: AutoPlaylistLanguage): string {
  return t(LANGUAGE_LABEL_KEYS[language]);
}

/** 平台个人歌单（从各插件实时拉取，未登录 / 离线时为空） */
interface RemotePlaylistEntry {
  sourceId: string;
  sourceName: string;
  id: string;
  name: string;
}

const remotePlaylists = ref<RemotePlaylistEntry[]>([]);
const remoteLoading = ref(false);
const remoteError = ref("");

/**
 * 拉取平台歌单。
 *
 * 只在「听完自动加歌单」打开时调用：这要挨个问插件要歌单列表（网络请求），
 * 没开这个功能时没必要打扰平台。单个来源失败只提示，不影响其它来源与本地歌单。
 */
async function loadRemotePlaylists(): Promise<void> {
  if (remoteLoading.value) return;
  const capable = plugins.records.filter(
    (record) => record.enabled && plugins.hasCapability(record, "myPlaylists"),
  );
  if (!capable.length) {
    remotePlaylists.value = [];
    return;
  }
  remoteLoading.value = true;
  remoteError.value = "";
  try {
    const groups = await plugins.getUserPlaylistsAll();
    const list: RemotePlaylistEntry[] = [];
    const failures: string[] = [];
    for (const group of groups) {
      const sourceName = group.record.entry.manifest.name;
      if (group.error) {
        failures.push(sourceName);
        continue;
      }
      for (const item of group.result ?? []) {
        // 系统歌单（pinned，如「每日日推」）不接受手动添加，不列进选择器
        if (item.pinned) continue;
        list.push({
          sourceId: group.record.entry.id,
          sourceName,
          id: item.id,
          name: item.name,
        });
      }
    }
    remotePlaylists.value = list;
    if (failures.length) {
      remoteError.value = t("settings.experimental.autoPlaylist.loadFailed", {
        sources: failures.join(t("settings.experimental.autoPlaylist.listSeparator")),
      });
    }
  } catch (error) {
    remoteError.value = t("settings.experimental.autoPlaylist.platformLoadFailed", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    remoteLoading.value = false;
  }
}

/** 下拉项：标签 + 目标歌单（本地 / 平台） */
interface TargetOption {
  label: string;
  target: AutoPlaylistTarget | null;
}

/** 配置里当前选中的所有目标（用于把「已保存但暂时拉不到」的歌单也列出来） */
const selectedTargets = computed<AutoPlaylistTarget[]>(() => {
  const config = settings.autoPlaylist;
  return [
    config.fixedTarget,
    ...AUTO_PLAYLIST_LANGUAGES.map((item) => config.languageTargets[item]),
    config.vocaloidTarget,
  ].filter((target): target is AutoPlaylistTarget => Boolean(target));
});

/**
 * 歌单选项。
 *
 * ComboBox 只回传选中项的文字（不带 id），所以重名歌单要加序号区分。
 * 平台歌单额外带来源名前缀（「网易云 · 我喜欢的音乐」），跨平台同名也不会混。
 * 已保存但当前拉不到的目标（平台未登录 / 歌单被删）追加成「不可用」项，
 * 这样下拉框仍显示用户当初的选择，而不是看起来被清空。
 */
const targetOptions = computed<TargetOption[]>(() => {
  const options: TargetOption[] = [{ label: NO_PLAYLIST_LABEL.value, target: null }];
  const used = new Set<string>([NO_PLAYLIST_LABEL.value]);

  const add = (base: string, target: AutoPlaylistTarget): void => {
    let label = base;
    let index = 1;
    while (used.has(label)) {
      index += 1;
      label = `${base}（${index}）`;
    }
    used.add(label);
    options.push({ label, target });
  };

  for (const item of library.playlists) {
    add(item.name, { kind: "local", id: item.id, name: item.name });
  }
  for (const item of remotePlaylists.value) {
    add(`${item.sourceName} · ${item.name}`, {
      kind: "remote",
      sourceId: item.sourceId,
      id: item.id,
      name: item.name,
    });
  }

  const known = new Set(options.map((option) => autoPlaylistTargetKey(option.target)));
  for (const target of selectedTargets.value) {
    if (known.has(autoPlaylistTargetKey(target))) continue;
    known.add(autoPlaylistTargetKey(target));
    const fallback =
      target.name ||
      (target.kind === "remote"
        ? t("settings.experimental.autoPlaylist.options.remotePlaylist")
        : t("settings.experimental.autoPlaylist.options.deletedPlaylist"));
    add(t("settings.experimental.autoPlaylist.unavailable", { name: fallback }), target);
  }
  return options;
});

const playlistOptions = computed<string[]>(() => targetOptions.value.map((item) => item.label));

const modeIndex = computed(() => (settings.autoPlaylist.mode === "auto" ? 1 : 0));

/** 目标歌单 → 下拉下标（没选 / 找不到时回到「不添加」） */
function targetIndex(target: AutoPlaylistTarget | null): number {
  const key = autoPlaylistTargetKey(target);
  if (!key) return 0;
  const index = targetOptions.value.findIndex(
    (option) => autoPlaylistTargetKey(option.target) === key,
  );
  return index < 0 ? 0 : index;
}

/** 下拉事件里的标签 → 目标歌单 */
function targetOf(payload?: { AddedItems?: unknown[] }): AutoPlaylistTarget | null {
  const label = String(payload?.AddedItems?.[0] ?? "");
  return targetOptions.value.find((option) => option.label === label)?.target ?? null;
}

const processedCount = ref(0);

async function refreshProcessedCount(): Promise<void> {
  processedCount.value = await countProcessedTracks().catch(() => 0);
}

onMounted(() => {
  // 设置页可能先于曲库初始化打开：歌单为空时补一次读取
  if (!library.playlists.length) void library.loadPlaylists();
  void refreshProcessedCount();
  if (settings.autoPlaylist.enabled) void loadRemotePlaylists();
});

// 打开开关时才需要知道「已经处理过多少首」，平台歌单也在这时才拉
watch(
  () => settings.autoPlaylist.enabled,
  (enabled) => {
    if (!enabled) return;
    void refreshProcessedCount();
    void loadRemotePlaylists();
  },
);

/* ---------- Vocaloid 自定义关键词 ---------- */

/** 输入框内容：用户用逗号 / 顿号 / 分号 / 换行分隔，保存前统一拆开 */
const keywordDraft = ref(settings.autoPlaylist.vocaloidKeywords.join("，"));

function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(/[,，、;；\n\r]+/)) {
    const word = part.trim();
    if (!word) continue;
    const lower = word.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(word);
  }
  return result;
}

let keywordTimer: ReturnType<typeof setTimeout> | undefined;

/** 边输入边存（防抖）：不需要「保存」按钮，和这个页面的其它开关一致 */
function onKeywordsInput(value: unknown): void {
  keywordDraft.value = String(value ?? "");
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    void settings.setAutoPlaylist({ vocaloidKeywords: parseKeywords(keywordDraft.value) });
  }, 500);
}

// 配置加载完成 / 被别处改动时回填输入框；正在输入的内容与已保存一致就不动它
watch(
  () => settings.autoPlaylist.vocaloidKeywords,
  (keywords) => {
    const draft = parseKeywords(keywordDraft.value);
    if (draft.join("\u0000") === keywords.join("\u0000")) return;
    keywordDraft.value = keywords.join("，");
  },
);

function onAutoPlaylistToggle(event: { IsOn: boolean }): void {
  void settings.setAutoPlaylist({ enabled: Boolean(event?.IsOn) });
}

function onAutoPlaylistModeChange(
  _sender: unknown,
  payload?: { AddedItems?: unknown[] },
): void {
  const label = String(payload?.AddedItems?.[0] ?? "");
  void settings.setAutoPlaylist({ mode: label === MODE_LABELS.value[1] ? "auto" : "fixed" });
}

function onFixedTargetChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  void settings.setAutoPlaylist({ fixedTarget: targetOf(payload) });
}

function onVocaloidTargetChange(_sender: unknown, payload?: { AddedItems?: unknown[] }): void {
  void settings.setAutoPlaylist({ vocaloidTarget: targetOf(payload) });
}

function onLanguageTargetChange(
  language: AutoPlaylistLanguage,
  _sender: unknown,
  payload?: { AddedItems?: unknown[] },
): void {
  void settings.setAutoPlaylist({ languageTargets: { [language]: targetOf(payload) } });
}

async function onResetProcessed(): Promise<void> {
  await resetProcessedTracks();
  processedCount.value = 0;
  toast(t("settings.experimental.autoPlaylist.reset.done"), "info");
}
</script>

<template>
  <SettingsSection id="experimental-auto-playlist" :title="t('settings.experimental.autoPlaylist.section')">
    <WpCard variant="row">
      <div class="card-content">
        <div class="card-header">{{ t("settings.experimental.autoPlaylist.enabled.title") }}</div>
        <div class="card-description">
          {{ t("settings.experimental.autoPlaylist.enabled.description") }}
        </div>
      </div>
      <ToggleSwitch :IsOn="settings.autoPlaylist.enabled" @Toggled="onAutoPlaylistToggle" />
    </WpCard>

    <template v-if="settings.autoPlaylist.enabled">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.experimental.autoPlaylist.mode.title") }}</div>
          <div class="card-description">
            {{ t("settings.experimental.autoPlaylist.mode.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control mode-control"
          :ItemsSource="modeOptions"
          :SelectedIndex="modeIndex"
          @SelectionChanged="onAutoPlaylistModeChange"
        />
      </WpCard>

      <!-- 固定歌单 -->
      <WpCard v-if="settings.autoPlaylist.mode === 'fixed'" variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.experimental.autoPlaylist.target.title") }}</div>
          <div class="card-description">
            {{ t("settings.experimental.autoPlaylist.target.description") }}
          </div>
        </div>
        <ComboBox
          class="card-control"
          :ItemsSource="playlistOptions"
          :SelectedIndex="targetIndex(settings.autoPlaylist.fixedTarget)"
          @SelectionChanged="onFixedTargetChange"
        />
      </WpCard>

      <!-- 按语种 / 类型自动分类 -->
      <WpCard v-else variant="column">
        <div class="card-content">
          <div class="card-header">{{ t("settings.experimental.autoPlaylist.groups.title") }}</div>
          <div class="card-description">
            {{ t("settings.experimental.autoPlaylist.groups.description") }}
          </div>
        </div>

        <div class="auto-groups">
          <div class="auto-group">
            <div class="auto-group-title">{{ t("settings.experimental.autoPlaylist.groups.language") }}</div>
            <div
              v-for="item in AUTO_PLAYLIST_LANGUAGES"
              :key="item"
              class="auto-row"
            >
              <span class="auto-label">{{ languageLabel(item) }}</span>
              <ComboBox
                class="auto-select"
                :ItemsSource="playlistOptions"
                :SelectedIndex="targetIndex(settings.autoPlaylist.languageTargets[item])"
                @SelectionChanged="
                  (sender: unknown, payload: { AddedItems: unknown[] }) =>
                    onLanguageTargetChange(item, sender, payload)
                "
              />
            </div>
          </div>

          <div class="auto-group">
            <div class="auto-group-title">{{ t("settings.experimental.autoPlaylist.groups.type") }}</div>
            <div class="auto-row">
              <span class="auto-label">Vocaloid</span>
              <ComboBox
                class="auto-select"
                :ItemsSource="playlistOptions"
                :SelectedIndex="targetIndex(settings.autoPlaylist.vocaloidTarget)"
                @SelectionChanged="onVocaloidTargetChange"
              />
            </div>
          </div>
        </div>
      </WpCard>

      <!-- Vocaloid 自定义关键词：补内置词表漏掉的新声库 / P 主写法 -->
      <WpCard v-if="settings.autoPlaylist.mode === 'auto'" variant="column">
        <div class="card-content">
          <div class="card-header">{{ t("settings.experimental.autoPlaylist.keywords.title") }}</div>
          <div class="card-description">
            {{ t("settings.experimental.autoPlaylist.keywords.description") }}
          </div>
        </div>
        <TextBox
          class="keyword-input"
          :Text="keywordDraft"
          :PlaceholderText="t('settings.experimental.autoPlaylist.keywords.placeholder')"
          :MaxLength="600"
          @update:Text="onKeywordsInput"
        />
        <div class="keyword-summary">
          {{
            t("settings.experimental.autoPlaylist.keywords.saved", {
              count: settings.autoPlaylist.vocaloidKeywords.length,
            })
          }}
          <span class="keyword-tip">{{ t("settings.experimental.autoPlaylist.keywords.tip") }}</span>
        </div>
      </WpCard>

      <!-- 处理记录：清空后听完的歌会重新判定 -->
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.experimental.autoPlaylist.reset.title") }}</div>
          <div class="card-description">
            {{
              t("settings.experimental.autoPlaylist.reset.description", { count: processedCount })
            }}
          </div>
        </div>
        <WpButton class="small" variant="standard" @click="onResetProcessed">
          {{ t("settings.experimental.autoPlaylist.reset.action") }}
        </WpButton>
      </WpCard>

      <p v-if="remoteLoading" class="auto-empty">{{ t("settings.experimental.autoPlaylist.loading") }}</p>
      <p v-else-if="remoteError" class="auto-empty">{{ remoteError }}</p>
      <p v-if="!library.playlists.length && !remotePlaylists.length" class="auto-empty">
        {{ t("settings.experimental.autoPlaylist.empty") }}
      </p>
    </template>
  </SettingsSection>
</template>

<style scoped>
/* 自动歌单：语种 / 类型分行，窄屏下标签与下拉框各占一行 */
.mode-control {
  /* 「按语种和类型自动分类」比默认 160px 宽，避免文字顶到下拉箭头 */
  width: 200px;
}

.auto-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
  width: 100%;
  margin-top: var(--space-lg);
}

.auto-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.auto-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--wp-text-secondary);
}

.auto-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}

.auto-label {
  flex: none;
  width: 64px;
  font-size: 13px;
  color: var(--wp-text-secondary);
}

.auto-select {
  flex: 1;
  min-width: 0;
  max-width: 280px;
}

.auto-empty {
  margin: var(--space-md) 0 0;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* 自定义关键词：输入框铺满卡片，下面跟一行已保存数量 */
.keyword-input {
  width: 100%;
}

.keyword-summary {
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.keyword-tip {
  color: var(--wp-text-tertiary);
}

@media (max-width: 520px) {
  .auto-row {
    flex-wrap: wrap;
    gap: var(--space-sm);
  }

  .auto-select {
    flex: 1 1 100%;
    max-width: none;
  }
}
</style>
