/** 播放器状态与控制（队列 / 模式 / 歌词），底层为原生 Rust 音频引擎 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getAudioEngine } from "@/services/audio";
import { isThrottled } from "@/services/backgroundMode";
import { findLyricIndex, mergeTranslation, parseLrc } from "@/services/lrc";
import { RECORDING_SOURCE_ID, recordingPlayPath } from "@/services/recorder";
import { getSetting, setSetting } from "@/services/db";
import {
  checkSleepDeadline,
  notifyTrackFinished,
  setSleepStopHandler,
} from "@/services/sleepTimer";
import { toast } from "@/services/toast";
import { hapticTap } from "@/services/haptics";
import { usePluginsStore } from "./plugins";
import { useDownloadsStore } from "./downloads";
import { useHistoryStore } from "./history";
import { createQueueUid, type LyricLine, type PlayMode, type QueueItem } from "@/types/player";
import type { UnifiedTrack } from "@/types/plugin";

const MODE_ORDER: PlayMode[] = ["sequential", "loop-all", "loop-one", "shuffle"];

export const usePlayerStore = defineStore("player", () => {
  const engine = getAudioEngine();
  const plugins = usePluginsStore();
  const downloads = useDownloadsStore();
  const history = useHistoryStore();

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

  /* ------------------------------ A-B 循环 ------------------------------ */

  /** A 点（秒）；null 表示未打点 */
  const abPointA = ref<number | null>(null);
  /** B 点（秒）；null 表示未打点 */
  const abPointB = ref<number | null>(null);
  /** 循环区间是否生效（A、B 都已打点才可能为 true） */
  const abEnabled = computed(
    () => abPointA.value !== null && abPointB.value !== null && abPointB.value > abPointA.value,
  );
  /** 回跳保护：一次 seek 后到下一次 timeupdate 前不再重复触发，避免抖动时连跳 */
  let abJumping = false;

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

  /** 清空 A-B 循环（换曲、用户清除时调用；换歌后区间不再有意义） */
  function clearAbLoop(): void {
    abPointA.value = null;
    abPointB.value = null;
    abJumping = false;
  }

  /** 打 A 点（当前进度；暂停时也可打点） */
  function setAbPointA(time = currentTime.value): void {
    abPointA.value = Math.max(0, time);
    // A 点越过 B 点时把 B 点作废，逼用户重新打 B（保持 A < B 的语义）
    if (abPointB.value !== null && abPointB.value <= abPointA.value) abPointB.value = null;
    abJumping = false;
  }

  /** 打 B 点（不能早于 A；没有 A 时自动把当前进度当 A） */
  function setAbPointB(time = currentTime.value): void {
    if (abPointA.value === null) abPointA.value = 0;
    abPointB.value = Math.max(abPointA.value! + 0.5, Math.max(0, time));
    abJumping = false;
  }

  /** 一键设置 A-B：A = 当前位置，B = 当前位置 + span 秒（默认 30s） */
  function setAbLoopAroundCurrent(span = 30): void {
    const start = Math.max(0, currentTime.value);
    const end = duration.value > 0 ? Math.min(duration.value, start + span) : start + span;
    abPointA.value = start;
    abPointB.value = end;
    abJumping = false;
  }

  /**
   * 进度到达 B 点：跳回 A 点续播。
   *
   * 只 `seek` 而不重新 load，保证无缝；跳转后抑制到下一帧 timeupdate，
   * 避免引擎尚未真正移回 A 时重复触发（网络源 seek 可能延迟数秒）。
   */
  function maybeJumpAbLoop(time: number): void {
    if (!abEnabled.value || abJumping) return;
    if (time < abPointB.value! - 0.15) return;
    abJumping = true;
    engine.seek(abPointA.value!);
    currentTime.value = abPointA.value!;
  }

  /* ------------------------------ 引擎事件 ------------------------------ */

  engine.on("timeupdate", (time) => {
    // 睡眠定时器到点：放在最前，后台节流时也必须生效
    checkSleepDeadline();
    // A-B 循环同样必须在后台也生效（窗口隐藏时仍要循环）
    maybeJumpAbLoop(time);
    if (isThrottled()) {
      // 后台优化：跳过响应式进度写（省去重渲染与 lyricIndex 计算），
      // 但预加载判断照常进行——用非响应式的 enginePosition 喂给它，
      // 保证隐藏状态（关闭到托盘 / 最小化）下无缝切歌不断链。
      void maybePreload(time);
      return;
    }
    currentTime.value = time;
    // seek 场景：到达目标附近后的首个进度复位加载态（缓冲期间后端
    // 阻塞在读取/推送，不上报进度，不会误清）
    loading.value = false;
    void maybePreload(time);
  });
  engine.on("durationchange", (value) => {
    if (value > 0) duration.value = value;
  });
  engine.on("playing", () => {
    playing.value = true;
    loading.value = false;
    idleSince = 0;
    // 只有真正出过一次声才清零重试计数，避免"刚 load 就失败"把计数吃掉
    retryCount = 0;
    recordPlayOnce();
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
  engine.on("advanced", (url, index) => {
    // 「播完当前曲目停止」：引擎在这里已经完成衔接，硬切回上一首的结尾不现实
    // （crossfade 时双流已经在混音）。先让元数据切到新曲再暂停，避免界面停在
    // 上一首上；紧接着清掉播放链 / 预载槽，防止它继续往下播。
    const stop = notifyTrackFinished();
    handleAdvanced(url, index);
    if (stop) {
      engine.pause();
      resetPreload(true);
      playing.value = false;
    }
  });
  engine.on("error", (message) => {
    loading.value = false;
    playing.value = false;
    // 播放中途出错（直链过期、网络抖动、解码失败）：先尝试自动恢复，
    // 恢复不了才把错误抛给用户
    void recoverFromError(message);
  });

  /* ------------------------------ 睡眠定时器 ------------------------------ */

  /**
   * 睡眠定时器到点：暂停播放并丢弃预载 / 播放链。
   *
   * 只 pause 不 stop：重新点播放时能接着当前进度继续（用户半夜醒来还想听）。
   * 但必须清掉播放链——否则引擎在后台仍会沿链自动换曲，「定时停止」形同虚设。
   */
  function stopForSleepTimer(): void {
    if (engine.paused === false || playing.value) engine.pause();
    playing.value = false;
    flushPlayReport(); // 定时停止也算这首播完，先把播放记录结算掉
    resetPreload(true);
    toast("睡眠定时器已停止播放", "info");
  }

  // 定时器由 services/sleepTimer 持有，这里只注册"到点后做什么"
  setSleepStopHandler(stopForSleepTimer);

  /* ------------------------------ 播放历史 ------------------------------ */

  /**
   * 本次「加载」是否已经记过播放。
   *
   * `playing` 事件在一次加载里可能因为暂停/继续、缓冲恢复而多次触发，
   * 而播放次数应该按"一首歌被播放一次"记，所以用这个标记按加载周期去重；
   * 每次 playAt / playUrlAt / handleAdvanced / adoptIndex 重新置位。
   */
  let playRecorded = false;

  /** 当前曲目记一次播放（同一加载周期内只记一次） */
  function recordPlayOnce(): void {
    if (playRecorded) return;
    const track = currentTrack.value;
    if (!track) return;
    playRecorded = true;
    void history.recordPlay(track);
    reportPlayStart(track);
  }

  /* ------------------------------ 平台播放记录回传 ------------------------------ */

  /**
   * 正在向平台回传的播放会话（startplay 已发出，等 play 结算）。
   *
   * 与本地播放历史同一时机：一次「加载」算一次播放，暂停/续播、seek、缓冲都不重复。
   * 回传分两条：开始播时发 start，这首被换下（切歌 / 播完 / 停止）时发 end，
   * 带上实际收听秒数——和平台官方客户端的打点方式一致，播放记录与听歌排行才不会
   * 只记「听了」不记「听了多久」。
   */
  let reportingTrack: UnifiedTrack | null = null;

  /** 本次会话的收听秒数：取引擎进度（后台场景 currentTime 会停更） */
  function listenedSeconds(): number {
    const position = Math.max(enginePosition, currentTime.value);
    const capped = duration.value > 0 ? Math.min(position, duration.value) : position;
    return Math.max(0, Math.round(capped));
  }

  /** 开始一次播放回传（若上一首还没结算，先补上，避免漏记） */
  function reportPlayStart(track: UnifiedTrack): void {
    flushPlayReport();
    reportingTrack = track;
    plugins.reportPlay(track, "start");
  }

  /** 结算当前播放会话，把实际收听时长回传给平台 */
  function flushPlayReport(seconds?: number): void {
    const track = reportingTrack;
    if (!track) return;
    reportingTrack = null;
    plugins.reportPlay(track, "end", seconds ?? listenedSeconds());
  }

  /* ------------------------------ 播放失败自动恢复 ------------------------------ */

  /** 当前曲目已自动重试次数（成功加载 / 换曲后清零，避免无限重试） */
  let retryCount = 0;

  /** 单曲最多自动重试次数：直链过期、网络抖动都靠它兜一下 */
  const MAX_RETRY = 2;

  /** 错误信息是否属于"重试也没用"的类型（没权限 / 没版权 / 缺少来源） */
  function isFatalError(message: string): boolean {
    return /版权|VIP|会员|未登录|不可用|缺少.*来源|不存在|已下架/i.test(message);
  }

  /**
   * 引擎报错后的自动恢复。
   *
   * 先丢弃旧直链、从当前位置重新解析一次（`getSongUrl` 内部还有跨插件回退），
   * 重试次数用尽或错误属于「重试无意义」的类型时，才把错误提示给用户并
   * 停下播放。恢复期间保持 `loading` 态，避免进度条闪回开头。
   */
  async function recoverFromError(message: string): Promise<void> {
    const track = currentTrack.value;
    const index = currentIndex.value;
    if (!track || index < 0) {
      toast(message, "error");
      return;
    }
    if (isFatalError(message)) {
      toast(message, "error");
      return;
    }
    if (retryCount >= MAX_RETRY) {
      retryCount = 0;
      toast(`${message}（已重试 ${MAX_RETRY} 次，可手动点击播放重试）`, "error");
      return;
    }
    retryCount += 1;
    const resumeAt = Math.max(0, enginePosition);
    loading.value = true;
    try {
      // 丢弃预载与播放链：它们指向的直链可能和刚失败的是同一批
      resetPreload(true);
      clearPreloadSlot(true);
      const url = await resolvePlayUrl(track);
      if (currentIndex.value !== index) return; // 期间用户切了歌
      engine.load(url);
      engine.volume = volume.value;
      engine.muted = muted.value;
      engine.setRate(rate.value);
      await engine.play();
      // 回到出错前的位置继续（首帧之前 seek 可能被忽略，故首帧后再补一次）
      if (resumeAt > 1) {
        engine.seek(resumeAt);
        window.setTimeout(() => {
          if (currentIndex.value === index && enginePosition < resumeAt - 2) engine.seek(resumeAt);
        }, 800);
      }
      playing.value = true;
      toast(`播放出错，已自动重试（${retryCount}/${MAX_RETRY}）`, "info");
    } catch (error) {
      loading.value = false;
      playing.value = false;
      toast(`无法播放「${track.name}」: ${error}`, "error");
    }
  }

  /* ------------------------------ 播放控制 ------------------------------ */

  function trackUid(track: UnifiedTrack): string {
    return `${track.sourceId ?? ""}:${track.id}`;
  }

  /** 解析播放地址：录音作品 → 本机协议；已下载曲目 → 本地文件；否则走插件直链 */
  async function resolvePlayUrl(track: UnifiedTrack): Promise<string> {
    // 录音棚作品：主进程按 id 给出 local:// 绝对路径（原生解码器不认自定义协议）
    if (track.sourceId === RECORDING_SOURCE_ID) return recordingPlayPath(track.id);
    const local = downloads.localUrl(track);
    if (local) return local;
    const result = await plugins.getSongUrl(track);
    return result.url;
  }

  /** 播放队列中指定位置的曲目 */
  async function playAt(index: number): Promise<void> {
    if (index < 0 || index >= queue.value.length) return;
    flushPlayReport(); // 换曲前结算上一首的平台播放记录
    // 只清预载槽：load 会在后端清预载槽与链，链随后由 republishChain 补回
    clearPreloadSlot();
    currentIndex.value = index;
    // 换曲：A-B 区间属于上一首，直接作废（不持久化）
    clearAbLoop();
    const track = queue.value[index].track;
    console.log(`[player] 播放请求 #${index}: ${track.sourceId}:${track.id} 《${track.name}》`);
    loading.value = true;
    retryCount = 0; // 换曲即重置自动重试预算
    playRecorded = false; // 新的一次加载：允许重新记一次播放
    try {
      const url = await resolvePlayUrl(track);
      if (currentIndex.value !== index) return; // 解析期间用户已切歌
      loadedTrackKey = trackUid(track);
      // 先重置时长，防止上一曲的时长残留（新时长由引擎事件上报）
      duration.value = track.duration ? track.duration / 1000 : 0;
      engine.load(url);
      engine.volume = volume.value;
      engine.muted = muted.value;
      engine.setRate(rate.value);
      await engine.play();
      void fetchLyrics(track);
      persistQueue();
      republishChain(); // load 会清后端链，这里按当前曲目重新锚定
      void syncPlayChain(); // 提前解析后续直链，锁屏期间由引擎连续换曲
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

  /**
   * 确保处于播放状态（系统媒体栏「播放」按钮专用）。
   *
   * 与 togglePlay 的区别：这里不再判断「当前是不是播放中」，因为后台/锁屏
   * 期间引擎事件可能丢失、playing 位会过时——按了播放却被判成「要暂停」
   * 是「暂停久了继续播放没声音」的主因之一。这里只在确实没在播时起播。
   */
  async function resume(): Promise<void> {
    if (currentIndex.value < 0 || !queue.value.length) {
      if (queue.value.length) await playAt(Math.max(0, currentIndex.value));
      return;
    }
    // 引擎已经在推进（未暂停且界面在播放）：无需重复唤醒
    if (!engine.paused && playing.value) return;
    await togglePlay();
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
    // 判定「当前是暂停态」：引擎的 paused 位与界面的 playing 位任一为假即
    // 视为暂停。后台/锁屏期间引擎的 paused 事件可能没送达 WebView，只看
    // engine.paused 会把「继续播放」误判成「要暂停」——按了反而没声音。
    const paused = engine.paused || !playing.value;
    if (paused) {
      // 长时间空闲后恢复：旧音频输出流可能已被系统回收、直链也可能过期，
      // 改为重新加载并续播（后端同时会重建输出流），而不是直接唤醒。
      // 优先复用链上直链：此时平台刚唤醒 WebView，插件 Worker 可能还没
      // 就绪，走完整解析会卡住导致「按了播放没声音」。
      const idleMs = idleSince > 0 ? Date.now() - idleSince : Number.POSITIVE_INFINITY;
      if (idleMs > IDLE_RELOAD_MS) {
        if (await startAt(currentIndex.value)) return;
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

  /**
   * 锁屏播放链：提前解析的后续若干首直链，整链下发给引擎（`engine.setPlayChain`）。
   * 锁屏后 WebView 的 JS 被暂停，maybePreload 不再执行、ended 也无从响应——
   * 引擎自己沿链前进即可连续自动切歌；链上的直链同时被媒体栏切歌直接复用
   * （不必在后台唤醒插件 Worker 解析直链）。
   *
   * chainToken 用于丢弃解析期间已过期的结果。
   */
  let chainEntries: Array<{ index: number; url: string }> = [];
  let chainToken = 0;

  /** 链长：够锁屏连续听一段时间，又不至于一次解析太多接口 */
  const CHAIN_LENGTH = 8;

  /** 沿播放顺序列出自「当前曲目之后」起的至多 CHAIN_LENGTH 个索引 */
  function chainTargets(): number[] {
    const total = queue.value.length;
    if (!total || currentIndex.value < 0) return [];
    const targets: number[] = [];
    // 单曲循环：链上重复当前曲目，引擎衔接后指针逐格前进即可持续循环
    if (mode.value === "loop-one") {
      for (let step = 1; step <= CHAIN_LENGTH; step += 1) targets.push(currentIndex.value);
      return targets;
    }
    // 随机模式的下一首由前端重洗决定，引擎无从预知：按队列顺序兜底，
    // 锁屏期间至少能顺着播下去（前端醒来后重新下发）
    for (let step = 1; step <= CHAIN_LENGTH; step += 1) {
      let index = currentIndex.value + step;
      if (index >= total) {
        // 列表循环：回到队首继续；顺序播放：链到此为止
        if (mode.value !== "loop-all" || total < 2) break;
        index -= total;
      }
      targets.push(index);
    }
    return targets;
  }

  /** 提前解析后续曲目直链并整链下发给引擎（加载/衔接/队列变更/模式变更后调用） */
  async function syncPlayChain(): Promise<void> {
    const token = ++chainToken;
    const targets = chainTargets();
    if (!targets.length) {
      if (token === chainToken) {
        chainEntries = [];
        engine.setPlayChain([], null);
      }
      return;
    }
    // 以「当前曲目 + 后续曲目」作为链：current = 0，引擎衔接后前进一格
    const current = currentIndex.value;
    const wanted = [current, ...targets];
    const known = new Map(chainEntries.map((entry) => [entry.index, entry.url]));
    // 先按队列位置去重解析（单曲循环的链是同一位置重复多项，只需解析一次）
    const resolvedByIndex = new Map<number, string>();
    for (const index of new Set(wanted)) {
      if (!queue.value[index]) continue;
      const cached = known.get(index);
      if (cached) {
        resolvedByIndex.set(index, cached);
        continue;
      }
      try {
        const url = await resolvePlayUrl(queue.value[index].track);
        if (token !== chainToken) return; // 期间切歌/改队列/改模式：结果已过期
        resolvedByIndex.set(index, url);
      } catch {
        // 该曲目解析失败：链在此中断（后续曲目等前端醒来再补）
        break;
      }
    }
    if (token !== chainToken) return;
    const resolved = wanted
      .filter((index) => resolvedByIndex.has(index))
      .map((index) => ({ index, url: resolvedByIndex.get(index)! }));
    // 链首必须是当前曲目（否则指针位置无从对齐）
    if (!resolved.length || resolved[0].index !== current) return;
    chainEntries = resolved;
    engine.setPlayChain(resolved, 0);
  }

  /**
   * 链上该队列位置已解析的直链（媒体栏切歌可据此直接起播，无需插件解析）。
   *
   * 同一队列位置在链上可能出现多次（单曲循环重复下发），任意一条都指向
   * 同一首曲目，取首个即可。
   */
  function chainUrlAt(index: number): string | null {
    return chainEntries.find((entry) => entry.index === index)?.url ?? null;
  }

  /* ------------------------------ 锁屏/后台恢复对齐 ------------------------------ */

  /** 是否正在从后台恢复（避免对齐过程中的中间态被持久化） */
  let resyncing = false;

  /** 引擎当前播放位置（引擎上报过 progress 之后才可靠） */
  let enginePosition = 0;
  engine.on("timeupdate", (time) => {
    enginePosition = time;
  });

  /**
   * 从后台/锁屏恢复：WebView 的 JS 被挂起期间，引擎可能已按播放链自行换过歌，
   * 或通过媒体栏切了歌——前端的内存状态（曲目、歌词、进度）会滞后甚至错位。
   * 这里按引擎的真实状态重新对齐：
   * - 用引擎回传的链下标（或当前直链）确认正在播放的曲目；
   * - 曲目变了就换元数据并重新拉歌词（修复「锁屏回来新曲没有歌词」）；
   * - 进度落后太多就直接认引擎为准（避免界面停在旧位置）。
   */
  async function syncEngineState(): Promise<void> {
    if (resyncing || currentIndex.value < 0) return;
    resyncing = true;
    try {
      // 引擎在后台自行衔接过（advanced 事件可能因挂起而丢失）：按直链反查
      const target = await findIndexByCurrentUrl();
      if (target != null && target !== currentIndex.value) {
        await adoptIndex(target);
      }
      // 进度对齐：引擎位置可信时以它为准
      if (enginePosition > 0 && Math.abs(enginePosition - currentTime.value) > 3) {
        currentTime.value = enginePosition;
      }
      // 歌词缺失（后台换歌时没能拉取）：补拉一次
      if (currentTrack.value && !lyrics.value.length && !lyricsLoading.value) {
        void fetchLyrics(currentTrack.value);
      }
    } finally {
      resyncing = false;
    }
    // 恢复后补齐播放链（后台期间链可能已经用掉一部分）
    void syncPlayChain();
  }

  /** 让引擎上报当前直链，据此反查队列下标（无法查询时返回 null） */
  async function findIndexByCurrentUrl(): Promise<number | null> {
    const url = await engine.currentSourceUrl().catch(() => null);
    if (!url) return null;
    // 锁屏期间引擎是沿播放链前进的：直链命中链上某条即知其队列位置
    return chainEntries.find((entry) => entry.url === url)?.index ?? null;
  }

  /** 采纳某个队列下标为当前曲目（元数据 + 歌词 + 持久化） */
  async function adoptIndex(index: number): Promise<void> {
    const item = queue.value[index];
    if (!item) return;
    // 后台期间引擎已沿链换曲：上一首按旧曲时长结算（时长随后会被新曲覆盖）
    flushPlayReport(duration.value > 0 ? Math.round(duration.value) : undefined);
    currentIndex.value = index;
    clearAbLoop();
    loadedTrackKey = trackUid(item.track);
    duration.value = item.track.duration ? item.track.duration / 1000 : 0;
    playing.value = true;
    loading.value = false;
    // 后台期间引擎已经把这首播起来了（advanced 事件在前端挂起时丢失）：
    // 这里补记一次历史，并把本加载周期标记为已记录，避免后续 playing 事件重复计数
    playRecorded = false;
    recordPlayOnce();
    await fetchLyrics(item.track);
    persistQueue();
  }

  /** 剩余时长进入提前量窗口时，解析下一首直链并交给引擎预加载
   * @param time 当前播放位置（秒）；默认读响应式 `currentTime`。
   *              后台优化时引擎事件不再写响应式进度，用 `enginePosition`
   *              计算——预加载不受后台模式影响，保证无缝切歌。 */
  async function maybePreload(time?: number): Promise<void> {
    if (preload || (duration.value <= 0)) return;
    const position = time ?? currentTime.value;
    if (position < duration.value - PRELOAD_AHEAD_SEC) return;
    const index = nextAutoIndex();
    if (index == null) return;
    const item = queue.value[index];
    if (!item) return;
    // 播放链已解析同一目标：直接复用其直链起预载，避免重复请求解析接口
    const chained = chainUrlAt(index);
    if (chained) {
      preload = { index, url: chained };
      engine.preload(chained);
      return;
    }
    preload = { index, url: "" };
    try {
      const url = await resolvePlayUrl(item.track);
      if (!preload || preload.index !== index) return; // 期间被重置
      preload.url = url;
      engine.preload(url);
    } catch {
      preload = null; // 解析失败：放弃预加载，播完走 ended 回退换曲
    }
  }

  /** 丢弃预加载槽（硬加载前调用；load 本身会在后端清掉预载槽） */
  function clearPreloadSlot(cancelRemote = false): void {
    preload = null;
    if (cancelRemote) engine.cancelPreload();
  }

  /**
   * 丢弃播放链（队列/模式变更、停止时才算真正失效）。
   *
   * 注意：切歌**不要**调这个——链是锁屏与后台切歌的唯一保障，每切一首就
   * 重建一次的话，一旦插件 Worker 在后台被冻结、重建失败，链会永久为空，
   * 后续切歌只能回退插件解析并卡死。
   */
  function resetPlayChain(): void {
    chainEntries = [];
    chainToken += 1; // 使在途的链解析结果失效
    engine.setPlayChain([], null);
  }

  /** 丢弃预加载与播放链状态（队列/模式变更等链已失效的场景） */
  function resetPreload(cancelRemote = false): void {
    clearPreloadSlot(cancelRemote);
    resetPlayChain();
  }

  /**
   * 把现存播放链重新交给引擎，并对齐到当前曲目。
   *
   * `engine.load()` 会让后端重新锚定链（命中则前移指针、未命中则清空），
   * 因此切歌后立刻用本地缓存的链补发一次，引擎就又能沿链自动续播——
   * 整个过程不经过插件 Worker，后台也能生效。
   */
  function republishChain(): void {
    if (!chainEntries.length) return;
    const position = chainEntries.findIndex((entry) => entry.index === currentIndex.value);
    engine.setPlayChain(chainEntries, position >= 0 ? position : null);
  }

  /** 引擎已衔接至下一首：切换曲目元数据（音频由引擎无缝续接） */
  function handleAdvanced(url: string, chainIndex: number | null): void {
    let index: number | null = null;
    if (preload && preload.url && preload.url === url) {
      index = preload.index;
      preload = null;
    } else if (chainIndex != null) {
      // 引擎沿播放链自行衔接（锁屏场景常规预载路径未走到）：直链自带队列下标
      index = chainIndex;
    } else {
      // 兜底：按直链在链上反查
      const chained = chainEntries.find((entry) => entry.url === url);
      if (chained) index = chained.index;
    }
    if (index == null) return;
    const item = queue.value[index];
    if (!item) return;
    // 引擎已经把上一首播完并沿链衔接：按旧曲时长结算平台播放记录
    flushPlayReport(duration.value > 0 ? Math.round(duration.value) : undefined);
    currentIndex.value = index;
    clearAbLoop();
    loadedTrackKey = trackUid(item.track);
    // 引擎无缝衔接到了新曲：属于新的一次播放，重新记一次历史
    playRecorded = false;
    currentTime.value = 0;
    enginePosition = 0;
    duration.value = item.track.duration ? item.track.duration / 1000 : 0;
    playing.value = true;
    loading.value = false;
    void fetchLyrics(item.track);
    persistQueue();
    void syncPlayChain(); // 为新曲目继续解析后续直链（前端已恢复时）
  }

  /** 自动切歌的下一曲索引；不可预知（sequential 末尾 / shuffle 一轮重洗）时返回 null */
  function nextAutoIndex(): number | null {
    if (!queue.value.length || currentIndex.value < 0) return null;
    if (mode.value === "loop-one") return currentIndex.value;
    const next = currentIndex.value + 1;
    if (next < queue.value.length) return next;
    return mode.value === "loop-all" && queue.value.length >= 2 ? 0 : null;
  }
  /**
   * 用已知直链起播指定队列下标（不碰插件 Worker）。
   *
   * 锁屏/媒体栏切歌与「长时间暂停后继续」时，WebView 刚被唤醒、插件 Worker
   * 往往还没就绪，走 resolvePlayUrl 会卡住甚至失败（表现为点了没声音）。
   * 调用方负责先用 chainUrlAt 取到直链。
   */
  async function playUrlAt(index: number, url: string): Promise<void> {
    // 换曲即清空 A-B 区间（与 playAt 保持一致）
    clearAbLoop();
    flushPlayReport(); // 换曲前结算上一首的平台播放记录
    // 只清预载槽：链要留着（锁屏/后台切歌全靠它），起播后再补发给引擎
    clearPreloadSlot();
    currentIndex.value = index;
    const item = queue.value[index];
    loading.value = true;
    playRecorded = false; // 新的一次加载：允许重新记一次播放
    loadedTrackKey = trackUid(item.track);
    duration.value = item.track.duration ? item.track.duration / 1000 : 0;
    currentTime.value = 0;
    enginePosition = 0;
    engine.load(url);
    engine.volume = volume.value;
    engine.muted = muted.value;
    engine.setRate(rate.value);
    try {
      await engine.play();
    } catch (error) {
      loading.value = false;
      playing.value = false;
      toast(`播放失败: ${error}`, "error");
      return;
    }
    void fetchLyrics(item.track);
    persistQueue();
    // 立即补发链（引擎 load 后重新锚定），再后台补齐后续曲目
    republishChain();
    void syncPlayChain();
  }

  /**
   * 起播指定队列下标：优先复用播放链上已解析的直链，没有才回退完整解析。
   * 返回是否走了直链快速路径。
   */
  async function startAt(index: number): Promise<boolean> {
    if (index < 0 || index >= queue.value.length) return false;
    const url = chainUrlAt(index);
    if (!url) return false;
    await playUrlAt(index, url);
    return true;
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
      flushPlayReport(duration.value > 0 ? Math.round(duration.value) : undefined); // 队列播完：结算最后一首
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
    if (await startAt(index)) return;
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
    if (await startAt(index)) return;
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
    void syncPlayChain(); // 下一曲映射可能改变，重新解析播放链
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
    void syncPlayChain(); // 下一曲映射可能改变，重新解析播放链
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
    void syncPlayChain(); // 下一曲映射可能改变，重新解析播放链
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
    // 录音作品没有歌词：别拿标题去别的播放源里瞎搜
    if (track.sourceId === RECORDING_SOURCE_ID) {
      lyrics.value = [];
      lyricsLoading.value = false;
      return;
    }
    lyricsLoading.value = true;
    lyrics.value = [];
    try {
      // 已下载且有歌词边车：离线优先读本地文件（无需插件/网络）
      const localLrc = await downloads.readLyrics(track);
      if (localLrc) {
        lyrics.value = parseLrc(localLrc);
        return;
      }
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
    resume,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    setRate,
    abPointA,
    abPointB,
    abEnabled,
    setAbPointA,
    setAbPointB,
    setAbLoopAroundCurrent,
    clearAbLoop,
    cycleMode,
    removeFromQueue,
    clearQueue,
    moveQueueItem,
    restore,
    persistQueue,
    syncEngineState,
  };
});
