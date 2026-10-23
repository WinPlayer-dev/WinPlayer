//! 录音棚（唱歌模式）：伴奏 + 麦克风双轨录制，停止后自动混音。
//!
//! # 数据流
//!
//! ```text
//! 播放引擎 ──解码──▶ ring ──▶ rodio Sink ──▶ 设备
//!                          │
//!                          └─(SampleTap)─▶ song ring ─▶ 写盘线程 ─▶ song.wav
//!
//! 麦克风 ──cpal──▶ mic ring ─▶ 写盘线程 ─▶ voice.wav
//!                                   └──(可选)──▶ monitor ring ─▶ Sink ─▶ 耳机
//! ```
//!
//! 伴奏分流点放在 `RingSource::next`（真正出声的时刻），而不是解码线程：
//! 解码领先播放约 1 秒，在解码侧取时间戳会让两条轨整体错位。
//!
//! # 对齐
//!
//! 两条轨各自记录「首帧到达的毫秒墙钟」，停止时用差值作为人声相对伴奏的
//! 起始偏移（`offsetMs`）。设备本身的 ADC/DAC 延迟无法自动消除，混音时
//! 可以用 `syncMs` 手动微调。
//!
//! # 落盘
//!
//! `{appData}/recordings/{id}/` 下：`meta.json` + `voice.wav` + `song.wav` + `mix.wav`。
//! 三条轨都是 PCM 16-bit，混音阶段不再有损编码。

pub mod capture;
pub mod mix;
pub mod wav;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::player::output::{RingSource, SampleTap};
use crate::player::PlayerEngine;
use capture::CaptureSession;
use wav::WavWriter;

/// 伴奏 ring（约 3 秒立体声，写盘跟不上时不至于丢样本）
const SONG_RING: usize = 1 << 18;
/// 人声 ring（约 1.3 秒 @48k）
const MIC_RING: usize = 1 << 16;
/// 监听 ring（约 0.7 秒 @48k）：监听宁可丢一点也不能拖长延迟
const MONITOR_RING: usize = 1 << 15;
/// 单次从 ring 取出的样本数
const DRAIN_BLOCK: usize = 2048;

/* ------------------------------ 数据结构 ------------------------------ */

/// 一次录音的元数据（`meta.json`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeta {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// 开始录音的毫秒时间戳
    pub created_at: u64,
    /// 录音时长（毫秒，取两条轨较长者）
    pub duration_ms: u64,
    #[serde(default)]
    pub song_frames: u64,
    #[serde(default)]
    pub song_sample_rate: u32,
    #[serde(default)]
    pub song_channels: u16,
    #[serde(default)]
    pub voice_frames: u64,
    #[serde(default)]
    pub voice_sample_rate: u32,
    /// 自动测得的偏移：正值 = 人声晚于伴奏（毫秒）
    #[serde(default)]
    pub offset_ms: i32,
    /// 手动对齐微调（毫秒），叠加在 offsetMs 之上
    #[serde(default)]
    pub sync_ms: i32,
    /// 是否已生成 mix.wav
    #[serde(default)]
    pub has_mix: bool,
}

/// 前端展示用的录音条目
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingItem {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover: Option<String>,
    pub source: Option<String>,
    pub created_at: u64,
    pub duration_ms: u64,
    pub offset_ms: i32,
    pub sync_ms: i32,
    pub has_mix: bool,
    pub has_song: bool,
    /// 目录绝对路径（打开所在文件夹用）
    pub dir: String,
    /// 可播放的本地路径（`local://` 前缀，交给原生引擎解码）
    pub mix_path: Option<String>,
    pub voice_path: Option<String>,
    /// 录音质量提醒（如「麦克风全程静音」），只在刚录完时返回
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// 开始录音的参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    /// 麦克风设备名（None = 系统默认）
    #[serde(default)]
    pub device: Option<String>,
    /// 是否开启耳机监听
    #[serde(default)]
    pub monitor: bool,
    #[serde(default = "default_monitor_volume")]
    pub monitor_volume: f32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

fn default_monitor_volume() -> f32 {
    0.7
}

/// 混音参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixOptions {
    #[serde(default)]
    pub offset_ms: i32,
    #[serde(default)]
    pub voice_gain_db: f32,
    #[serde(default)]
    pub song_gain_db: f32,
}

/// 录音工程存储（Tauri 状态）
#[derive(Default)]
pub struct RecorderStore {
    session: Mutex<Option<Session>>,
}

/* ------------------------------ 会话 ------------------------------ */

struct SongOutcome {
    /// 累计写入的**单样本**数（交错），帧数由调用方按声道折算
    samples: u64,
    sample_rate: u32,
    channels: u16,
    error: Option<String>,
}

struct VoiceOutcome {
    /// 人声是单声道，样本数 = 帧数
    frames: u64,
    sample_rate: u32,
    error: Option<String>,
}

struct Session {
    id: String,
    dir: PathBuf,
    title: String,
    artist: String,
    cover: Option<String>,
    source: Option<String>,
    created_at: u64,
    song_first: Arc<AtomicU64>,
    mic_first: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    mic: Option<CaptureSession>,
    monitor: Option<rodio::Sink>,
    song_thread: Option<std::thread::JoinHandle<SongOutcome>>,
    voice_thread: Option<std::thread::JoinHandle<VoiceOutcome>>,
}

/* ------------------------------ 工具 ------------------------------ */

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn recordings_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
    let dir = base.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建录音目录失败: {error}"))?;
    Ok(dir)
}

/// 从 ring 批量取样本，返回取到的数量
fn drain(consumer: &mut rtrb::Consumer<f32>, buffer: &mut Vec<f32>, max: usize) -> usize {
    buffer.clear();
    for _ in 0..max {
        match consumer.pop() {
            Ok(value) => buffer.push(value),
            Err(_) => break,
        }
    }
    buffer.len()
}

fn local_url(path: &Path) -> String {
    format!("local://{}", path.to_string_lossy())
}

fn item_from_meta(dir: &Path, meta: &RecordingMeta) -> RecordingItem {
    let mix = dir.join("mix.wav");
    let voice = dir.join("voice.wav");
    let song = dir.join("song.wav");
    let mix_ok = mix.is_file();
    RecordingItem {
        id: meta.id.clone(),
        title: meta.title.clone(),
        artist: meta.artist.clone(),
        cover: meta.cover.clone(),
        source: meta.source.clone(),
        created_at: meta.created_at,
        duration_ms: meta.duration_ms,
        offset_ms: meta.offset_ms,
        sync_ms: meta.sync_ms,
        has_mix: mix_ok,
        has_song: song.is_file(),
        dir: dir.to_string_lossy().to_string(),
        mix_path: mix_ok.then(|| local_url(&mix)),
        voice_path: voice.is_file().then(|| local_url(&voice)),
        warning: None,
    }
}

fn write_meta(dir: &Path, meta: &RecordingMeta) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(meta).map_err(|error| format!("序列化录音信息失败: {error}"))?;
    std::fs::write(dir.join("meta.json"), text).map_err(|error| format!("写入录音信息失败: {error}"))
}

fn read_meta(dir: &Path) -> Option<RecordingMeta> {
    let text = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/* ------------------------------ 采集线程 ------------------------------ */

/// 伴奏写盘线程：等音源格式确定后建 WAV，之后持续排空 ring
fn spawn_song_writer(
    dir: PathBuf,
    consumer: rtrb::Consumer<f32>,
    stop: Arc<AtomicBool>,
    tap: Arc<SampleTap>,
) -> std::thread::JoinHandle<SongOutcome> {
    std::thread::Builder::new()
        .name("recorder-song".into())
        .spawn(move || {
            let mut consumer = consumer;
            let mut writer: Option<WavWriter> = None;
            let mut outcome = SongOutcome {
                samples: 0,
                sample_rate: 0,
                channels: 0,
                error: None,
            };
            let mut buffer: Vec<f32> = Vec::with_capacity(DRAIN_BLOCK);
            loop {
                let stopping = stop.load(Ordering::Acquire);
                // 只有 ring 里真有样本时才建文件：音源格式由 install_sink 在
                // 第一个样本之前告知，因此此时 format 必定可用，不会写错头。
                if writer.is_none() && consumer.slots() > 0 {
                    let created = tap
                        .format()
                        .ok_or_else(|| "无法确定伴奏采样格式".to_string())
                        .and_then(|(sample_rate, channels)| {
                            WavWriter::create(&dir.join("song.wav"), sample_rate, channels)
                                .map_err(|error| format!("创建伴奏轨失败: {error}"))
                        });
                    match created {
                        Ok(file) => {
                            outcome.sample_rate = file.sample_rate();
                            outcome.channels = file.channels();
                            writer = Some(file);
                        }
                        Err(error) => {
                            outcome.error = Some(error);
                            return outcome;
                        }
                    }
                }
                let mut wrote = false;
                if let Some(target) = writer.as_mut() {
                    let got = drain(&mut consumer, &mut buffer, DRAIN_BLOCK);
                    if got > 0 {
                        if let Err(error) = target.write_samples(&buffer) {
                            outcome.error = Some(format!("写伴奏轨失败: {error}"));
                            break;
                        }
                        outcome.samples += got as u64;
                        wrote = true;
                    }
                }
                if stopping && !wrote {
                    break;
                }
                if !wrote {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            if let Some(target) = writer {
                if let Err(error) = target.finish() {
                    outcome.error = Some(format!("伴奏轨落盘失败: {error}"));
                }
            }
            outcome
        })
        .expect("伴奏写盘线程启动失败")
}

/// 人声写盘线程：同时（可选）把样本推给监听 ring
fn spawn_voice_writer(
    dir: PathBuf,
    consumer: rtrb::Consumer<f32>,
    stop: Arc<AtomicBool>,
    sample_rate: u32,
    monitor: Option<Mutex<rtrb::Producer<f32>>>,
) -> std::thread::JoinHandle<VoiceOutcome> {
    std::thread::Builder::new()
        .name("recorder-voice".into())
        .spawn(move || {
            let mut consumer = consumer;
            let mut outcome = VoiceOutcome {
                frames: 0,
                sample_rate,
                error: None,
            };
            let mut writer = match WavWriter::create(&dir.join("voice.wav"), sample_rate, 1) {
                Ok(created) => created,
                Err(error) => {
                    outcome.error = Some(format!("创建人声轨失败: {error}"));
                    return outcome;
                }
            };
            let mut buffer: Vec<f32> = Vec::with_capacity(DRAIN_BLOCK);
            loop {
                let stopping = stop.load(Ordering::Acquire);
                let got = drain(&mut consumer, &mut buffer, DRAIN_BLOCK);
                if got > 0 {
                    if let Some(target) = monitor.as_ref() {
                        if let Ok(mut producer) = target.try_lock() {
                            for sample in &buffer {
                                let _ = producer.push(*sample);
                            }
                        }
                    }
                    if let Err(error) = writer.write_samples(&buffer) {
                        outcome.error = Some(format!("写人声轨失败: {error}"));
                        break;
                    }
                    outcome.frames += got as u64;
                }
                if stopping && got == 0 {
                    break;
                }
                if got == 0 {
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            if let Err(error) = writer.finish() {
                outcome.error = Some(format!("人声轨落盘失败: {error}"));
            }
            outcome
        })
        .expect("人声写盘线程启动失败")
}

/* ------------------------------ 播放协议 ------------------------------ */

/// 录音播放协议：`http://recording.localhost/?id=<id>&f=mix.wav`
///
/// 前端 `<audio>` 直接播放成品/分轨（支持 Range，长录音也能拖动进度）。
/// 只允许读 `recordings/<id>/` 下白名单内的三个文件，不接受任意路径。
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("recording", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            responder.respond(serve_recording(&app, request).await);
        });
    })
}

fn binary_response(
    status: u16,
    body: Vec<u8>,
    extra: Option<(String, String)>,
) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", "audio/wav")
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*");
    if let Some((name, value)) = extra {
        builder = builder.header(name, value);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// 解析 `Range: bytes=start-end`（只处理单段）
fn parse_range(header: &str, total: usize) -> Option<(usize, usize)> {
    let spec = header.strip_prefix("bytes=")?;
    let (start_text, end_text) = spec.split_once('-')?;
    let start = start_text.trim().parse::<usize>().ok()?;
    let end = if end_text.trim().is_empty() {
        total.checked_sub(1)?
    } else {
        end_text.trim().parse::<usize>().ok()?
    };
    if start >= total {
        return None;
    }
    Some((start, end.min(total.saturating_sub(1))))
}

async fn serve_recording<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let not_found = || binary_response(404, b"not found".to_vec(), None);
    let Ok(url) = tauri::Url::parse(&request.uri().to_string()) else {
        return not_found();
    };
    let mut id = None;
    let mut file = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "id" => id = Some(value.into_owned()),
            "f" => file = Some(value.into_owned()),
            _ => {}
        }
    }
    let (Some(id), Some(file)) = (id, file) else {
        return not_found();
    };
    if !matches!(file.as_str(), "mix.wav" | "voice.wav" | "song.wav") {
        return not_found();
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return not_found();
    }
    let Ok(root) = recordings_dir(app) else {
        return not_found();
    };
    let path = root.join(&id).join(&file);
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return not_found();
    };
    let total = meta.len() as usize;
    if total == 0 {
        return not_found();
    }
    let range_header = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let range = range_header.as_deref().and_then(|value| parse_range(value, total));
    // 只读请求需要的字节区间：`<audio>` 拖进度会连续发多个 Range 请求，
    // 每次都整段读入几十兆会让内存和延迟一起抖
    let (start, end, status) = match range {
        Some((start, end)) => (start, end, 206u16),
        None => (0, total - 1, 200u16),
    };
    let length = end - start + 1;
    let read = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<Vec<u8>> {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = std::fs::File::open(&path)?;
        file.seek(SeekFrom::Start(start as u64))?;
        let mut buffer = vec![0u8; length];
        file.read_exact(&mut buffer)?;
        Ok(buffer)
    })
    .await;
    let Ok(Ok(bytes)) = read else {
        return not_found();
    };
    let extra = if status == 206 {
        Some((
            "Content-Range".to_string(),
            format!("bytes {start}-{end}/{total}"),
        ))
    } else {
        Some(("Content-Length".to_string(), total.to_string()))
    };
    binary_response(status, bytes, extra)
}

/// 列出可用麦克风设备
#[tauri::command]
pub fn recorder_list_devices() -> Result<Vec<String>, String> {
    capture::list_input_devices()
}

/// setup 阶段挂载录音状态
pub fn init(app: &tauri::App) {
    app.manage(RecorderStore::default());
}

/// 当前是否在录音
#[tauri::command]
pub fn recorder_status(store: State<RecorderStore>) -> bool {
    store.session.lock().unwrap().is_some()
}

/// 确保麦克风权限：Android 6+ 需要运行时授权，桌面端恒成功
fn ensure_mic_permission<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_mic_permission::MicPermissionExt;
        return app.mic_permission().request();
    }
    #[cfg(desktop)]
    {
        let _ = app;
        Ok(())
    }
}

/// 开始录音：挂载伴奏分流点 + 启动麦克风采集
#[tauri::command]
pub fn recorder_start(
    app: AppHandle,
    engine: State<Arc<PlayerEngine>>,
    store: State<RecorderStore>,
    options: StartOptions,
) -> Result<(), String> {
    let mut guard = store.session.lock().unwrap();
    if guard.is_some() {
        return Err("已经在录音了".to_string());
    }
    ensure_mic_permission(&app)?;
    let id = now_ms().to_string();
    let dir = recordings_dir(&app)?.join(&id);
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建录音目录失败: {error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let song_first = Arc::new(AtomicU64::new(0));
    let mic_first = Arc::new(AtomicU64::new(0));

    // ---------- 伴奏分流 ----------
    let (song_producer, song_consumer) = rtrb::RingBuffer::<f32>::new(SONG_RING);
    let tap = SampleTap::new(song_producer, song_first.clone());
    let song_thread = spawn_song_writer(dir.clone(), song_consumer, stop.clone(), tap.clone());

    // ---------- 麦克风采集 ----------
    let (mic_producer, mic_consumer) = rtrb::RingBuffer::<f32>::new(MIC_RING);
    let (info, mic) = capture::start(options.device.clone(), mic_producer, mic_first.clone())?;

    // ---------- 监听 ----------
    let mut monitor_sink = None;
    let monitor_producer = if options.monitor {
        let (producer, consumer) = rtrb::RingBuffer::<f32>::new(MONITOR_RING);
        match engine.new_monitor_sink(options.monitor_volume.clamp(0.0, 2.0)) {
            Ok(sink) => {
                sink.append(RingSource::new(consumer, 1, info.sample_rate));
                sink.play();
                monitor_sink = Some(sink);
                Some(Mutex::new(producer))
            }
            Err(error) => {
                eprintln!("[recorder] 监听不可用: {error}");
                None
            }
        }
    } else {
        None
    };

    let voice_thread = spawn_voice_writer(
        dir.clone(),
        mic_consumer,
        stop.clone(),
        info.sample_rate,
        monitor_producer,
    );

    // ---------- 挂载伴奏分流（会重建当前会话，让新音源带上 tap） ----------
    engine.set_sample_tap(Some(tap));

    *guard = Some(Session {
        id,
        dir,
        title: options.title,
        artist: options.artist,
        cover: options.cover,
        source: options.source,
        created_at: now_ms(),
        song_first,
        mic_first,
        stop,
        mic: Some(mic),
        monitor: monitor_sink,
        song_thread: Some(song_thread),
        voice_thread: Some(voice_thread),
    });
    Ok(())
}

/// 停止录音并自动混音，返回成品条目
#[tauri::command]
pub fn recorder_stop(
    engine: State<Arc<PlayerEngine>>,
    store: State<RecorderStore>,
) -> Result<RecordingItem, String> {
    let session = store
        .session
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "当前没有在录音".to_string())?;

    // 1. 先停麦克风：不再产生新样本
    let mut mic = session.mic;
    // 停止前记下「到底有没有收到过非静音样本」，用来区分「没权限」与「没唱」
    let mic_live = mic.as_ref().map(|value| value.live()).unwrap_or(false);
    if let Some(mic) = mic.as_mut() {
        mic.stop();
    }

    // 2. 停止伴奏分流（不重建会话：旧音源上的 tap 推入无人消费的 ring，满后自动丢弃）
    engine.set_sample_tap(None);

    // 3. 收尾写盘线程
    session.stop.store(true, Ordering::Release);
    let song = session.song_thread.and_then(|handle| handle.join().ok());
    let voice = session.voice_thread.and_then(|handle| handle.join().ok());

    // 4. 关闭监听
    if let Some(sink) = session.monitor {
        sink.stop();
    }

    let song_frames = song
        .as_ref()
        .map(|value| value.samples / value.channels.max(1) as u64)
        .unwrap_or(0);
    let song_sr = song.as_ref().map(|value| value.sample_rate).unwrap_or(0);
    let song_channels = song.as_ref().map(|value| value.channels).unwrap_or(0);
    let voice_frames = voice.as_ref().map(|value| value.frames).unwrap_or(0);
    let voice_sr = voice
        .as_ref()
        .map(|value| value.sample_rate)
        .filter(|value| *value > 0)
        .unwrap_or(48_000);

    // 5. 对齐：两条轨首帧到达时间的差值
    let song_at = session.song_first.load(Ordering::Acquire);
    let mic_at = session.mic_first.load(Ordering::Acquire);
    let offset_ms = if song_at > 0 && mic_at > 0 {
        (mic_at as i64 - song_at as i64).clamp(-5_000, 5_000) as i32
    } else {
        0
    };

    let duration_ms = {
        let song_ms = if song_sr > 0 {
            song_frames * 1000 / song_sr as u64
        } else {
            0
        };
        let voice_ms = voice_frames * 1000 / voice_sr as u64;
        song_ms.max(voice_ms.saturating_add_signed(offset_ms as i64))
    };

    let mut meta = RecordingMeta {
        id: session.id.clone(),
        title: session.title,
        artist: session.artist,
        cover: session.cover,
        source: session.source,
        created_at: session.created_at,
        duration_ms,
        song_frames,
        song_sample_rate: song_sr,
        song_channels,
        voice_frames,
        voice_sample_rate: voice_sr,
        offset_ms,
        sync_ms: 0,
        has_mix: false,
    };

    // 6. 两条轨都为空：不留下空工程
    if voice_frames == 0 && song_frames == 0 {
        let _ = std::fs::remove_dir_all(&session.dir);
        let detail = voice
            .as_ref()
            .and_then(|value| value.error.clone())
            .or_else(|| song.as_ref().and_then(|value| value.error.clone()))
            .unwrap_or_else(|| "没有采集到任何声音".to_string());
        return Err(format!("录音失败: {detail}"));
    }

    // 7. 自动混音（失败也保留分轨，便于重试导出）
    if let Err(error) = mix::render(&session.dir, offset_ms, &mix::MixParams::default()) {
        eprintln!("[recorder] 自动混音失败: {error}");
    } else {
        meta.has_mix = true;
    }
    write_meta(&session.dir, &meta)?;

    if let Some(error) = voice.as_ref().and_then(|value| value.error.clone()) {
        eprintln!("[recorder] {error}");
    }
    let mut item = item_from_meta(&session.dir, &meta);
    // 麦克风一路静音：文件能播但没有自己的声音，用户会以为「录坏了」
    if !mic_live {
        item.warning = Some(if song_frames > 0 {
            "麦克风没有收到任何声音，这条只有伴奏。请检查 Windows「设置 → 隐私和安全性 → 麦克风」里是否允许桌面应用访问麦克风，以及录音棚里选的输入设备是否正确。"
                .to_string()
        } else {
            "麦克风没有收到任何声音。请检查系统的麦克风权限与输入设备选择。".to_string()
        });
    }
    Ok(item)
}

/// 录音中的实时电平（0.0–1.0）：界面用它画电平条，也能立刻看出麦克风是否在响
#[tauri::command]
pub fn recorder_level(store: State<RecorderStore>) -> f32 {
    store
        .session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|session| session.mic.as_ref())
        .map(|mic| mic.level())
        .unwrap_or(0.0)
}

/// 试音：采集一小段时间并返回峰值电平，用来确认麦克风真的能出声。
///
/// 系统拒绝麦克风访问时设备依然「能打开」，只是回调全是 0，
/// 所以只能靠电平区分「没权限」和「没说话」。
#[tauri::command]
pub async fn recorder_probe_mic(device: Option<String>) -> Result<capture::ProbeReport, String> {
    tauri::async_runtime::spawn_blocking(move || capture::probe(device, 1_500))
        .await
        .map_err(|error| format!("试音失败: {error}"))?
}

/// 打开系统的麦克风隐私设置（Windows / Android 各自的入口）
#[tauri::command]
pub fn recorder_open_mic_settings(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", "ms-settings:privacy-microphone"])
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开系统设置: {error}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台请手动到系统设置里授权麦克风".to_string())
    }
}

/// 列出所有录音工程（按创建时间倒序）
#[tauri::command]
pub fn recorder_list(app: AppHandle) -> Result<Vec<RecordingItem>, String> {
    let root = recordings_dir(&app)?;
    let mut items = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(items);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(meta) = read_meta(&path) {
            items.push(item_from_meta(&path, &meta));
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

/// 主播放器要的播放地址：`local://<绝对路径>/mix.wav`
///
/// 主播放器走原生解码器（symphonia），它只认 `local://` 前缀；
/// `recording.localhost` 那种自定义协议只有 WebView 认识，交给它取不到流。
#[tauri::command]
pub fn recorder_play_path(app: AppHandle, id: String) -> Result<String, String> {
    let dir = recordings_dir(&app)?.join(&id);
    let mix = dir.join("mix.wav");
    if !mix.is_file() {
        return Err("这条录音还没有可播放的成品".to_string());
    }
    Ok(local_url(&mix))
}

/// 重新混音（调整对齐微调与两条轨的增益）
#[tauri::command]
pub fn recorder_export_mix(
    app: AppHandle,
    id: String,
    options: MixOptions,
) -> Result<RecordingItem, String> {
    let dir = recordings_dir(&app)?.join(&id);
    if !dir.is_dir() {
        return Err("录音不存在".to_string());
    }
    let mut meta = read_meta(&dir).ok_or_else(|| "录音信息缺失".to_string())?;
    let params = mix::MixParams {
        offset_ms: options.offset_ms,
        voice_gain_db: options.voice_gain_db,
        song_gain_db: options.song_gain_db,
        normalize: true,
    };
    let duration = mix::render(&dir, meta.offset_ms, &params)?;
    meta.sync_ms = options.offset_ms;
    meta.has_mix = true;
    meta.duration_ms = duration;
    write_meta(&dir, &meta)?;
    Ok(item_from_meta(&dir, &meta))
}

/// 删除一个录音工程
#[tauri::command]
pub fn recorder_delete(app: AppHandle, id: String) -> Result<(), String> {
    let root = recordings_dir(&app)?;
    let dir = root.join(&id);
    // 只允许删 recordings 下的直接子目录，防止 id 被构造成越界路径
    let ok = dir.parent() == Some(root.as_path())
        && dir.is_dir()
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\');
    if !ok {
        return Err("录音不存在".to_string());
    }
    std::fs::remove_dir_all(&dir).map_err(|error| format!("删除录音失败: {error}"))
}

/// 打开录音所在文件夹
#[tauri::command]
pub fn recorder_reveal(app: AppHandle, id: String) -> Result<(), String> {
    if cfg!(mobile) {
        return Err("移动端暂不支持打开文件夹".to_string());
    }
    let dir = recordings_dir(&app)?.join(&id);
    if !dir.is_dir() {
        return Err("录音不存在".to_string());
    }
    let target = if dir.join("mix.wav").exists() {
        dir.join("mix.wav")
    } else {
        dir
    };
    #[cfg(target_os = "windows")]
    let spawn = std::process::Command::new("explorer")
        .arg(format!("/select,{}", target.display()))
        .spawn();
    #[cfg(target_os = "macos")]
    let spawn = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawn = std::process::Command::new("xdg-open")
        .arg(target.parent().unwrap_or(Path::new(".")))
        .spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    let spawn: Result<std::process::Child, std::io::Error> =
        Err(std::io::Error::new(std::io::ErrorKind::Other, "unsupported"));

    spawn.map(|_| ()).map_err(|error| format!("打开文件夹失败: {error}"))
}
