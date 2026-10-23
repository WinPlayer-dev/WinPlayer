//! 音频输出封装：rodio 输出流与 Sink 管理。
//!
//! OutputStream 全局唯一并随引擎存活；每次加载/seek 创建新的 Sink
//! （丢弃旧 Sink 前必须显式 `stop()`，否则混音器里会残留旧音源继续出声）。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{cpal, OutputStream, OutputStreamHandle, Sink, Source};

/// 录音分流点：把「即将送往设备」的伴奏样本复制一份给录音器。
///
/// 放在 `RingSource::next` 而不是解码线程，是因为解码比播放快约 1 秒，
/// 在解码侧记时间戳会让伴奏整体提前；这里取到的才是真正出声的时序。
///
/// 回调线程约束：`try_lock` 拿不到就丢弃该样本——宁可录音缺一个样本，
/// 也不能让音频回调等锁。
pub struct SampleTap {
    producer: Mutex<rtrb::Producer<f32>>,
    /// 首帧到达时刻（毫秒墙钟，0 = 尚未收到）：录音器据此与人声对齐
    first_at: Arc<AtomicU64>,
    /// 装配音源的原始格式（采样率, 声道）：录音器写 WAV 头要用
    format: Mutex<Option<(u32, u16)>>,
}

impl SampleTap {
    pub fn new(producer: rtrb::Producer<f32>, first_at: Arc<AtomicU64>) -> Arc<Self> {
        Arc::new(SampleTap {
            producer: Mutex::new(producer),
            first_at,
            format: Mutex::new(None),
        })
    }

    /// 由引擎在装配 Sink 时告知音源格式（一定早于第一个样本到达）
    pub fn set_format(&self, sample_rate: u32, channels: u16) {
        *self.format.lock().unwrap() = Some((sample_rate, channels));
    }

    pub fn format(&self) -> Option<(u32, u16)> {
        *self.format.lock().unwrap()
    }

    fn push(&self, sample: f32) {
        if self.first_at.load(Ordering::Acquire) == 0 {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_millis() as u64)
                .unwrap_or(0);
            let _ = self
                .first_at
                .compare_exchange(0, now, Ordering::AcqRel, Ordering::Acquire);
        }
        if let Ok(mut producer) = self.producer.try_lock() {
            let _ = producer.push(sample);
        }
    }
}

/// 枚举系统默认音频主机（Windows 为 WASAPI）下的所有输出设备名称。
///
/// 名称同时作为设备标识持久化；重名设备仅保留一条。
pub fn list_output_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| format!("无法枚举音频输出设备: {e}"))?;
    let mut names = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    Ok(names)
}

/// 按名称查找输出设备（名称来自 `list_output_devices`）
fn find_output_device(name: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| format!("无法枚举音频输出设备: {e}"))?;
    for device in devices {
        if device.name().map(|n| n == name).unwrap_or(false) {
            return Ok(device);
        }
    }
    Err(format!("找不到音频输出设备: {name}"))
}

/// 打开输出流：`device_name` 为 `None` 时使用系统默认设备
fn open_stream(device_name: Option<&str>) -> Result<(OutputStream, OutputStreamHandle), String> {
    match device_name {
        Some(name) => {
            let device = find_output_device(name)?;
            OutputStream::try_from_device(&device)
                .map_err(|e| format!("无法打开输出设备「{name}」: {e}"))
        }
        None => OutputStream::try_default().map_err(|e| format!("无法打开音频输出设备: {e}")),
    }
}

/// 从 ring buffer 读取样本的 rodio Source。
///
/// ring 为空时输出静音（混音器需要它持续拉取以保持设备活跃）；
/// 采样率/声道数声明为解码流的原始值，rodio 混音器会自动转换到设备参数。
///
/// `ended` 置位且 ring 排空后，`next()` 返回 None——rodio Sink 会把该源
/// 从播放队列移除并自动衔接下一个 append 进来的源（Gapless 的衔接机制）。
pub struct RingSource {
    consumer: rtrb::Consumer<f32>,
    channels: u16,
    sample_rate: u32,
    ended: Arc<AtomicBool>,
    /// 录音分流（None = 未在录音，零开销）
    tap: Option<Arc<SampleTap>>,
}

impl RingSource {
    pub fn new(consumer: rtrb::Consumer<f32>, channels: u16, sample_rate: u32) -> Self {
        RingSource {
            consumer,
            channels,
            sample_rate,
            ended: Arc::new(AtomicBool::new(false)),
            tap: None,
        }
    }

    /// 挂上录音分流点（装配 Sink 时由引擎调用）
    pub fn with_tap(mut self, tap: Option<Arc<SampleTap>>) -> Self {
        self.tap = tap;
        self
    }

    /// 结束标记句柄（解码端全部样本推送完毕后由引擎远程置位：
    /// ring 排空后本源即结束，rodio Sink 自动衔接下一源）
    pub fn ended_handle(&self) -> Arc<AtomicBool> {
        self.ended.clone()
    }

    /// 音源的原始声道数（录音时用来写 WAV 头）
    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// 音源的原始采样率（录音时用来写 WAV 头）
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
}

impl Iterator for RingSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = match self.consumer.pop() {
            Ok(sample) => sample,
            Err(_) => {
                if self.ended.load(Ordering::Acquire) {
                    return None;
                }
                // 解码跟不上：补静音保持时间轴线性，录音时间轴才不会被压缩
                0.0
            }
        };
        if let Some(tap) = &self.tap {
            tap.push(sample);
        }
        Some(sample)
    }
}

impl Source for RingSource {
    fn current_frame_len(&self) -> Option<usize> {
        let readable = self.consumer.slots();
        if readable == 0 {
            None
        } else {
            Some(readable)
        }
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        None
    }
}

/// 全局输出流（保持 OutputStream 存活以维持设备会话）。
///
/// cpal 的 OutputStream 不是 Send/Sync（平台限制），无法放进引擎状态；
/// 把它移入常驻 park 线程持有，引擎侧只保留 Send+Sync 的 OutputStreamHandle。
///
/// 长时间无音频活动后底层设备会话可能被系统回收（Android 退后台、
/// Windows 睡眠或音频设备切换），此时旧流上的 Sink 不再被回调消费，
/// 必须丢弃旧流重开：`stop` 标志用于唤醒 park 线程退出并释放设备。
pub struct Output {
    handle: OutputStreamHandle,
    stop: Arc<AtomicBool>,
    keepalive: std::thread::JoinHandle<()>,
}

impl Drop for Output {
    fn drop(&mut self) {
        // 通知常驻线程退出：唤醒后释放 OutputStream，设备会话随之关闭
        self.stop.store(true, Ordering::Release);
        self.keepalive.thread().unpark();
    }
}

impl Output {
    /// 打开输出流：`device_name` 为 `None` 时使用系统默认设备。
    pub fn open(device_name: Option<String>) -> Result<Output, String> {
        // cpal 的 OutputStream 不是 Send，无法移入线程，只能在专用线程内创建；
        // 该线程持有 stream 维持设备会话，仅把 Send+Sync 的 handle 传回。
        let (tx, rx) = std::sync::mpsc::channel::<Result<OutputStreamHandle, String>>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let keepalive = std::thread::Builder::new()
            .name("audio-output".into())
            .spawn(move || match open_stream(device_name.as_deref()) {
                Ok((stream, handle)) => {
                    let _keepalive = stream;
                    let _ = tx.send(Ok(handle));
                    // 被 park 唤醒且标志置位时退出（Output 被丢弃 = 重建输出流）
                    while !stop_flag.load(Ordering::Acquire) {
                        std::thread::park();
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            })
            .map_err(|e| format!("音频输出线程启动失败: {e}"))?;
        let handle = rx
            .recv()
            .map_err(|_| "音频输出线程异常退出".to_string())??;
        Ok(Output { handle, stop, keepalive })
    }

    /// 创建一个新 Sink（默认置为暂停，由播放命令显式恢复）
    pub fn new_sink(&self, volume: f32) -> Result<Sink, String> {
        let sink = Sink::try_new(&self.handle).map_err(|e| format!("创建播放器失败: {e}"))?;
        sink.set_volume(volume);
        sink.pause();
        Ok(sink)
    }
}
