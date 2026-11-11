<script setup lang="ts">
/**
 * 「自定义歌曲信息」编辑框宿主（全局唯一实例，挂在 App.vue）
 *
 * 通过 openTrackMetaEditor(track) 打开。表单里能改歌名 / 歌手 / 专辑 / 封面，
 * 三条获取途径：
 * - 「以歌曲为模板」：搜一首歌，歌名 / 歌手 / 专辑 / 封面一次套用（带站内 id，
 *   套用后歌手名、专辑名都能点进详情页）；
 * - 「搜索歌手」：只换歌手（同样带 id，能跳歌手页）；
 * - 「搜索封面」/ 本地图片 / 图片地址：只换封面。
 *
 * 保存时把界面上的文本与「带 id 的文本」做对比：只要用户手动改过歌手 / 专辑
 * 文本，对应 id 就作废（文本与身份不再对应，跳转过去只会是错的人 / 错的专辑）。
 * 所有空字段都由 store 丢弃，等于「这个字段仍是原始值」。
 */
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "@/i18n";
import { ContentDialog } from "@/components/winui";
import WpButton from "@/components/theme/WpButton.vue";
import CachedImage from "@/components/common/CachedImage.vue";
import { usePluginsStore } from "@/stores/plugins";
import { useTrackMetaStore } from "@/stores/trackMeta";
import { cachedImgUrl, resolveImgUrl } from "@/services/imageCache";
import { demoName } from "@/services/demoMode";
import { toast } from "@/services/toast";
import { closeTrackMetaEditor, trackMetaEditorState } from "@/services/trackMetaEditor";
import { trackArtist, trackTitle } from "@/types/player";
import type { UnifiedArtist, UnifiedTrack } from "@/types/plugin";

type Panel = "form" | "template" | "artist" | "cover";

interface DialogRef {
  ShowAsync: () => Promise<string>;
  Hide: () => void;
}

interface SongHit {
  track: UnifiedTrack;
  source: string;
}

interface ArtistHit {
  artist: UnifiedArtist;
  source: string;
}

const { t } = useI18n();
const plugins = usePluginsStore();
const meta = useTrackMetaStore();

const dialogRef = ref<DialogRef | null>(null);
const panel = ref<Panel>("form");

/* ------------------------------ 表单状态 ------------------------------ */

const nameText = ref("");
const artistText = ref("");
const albumText = ref("");
/** 封面原图地址（http(s) 或 localcover 协议），空 = 沿用原始封面 */
const coverText = ref("");
const coverUrlDraft = ref("");
const coverBusy = ref(false);

/**
 * 「带身份」的歌手 / 专辑文本。
 *
 * `artistIds` 只有在 `artistText` 与 `identifiedArtistText` 完全一致时才仍然有效：
 * 用户一旦手改文本，原来的 id 就对应不上新名字了，必须丢掉，否则点歌手名会跳到别人主页。
 */
const identifiedArtistText = ref("");
const artistIds = ref<Array<string | null>>([]);
const artistSourceId = ref("");
const identifiedAlbumText = ref("");
const albumId = ref("");
const albumSourceId = ref("");

/* ------------------------------ 搜索状态 ------------------------------ */

const keyword = ref("");
const searching = ref(false);
const searched = ref(false);
const searchError = ref("");
const songHits = ref<SongHit[]>([]);
const artistHits = ref<ArtistHit[]>([]);

const baseTrack = computed(() => trackMetaEditorState.track);
const hasOverride = computed(() => (baseTrack.value ? meta.has(baseTrack.value) : false));

const previewCover = computed(() => {
  if (coverText.value) return cachedImgUrl(coverText.value);
  return baseTrack.value?.cover;
});

const originalArtistText = computed(() => {
  const names = baseTrack.value?.artists ?? [];
  return names.length ? names.join(" / ") : t("components.trackMeta.unknownArtist");
});

const dialogTitle = computed(() => {
  switch (panel.value) {
    case "template":
      return t("components.trackMeta.titleSelectTemplate");
    case "artist":
      return t("components.trackMeta.titleSearchArtist");
    case "cover":
      return t("components.trackMeta.titleSearchCover");
    default:
      return t("components.trackMeta.titleEdit");
  }
});

const isForm = computed(() => panel.value === "form");

/* ------------------------------ 打开 / 关闭 ------------------------------ */

watch(
  () => trackMetaEditorState.visible,
  async (visible) => {
    if (!visible) {
      dialogRef.value?.Hide();
      return;
    }
    const track = trackMetaEditorState.track;
    if (!track) return;

    const existing = meta.get(track);
    panel.value = "form";
    nameText.value = existing?.name ?? "";
    artistText.value = existing?.artists?.join(" / ") ?? "";
    identifiedArtistText.value = artistText.value;
    artistIds.value = existing?.artistIds ? [...existing.artistIds] : [];
    artistSourceId.value = existing?.artistSourceId ?? "";
    albumText.value = existing?.album ?? "";
    identifiedAlbumText.value = albumText.value;
    albumId.value = existing?.albumId ?? "";
    albumSourceId.value = existing?.albumSourceId ?? "";
    coverText.value = existing?.cover ? resolveImgUrl(existing.cover) ?? "" : "";
    coverUrlDraft.value = "";
    coverBusy.value = false;
    keyword.value = "";
    resetSearch();

    const result = await dialogRef.value?.ShowAsync();
    if (result === "Primary") await save();
    else if (result === "Secondary") await resetAll();
    if (trackMetaEditorState.visible) closeTrackMetaEditor();
  },
);

/* ------------------------------ 保存 / 恢复 ------------------------------ */

/** 歌手分隔符只用「 / 」（两侧带空格）或中文顿号 / 分号，避免把 AC/DC 这种名字拆开 */
function parseList(text: string): string[] {
  return text
    .split(/\s+\/\s+|\s*[、;；]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function save(): Promise<void> {
  const track = baseTrack.value;
  if (!track) return;
  const keepArtistId = artistText.value.trim() === identifiedArtistText.value.trim();
  const keepAlbumId = albumText.value.trim() === identifiedAlbumText.value.trim();
  try {
    const saved = await meta.save(track, {
      name: nameText.value,
      artists: parseList(artistText.value),
      artistIds: keepArtistId ? artistIds.value : undefined,
      artistSourceId: keepArtistId ? artistSourceId.value : undefined,
      album: albumText.value,
      albumId: keepAlbumId ? albumId.value : undefined,
      albumSourceId: keepAlbumId ? albumSourceId.value : undefined,
      cover: coverText.value,
    });
    toast(
      saved ? t("components.trackMeta.saved") : t("components.trackMeta.restored"),
      "success",
    );
  } catch (error) {
    toast(
      t("components.trackMeta.saveFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  }
}

async function resetAll(): Promise<void> {
  const track = baseTrack.value;
  if (!track) return;
  try {
    await meta.reset(track);
    toast(t("components.trackMeta.restored"), "info");
  } catch (error) {
    toast(
      t("components.trackMeta.restoreFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  }
}

/* ------------------------------ 封面 ------------------------------ */

/** 把网络封面落到本地（失败就保留原地址，至少还能显示） */
async function pinCover(url: string): Promise<void> {
  try {
    const local = await invoke<string>("custom_cover_fetch", { url });
    // 用户可能在等待期间又换了图，只在没被改动时回填
    if (coverText.value === url) coverText.value = local;
  } catch {
    /* 保留远程地址 */
  }
}

async function applyCoverUrl(): Promise<void> {
  const url = coverUrlDraft.value.trim();
  if (!url) return;
  coverBusy.value = true;
  try {
    coverText.value = await invoke<string>("custom_cover_fetch", { url });
    coverUrlDraft.value = "";
    toast(t("components.trackMeta.coverSaved"), "success");
  } catch (error) {
    coverText.value = url;
    coverUrlDraft.value = "";
    toast(
      t("components.trackMeta.coverUrlFallback", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "info",
    );
  } finally {
    coverBusy.value = false;
  }
}

async function pickLocalCover(): Promise<void> {
  const picked = await openFileDialog({
    multiple: false,
    directory: false,
    title: t("components.trackMeta.pickCoverTitle"),
    filters: [
      {
        name: t("components.trackMeta.pickCoverFilter"),
        extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"],
      },
    ],
  });
  if (!picked || Array.isArray(picked)) return;
  coverBusy.value = true;
  try {
    coverText.value = await invoke<string>("custom_cover_import", { path: picked });
    toast(t("components.trackMeta.coverImported"), "success");
  } catch (error) {
    toast(
      t("components.trackMeta.coverImportFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    coverBusy.value = false;
  }
}

/* ------------------------------ 搜索 ------------------------------ */

function resetSearch(): void {
  searching.value = false;
  searched.value = false;
  searchError.value = "";
  songHits.value = [];
  artistHits.value = [];
}

/** 打开搜索面板：按用途预填关键词，并自动搜一次 */
function openPanel(next: Panel): void {
  panel.value = next;
  resetSearch();
  const track = baseTrack.value;
  const names = parseList(artistText.value);
  if (next === "artist") {
    keyword.value = names[0] ?? track?.artists?.[0] ?? "";
  } else {
    // 模板 / 封面都按「歌名 歌手」搜，命中率最高
    keyword.value = [track?.name ?? "", names[0] ?? track?.artists?.[0] ?? ""]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (keyword.value) void runSearch();
}

async function runSearch(): Promise<void> {
  const kw = keyword.value.trim();
  if (!kw || searching.value) return;
  const ids = plugins.enabledRecords
    .filter((record) => plugins.hasCapability(record, "search"))
    .map((record) => record.entry.id);
  if (!ids.length) {
    searchError.value = t("components.trackMeta.noSearchSource");
    return;
  }
  searching.value = true;
  searchError.value = "";
  try {
    const type = panel.value === "artist" ? "artist" : "song";
    const results = await plugins.searchSources(ids, kw, type);
    if (type === "artist") {
      artistHits.value = results.flatMap((item) =>
        (item.result?.artists ?? []).map((artist) => ({
          artist,
          source: demoName(item.record.entry.manifest.name),
        })),
      );
      songHits.value = [];
    } else {
      songHits.value = results.flatMap((item) =>
        (item.result?.songs ?? []).map((track) => ({
          track,
          source: demoName(item.record.entry.manifest.name),
        })),
      );
      artistHits.value = [];
    }
    if (!songHits.value.length && !artistHits.value.length) {
      searchError.value = t("components.trackMeta.noSearchResult");
    }
  } catch (error) {
    searchError.value = t("components.trackMeta.searchFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    searching.value = false;
    searched.value = true;
  }
}

/* ------------------------------ 套用结果 ------------------------------ */

/** 拿一首歌当模板：歌名 / 歌手 / 专辑 / 封面整体套用 */
function applyTemplate(track: UnifiedTrack): void {
  const artists = track.artists ?? [];
  nameText.value = track.name ?? "";
  artistText.value = artists.join(" / ");
  identifiedArtistText.value = artistText.value;
  artistIds.value = artists.map((_, index) => track.artistIds?.[index] ?? null);
  artistSourceId.value = track.sourceId ?? "";
  albumText.value = track.album ?? "";
  identifiedAlbumText.value = albumText.value;
  albumId.value = track.albumId ?? "";
  albumSourceId.value = track.sourceId ?? "";

  const rawCover = resolveImgUrl(track.cover);
  if (rawCover) {
    coverText.value = rawCover;
    void pinCover(rawCover);
  }
  panel.value = "form";
  toast(t("components.trackMeta.templateApplied"), "success");
}

/** 只换歌手（带 id，能跳歌手页） */
function applyArtist(hit: ArtistHit): void {
  artistText.value = hit.artist.name;
  identifiedArtistText.value = hit.artist.name;
  artistIds.value = [hit.artist.id];
  artistSourceId.value = hit.artist.sourceId ?? "";
  panel.value = "form";
}

/** 只换封面 */
function applyCover(track: UnifiedTrack): void {
  const rawCover = resolveImgUrl(track.cover);
  if (!rawCover) {
    toast(t("components.trackMeta.noCover"), "error");
    return;
  }
  coverText.value = rawCover;
  void pinCover(rawCover);
  panel.value = "form";
}

function pickSong(hit: SongHit): void {
  if (panel.value === "cover") applyCover(hit.track);
  else applyTemplate(hit.track);
}

/** 歌手 / 专辑是否还带着站内身份（决定表单里要不要提示「可跳转」） */
const artistLinked = computed(
  () => artistText.value.trim() === identifiedArtistText.value.trim() && artistIds.value.some(Boolean),
);
const albumLinked = computed(
  () => albumText.value.trim() === identifiedAlbumText.value.trim() && Boolean(albumId.value),
);
</script>

<template>
  <ContentDialog
    ref="dialogRef"
    :Title="dialogTitle"
    :PrimaryButtonText="isForm ? t('common.action.save') : ''"
    :SecondaryButtonText="isForm && hasOverride ? t('components.trackMeta.restoreOriginal') : ''"
    :CloseButtonText="t('common.action.cancel')"
  >
    <div class="meta-editor">
      <!-- ------------------------------ 表单 ------------------------------ -->
      <template v-if="isForm">
        <div class="cover-row">
          <div class="cover-box">
            <CachedImage
              v-if="previewCover"
              :src="previewCover"
              :alt="t('components.trackMeta.coverPreview')"
            />
            <span v-else class="wp-icon cover-empty">&#xE852;</span>
          </div>
          <div class="cover-side">
            <div class="cover-buttons">
              <WpButton variant="standard" size="small" :disabled="coverBusy" @click="pickLocalCover">
                {{ t("components.trackMeta.localImage") }}
              </WpButton>
              <WpButton variant="standard" size="small" :disabled="coverBusy" @click="openPanel('cover')">
                {{ t("components.trackMeta.searchCover") }}
              </WpButton>
              <WpButton
                v-if="coverText"
                variant="standard"
                size="small"
                :disabled="coverBusy"
                @click="coverText = ''"
              >
                {{ t("common.action.clear") }}
              </WpButton>
            </div>
            <div class="cover-url">
              <input
                v-model="coverUrlDraft"
                class="field-input"
                :placeholder="t('components.trackMeta.coverUrlPlaceholder')"
                @keydown.enter.prevent="applyCoverUrl"
              />
            </div>
          </div>
        </div>

        <div class="field">
          <span class="field-label">{{ t("components.trackMeta.nameLabel") }}</span>
          <input
            v-model="nameText"
            class="field-input"
            :placeholder="baseTrack?.name || t('components.empty.untitled')"
          />
        </div>

        <div class="field">
          <span class="field-label">
            {{ t("common.column.artist") }}
            <span class="field-hint">{{ t("components.trackMeta.artistsHint") }}</span>
          </span>
          <div class="field-row">
            <input v-model="artistText" class="field-input" :placeholder="originalArtistText" />
            <button
              class="field-search"
              :title="t('components.trackMeta.titleSearchArtist')"
              @click="openPanel('artist')"
            >
              <span class="wp-icon">&#xF690;</span>
            </button>
          </div>
          <span v-if="artistLinked" class="field-note">
            {{ t("components.trackMeta.artistLinkNote") }}
          </span>
        </div>

        <div class="field">
          <span class="field-label">{{ t("common.column.album") }}</span>
          <input
            v-model="albumText"
            class="field-input"
            :placeholder="baseTrack?.album || t('components.trackMeta.albumPlaceholder')"
          />
          <span v-if="albumLinked" class="field-note">
            {{ t("components.trackMeta.albumLinkNote") }}
          </span>
        </div>

        <div class="template-row">
          <WpButton variant="standard" size="small" @click="openPanel('template')">
            {{ t("components.trackMeta.useTemplate") }}
          </WpButton>
          <span class="template-hint">{{ t("components.trackMeta.templateHint") }}</span>
        </div>
      </template>

      <!-- ------------------------------ 搜索 ------------------------------ -->
      <template v-else>
        <button class="back-link" @click="panel = 'form'">
          <span class="wp-icon">&#xF2AB;</span>
          {{ t("common.action.back") }}
        </button>

        <div class="search-row">
          <input
            v-model="keyword"
            class="field-input"
            :placeholder="
              panel === 'artist'
                ? t('components.trackMeta.artistKeywordPlaceholder')
                : t('components.trackMeta.keywordPlaceholder')
            "
            @keydown.enter.prevent="runSearch"
          />
          <WpButton variant="accent" size="small" :disabled="searching" @click="runSearch">
            {{
              searching ? t("components.trackMeta.searching") : t("common.action.search")
            }}
          </WpButton>
        </div>

        <div v-if="searching" class="search-hint">
          {{ t("components.trackMeta.searchInProgress") }}
        </div>
        <div v-else-if="searchError" class="search-hint">{{ searchError }}</div>
        <div v-else-if="!searched" class="search-hint">
          {{
            panel === "artist"
              ? t("components.trackMeta.artistSearchHint")
              : t("components.trackMeta.templateSearchHint")
          }}
        </div>

        <div v-else class="result-list">
          <button
            v-for="hit in songHits"
            :key="`${hit.track.sourceId}:${hit.track.id}`"
            class="result-item"
            @click="pickSong(hit)"
          >
            <CachedImage v-if="hit.track.cover" :src="hit.track.cover" class="result-cover" />
            <span v-else class="result-cover result-cover-empty wp-icon">&#xE852;</span>
            <span class="result-main">
              <span class="result-name ellipsis">{{ trackTitle(hit.track) }}</span>
              <span class="result-meta ellipsis">
                {{ trackArtist(hit.track) }}<template v-if="hit.track.album"> · {{ hit.track.album }}</template>
              </span>
            </span>
            <span class="result-source ellipsis">{{ hit.source }}</span>
          </button>

          <button
            v-for="hit in artistHits"
            :key="`${hit.artist.sourceId}:${hit.artist.id}`"
            class="result-item"
            @click="applyArtist(hit)"
          >
            <span class="result-avatar">
              <CachedImage v-if="hit.artist.avatar" :src="hit.artist.avatar" class="result-cover" />
              <span v-else class="wp-icon result-cover-empty">&#xF5BE;</span>
            </span>
            <span class="result-main">
              <span class="result-name ellipsis">{{ hit.artist.name }}</span>
              <span class="result-meta ellipsis">
                {{ hit.artist.alias?.join(" / ") || t("common.column.artist") }}
                <template v-if="hit.artist.songCount">
                  · {{ t("common.unit.track", { count: hit.artist.songCount }) }}
                </template>
              </span>
            </span>
            <span class="result-source ellipsis">{{ hit.source }}</span>
          </button>
        </div>
      </template>
    </div>
  </ContentDialog>
</template>

<style scoped>
.meta-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  min-width: 0;
}

/* ------------------------------ 封面 ------------------------------ */
.cover-row {
  display: flex;
  gap: var(--space-lg);
  align-items: flex-start;
}

.cover-box {
  flex: none;
  width: 88px;
  height: 88px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--wp-control-fill);
  border: 1px solid var(--wp-control-stroke);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-box :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-empty {
  font-size: 26px;
  color: var(--wp-text-tertiary);
}

.cover-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.cover-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.cover-url {
  display: flex;
}

/* ------------------------------ 字段 ------------------------------ */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-label {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  font-size: 12px;
  color: var(--wp-text-secondary);
}

.field-hint {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.field-row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.field-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill);
  color: var(--wp-text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

.field-input:focus {
  border-color: var(--wp-accent);
}

.field-search {
  flex: none;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wp-control-stroke);
  border-radius: var(--radius-sm);
  background: var(--wp-control-fill);
  color: var(--wp-text-secondary);
  font-size: 14px;
  cursor: pointer;
}

.field-search:hover {
  background: var(--wp-card-hover);
  color: var(--wp-text-primary);
}

.field-note {
  font-size: 11px;
  color: var(--wp-accent);
}

.template-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
  padding-top: var(--space-xs);
  border-top: 1px solid var(--wp-control-stroke);
}

.template-hint {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

/* ------------------------------ 搜索 ------------------------------ */
.back-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--wp-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.back-link:hover {
  color: var(--wp-text-primary);
}

.search-row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.search-hint {
  font-size: 13px;
  color: var(--wp-text-secondary);
  padding: var(--space-lg) 0;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}

.result-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 6px var(--space-md);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--wp-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.result-item:hover {
  background: var(--wp-card-hover);
}

.result-cover {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--wp-control-fill);
}

.result-cover-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--wp-text-tertiary);
}

.result-avatar .result-cover,
.result-avatar .result-cover-empty {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.result-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-name {
  font-size: 13px;
  color: var(--wp-text-primary);
}

.result-meta {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.result-source {
  flex: none;
  max-width: 30%;
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------- 移动端 ---------------------------------- */
html.is-mobile .field-input {
  height: 44px;
  font-size: 15px;
}

html.is-mobile .field-search {
  width: 44px;
  height: 44px;
  font-size: 17px;
}

html.is-mobile .field-label {
  font-size: 13px;
}

html.is-mobile .cover-box {
  width: 76px;
  height: 76px;
}

html.is-mobile .result-list {
  max-height: min(46vh, 420px);
  gap: var(--space-xs);
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html.is-mobile .result-item {
  height: 56px;
  padding: 0 var(--space-md);
  border-radius: var(--radius-md);
}

html.is-mobile .result-item:hover {
  background: transparent;
}

html.is-mobile .result-item:active {
  background: var(--wp-card-hover);
}

html.is-mobile .result-cover,
html.is-mobile .result-avatar .result-cover,
html.is-mobile .result-avatar .result-cover-empty {
  width: 42px;
  height: 42px;
}

html.is-mobile .result-name {
  font-size: 15px;
}

html.is-mobile .result-meta,
html.is-mobile .result-source {
  font-size: 12px;
}
</style>
