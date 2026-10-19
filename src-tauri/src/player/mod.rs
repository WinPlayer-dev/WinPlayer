//! 原生音频播放引擎：解码（symphonia）→ EQ（biquad 链）→ ring buffer → rodio 输出。
//!
//! 会话模型：每个解码线程持有单调递增的会话 ID 与启动时的代际（generation）。
//! load/stop 递增 generation 使所有旧线程（含预加载线程）退出；跨淡/无缝
//! 衔接则把活跃身份（`active`）移交给预加载会话，旧线程以「淡出中」身份
//! 继续供数直至排空。
//!
//! 衔接模型（自动切歌）：
//! - 前端提前解析下一首直链并调用 `player_preload`，后端并行解码到独立
//!   ring（不触碰当前 Sink）；
//! - Crossfade：剩余 ≤ 淡入淡出时长时，新 Sink 音量 0 淡入、旧 Sink 移入
//!   fading 槽淡出，随后广播 `player://advanced`；
//! - Gapless：旧曲 ring 排空后把预载源 append 进同一 Sink（rodio 源队列
//!   自动衔接），同样广播 `player://advanced`；
//! - 预载未就绪/解析失败时回退旧行为：广播 `player://ended` 由前端换曲。
//!
//! 锁屏自动连播：Android 锁屏后 WebView 的 JS 被暂停/强节流，前端无法及时
//! 触发 `player_preload`，也无从响应 `player://ended`——自动切歌会直接停摆。
//! 因此前端提前解析**后续若干首**直链，经 `player_set_play_chain` 整链下发
//! 给引擎（`index` = 该条在播放队列中的位置，`current` = 当前曲目在链上的
//! 位置）；引擎自然播完且预载未就绪时，自己沿链前进、现场起预载会话并等待
//! 就绪后无缝衔接，连续切歌还能继续用链上后续曲目，完全不依赖前端存活。
//!
//! Tauri 事件（前端 `listen`）：
//! - `player://progress`  `{ currentTime, duration }`，解码循环每 250ms
//! - `player://duration`  `{ duration }`（probe 后，估算或精确，秒）
//! - `player://state`     `{ state }`：buffering / playing / paused / idle
//! - `player://ended`     自然播完（未发生衔接时）
//! - `player://advanced`  `{ url }`：已衔接至预加载曲目（crossfade 起点 /
//!   gapless 衔接点），前端据此切换曲目元数据
//! - `player://error`     `{ message }`（中文，可直接展示）

pub mod decoder;
pub mod eq;
pub mod http_source;
pub mod local_source;
pub mod output;
pub mod stretch;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use eq::EqChain;
use output::Output;

/// 事件名前缀
const EVENT_PROGRESS: &str = "player://progress";
const EVENT_DURATION: &str = "player://duration";
const EVENT_STATE: &str = "player://state";
const EVENT_ENDED: &str = "player://ended";
const EVENT_ADVANCED: &str = "player://advanced";
const EVENT_ERROR: &str = "player://error";

/// 淡入淡出音量斜坡步进间隔
const FADE_STEP: Duration = Duration::from_millis(50);

/// 无音频活动的容忍时长：超过后认为平台音频流（Android 退后台、
/// Windows 睡眠/设备切换）可能已被系统回收，需要重建输出流。
/// 与前端 IDLE_RELOAD_MS 保持一致。
const OUTPUT_IDLE_RESET: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    current_time: f64,
    duration: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DurationPayload {
    duration: f64,
}

#[derive(Serialize, Clone)]
struct StatePayload {
    state: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    message: String,
}

#[derive(Serialize, Clone)]
struct AdvancedPayload {
    url: String,
    /// 衔接到的曲目在播放链上的队列位置（前端据此切换曲目元数据/歌词）；
    /// 未知时为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
}

/// 预加载槽：下一首的解码会话信息，解码线程首帧后存入就绪的音源
pub(crate) struct PendingSlot {
    pub id: u64,
    pub url: String,
    /// 首帧解码后置 true，并持有待衔接的音源（含 ring 消费端）
    pub source: Option<output::RingSource>,
}

impl PendingSlot {
    fn new(id: u64, url: String) -> Self {
        PendingSlot { id, url, source: None }
    }
}

/// 播放链上的一条：前端提前解析好的直链及其在播放队列中的位置
#[derive(Clone, Debug)]
pub(crate) struct ChainEntry {
    /// 该曲目在播放队列中的下标（前端用来对齐元数据/歌词）
    pub index: usize,
    pub url: String,
}

/// 锁屏自动连播的播放链：前端提前解析的后续曲目直链，按播放顺序排列。
/// `current` 为当前正在播放的曲目在 `entries` 上的位置；引擎每次自然播完
/// 就沿链 `advance` 一格，因此锁屏期间可以连续自动切歌而无需前端参与。
#[derive(Clone, Debug, Default)]
pub(crate) struct PlayChain {
    pub entries: Vec<ChainEntry>,
    /// 当前曲目所在下标；None 表示尚未对齐（使用下一条即可）
    pub current: Option<usize>,
}

impl PlayChain {
    /// 链上下一条：指针后移一格，到链尾回卷到链首（列表循环/单曲循环续播）。
    /// 前端把「当前曲目」排在链首，因此回卷等价于从头继续播。
    pub(crate) fn next_entry(&self) -> Option<&ChainEntry> {
        if self.entries.is_empty() {
            return None;
        }
        let next = match self.current {
            Some(position) => (position + 1) % self.entries.len(),
            None => 0,
        };
        self.entries.get(next)
    }

    /// 硬切换后按新 URL 重新锚定：命中链上某条就前移指针，未命中则作废
    /// （新曲目不在链上，说明队列/模式已变，旧链不再可用）。
    pub(crate) fn reanchor(&mut self, url: &str) {
        match self.entries.iter().position(|entry| entry.url == url) {
            Some(position) => self.current = Some(position),
            None => {
                self.entries.clear();
                self.current = None;
            }
        }
    }

    /// 衔接成功后把指针移到该 URL。从当前指针之后开始找，保证指针单调前进：
    /// 单曲循环的链是同一 URL 重复多项，按「首个匹配」会永远停在 0。
    pub(crate) fn advance_to(&mut self, url: &str) {
        let len = self.entries.len();
        if len == 0 {
            return;
        }
        let start = self.current.map_or(0, |position| (position + 1) % len);
        for offset in 0..len {
            let position = (start + offset) % len;
            if self.entries[position].url == url {
                self.current = Some(position);
                return;
            }
        }
    }
}

pub struct PlayerEngine {
    app: AppHandle,
    output: Mutex<Option<Output>>,
    /// 输出设备名称（None = 系统默认设备）：输出流按此使用设备
    output_device: Mutex<Option<String>>,
    /// 当前活跃 Sink（crossfade 期间为即将转正的新音源）
    sink: Mutex<Option<Arc<rodio::Sink>>>,
    /// 淡出中的旧 Sink（crossfade 过渡期短暂存在）
    fading_sink: Mutex<Option<Arc<rodio::Sink>>>,
    /// 会话 ID 分配器（每个解码线程一个）
    session: AtomicU64,
    /// 代际：load/stop 递增，使所有旧线程（含预加载线程）退出
    generation: AtomicU64,
    /// 当前活跃会话 ID（接收 seek、上报事件、触发衔接）
    active: AtomicU64,
    /// 淡出中的会话 ID（其线程需继续供数直至排空）
    fading: AtomicU64,
    /// 预加载槽（None = 无预加载）
    pending: Mutex<Option<PendingSlot>>,
    /// 锁屏自动连播的播放链（空 = 无预解析直链可用）
    play_chain: Mutex<PlayChain>,
    /// 活跃音源的结束标记（gapless 衔接时置位，令旧源排空后让位）
    ended_flag: Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>,
    volume: Mutex<f32>,
    /// 待应用的 seek 目标（秒），由活跃解码线程消费
    pending_seek: Mutex<Option<f64>>,
    /// 用户期望的播放状态（与 Sink 的暂停位镜像）
    is_playing: AtomicBool,
    /// 解码是否跟不上（用于 waiting 事件去重）
    buffering: AtomicBool,
    /// 当前加载的 URL（seek 会话重建时需要）
    current_url: Mutex<Option<String>>,
    /// 最近一次音频活动时刻（解码推进 / 加载）：用于判定输出流是否可能失效
    last_active: Mutex<Instant>,
    /// 最近一次上报的播放位置（秒）：长时间空闲后恢复会话时用于续播
    last_position: Mutex<f64>,
    /// HTTP 客户端（长连接复用）
    client: reqwest::blocking::Client,
    /// EQ 主配置（仅承载开关/增益/版本；会话线程各自实例化滤波链——
    /// crossfade 双流采样率可能不同，滤波状态不能共享）
    eq_master: EqChain,
    /// 横向淡入淡出配置（启用 + 时长秒）
    crossfade: Mutex<(bool, f64)>,
    /// 播放倍速（0.5–2.0）：解码线程据此做保持音调的时间伸缩
    playback_rate: Mutex<f32>,
}

impl PlayerEngine {
    pub fn new(app: AppHandle) -> Arc<PlayerEngine> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("WinPlayer/1.2")
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        let engine = Arc::new(PlayerEngine {
            app: app.clone(),
            // 输出设备懒初始化（install_sink 首次调用时打开）：
            // 启动阶段不触碰平台音频栈——Android 上 cpal/Oboe 初始化链路
            // 含大量 unwrap，且 release 配置 panic=abort，一旦 panic 即闪退
            output: Mutex::new(None),
            output_device: Mutex::new(None),
            sink: Mutex::new(None),
            fading_sink: Mutex::new(None),
            session: AtomicU64::new(0),
            generation: AtomicU64::new(1),
            active: AtomicU64::new(0),
            fading: AtomicU64::new(0),
            pending: Mutex::new(None),
            play_chain: Mutex::new(PlayChain::default()),
            ended_flag: Mutex::new(None),
            volume: Mutex::new(0.8),
            pending_seek: Mutex::new(None),
            is_playing: AtomicBool::new(false),
            buffering: AtomicBool::new(false),
            current_url: Mutex::new(None),
            last_active: Mutex::new(Instant::now()),
            last_position: Mutex::new(0.0),
            client,
            eq_master: EqChain::new(),
            crossfade: Mutex::new((true, 6.0)),
            playback_rate: Mutex::new(1.0),
        });
        // 空闲状态广播一次，前端据此复位
        let _ = app.emit(EVENT_STATE, StatePayload { state: "idle" });
        engine
    }

    fn bump_session(&self) -> u64 {
        self.session.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    fn bump_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::AcqRel) + 1
    }

    fn active_id(&self) -> u64 {
        self.active.load(Ordering::Acquire)
    }

    pub(crate) fn is_active(&self, id: u64) -> bool {
        self.active_id() == id
    }

    /// 预加载槽是否仍归属该会话（预加载线程存活依据之一）
    fn pending_has(&self, id: u64) -> bool {
        self.pending.lock().unwrap().as_ref().map(|slot| slot.id) == Some(id)
    }

    /// 线程退出判定：代际过期，或既不活跃、也不在淡出、也不持有预加载槽
    pub(crate) fn is_retired(&self, id: u64, generation: u64) -> bool {
        if self.generation() != generation {
            return true;
        }
        !self.is_active(id) && self.fading.load(Ordering::Acquire) != id && !self.pending_has(id)
    }

    pub(crate) fn emit_state(&self, state: &'static str) {
        let _ = self.app.emit(EVENT_STATE, StatePayload { state });
    }

    /// 记录活跃音源的结束标记句柄（install_sink / 衔接时调用）
    fn register_ended_flag(&self, source: &output::RingSource) {
        *self.ended_flag.lock().unwrap() = Some(source.ended_handle());
    }

    /// 确保输出设备就绪（懒初始化，按当前选择的设备打开）
    fn ensure_output(&self) -> Result<(), String> {
        let mut guard = self.output.lock().unwrap();
        if guard.is_none() {
            // 懒初始化：首次播放才打开音频输出；失败不缓存，下次再试
            let selected = self.output_device.lock().unwrap().clone();
            match Output::open(selected.clone()) {
                Ok(output) => *guard = Some(output),
                Err(error) if selected.is_some() => {
                    // 选定的设备不可用（已拔出 / 名称变更）：回退系统默认设备
                    eprintln!("[player] {error}，回退系统默认输出设备");
                    *self.output_device.lock().unwrap() = None;
                    *guard = Output::open(None).ok();
                }
                Err(error) => {
                    eprintln!("[player] {error}");
                }
            }
        }
        if guard.is_none() {
            return Err("音频输出设备不可用".to_string());
        }
        Ok(())
    }

    /// 标记一次音频活动（解码推进 / 加载）
    fn touch_active(&self) {
        *self.last_active.lock().unwrap() = Instant::now();
    }

    /// 距最近一次音频活动的时长
    fn output_idle(&self) -> Duration {
        self.last_active.lock().unwrap().elapsed()
    }

    /// 长时间无音频活动后重建输出流：平台可能已回收设备会话（Android
    /// 退后台 / Windows 睡眠 / 音频设备切换），旧流上的 Sink 不再被回调
    /// 消费——继续复用会让解码线程阻塞在环形缓冲、进度冻结在 0。
    /// 先尝试打开新流，成功才替换旧流（失败则沿用，避免变得更糟）。
    fn refresh_output_if_idle(&self) {
        if self.output_idle() < OUTPUT_IDLE_RESET {
            return;
        }
        let device = self.output_device.lock().unwrap().clone();
        let Ok(fresh) = Output::open(device) else {
            return;
        };
        // 旧 Output 在此被丢弃：keepalive 线程退出、设备会话释放
        *self.output.lock().unwrap() = Some(fresh);
    }

    /// 长时间空闲后恢复播放：旧输出流与解码会话可能都已失效，且旧
    /// RingSource 已绑定在死流上无法复用——重新加载当前 URL 建全新会话，
    /// 并续播到上次位置。返回是否走了恢复路径。
    fn recover_idle_session(self: &Arc<Self>) -> bool {
        if self.output_idle() < OUTPUT_IDLE_RESET {
            return false;
        }
        let Some(url) = self.current_url.lock().unwrap().clone() else {
            // 无当前曲目：仅重建输出流并复位为 idle
            self.refresh_output_if_idle();
            self.is_playing.store(false, Ordering::Release);
            self.touch_active();
            self.emit_state("idle");
            return true;
        };
        let position = *self.last_position.lock().unwrap();
        self.load(url);
        // load 会重置位置与播放位，这里恢复续播状态
        *self.pending_seek.lock().unwrap() = Some(position);
        *self.last_position.lock().unwrap() = position;
        self.is_playing.store(true, Ordering::Release);
        true
    }

    /// 切换输出设备（None / 空串 = 系统默认）。设备变化时关闭旧输出流，
    /// 并在新设备上重建会话续播到当前位置（播放中无缝过渡到新设备）。
    fn set_output_device(self: &Arc<Self>, device: Option<String>, position: Option<f64>) {
        let device = device.filter(|name| !name.trim().is_empty());
        {
            let mut guard = self.output_device.lock().unwrap();
            if *guard == device {
                return;
            }
            *guard = device;
        }
        // 丢弃旧输出流：旧设备上的 Sink/设备会话随之失效
        *self.output.lock().unwrap() = None;
        let Some(url) = self.current_url.lock().unwrap().clone() else {
            // 无已加载曲目：仅释放旧输出流，下次播放按新设备打开
            return;
        };
        // 在当前位置重建会话；前端传来的位置优先（暂停时后端位置可能滞后）
        let resume = position
            .filter(|value| value.is_finite() && *value > 0.0)
            .or_else(|| {
                let last = *self.last_position.lock().unwrap();
                (last > 0.0).then_some(last)
            })
            .unwrap_or(0.0);
        let was_playing = self.is_playing.load(Ordering::Acquire);
        self.load(url);
        *self.pending_seek.lock().unwrap() = Some(resume);
        *self.last_position.lock().unwrap() = resume;
        self.is_playing.store(was_playing, Ordering::Release);
        if !was_playing {
            // 暂停态下 load 广播的是 buffering，这里复位为 paused
            self.emit_state("paused");
        }
    }

    /// 用新音源整体替换 Sink（旧 Sink 先 stop 再丢弃，防止混音器残留）
    fn install_sink(&self, source: output::RingSource) -> Result<(), String> {
        self.ensure_output()?;
        let sink = {
            let guard = self.output.lock().unwrap();
            guard
                .as_ref()
                .unwrap()
                .new_sink(*self.volume.lock().unwrap())?
        };
        self.register_ended_flag(&source);
        if self.is_playing.load(Ordering::Acquire) {
            sink.play();
        }
        sink.append(source);
        let mut guard = self.sink.lock().unwrap();
        if let Some(old) = guard.take() {
            old.stop();
        }
        *guard = Some(Arc::new(sink));
        Ok(())
    }

    /// 停止淡出中的 Sink（硬切换时调用，防止旧曲残响）
    fn cancel_fade(&self) {
        if let Some(sink) = self.fading_sink.lock().unwrap().take() {
            sink.stop();
        }
        self.fading.store(0, Ordering::Release);
    }

    /// 硬切换：终止一切旧会话与预加载，开始全新会话
    fn load(self: &Arc<Self>, url: String) {
        // 长时间空闲后的首次加载：先换掉可能已被系统回收的输出流，
        // 否则新 Sink 会挂在死流上一直不出声（进度冻结在 0）
        self.refresh_output_if_idle();
        self.touch_active();
        let generation = self.bump_generation();
        let id = self.bump_session();
        self.active.store(id, Ordering::Release);
        self.fading.store(0, Ordering::Release);
        *self.pending.lock().unwrap() = None;
        // 播放链不在这里清：前端可能正是在后台/锁屏切歌（链是唯一可靠的
        // 下一条来源），每次 load 都清会让链越切越短直至失效。改由锚定：
        // 命中链上某条就前移指针，未命中才作废。
        self.reanchor_chain(&url);
        *self.pending_seek.lock().unwrap() = None;
        self.buffering.store(false, Ordering::Release);
        self.is_playing.store(false, Ordering::Release);
        *self.current_url.lock().unwrap() = Some(url.clone());
        // 新会话从 0 位置开始（恢复续播时由调用方重新写入目标位置）
        *self.last_position.lock().unwrap() = 0.0;
        self.cancel_fade();
        // 立即清掉旧 Sink（旧音频静音），新 Sink 由解码线程装配
        if let Some(old) = self.sink.lock().unwrap().take() {
            old.stop();
        }
        self.emit_state("buffering");
        decoder::spawn_live(self.clone(), id, generation, url);
    }

    fn stop(&self) {
        self.bump_generation();
        self.active.store(0, Ordering::Release);
        self.fading.store(0, Ordering::Release);
        *self.pending.lock().unwrap() = None;
        *self.play_chain.lock().unwrap() = PlayChain::default();
        *self.pending_seek.lock().unwrap() = None;
        self.buffering.store(false, Ordering::Release);
        self.is_playing.store(false, Ordering::Release);
        *self.current_url.lock().unwrap() = None;
        self.cancel_fade();
        if let Some(old) = self.sink.lock().unwrap().take() {
            old.stop();
        }
        self.emit_state("idle");
    }

    /// 预加载下一首：并行解码到独立 ring，不触碰当前 Sink。
    /// 当前无活跃会话时退化为直接加载。
    fn preload(self: &Arc<Self>, url: String) {
        if self.active_id() == 0 || self.sink.lock().unwrap().is_none() {
            self.load(url);
            return;
        }
        let generation = self.generation();
        let id = self.bump_session();
        *self.pending.lock().unwrap() = Some(PendingSlot::new(id, url.clone()));
        decoder::spawn_preload(self.clone(), id, generation, url);
    }

    /// 丢弃预加载（前端队列/模式变更导致预载目标失效时调用）
    fn cancel_preload(&self) {
        *self.pending.lock().unwrap() = None;
    }

    /// Crossfade 衔接：由活跃解码线程在剩余时长 ≤ 淡入淡出窗口时调用。
    /// 成功后新 Sink 音量 0 起步并转入播放，旧 Sink 移入 fading 槽淡出。
    pub(crate) fn try_begin_crossfade(self: &Arc<Self>, from_id: u64) -> bool {
        let (enabled, fade_secs) = *self.crossfade.lock().unwrap();
        if !enabled || !self.is_active(from_id) {
            return false;
        }
        let mut slot = match self.pending.lock().unwrap().take() {
            Some(slot) => slot,
            None => return false,
        };
        let Some(source) = slot.source.take() else {
            // 预载尚未就绪：放回，稍后重试
            *self.pending.lock().unwrap() = Some(slot);
            return false;
        };
        if self.ensure_output().is_err() {
            return false;
        }
        let target_volume = *self.volume.lock().unwrap();
        let new_sink = {
            let guard = self.output.lock().unwrap();
            match guard.as_ref().unwrap().new_sink(target_volume) {
                Ok(sink) => Arc::new(sink),
                Err(_) => return false,
            }
        };
        self.register_ended_flag(&source);
        new_sink.set_volume(0.0);
        new_sink.append(source);
        if self.is_playing.load(Ordering::Acquire) {
            new_sink.play();
        }

        // 身份移交：预载会话转正，旧会话进入淡出
        let old_sink = self.sink.lock().unwrap().take();
        self.fading.store(from_id, Ordering::Release);
        self.active.store(slot.id, Ordering::Release);
        // 正在播放的曲目已变：同步 current_url，供前端恢复时反查实际曲目
        *self.current_url.lock().unwrap() = Some(slot.url.clone());
        *self.sink.lock().unwrap() = Some(new_sink.clone());
        self.buffering.store(false, Ordering::Release);
        // 已衔接到预载曲目：本次预载槽消费完毕，等待前端（或锁屏兜底）重新下发
        let index = self.chain_index_of(&slot.url);
        let _ = self
            .app
            .emit(EVENT_ADVANCED, AdvancedPayload { url: slot.url, index });

        // 淡出/淡入斜坡：以主音量为基准同步缩放两路
        let engine = self.clone();
        let fade_generation = self.generation();
        std::thread::Builder::new()
            .name("audio-fade".into())
            .spawn(move || {
                let steps = ((fade_secs / FADE_STEP.as_secs_f64()).ceil() as usize).max(1);
                for step in 1..=steps {
                    // 代际变化（load/stop/seek）时立即中止斜坡
                    if engine.generation() != fade_generation {
                        break;
                    }
                    let progress = step as f32 / steps as f32;
                    let target = *engine.volume.lock().unwrap();
                    if let Some(old) = old_sink.as_ref() {
                        old.set_volume(target * (1.0 - progress));
                    }
                    new_sink.set_volume(target * progress);
                    std::thread::sleep(FADE_STEP);
                }
                if let Some(old) = old_sink.as_ref() {
                    old.stop();
                }
                engine.fading.store(0, Ordering::Release);
            })
            .ok();
        true
    }

    /// Gapless 衔接：由活跃解码线程在自然播完且 ring 排空后调用。
    /// 旧源标记结束，rodio Sink 自动衔接预载源；返回是否衔接成功。
    pub(crate) fn try_gapless_append(&self, from_id: u64) -> bool {
        if !self.is_active(from_id) {
            return false;
        }
        let slot = match self.pending.lock().unwrap().take() {
            Some(slot) => slot,
            None => return false,
        };
        if slot.source.is_none() {
            // 预载尚未就绪：放回（随后走兜底等待/ended 回退）
            *self.pending.lock().unwrap() = Some(slot);
            return false;
        }
        if self.sink.lock().unwrap().is_none() {
            *self.pending.lock().unwrap() = Some(slot);
            return false;
        }
        self.gapless_append_slot(slot);
        true
    }

    /// 用就绪的预载槽完成 gapless 衔接（常规预载与锁屏兜底等待共用）：
    /// 旧源标记结束 → Sink 队列衔接新源 → 活跃身份移交 → 广播 advanced。
    fn gapless_append_slot(&self, mut slot: PendingSlot) -> bool {
        let Some(source) = slot.source.take() else {
            return false;
        };
        let sink_guard = self.sink.lock().unwrap();
        let Some(sink) = sink_guard.as_ref() else {
            return false;
        };
        // 旧源标记结束：排空后 Sink 队列自动前进到新源（零间隙）
        if let Some(flag) = self.ended_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Release);
        }
        self.register_ended_flag(&source);
        sink.append(source);
        drop(sink_guard);
        self.active.store(slot.id, Ordering::Release);
        // 正在播放的曲目已变：同步 current_url，供前端恢复时反查实际曲目
        *self.current_url.lock().unwrap() = Some(slot.url.clone());
        // 已衔接到链上曲目：链指针前进一格，连续切歌可继续用后续曲目
        self.chain_advance_to_url(&slot.url);
        let index = self.chain_index_of(&slot.url);
        let _ = self
            .app
            .emit(EVENT_ADVANCED, AdvancedPayload { url: slot.url, index });
        true
    }

    /* ------------------------------ 播放链 ------------------------------ */

    /// 该 URL 若非链上曲目则返回 None（供 advanced 事件带上队列下标）
    fn chain_index_of(&self, url: &str) -> Option<usize> {
        self.play_chain
            .lock()
            .unwrap()
            .entries
            .iter()
            .find(|entry| entry.url == url)
            .map(|entry| entry.index)
    }

    /// 衔接成功后把链指针移到该 URL（从当前指针之后开始找，单调前进）
    fn chain_advance_to_url(&self, url: &str) {
        self.play_chain.lock().unwrap().advance_to(url);
    }

    /// 硬切换后按新 URL 重新锚定播放链（不命中则作废）
    fn reanchor_chain(&self, url: &str) {
        self.play_chain.lock().unwrap().reanchor(url);
    }

    /// 链上下一条（相对当前指针，到链尾回卷）
    fn chain_next(&self) -> Option<(usize, String)> {
        self.play_chain
            .lock()
            .unwrap()
            .next_entry()
            .map(|entry| (entry.index, entry.url.clone()))
    }

    /// 锁屏自动连播：预载未就绪时（前端已被 WebView 暂停，无人响应 ended），
    /// 取链上下一条直链现场起预载会话并等待解码就绪，再无缝衔接。
    /// 等待超时（弱网迟迟不就绪）则放弃，回退 `player://ended`。
    pub(crate) fn promote_chain_and_wait(self: &Arc<Self>, from_id: u64) -> bool {
        if !self.is_active(from_id) {
            return false;
        }
        // 预载槽里若已是「当前正在播的这首」（前端旧逻辑只预载一首，切过来后
        // 槽仍停在这首上），直接等它就是空转：换成链上下一条。目标一致时则
        // 保留，免得丢掉已经解码好的音源。
        let (_, want) = match self.chain_next() {
            Some(next) => next,
            None => return false,
        };
        let stale = {
            let guard = self.pending.lock().unwrap();
            match guard.as_ref() {
                None => true,
                Some(slot) => slot.url != want && Some(slot.url.as_str()) == self.current_url_str().as_deref(),
            }
        };
        if stale {
            self.preload(want);
        }
        self.wait_gapless_ready(from_id)
    }

    /// 当前加载的 URL（只读克隆）
    fn current_url_str(&self) -> Option<String> {
        self.current_url.lock().unwrap().clone()
    }

    /// 等待预载槽解码就绪并完成 gapless 衔接；超时或期间发生硬切换则放弃
    fn wait_gapless_ready(&self, from_id: u64) -> bool {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if !self.is_active(from_id) {
                // 期间发生硬切换（用户亮屏操作）：丢弃预载槽，新会话自行管理
                *self.pending.lock().unwrap() = None;
                return false;
            }
            let ready = {
                let guard = self.pending.lock().unwrap();
                guard.as_ref().map_or(false, |slot| slot.source.is_some())
            };
            if ready {
                let slot = self.pending.lock().unwrap().take();
                return slot.map_or(false, |slot| self.gapless_append_slot(slot));
            }
            if Instant::now() >= deadline {
                // 超时放弃：清槽使预载线程退出，回退 ended 由前端换曲
                *self.pending.lock().unwrap() = None;
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/* ------------------------------ Tauri commands ------------------------------ */

#[tauri::command]
pub fn player_load(engine: State<Arc<PlayerEngine>>, url: String) {
    engine.load(url);
}

#[tauri::command]
pub fn player_preload(engine: State<Arc<PlayerEngine>>, url: String) {
    engine.preload(url);
}

/// 查询引擎当前正在播放的直链（前台恢复时用于反查实际曲目：锁屏期间引擎
/// 可能已按播放链自行换歌，前端需要据此对齐元数据与歌词）。
#[tauri::command]
pub fn player_current_url(engine: State<Arc<PlayerEngine>>) -> Option<String> {
    engine.current_url.lock().unwrap().clone()
}

#[tauri::command]
pub fn player_cancel_preload(engine: State<Arc<PlayerEngine>>) {
    engine.cancel_preload();
}

/// 下发锁屏自动连播的播放链：前端提前解析**后续若干首**直链并按播放顺序
/// 排好交给引擎，供「前端已被 WebView 暂停」时连续自动切歌。
///
/// - `entries`：`{ index, url }` 列表，`index` 是该曲目在播放队列中的位置
///   （前端据此对齐元数据/歌词）；
/// - `current`：当前曲目在 `entries` 上的位置（None = 尚未对齐，取链首的
///   下一条）；单曲循环时前端把当前曲目重复两项下发，引擎照常前进一格。
///
/// 空列表表示清除（队列/模式变更后由前端重新下发）。
#[tauri::command]
pub fn player_set_play_chain(
    engine: State<Arc<PlayerEngine>>,
    entries: Vec<ChainEntryArg>,
    current: Option<usize>,
) {
    let entries: Vec<ChainEntry> = entries
        .into_iter()
        .filter(|entry| !entry.url.trim().is_empty())
        .map(|entry| ChainEntry { index: entry.index, url: entry.url })
        .collect();
    let current = current.filter(|position| *position < entries.len());
    *engine.play_chain.lock().unwrap() = PlayChain { entries, current };
}

/// 播放链条目的前端载荷（serde 转为 camelCase）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainEntryArg {
    pub index: usize,
    pub url: String,
}

#[tauri::command]
pub fn player_set_crossfade(engine: State<Arc<PlayerEngine>>, enabled: bool, seconds: f64) {
    let seconds = seconds.clamp(1.0, 15.0);
    *engine.crossfade.lock().unwrap() = (enabled, seconds);
}

#[tauri::command]
pub fn player_play(engine: State<Arc<PlayerEngine>>) {
    engine.play();
}

#[tauri::command]
pub fn player_pause(engine: State<Arc<PlayerEngine>>) {
    engine.pause();
}

#[tauri::command]
pub fn player_stop(engine: State<Arc<PlayerEngine>>) {
    engine.stop();
}

#[tauri::command]
pub fn player_seek(engine: State<Arc<PlayerEngine>>, seconds: f64) {
    // seek 意味着用户要精确控制当前位置：中断进行中的 crossfade（硬切旧曲）
    engine.cancel_fade();
    *engine.pending_seek.lock().unwrap() = Some(seconds.max(0.0));
    // seek 后必然继续播（与 HTML5 行为一致），唤醒 Sink
    engine.is_playing.store(true, Ordering::Release);
    // 长时间空闲后旧输出流可能已被系统回收：对着死流 play() 不会出声。
    // 此时按目标位置重建会话（load 内部会先换掉失效的输出流）。
    if engine.output_idle() >= OUTPUT_IDLE_RESET {
        if engine.recover_idle_session() {
            // recover 会用 last_position 续播，这里改写成用户请求的目标位置
            *engine.pending_seek.lock().unwrap() = Some(seconds.max(0.0));
            return;
        }
    }
    if let Some(sink) = engine.sink.lock().unwrap().as_ref() {
        sink.play();
    }
}

#[tauri::command]
pub fn player_set_volume(engine: State<Arc<PlayerEngine>>, volume: f32) {
    let volume = volume.clamp(0.0, 1.0);
    *engine.volume.lock().unwrap() = volume;
    if let Some(sink) = engine.sink.lock().unwrap().as_ref() {
        sink.set_volume(volume);
    }
}

#[tauri::command]
pub fn player_set_eq(engine: State<Arc<PlayerEngine>>, enabled: bool, gains: Vec<f32>) {
    let mut bands = [0.0f32; 10];
    for (i, value) in gains.iter().take(10).enumerate() {
        bands[i] = value.clamp(-12.0, 12.0);
    }
    engine.eq_master.update(|state| {
        state.set_enabled(enabled);
        state.set_gains(bands);
    });
}

/// 设置播放倍速（0.5–2.0）：解码线程据此做保持音调的时间伸缩
#[tauri::command]
pub fn player_set_rate(engine: State<Arc<PlayerEngine>>, rate: f32) {
    let rate = rate.clamp(0.5, 2.0);
    *engine.playback_rate.lock().unwrap() = rate;
}

/// 列出可用输出设备名称
#[tauri::command]
pub fn player_list_output_devices() -> Result<Vec<String>, String> {
    output::list_output_devices()
}

/// 切换输出设备（`None` / 空串 = 系统默认设备）。
/// `position` 为切换前的播放位置（秒），用于在新设备上续播。
#[tauri::command]
pub fn player_set_output_device(
    engine: State<Arc<PlayerEngine>>,
    device: Option<String>,
    position: Option<f64>,
) {
    engine.set_output_device(device, position);
}

/// setup 阶段创建引擎并挂到应用状态
pub fn init(app: &tauri::App) {
    let engine = PlayerEngine::new(app.handle().clone());
    app.manage(engine);
}

/* ------------------------------ 供解码线程使用的辅助 ------------------------------ */

impl PlayerEngine {
    pub(crate) fn client(&self) -> reqwest::blocking::Client {
        self.client.clone()
    }

    pub(crate) fn buffer_dir(&self) -> Option<std::path::PathBuf> {
        self.app.path().app_cache_dir().ok()
    }

    pub(crate) fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::Acquire)
    }

    /// 开始/继续播放（`player_play` 命令与托盘菜单共用）。
    ///
    /// 需要 `&Arc<Self>`：长时间空闲后输出流可能已被系统回收，
    /// [`Self::recover_idle_session`] 要重建会话来从上次位置续播。
    pub(crate) fn play(self: &Arc<Self>) {
        self.is_playing.store(true, Ordering::Release);
        // 长时间空闲后恢复：输出流/会话可能已失效，重建会话并从上次位置续播
        if self.recover_idle_session() {
            return;
        }
        if let Some(sink) = self.sink.lock().unwrap().as_ref() {
            sink.play();
        }
        self.emit_state("playing");
    }

    /// 暂停播放（`player_pause` 命令与托盘菜单共用）
    pub(crate) fn pause(&self) {
        self.is_playing.store(false, Ordering::Release);
        if let Some(sink) = self.sink.lock().unwrap().as_ref() {
            sink.pause();
        }
        self.emit_state("paused");
    }

    /// 当前播放倍速（解码线程每次处理包时读取，支持实时变更）
    pub(crate) fn playback_rate(&self) -> f32 {
        *self.playback_rate.lock().unwrap()
    }

    pub(crate) fn take_pending_seek(&self) -> Option<f64> {
        self.pending_seek.lock().unwrap().take()
    }

    /// 是否有待应用的 seek（只窥探不消费，供 push_all 中断判断）
    pub(crate) fn has_pending_seek(&self) -> bool {
        self.pending_seek.lock().unwrap().is_some()
    }

    /// 换装新 ring（seek 后调用）：整体替换 Sink 以瞬时切断旧数据
    pub(crate) fn swap_sink(&self, source: output::RingSource) -> Result<(), String> {
        self.install_sink(source)
    }

    /// 预加载会话首帧后存入就绪音源（槽被替换/清除时返回 false）
    pub(crate) fn store_preload_source(&self, id: u64, source: output::RingSource) -> bool {
        let mut guard = self.pending.lock().unwrap();
        match guard.as_mut() {
            Some(slot) if slot.id == id => {
                slot.source = Some(source);
                true
            }
            _ => false,
        }
    }

    /// crossfade 是否启用及时长（活跃线程触发判定用）
    pub(crate) fn crossfade_config(&self) -> (bool, f64) {
        *self.crossfade.lock().unwrap()
    }

    pub(crate) fn set_buffering(&self, value: bool) -> bool {
        self.buffering.swap(value, Ordering::AcqRel)
    }

    pub(crate) fn emit_progress(&self, current_time: f64, duration: f64) {
        // 有进度推进 = 有音频活动（暂停时解码线程阻塞、不上报，
        // 因此这是判定「输出流是否长时间闲置」的可靠信号）
        *self.last_position.lock().unwrap() = current_time;
        self.touch_active();
        let _ = self.app.emit(EVENT_PROGRESS, ProgressPayload { current_time, duration });
    }

    pub(crate) fn emit_duration(&self, duration: f64) {
        let _ = self.app.emit(EVENT_DURATION, DurationPayload { duration });
    }

    pub(crate) fn emit_ended(&self) {
        self.is_playing.store(false, Ordering::Release);
        self.buffering.store(false, Ordering::Release);
        let _ = self.app.emit(EVENT_ENDED, ());
    }

    pub(crate) fn emit_error(&self, message: String) {
        self.is_playing.store(false, Ordering::Release);
        self.buffering.store(false, Ordering::Release);
        let _ = self.app.emit(EVENT_ERROR, ErrorPayload { message });
    }
}

#[cfg(test)]
mod tests {
    use super::{ChainEntry, PlayChain};

    fn chain_of(urls: &[&str], indexes: &[usize]) -> PlayChain {
        PlayChain {
            entries: urls
                .iter()
                .zip(indexes)
                .map(|(url, index)| ChainEntry { index: *index, url: (*url).to_string() })
                .collect(),
            current: Some(0),
        }
    }

    /// 链上下一条：指针后移一格，到链尾回卷到链首（列表循环续播）
    #[test]
    fn next_entry_advances_then_wraps() {
        let mut chain = chain_of(&["a", "b", "c"], &[0, 1, 2]);
        assert_eq!(chain.next_entry().unwrap().url, "b");
        chain.advance_to("b");
        assert_eq!(chain.next_entry().unwrap().url, "c");
        chain.advance_to("c");
        // 链尾回卷：等价于列表循环从头继续
        assert_eq!(chain.next_entry().unwrap().url, "a");
    }

    /// 单曲循环：同一 URL 重复多项，指针在重复项上仍逐格前进（不会被首个匹配卡住）
    #[test]
    fn advance_on_repeated_url_moves_forward() {
        let mut chain = chain_of(&["same", "same", "same", "same"], &[3, 3, 3, 3]);
        assert_eq!(chain.current, Some(0));
        chain.advance_to("same");
        assert_eq!(chain.current, Some(1), "重复 URL 上指针应前进而不是停在 0");
        chain.advance_to("same");
        assert_eq!(chain.current, Some(2));
    }

    /// 硬切换（切歌/媒体栏）后按新 URL 重新锚定：命中则前移指针，链继续可用
    #[test]
    fn reanchor_keeps_chain_when_url_is_in_it() {
        let mut chain = chain_of(&["a", "b", "c", "d"], &[0, 1, 2, 3]);
        chain.reanchor("c");
        assert_eq!(chain.current, Some(2), "命中链上 c 应前移到该位置");
        // 指针停在 c，下一条仍是 d——切歌不会把链截断
        assert_eq!(chain.next_entry().unwrap().url, "d");
    }

    /// 硬切换后新 URL 不在链上（队列/模式已变）：旧链作废
    #[test]
    fn reanchor_clears_chain_when_url_unknown() {
        let mut chain = chain_of(&["a", "b"], &[0, 1]);
        chain.reanchor("unrelated");
        assert!(chain.entries.is_empty(), "未命中应清空旧链");
        assert_eq!(chain.current, None);
    }

    /// 连续切歌（媒体栏连按）：每次锚定后链仍能提供下一条，不会越切越短
    #[test]
    fn consecutive_switches_keep_chain_usable() {
        let mut chain = chain_of(&["a", "b", "c", "d"], &[0, 1, 2, 3]);
        for (url, expect_next) in [("b", "c"), ("c", "d")] {
            chain.reanchor(url);
            assert_eq!(chain.next_entry().unwrap().url, expect_next);
        }
    }

    /// 空链不产生衔接目标（锁屏但队列未知时回退 ended）
    #[test]
    fn empty_chain_has_no_next() {
        let chain = PlayChain::default();
        assert!(chain.next_entry().is_none());
    }

    /// 未对齐（current 为 None）时从链首开始
    #[test]
    fn unaligned_chain_starts_at_head() {
        let mut chain = chain_of(&["a", "b"], &[0, 1]);
        chain.current = None;
        assert_eq!(chain.next_entry().unwrap().url, "a");
    }
}
