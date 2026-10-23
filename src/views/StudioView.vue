<script setup lang="ts">
/**
 * 录音棚（唱歌模式）
 *
 * 伴奏直接用播放器当前曲目——原生引擎把「即将出声」的样本分流一份给录音器，
 * 因此伴奏轨与真正听到的完全一致（不受缓冲提前量的影响）。人声走麦克风采集，
 * 停止录音后由后端按两条轨的首帧时间戳对齐并混音成 `mix.wav`。
 *
 * 回放成品走主播放器（源 id `recording`），这样「正在播放」、锁屏、
 * 播放队列都能看到它，而不是只在页面里偷偷放一遍。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ComboBox, ContentDialog, Slider, ToggleSwitch } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import MobilePageHeader from "@/components/layout/MobilePageHeader.vue";
import WpButton from "@/components/theme/WpButton.vue";
import { useIsMobile } from "@/composables/useIsMobile";
import { usePlayerStore } from "@/stores/player";
import { useRecorderStore } from "@/stores/recorder";
import { useSettingsStore } from "@/stores/settings";
import {
  RECORDING_SOURCE_ID,
  revealRecording,
  type RecordingItem,
} from "@/services/recorder";
import { toast } from "@/services/toast";
import { formatDuration, formatTime, trackArtist, trackTitle } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

interface DialogRef {
  ShowAsync: () => Promise<string>;
}

const player = usePlayerStore();
const recorder = useRecorderStore();
const settings = useSettingsStore();
const router = useRouter();
const isMobile = useIsMobile();

const currentTrack = computed(() => player.currentTrack);

/* ------------------------------ 麦克风 / 监听 ------------------------------ */

const deviceItems = computed(() => ["系统默认", ...recorder.devices]);
const deviceIndex = computed(() => {
  if (!recorder.device) return 0;
  const index = recorder.devices.indexOf(recorder.device);
  return index < 0 ? 0 : index + 1;
});

function onDeviceChange(_sender: HTMLElement | null, payload: { AddedItems: unknown[] }): void {
  const label = String(payload.AddedItems[0] ?? "");
  recorder.device = label === "系统默认" ? null : label;
  recorder.persist();
  // 换了麦克风，之前的试音结论不再适用
  recorder.probeReport = null;
  if (!recorder.recording) void recorder.probe();
}

function onMonitorToggle(event: { IsOn: boolean }): void {
  recorder.monitor = event.IsOn;
  recorder.persist();
}

function onMonitorVolume(value: number): void {
  recorder.monitorVolume = value;
  recorder.persist();
}

/* ------------------------------ 电平 / 试音 ------------------------------ */

/** 采样峰值换成「听起来像音量」的百分比：-60dB 到 0dB 映射成 0–100 */
function toPercent(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0.0008) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/** 录音中看实时电平，未录音时看试音峰值 */
const levelPercent = computed(() =>
  toPercent(recorder.recording ? recorder.level : (recorder.probeReport?.peak ?? 0)),
);

function dbText(peak: number): string {
  if (!Number.isFinite(peak) || peak <= 0.0001) return "静音";
  return `${(20 * Math.log10(peak)).toFixed(0)} dB`;
}

/**
 * 试音结论。系统禁止麦克风访问时设备照样「能打开」、也不报错，
 * 只有电平能区分「没权限」与「没说话」——所以这个提示必须给到位。
 */
const probeHint = computed<{ kind: "busy" | "bad" | "weak" | "ok"; text: string } | null>(() => {
  if (recorder.probing) return { kind: "busy", text: "正在采集，请对着麦克风说句话…" };
  const report = recorder.probeReport;
  if (!report) return null;
  if (report.peak < 0.002) {
    return {
      kind: "bad",
      text: "没有收到任何声音：系统可能没允许应用使用麦克风，或当前设备选错了",
    };
  }
  if (report.peak < 0.02) {
    return { kind: "weak", text: `有声音但偏小（峰值 ${dbText(report.peak)}），可以离麦克风近一点` };
  }
  return { kind: "ok", text: `麦克风正常（峰值 ${dbText(report.peak)}）` };
});

async function runProbe(): Promise<void> {
  if (recorder.recording || recorder.probing) return;
  const report = await recorder.probe();
  if (report && report.peak < 0.002) {
    toast("麦克风没有收到声音，请检查系统麦克风权限或换一个输入设备", "error");
  }
}

/* ------------------------------ 歌词滚动 ------------------------------ */

const lyricLines = computed(() => player.lyrics);
const activeLyric = computed(() => (lyricLines.value.length ? player.lyricIndex : -1));

/** 当前行索引（前奏时为 0）：交给 CSS 变量做居中位移，与视口高度无关 */
const lyricIndexVar = computed(() => Math.max(0, activeLyric.value));

/* ------------------------------ 录音 ------------------------------ */

/** 当前播放的是一条录音成品：它不能拿来当伴奏（会把自己再录一遍） */
const isRecordingPlayback = computed(
  () => currentTrack.value?.sourceId === RECORDING_SOURCE_ID,
);

async function toggleRecord(): Promise<void> {
  if (recorder.busy) return;

  if (recorder.recording) {
    const item = await recorder.stop();
    // 停录即停伴奏：继续放着容易在暂停点留下半句录音
    if (player.playing) player.togglePlay();
    if (item) toast(`录音已保存 · ${formatDuration(item.durationMs)}`, "success");
    return;
  }

  if (isRecordingPlayback.value) {
    toast("现在放的是录音成品，换一首歌再录", "info");
    return;
  }

  const track = currentTrack.value;
  const started = await recorder.start(
    track
      ? {
          title: trackTitle(track),
          artist: trackArtist(track),
          cover: track.cover,
          source: track.sourceId,
        }
      : null,
  );
  if (!started) return;
  // 伴奏跟着录音一起开始：后端挂分流点会重建会话，这里再把播放位拉起
  if (track && !player.playing) player.resume();
}

/* ------------------------------ 作品回放 ------------------------------ */

/** 主播放器当前放的是不是这条录音 */
function isPlayingItem(item: RecordingItem): boolean {
  const track = player.currentTrack;
  return Boolean(
    player.playing && track?.sourceId === RECORDING_SOURCE_ID && track.id === item.id,
  );
}

/** 这条录音是否已装载在播放器里（不论是否在放） */
function isLoadedItem(item: RecordingItem): boolean {
  const track = player.currentTrack;
  return Boolean(track?.sourceId === RECORDING_SOURCE_ID && track.id === item.id);
}

/** 录音作品 → 播放器曲目（走主播放器，正在播放/锁屏/队列都能看到） */
function recordingTrack(item: RecordingItem): UnifiedTrack {
  return {
    id: item.id,
    name: item.title || "未命名录音",
    artists: [item.artist || "清唱"],
    album: "录音棚",
    cover: item.cover ?? undefined,
    duration: item.durationMs,
    sourceId: RECORDING_SOURCE_ID,
  };
}

function togglePlayItem(item: RecordingItem): void {
  if (isPlayingItem(item)) {
    player.togglePlay();
    return;
  }
  // 同一条被暂停了：继续放，别从头加载
  if (isLoadedItem(item)) {
    player.resume();
    return;
  }
  void player.playTracks([recordingTrack(item)]);
}

/* ------------------------------ 混音调整 ------------------------------ */

const mixDialogRef = ref<DialogRef | null>(null);
const deleteDialogRef = ref<DialogRef | null>(null);
const mixTarget = ref<RecordingItem | null>(null);
const pendingDelete = ref<RecordingItem | null>(null);
const mixVoiceGain = ref(0);
const mixSongGain = ref(0);
const mixOffset = ref(0);

async function openMixDialog(item: RecordingItem): Promise<void> {
  mixTarget.value = item;
  mixVoiceGain.value = 0;
  mixSongGain.value = 0;
  // 起点是上一次的微调值，方便在原有基础上继续调
  mixOffset.value = item.syncMs ?? 0;
  const result = await mixDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  const updated = await recorder.remix(item.id, {
    offsetMs: Math.round(mixOffset.value),
    voiceGainDb: mixVoiceGain.value,
    songGainDb: mixSongGain.value,
  });
  // 正在放这条就重新装载一次音源，否则听到的还是旧混音
  if (updated && isLoadedItem(item)) {
    void player.playTracks([recordingTrack(updated)]);
  }
}

async function openDeleteDialog(item: RecordingItem): Promise<void> {
  pendingDelete.value = item;
  const result = await deleteDialogRef.value?.ShowAsync();
  if (result !== "Primary") return;
  // 先停掉播放：文件即将被删，继续放会直接报解码错误
  if (isPlayingItem(item)) player.togglePlay();
  await recorder.remove(item.id);
}

async function reveal(item: RecordingItem): Promise<void> {
  try {
    await revealRecording(item.id);
  } catch (error) {
    toast(String(error), "error");
  }
}

/* ------------------------------ 格式化 ------------------------------ */

function formatDate(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ------------------------------ 生命周期 ------------------------------ */

/**
 * 兜底：设置里关掉录音棚后，冷启动直接开到 `/studio`（设置还没从库里读出来）时
 * 路由守卫无从判断，会先放行；等设置加载完发现是关闭状态，就把人送回推荐页。
 * 录音中的页面不会被踢走——开关只在设置页可改，那时本页面已经卸载了。
 */
watch(
  () => settings.loaded && !settings.studioEnabled,
  (hidden) => {
    if (hidden) void router.replace({ name: "recommend" });
  },
  { immediate: true },
);

onMounted(() => {
  void recorder.loadDevices();
  void recorder.loadItems();
  void recorder.sync();
  // 进页面自动试音：Windows 的桌面程序不会弹权限框，
  // 只有主动采一段电平才能知道系统到底允不允许用麦克风
  if (!recorder.probeReport) void recorder.probe();
});
</script>

<template>
  <div class="wp-page studio-page" :class="{ 'is-mobile': isMobile }">
    <MobilePageHeader title="录音棚（实验性）" />

    <div class="wp-page-header">
      <div class="header-cover" :class="{ live: recorder.recording }">
        <span class="wp-icon">&#xE7FA;</span>
      </div>
      <div class="header-meta">
        <h1 class="wp-page-title">录音棚<span class="title-experimental">（实验性）</span></h1>
        <div class="header-sub">
          <template v-if="recorder.recording">
            <span class="live-dot" />正在录音 · {{ formatTime(recorder.elapsed / 1000) }}
          </template>
          <template v-else>用当前播放的歌曲当伴奏，唱完直接混成一条音轨</template>
        </div>
      </div>
    </div>

    <!-- 录音台：左侧伴奏+歌词，右侧控制 -->
    <section class="deck">
      <div class="deck-stage">
        <div class="now-playing">
          <div class="np-cover">
            <CachedImage v-if="currentTrack?.cover" :src="currentTrack.cover" />
            <span v-else class="wp-icon">&#xE855;</span>
          </div>
          <div class="np-meta">
            <div class="np-title ellipsis">
              {{ currentTrack ? trackTitle(currentTrack) : "还没有选择伴奏" }}
            </div>
            <div class="np-sub ellipsis">
              <template v-if="isRecordingPlayback">录音回放 · 换一首歌才能继续录</template>
              <template v-else-if="currentTrack">{{ trackArtist(currentTrack) }}</template>
              <template v-else>在播放器里挑一首歌，它就会出现在这里</template>
            </div>
          </div>
        </div>

        <div class="lyric-viewport">
          <div
            v-if="lyricLines.length"
            class="lyric-track"
            :style="{ '--lyric-index': String(lyricIndexVar) }"
          >
            <p
              v-for="(line, index) in lyricLines"
              :key="index"
              class="lyric-line"
              :class="{ active: index === activeLyric, passed: index < activeLyric }"
            >
              {{ line.text || "♪" }}
            </p>
          </div>
          <div v-else class="lyric-empty">
            {{ player.lyricsLoading ? "歌词加载中…" : "这首歌暂无歌词" }}
          </div>
        </div>
      </div>

      <div class="deck-controls">
        <div class="control-field">
          <span class="field-label">麦克风</span>
          <ComboBox
            :ItemsSource="deviceItems"
            :SelectedIndex="deviceIndex"
            :IsEnabled="!recorder.recording"
            @SelectionChanged="onDeviceChange"
          />
        </div>

        <!-- 输入电平 + 试音：麦克风到底出不出声，只能靠这个看出来 -->
        <div class="control-field">
          <div class="field-head">
            <span class="field-label">输入电平</span>
            <button
              type="button"
              class="probe-button"
              :disabled="recorder.recording || recorder.probing"
              @click="runProbe"
            >
              {{ recorder.probing ? "试音中…" : "试音" }}
            </button>
          </div>
          <div
            class="level-meter"
            :class="{
              live: recorder.recording || recorder.probing,
              active: levelPercent > 0,
              hot: levelPercent > 92,
            }"
          >
            <div class="level-fill" :style="{ width: `${levelPercent}%` }" />
          </div>
          <div v-if="probeHint" class="probe-hint" :class="probeHint.kind">
            <span>{{ probeHint.text }}</span>
            <button
              v-if="probeHint.kind === 'bad'"
              type="button"
              class="probe-link"
              @click="recorder.showMicSettings()"
            >
              打开系统设置
            </button>
          </div>
        </div>

        <div class="control-field inline">
          <div class="field-text">
            <span class="field-label">耳机监听</span>
            <span class="field-hint">戴耳机再开，避免啸叫</span>
          </div>
          <ToggleSwitch :IsOn="recorder.monitor" @Toggled="onMonitorToggle" />
        </div>

        <div v-if="recorder.monitor" class="control-field">
          <div class="field-head">
            <span class="field-label">监听音量</span>
            <span class="field-value">{{ Math.round(recorder.monitorVolume) }}%</span>
          </div>
          <Slider
            :Value="recorder.monitorVolume"
            :Minimum="0"
            :Maximum="100"
            :StepFrequency="1"
            @update:Value="onMonitorVolume"
          />
        </div>

        <button
          type="button"
          class="record-button"
          :class="{ recording: recorder.recording, busy: recorder.busy }"
          :disabled="recorder.busy || isRecordingPlayback"
          @click="toggleRecord"
        >
          <span class="wp-icon">{{ recorder.recording ? "&#xF75B;" : "&#xE7FA;" }}</span>
        </button>
        <div class="record-caption">
          {{
            recorder.busy
              ? "处理中…"
              : recorder.recording
                ? `点击结束并混音 · ${formatTime(recorder.elapsed / 1000)}`
                : isRecordingPlayback
                  ? "当前是录音回放，不能当伴奏"
                  : "点击开始录音"
          }}
        </div>
      </div>
    </section>

    <!-- 作品列表 -->
    <section class="recordings">
      <div class="section-head">
        <h2 class="wp-section-title">我的录音</h2>
        <span v-if="recorder.items.length" class="section-count">
          {{ recorder.items.length }} 条
        </span>
      </div>

      <div v-if="!recorder.items.length" class="empty-hint">
        <span class="wp-icon">&#xE7FA;</span>
        <p>还没有录音。选一首歌，点上面的按钮开始唱。</p>
      </div>

      <ul v-else class="rec-list">
        <li v-for="item in recorder.items" :key="item.id" class="rec-row">
          <button
            type="button"
            class="rec-play"
            :class="{ playing: isPlayingItem(item) }"
            :title="isPlayingItem(item) ? '暂停' : '播放'"
            @click="togglePlayItem(item)"
          >
            <span class="wp-icon">{{ isPlayingItem(item) ? "&#xF5A2;" : "&#xF606;" }}</span>
          </button>

          <div class="rec-cover">
            <CachedImage v-if="item.cover" :src="item.cover" />
            <span v-else class="wp-icon">&#xE855;</span>
          </div>

          <div class="rec-meta">
            <div class="rec-title ellipsis">{{ item.title || "未命名录音" }}</div>
            <div class="rec-sub ellipsis">
              {{ item.artist || "清唱" }} · {{ formatDate(item.createdAt) }} ·
              {{ formatDuration(item.durationMs) }}
              <span v-if="!item.hasSong" class="tag">无人声伴奏</span>
            </div>
          </div>

          <div class="rec-actions">
            <WpButton size="small" variant="standard" @click.stop="openMixDialog(item)">
              混音
            </WpButton>
            <button
              v-if="!isMobile"
              type="button"
              class="icon-button"
              title="在文件夹中显示"
              @click.stop="reveal(item)"
            >
              <span class="wp-icon">&#xF584;</span>
            </button>
            <button
              type="button"
              class="icon-button danger"
              title="删除"
              @click.stop="openDeleteDialog(item)"
            >
              <span class="wp-icon">&#xF34D;</span>
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 混音调整 -->
    <ContentDialog
      ref="mixDialogRef"
      Title="混音调整"
      PrimaryButtonText="重新生成"
      CloseButtonText="取消"
    >
      <div class="dialog-form">
        <p class="dialog-hint">
          人声与伴奏已经按录音时间戳自动对齐，如果听起来「人声偏早/偏晚」，用对齐微调补一点。
        </p>
        <div class="mix-field">
          <div class="field-head">
            <span class="field-label">对齐微调</span>
            <span class="field-value">{{ Math.round(mixOffset) }} ms</span>
          </div>
          <Slider
            :Value="mixOffset"
            :Minimum="-500"
            :Maximum="500"
            :StepFrequency="5"
            @update:Value="mixOffset = $event"
          />
        </div>
        <div class="mix-field">
          <div class="field-head">
            <span class="field-label">人声</span>
            <span class="field-value">{{ mixVoiceGain > 0 ? "+" : "" }}{{ mixVoiceGain.toFixed(1) }} dB</span>
          </div>
          <Slider
            :Value="mixVoiceGain"
            :Minimum="-12"
            :Maximum="12"
            :StepFrequency="0.5"
            @update:Value="mixVoiceGain = $event"
          />
        </div>
        <div class="mix-field">
          <div class="field-head">
            <span class="field-label">伴奏</span>
            <span class="field-value">{{ mixSongGain > 0 ? "+" : "" }}{{ mixSongGain.toFixed(1) }} dB</span>
          </div>
          <Slider
            :Value="mixSongGain"
            :Minimum="-12"
            :Maximum="12"
            :StepFrequency="0.5"
            @update:Value="mixSongGain = $event"
          />
        </div>
      </div>
    </ContentDialog>

    <ContentDialog
      ref="deleteDialogRef"
      Title="删除录音"
      :Content="`删除后无法恢复，确定要删除「${pendingDelete?.title || '这条录音'}」吗？`"
      PrimaryButtonText="删除"
      CloseButtonText="取消"
    />
  </div>
</template>

<style scoped>
/* ------------------------------ 头部 ------------------------------ */

.studio-page {
  padding-bottom: 24px;
}

/* 「（实验性）」后缀：字号降一档、灰色，不跟主标题抢视线但保持可读 */
.title-experimental {
  margin-left: 2px;
  font-size: 0.55em;
  font-weight: 500;
  color: var(--wp-text-secondary);
  white-space: nowrap;
}

.header-cover {
  width: 96px;
  height: 96px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  font-size: 40px;
  background: linear-gradient(135deg, var(--wp-accent), var(--wp-accent-active));
  color: var(--wp-text-on-accent);
  box-shadow: var(--shadow-card);
}

.header-cover.live {
  animation: cover-pulse 1.6s ease-in-out infinite;
}

@keyframes cover-pulse {
  0%,
  100% {
    box-shadow: var(--shadow-card);
  }
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--wp-accent) 22%, transparent);
  }
}

/* ------------------------------ 输入电平 ------------------------------ */

.level-meter {
  position: relative;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  /* 不用 control-fill-secondary：浅色主题下它几乎和卡片同色，空条会看不见 */
  background: color-mix(in srgb, var(--wp-text-primary) 12%, transparent);
}

.level-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  border-radius: 3px;
  background: var(--wp-accent);
  /* 用 width 而不是 scaleX：缩放会把渐变一起压扁，末端永远显示成「快爆音」的红色 */
  transition:
    width 0.09s linear,
    background 0.15s ease;
}

/* 接近满刻度才转红，提示要爆音了 */
.level-meter.hot .level-fill {
  background: var(--wp-danger);
}

.probe-button {
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--wp-control-stroke);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
  font-size: 11px;
  cursor: pointer;
}

.probe-button:hover:not(:disabled) {
  border-color: var(--wp-accent);
}

.probe-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.probe-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  line-height: 1.5;
}

.probe-hint.bad {
  color: var(--wp-danger);
}

.probe-hint.weak {
  color: var(--wp-text-secondary);
}

.probe-hint.ok {
  color: var(--wp-text-secondary);
}

.probe-hint.busy {
  color: var(--wp-text-tertiary);
}

.probe-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--wp-accent);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}

/* ------------------------------ 录音状态点 ------------------------------ */
.live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--wp-danger);
  vertical-align: 1px;
  animation: dot-blink 1s ease-in-out infinite;
}

@keyframes dot-blink {
  50% {
    opacity: 0.25;
  }
}

/* ------------------------------ 录音台 ------------------------------ */

.deck {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  margin: 4px 0 28px;
}

.deck-stage {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
  min-width: 0;
}

.now-playing {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.np-cover,
.rec-cover {
  width: 52px;
  height: 52px;
  flex: none;
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-tertiary);
  font-size: 20px;
}

.np-cover :deep(img),
.rec-cover :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-meta {
  min-width: 0;
}

.np-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wp-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-sub {
  font-size: 12px;
  color: var(--wp-text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 歌词：固定 7 行视口 + 整轨位移，当前行高亮 */
.lyric-viewport {
  position: relative;
  flex: 1;
  min-height: 150px;
  overflow: hidden;
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 18%,
    #000 82%,
    transparent 100%
  );
}

.lyric-track {
  /* 绝对定位到视口中线，再按当前行索引上移：视口多高都能保证当前行居中 */
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(calc(-15px - var(--lyric-index, 0) * 30px));
  transition: transform 0.42s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

.lyric-line {
  height: 30px;
  line-height: 30px;
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: var(--wp-text-tertiary);
  transition:
    color 0.25s ease,
    font-size 0.25s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 8px;
}

.lyric-line.passed {
  color: var(--wp-text-secondary);
  opacity: 0.6;
}

.lyric-line.active {
  color: var(--wp-accent);
  font-size: 16px;
  font-weight: 600;
}

.lyric-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text-tertiary);
  font-size: 13px;
}

/* 控制面板 */
.deck-controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--wp-card);
  border: 1px solid var(--wp-control-stroke);
}

.control-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-field.inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  font-size: 13px;
  color: var(--wp-text-primary);
}

.field-hint {
  font-size: 11px;
  color: var(--wp-text-tertiary);
}

.field-value {
  font-size: 12px;
  color: var(--wp-text-secondary);
  font-variant-numeric: tabular-nums;
}

.field-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* 录音按钮 */
.record-button {
  align-self: center;
  width: 72px;
  height: 72px;
  margin-top: 4px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: #fff;
  background: var(--wp-accent);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--wp-accent) 38%, transparent);
  transition:
    transform 0.16s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.record-button:hover:not(:disabled) {
  transform: scale(1.04);
  background: var(--wp-accent-active);
}

.record-button:active:not(:disabled) {
  transform: scale(0.97);
}

.record-button.recording {
  background: var(--wp-danger);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--wp-danger) 40%, transparent);
  animation: rec-glow 1.4s ease-in-out infinite;
}

.record-button:disabled {
  opacity: 0.55;
  cursor: default;
}

@keyframes rec-glow {
  50% {
    box-shadow: 0 6px 26px color-mix(in srgb, var(--wp-danger) 62%, transparent);
  }
}

.record-caption {
  text-align: center;
  font-size: 12px;
  color: var(--wp-text-secondary);
}

/* ------------------------------ 作品列表 ------------------------------ */

.recordings {
  margin-top: 8px;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.section-count {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 16px;
  color: var(--wp-text-tertiary);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--wp-control-stroke);
  font-size: 13px;
}

.empty-hint .wp-icon {
  font-size: 26px;
  opacity: 0.6;
}

.rec-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rec-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  transition: background 0.15s ease;
}

.rec-row:hover {
  background: var(--wp-card-hover);
}

.rec-play {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--wp-control-stroke);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.rec-play.playing {
  background: var(--wp-accent);
  border-color: transparent;
  color: var(--wp-text-on-accent);
}

.rec-meta {
  flex: 1;
  min-width: 0;
}

.rec-title {
  font-size: 14px;
  color: var(--wp-text-primary);
}

.rec-sub {
  font-size: 12px;
  color: var(--wp-text-secondary);
  margin-top: 2px;
}

.tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-tertiary);
  font-size: 11px;
}

.rec-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.icon-button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--wp-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.icon-button:hover {
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
}

.icon-button.danger:hover {
  color: var(--wp-danger);
}

/* ------------------------------ 对话框 ------------------------------ */

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.dialog-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wp-text-secondary);
}

.mix-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ------------------------------ 移动端 ------------------------------ */

@media (max-width: 880px) {
  .deck {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  /* 单列时歌词不能再 flex:1 撑开，否则会把录音键顶到屏幕外 */
  .lyric-viewport {
    flex: none;
    height: 150px;
  }


  .rec-actions :deep(.wp-standard-button) {
    padding: 0 10px;
  }
}

/* 移动端：整行不换行，靠缩小封面与按钮间距给标题让位（换行会把标题压成一字一行） */
.is-mobile .rec-row {
  gap: 8px;
  padding: 8px 4px;
}

.is-mobile .rec-cover {
  width: 40px;
  height: 40px;
}

.is-mobile .rec-actions {
  gap: 2px;
}
</style>
