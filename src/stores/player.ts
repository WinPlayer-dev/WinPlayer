/** 播放器状态与控制（队列 / 模式 / 歌词），底层为原生 Rust 音频引擎 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getAudioEngine } from "@/services/audio";
import { findLyricIndex, mergeTranslation, parseLrc } from "@/services/lrc";
import { getSetting, setSetting } from "@/services/db";
import { toast } from "@/services/toast";
import { hapticTap } from "@/services/haptics";
import { usePluginsStore } from "./plugins";
import { createQueueUid, type LyricLine, type PlayMode, type QueueItem } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

const MODE_ORDER: PlayMode[] = ["sequential", "loop-all", "loop-one", "shuffle"];

export const usePlayerStore = defineStore("player", () => {
  const engine = getAudioEngine();
  const plugins = usePluginsStore();

  const queue = ref<QueueItem[]>([]);
  const currentIndex = ref(-1);
  /** 随机模式下的「原始播放列表」备份，切回其他模式时用于恢复顺序 */
  const originalQueue = ref<QueueItem[]>([]);
  const mode = ref<PlayMode>("loop-all");
  const playing = ref(false);
  const loading = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const volume = ref(0.8);
  const muted = ref(false);
  /** 播放倍速（0.5–2.0，保持音调；全局设置，持久化） */
  const rate = ref(1);

  /** 当前已加载音频的曲目标识（用于判断是否需要解析直链） */
  let loadedTrackKey: string | null = null;

  /** 长时间空闲（暂停 / 停止 / 播完）后恢复播放的阈值：超过则重新解析
   * 直链并重载会话——平台音频流可能已被系统回收、直链也可能过期；与
   * 后端 OUTPUT_IDLE_RESET（60s）保持一致 */
  const IDLE_RELOAD_MS = 60_000;

  /** 进入非播放状态的时刻（毫秒）；0 表示本轮尚未进入过空闲 */
  let idleSince = 0;

  // 歌词
  const lyrics = ref<LyricLine[]>([]);
  const lyricsLoading = ref(false);
  const lyricIndex = computed(() => findLyricIndex(lyrics.value, currentTime.value * 1000));

  // UI 状态（队列/歌词面板）
  const showQueue = ref(false);
  const showLyrics = ref(false);

  const currentTrack = computed<UnifiedTrack | null>(() =>
    currentIndex.value >= 0 && currentIndex.value < queue.value.length
      ? queue.value[currentIndex.value].track
      : null,
  );

  /* ------------------------------ 随机播放 ------------------------------ */

  /** Fisher-Yates 洗牌（返回新数组，不改动入参） */
  function shuffled<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** 当前曲目在队列中的条目 uid */
  function currentUid(): string | null {
    return queue.value[currentIndex.value]?.uid ?? null;
  }

  /** 深拷贝条目列表（uid 与曲目引用保持不变） */
  function cloneItems(items: QueueItem[]): QueueItem[] {
    return items.map((item) => ({ uid: item.uid, track: item.track }));
  }

  /** 备份当前队列为「原始播放列表」 */
  function snapshotOriginal(source: QueueItem[] = queue.value): void {
    originalQueue.value = cloneItems(source);
  }

  /** 打乱当前队列，并让正在播放的曲目跟随到新位置（不中断播放） */
  function shuffleQueue(): void {
    const uid = currentUid();
    queue.value = shuffled(queue.value);
    if (uid) {
      const index = queue.value.findIndex((item) => item.uid === uid);
      if (index >= 0) currentIndex.value = index;
    }
  }

  /** 一轮播完后：基于原始列表重新洗牌并从头开始 */
  function reshuffleFromOriginal(): void {
    const lastUid = currentUid();
    const source = originalQueue.value.length ? originalQueue.value : queue.value;
    const reordered = shuffled(source);
    // 尽量不以刚播完的曲目开头，避免连续重复
    if (reordered.length > 1 && reordered[0].uid === lastUid) {
      const swapWith = 1 + Math.floor(Math.random() * (reordered.length - 1));
      [reordered[0], reordered[swapWith]] = [reordered[swapWith], reordered[0]];
    }
    queue.value = reordered;
    currentIndex.value = 0;
  }

  /** 恢复原始播放列表顺序，并让正在播放的曲目跟随（离开随机模式时调用） */
  function restoreOriginal(): void {
    if (originalQueue.value.length) {
      const uid = currentUid();
      const restored = cloneItems(originalQueue.value);
      queue.value = restored;
      if (uid) {
        const index = restored.findIndex((item) => item.uid === uid);
        if (index >= 0) currentIndex.value = index;
      }
    }
    originalQueue.value = [];
  }

  /* ------------------------------ 引擎事件 ------------------------------ */

  engine.on("timeupdate", (time) => {
    currentTime.value = time;
    // seek 场景：到达目标附近后的首个进度复位加载态（缓冲期间后端
    // 阻塞在读取/推送，不上报进度，不会误清）
    loading.value = false;
    void maybePreload();
  });
  engine.on("durationchange", (value) => {
    if (value > 0) duration.value = value;
  });
  engine.on("playing", () => {
    playing.value = true;
    loading.value = false;
    idleSince = 0;
  });
  engine.on("paused", () => {
    playing.value = false;
    idleSince = Date.now();
  });
  engine.on("waiting", () => {
    loading.value = true;
  });
  engine.on("ended", () => {
    handleEnded();
  });
  engine.on("advanced", (url) => {
    handleAdvanced(url);
  });
  engine.on("error", (message) => {
    loading.value = false;
    playing.value = false;
    toast(message, "error");
  });

  /* ------------------------------ 播放控制 ------------------------------ */

  function trackUid(track: UnifiedTrack): string {
    return `${track.sourceId ?? ""}:${track.id}`;
  }

  /** 播放队列中指定位置的曲目 */
  async function playAt(index: number): Promise<void> {
    if (index < 0 || index >= queue.value.length) return;
    resetPreload(); // 硬加载会终止后端预加载会话
    currentIndex.value = index;
    const track = queue.value[index].track;
    console.log(`[player] 播放请求 #${index}: ${track.sourceId}:${track.id} 《${track.name}》`);
    loading.value = true;
    try {
      const result = await plugins.getSongUrl(track);
      loadedTrackKey = trackUid(track);
      // 先重置时长，防止上一曲的时长残留（新时长由引擎事件上报）
      duration.value = track.duration ? track.duration / 1000 : 0;
      engine.load(result.url);
      engine.volume = volume.value;
      engine.muted = muted.value;
      engine.setRate(rate.value);
      await engine.play();
      void fetchLyrics(track);
      persistQueue();
    } catch (error) {
      loading.value = false;
      playing.value = false;
      toast(`无法播放「${track.name}」: ${error}`, "error");
    }
  }

  /** 用一组曲目替换队列并从指定索引播放 */
  async function playTracks(tracks: UnifiedTrack[], startIndex = 0): Promise<void> {
    if (!tracks.length) return;
    const items: QueueItem[] = tracks.map((track) => ({ uid: createQueueUid(), track }));
    const safeStart = Math.min(Math.max(0, startIndex), items.length - 1);
    if (mode.value === "shuffle") {
      // 新的播放上下文：以传入顺序作为原始列表备份，再洗牌播放目标曲目
      const targetUid = items[safeStart].uid;
      snapshotOriginal(items);
      queue.value = shuffled(items);
      const index = queue.value.findIndex((item) => item.uid === targetUid);
      await playAt(index >= 0 ? index : 0);
      return;
    }
    queue.value = items;
    await playAt(safeStart);
  }

  /** 将曲目追加到队列尾部（不在队列时） */
  function addToQueue(tracks: UnifiedTrack[]): void {
    const existing = new Set(queue.value.map((item) => trackUid(item.track)));
    let added = 0;
    for (const track of tracks) {
      const key = trackUid(track);
      if (existing.has(key)) continue;
      existing.add(key);
      const item: QueueItem = { uid: createQueueUid(), track };
      queue.value.push(item);
      // 随机模式下同步备份（追加到末尾，保持原始相对顺序）
      if (mode.value === "shuffle") originalQueue.value.push({ uid: item.uid, track });
      added += 1;
    }
    if (added) {
      toast(`已添加 ${added} 首到播放队列`, "success");
      persistQueue();
    } else {
      toast("歌曲已在播放队列中", "info");
    }
  }

  /** 播放单曲（并以给定上下文重建队列） */
  async function playTrack(track: UnifiedTrack, context?: UnifiedTrack[]): Promise<void> {
    if (context?.length) {
      const index = context.findIndex((t) => trackUid(t) === trackUid(track));
      await playTracks(context, index >= 0 ? index : 0);
      return;
    }
    if (queue.value.length && currentIndex.value >= 0) {
      // 插入到当前曲目之后
      const insertAt = currentIndex.value + 1;
      const anchorUid = currentUid();
      const item: QueueItem = { uid: createQueueUid(), track };
      queue.value.splice(insertAt, 0, item);
      if (mode.value === "shuffle") {
        // 备份中同步插入到当前曲目之后；找不到锚点时追加到末尾
        const anchorIndex = anchorUid
          ? originalQueue.value.findIndex((entry) => entry.uid === anchorUid)
          : -1;
        const backupItem: QueueItem = { uid: item.uid, track };
        if (anchorIndex >= 0) originalQueue.value.splice(anchorIndex + 1, 0, backupItem);
        else originalQueue.value.push(backupItem);
      }
      await playAt(insertAt);
    } else {
      await playTracks([track], 0);
    }
  }

  async function togglePlay(): Promise<void> {
    if (currentIndex.value < 0 || !queue.value.length) {
      // 恢复了队列但尚未加载音频：直接加载当前曲目
      if (queue.value.length) await playAt(Math.max(0, currentIndex.value));
      return;
    }
    const track = queue.value[currentIndex.value].track;
    if (loadedTrackKey !== trackUid(track)) {
      // 队列恢复场景：首次播放需解析直链
      await playAt(currentIndex.value);
      return;
    }
    if (engine.paused) {
      // 长时间空闲后恢复：旧音频输出流可能已被系统回收、直链也可能过期，
      // 改为重新解析直链并重载会话（后端同时会重建输出流），而不是直接唤醒
      if (idleSince > 0 && Date.now() - idleSince > IDLE_RELOAD_MS) {
        await playAt(currentIndex.value);
        return;
      }
      try {
        await engine.play();
      } catch (error) {
        toast(`播放失败: ${error}`, "error");
      }
    } else {
      engine.pause();
    }
  }

  /* ------------------------------ 无缝播放（预加载 + 衔接） ------------------------------ */

  /** 提前量（秒）：剩余这么久时开始解析并预加载下一首直链 */
  const PRELOAD_AHEAD_SEC = 20;

  /** 预加载状态：目标索引与已解析直链（url 为空 = 解析中，占位防重入） */
  let preload: { index: number; url: string } | null = null;

  /** 自动切歌的下一曲索引；不可预知（sequential 末尾 / shuffle 一轮重洗）时返回 null */
  function nextAutoIndex(): number | null {
    if (!queue.value.length || currentIndex.value < 0) return null;
    if (mode.value === "loop-one") return currentIndex.value;
    const next = currentIndex.value + 1;
    if (next < queue.value.length) return next;
    return mode.value === "loop-all" && queue.value.length >= 2 ? 0 : null;
  }

  /** 剩余时长进入提前量窗口时，解析下一首直链并交给引擎预加载 */
  async function maybePreload(): Promise<void> {
    if (preload || duration.value <= 0) return;
    if (currentTime.value < duration.value - PRELOAD_AHEAD_SEC) return;
    const index = nextAutoIndex();
    if (index == null) return;
    const item = queue.value[index];
    if (!item) return;
    preload = { index, url: "" };
    try {
      const result = await plugins.getSongUrl(item.track);
      if (!preload || preload.index !== index) return; // 期间被重置
      preload.url = result.url;
      engine.preload(result.url);
    } catch {
      preload = null; // 解析失败：放弃预加载，播完走 ended 回退换曲
    }
  }

  /** 丢弃预加载状态（可选通知引擎；load/stop 本身会清理后端预加载槽） */
  function resetPreload(cancelRemote = false): void {
    preload = null;
    if (cancelRemote) engine.cancelPreload();
  }

  /** 引擎已衔接至预加载曲目：切换曲目元数据（音频由引擎无缝续接） */
  function handleAdvanced(url: string): void {
    const pending = preload;
    preload = null;
    if (!pending || pending.url !== url) return;
    const item = queue.value[pending.index];
    if (!item) return;
    currentIndex.value = pending.index;
    loadedTrackKey = trackUid(item.track);
    currentTime.value = 0;
    duration.value = item.track.duration ? item.track.duration / 1000 : 0;
    playing.value = true;
    loading.value = false;
    void fetchLyrics(item.track);
    persistQueue();
  }

  function handleEnded(): void {
    if (mode.value === "loop-one") {
      // 原生引擎解码线程 emit ended 后即退出，seek(0) 无法复活会话，
      // 必须重新走 playAt 完整 load 新会话
      void playAt(currentIndex.value);
      return;
    }
    if (mode.value === "sequential" && currentIndex.value >= queue.value.length - 1) {
      playing.value = false;
      return;
    }
    void next(true);
  }

  async function next(auto = false): Promise<void> {
    if (!queue.value.length) return;
    let index = currentIndex.value + 1;
    if (index >= queue.value.length) {
      if (mode.value === "shuffle") {
        // 一轮播完：重新洗牌后从头继续
        reshuffleFromOriginal();
        persistQueue();
        index = 0;
      } else if (mode.value === "sequential" && auto) {
        playing.value = false;
        return;
      } else {
        index = 0;
      }
    }
    await playAt(index);
  }

  async function prev(): Promise<void> {
    if (!queue.value.length) return;
    // 播放超过 3 秒时，先回到开头
    if (currentTime.value > 3) {
      engine.seek(0);
      currentTime.value = 0;
      return;
    }
    let index = currentIndex.value - 1;
    if (index < 0) index = queue.value.length - 1;
    await playAt(index);
  }

  function seek(seconds: number): void {
    engine.seek(seconds);
    currentTime.value = seconds;
    // 引擎需缓冲/重拉才能到达目标（全量下载源可达数十秒），
    // 显示加载态，首个到达目标附近的 timeupdate 复位
    loading.value = true;
  }

  async function setVolume(value: number): Promise<void> {
    volume.value = Math.min(1, Math.max(0, value));
    engine.volume = volume.value;
    if (muted.value && volume.value > 0) {
      muted.value = false;
      engine.muted = false;
    }
    await setSetting("player.volume", volume.value);
  }

  async function toggleMute(): Promise<void> {
    muted.value = !muted.value;
    engine.muted = muted.value;
    await setSetting("player.muted", muted.value);
  }

  /** 设置播放倍速（0.5–2.0，保持音调），持久化并实时生效 */
  async function setRate(value: number): Promise<void> {
    rate.value = Math.min(2, Math.max(0.5, value));
    engine.setRate(rate.value);
    await setSetting("player.rate", rate.value);
  }

  /** 切换播放模式；进入随机时备份并打乱，离开随机时恢复原始顺序 */
  function setMode(next: PlayMode): void {
    if (next === mode.value) return;
    hapticTap();
    resetPreload(true); // 下一曲映射可能改变，丢弃已预加载的曲目
    const from = mode.value;
    mode.value = next;
    if (next === "shuffle") {
      snapshotOriginal();
      shuffleQueue();
    } else if (from === "shuffle") {
      restoreOriginal();
    }
    persistQueue();
    void setSetting("player.mode", mode.value);
  }

  function cycleMode(): void {
    const index = MODE_ORDER.indexOf(mode.value);
    setMode(MODE_ORDER[(index + 1) % MODE_ORDER.length]);
  }

  /* ------------------------------ 队列管理 ------------------------------ */

  function removeFromQueue(uid: string): void {
    const index = queue.value.findIndex((item) => item.uid === uid);
    if (index < 0) return;
    resetPreload(true); // 队列变动后下一曲可能不再是预加载目标
    queue.value.splice(index, 1);
    // 随机模式下同步移除备份中的对应条目
    const backupIndex = originalQueue.value.findIndex((item) => item.uid === uid);
    if (backupIndex >= 0) originalQueue.value.splice(backupIndex, 1);
    if (index < currentIndex.value) {
      currentIndex.value -= 1;
    } else if (index === currentIndex.value) {
      // 移除的是正在播放的曲目
      engine.stop();
      playing.value = false;
      loadedTrackKey = null;
      if (queue.value.length) {
        void playAt(Math.min(index, queue.value.length - 1));
      } else {
        currentIndex.value = -1;
      }
    }
    persistQueue();
  }

  function clearQueue(): void {
    queue.value = [];
    originalQueue.value = [];
    currentIndex.value = -1;
    loadedTrackKey = null;
    resetPreload();
    engine.stop();
    playing.value = false;
    lyrics.value = [];
    persistQueue();
  }

  function moveQueueItem(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= queue.value.length || to >= queue.value.length) {
      return;
    }
    resetPreload(true); // 重排后下一曲可能不再是预加载目标
    const currentItemUid = currentTrack.value ? queue.value[currentIndex.value]?.uid : null;
    const [item] = queue.value.splice(from, 1);
    queue.value.splice(to, 0, item);
    // 随机模式下同步备份：把条目移到其新后位之前，尽量保留其余相对顺序
    if (mode.value === "shuffle") {
      moveBackupItem(item.uid, queue.value[to + 1]?.uid ?? null);
    }
    if (currentItemUid) {
      currentIndex.value = queue.value.findIndex((entry) => entry.uid === currentItemUid);
    }
    persistQueue();
  }

  /** 拖动排序时同步原始列表备份 */
  function moveBackupItem(uid: string, nextUid: string | null): void {
    const fromIndex = originalQueue.value.findIndex((item) => item.uid === uid);
    if (fromIndex < 0) return;
    const [entry] = originalQueue.value.splice(fromIndex, 1);
    let insertAt = originalQueue.value.length;
    if (nextUid) {
      const nextIndex = originalQueue.value.findIndex((item) => item.uid === nextUid);
      if (nextIndex >= 0) insertAt = nextIndex;
    }
    originalQueue.value.splice(insertAt, 0, entry);
  }

  /* ------------------------------ 歌词 ------------------------------ */

  async function fetchLyrics(track: UnifiedTrack): Promise<void> {
    lyricsLoading.value = true;
    lyrics.value = [];
    try {
      const result = await plugins.getLyrics(track);
      if (result?.lrc) {
        const lines = parseLrc(result.lrc);
        lyrics.value = mergeTranslation(lines, result.translation);
      }
    } finally {
      lyricsLoading.value = false;
    }
  }

  /* ------------------------------ 持久化 ------------------------------ */

  let persistTimer: number | undefined;

  function persistQueue(): void {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      const snapshot = {
        items: queue.value.map((item) => ({ uid: item.uid, track: item.track })),
        index: currentIndex.value,
        mode: mode.value,
        originalItems: originalQueue.value.map((item) => ({ uid: item.uid, track: item.track })),
      };
      void setSetting("player.queue", snapshot);
    }, 600);
  }

  watch(mode, persistQueue);

  /** 启动时恢复（不自动播放） */
  async function restore(): Promise<void> {
    volume.value = await getSetting("player.volume", 0.8);
    muted.value = await getSetting("player.muted", false);
    rate.value = Math.min(2, Math.max(0.5, await getSetting("player.rate", 1)));
    const savedMode = await getSetting<PlayMode>("player.mode", "loop-all");
    if (MODE_ORDER.includes(savedMode)) mode.value = savedMode;
    engine.volume = volume.value;
    engine.muted = muted.value;
    engine.setRate(rate.value);

    const snapshot = await getSetting<{
      /** 兼容旧版仅存曲目列表的格式 */
      tracks?: UnifiedTrack[];
      items?: { uid: string; track: UnifiedTrack }[];
      index?: number;
      originalItems?: { uid: string; track: UnifiedTrack }[];
    } | null>("player.queue", null);

    const items = snapshot?.items?.length
      ? snapshot.items.map((item) => ({ uid: item.uid, track: item.track }))
      : (snapshot?.tracks ?? []).map((track) => ({ uid: createQueueUid(), track }));

    if (items.length) {
      queue.value = items;
      currentIndex.value = Math.min(Math.max(0, snapshot?.index ?? 0), queue.value.length - 1);
      duration.value = queue.value[currentIndex.value].track.duration
        ? queue.value[currentIndex.value].track.duration! / 1000
        : 0;
    }

    // 恢复随机模式的原始列表备份，供切回普通模式时还原顺序
    originalQueue.value =
      mode.value === "shuffle"
        ? (snapshot?.originalItems ?? []).map((item) => ({ uid: item.uid, track: item.track }))
        : [];
  }

  return {
    queue,
    currentIndex,
    mode,
    playing,
    loading,
    currentTime,
    duration,
    volume,
    muted,
    rate,
    lyrics,
    lyricsLoading,
    lyricIndex,
    showQueue,
    showLyrics,
    currentTrack,
    playAt,
    playTracks,
    playTrack,
    addToQueue,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    setRate,
    cycleMode,
    removeFromQueue,
    clearQueue,
    moveQueueItem,
    restore,
    persistQueue,
  };
});
