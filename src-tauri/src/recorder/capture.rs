//! 麦克风采集：cpal 输入流 → 单声道 f32 → 无锁 ring。
//!
//! cpal 的 `Stream` 不是 Send（平台限制），只能在创建它的线程里存活，
//! 因此这里把流移入一个常驻线程持有，外部只拿停止标志与 join 句柄
//! （与 `player::output::Output` 同一套做法）。
//!
//! 采集回调跑在实时音频线程上：只做「声道混成单声道 + try_push」，
//! 不做分配、不加阻塞锁，ring 满则丢弃（宁可丢样本也不阻塞驱动）。

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::cpal::{self, FromSample, Sample, SampleFormat, SizedSample, StreamConfig};

/// 采集信息（写 WAV 头要用）
#[derive(Debug, Clone, Copy)]
pub struct CaptureInfo {
    pub sample_rate: u32,
}

/// 采集会话：drop 或 `stop()` 都会让采集线程退出并释放设备
pub struct CaptureSession {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// 最近一次回调的块峰值（f32 的位模式；正数按位比较即数值比较）
    level: Arc<AtomicU32>,
    /// 是否真的收到过非静音样本（区分「没权限/没设备」与「用户没出声」）
    live: Arc<AtomicBool>,
}

impl CaptureSession {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }

    /// 最近一次回调的块峰值（0.0–1.0），用于实时电平与「麦克风是否真的在响」判断
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// 自启动以来是否收到过明显非静音的样本
    pub fn live(&self) -> bool {
        self.live.load(Ordering::Relaxed)
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// 试音结果：给界面判断「麦克风到底出没出声」
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    /// 试音窗口内的峰值（0.0–1.0）
    pub peak: f32,
    pub sample_rate: u32,
}

/// 毫秒级墙钟：录音对齐用（人声/伴奏两侧都能拿到同一时基）
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 枚举可用输入设备名称（重名只保留一条）
pub fn list_input_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|error| format!("无法枚举麦克风设备: {error}"))?;
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

fn find_input_device(name: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|error| format!("无法枚举麦克风设备: {error}"))?;
    for device in devices {
        if device.name().map(|value| value == name).unwrap_or(false) {
            return Ok(device);
        }
    }
    Err(format!("找不到麦克风设备: {name}"))
}

/// 回调侧共享状态：生产者 + 首帧到达时刻
struct Feed {
    producer: Mutex<rtrb::Producer<f32>>,
    first_at: Arc<AtomicU64>,
    channels: usize,
    level: Arc<AtomicU32>,
    live: Arc<AtomicBool>,
}

impl Feed {
    /// 实时回调：多声道混成单声道后推入 ring
    fn feed<T>(&self, data: &[T])
    where
        T: Sample + SizedSample,
        f32: FromSample<T>,
    {
        if data.is_empty() {
            return;
        }
        // 首帧时刻：仅在第一次成功写入时记录，用作两条音轨的对齐基准
        if self.first_at.load(Ordering::Acquire) == 0 {
            let _ = self.first_at.compare_exchange(
                0,
                now_ms(),
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        }
        let Ok(mut producer) = self.producer.try_lock() else {
            return;
        };
        let channels = self.channels.max(1);
        let mut peak = 0.0f32;
        for frame in data.chunks(channels) {
            let mut sum = 0.0f32;
            for sample in frame {
                sum += f32::from_sample(*sample);
            }
            let mono = (sum / frame.len() as f32).clamp(-1.0, 1.0);
            peak = peak.max(mono.abs());
            // ring 满：丢弃（绝不阻塞音频线程）
            let _ = producer.push(mono);
        }
        // 电平只做覆盖写：界面轮询读到的是「最近一块」而不是历史峰值
        self.level.store(peak.to_bits(), Ordering::Relaxed);
        // -40dBFS 以上才算「真的有人在出声」：笔记本麦克风的固有底噪常在
        // -50dBFS 左右，阈值压太低会让「全程静音」永远判不出来
        if peak > 0.01 {
            self.live.store(true, Ordering::Relaxed);
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    feed: Arc<Feed>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| feed.feed(data),
        move |error| eprintln!("[recorder] 采集流异常: {error}"),
        None,
    )
}

/// 启动麦克风采集。
///
/// - `device_name`：`None` 用系统默认输入设备
/// - `producer`：单声道 f32 样本推送端
/// - `first_at`：首帧到达的毫秒时基（0 = 尚未收到），由调用方与伴奏侧对齐
pub fn start(
    device_name: Option<String>,
    producer: rtrb::Producer<f32>,
    first_at: Arc<AtomicU64>,
) -> Result<(CaptureInfo, CaptureSession), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<CaptureInfo, String>>();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let level = Arc::new(AtomicU32::new(0));
    let live = Arc::new(AtomicBool::new(false));
    let level_feed = level.clone();
    let live_feed = live.clone();
    let thread = std::thread::Builder::new()
        .name("recorder-mic".into())
        .spawn(move || {
            let result = open_input(
                device_name.as_deref(),
                producer,
                first_at,
                level_feed,
                live_feed,
            );
            match result {
                Ok((info, stream)) => {
                    let _ = tx.send(Ok(info));
                    // 持有 stream 直到停止（非 Send，必须留在本线程）
                    let _keepalive = stream;
                    while !stop_flag.load(Ordering::Acquire) {
                        std::thread::park_timeout(Duration::from_millis(50));
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(error));
                }
            }
        })
        .map_err(|error| format!("采集线程启动失败: {error}"))?;

    let info = rx
        .recv()
        .map_err(|_| "采集线程异常退出".to_string())??;
    Ok((
        info,
        CaptureSession {
            stop,
            thread: Some(thread),
            level,
            live,
        },
    ))
}

/// 试音：打开麦克风采集 `duration_ms` 毫秒，返回这段时间内的峰值电平。
///
/// 用于回答「麦克风到底出没出声」——系统禁止麦克风访问时设备仍能打开，
/// 但回调拿到的全是 0，只有看电平才能区分「没权限」和「用户没说话」。
pub fn probe(device_name: Option<String>, duration_ms: u64) -> Result<ProbeReport, String> {
    let (producer, _consumer) = rtrb::RingBuffer::<f32>::new(1 << 16);
    let first_at = Arc::new(AtomicU64::new(0));
    let (info, session) = start(device_name, producer, first_at)?;
    let deadline = SystemTime::now() + Duration::from_millis(duration_ms);
    let mut peak = 0.0f32;
    // 逐块轮询取最大值：回调块的瞬时峰值不适合直接 sleep 后读一次
    while SystemTime::now() < deadline {
        std::thread::sleep(Duration::from_millis(40));
        peak = peak.max(session.level());
    }
    Ok(ProbeReport {
        peak,
        sample_rate: info.sample_rate,
    })
}

/// 各采样格式统一走 f32 混音：设备给什么格式就按什么格式读
macro_rules! build_by_format {
    ($device:expr, $config:expr, $feed:expr, $format:expr) => {
        match $format {
            SampleFormat::F32 => build_stream::<f32>($device, $config, $feed),
            SampleFormat::F64 => build_stream::<f64>($device, $config, $feed),
            SampleFormat::I16 => build_stream::<i16>($device, $config, $feed),
            SampleFormat::I32 => build_stream::<i32>($device, $config, $feed),
            SampleFormat::I8 => build_stream::<i8>($device, $config, $feed),
            SampleFormat::U16 => build_stream::<u16>($device, $config, $feed),
            SampleFormat::U32 => build_stream::<u32>($device, $config, $feed),
            SampleFormat::U8 => build_stream::<u8>($device, $config, $feed),
            other => return Err(format!("麦克风采样格式不受支持: {other:?}")),
        }
    };
}

/// 在采集线程内打开设备并构建流（返回时流已就绪且已开始采集）
fn open_input(
    device_name: Option<&str>,
    producer: rtrb::Producer<f32>,
    first_at: Arc<AtomicU64>,
    level: Arc<AtomicU32>,
    live: Arc<AtomicBool>,
) -> Result<(CaptureInfo, cpal::Stream), String> {
    let device = match device_name {
        Some(name) => find_input_device(name)?,
        None => cpal::default_host()
            .default_input_device()
            .ok_or_else(|| {
                "没有可用的麦克风设备。请确认已插入麦克风，并在「设置 → 系统 → 声音」里能看到输入设备。"
                    .to_string()
            })?,
    };
    let supported = device.default_input_config().map_err(|error| {
        format!(
            "无法读取麦克风默认参数：{error}\n\
             如果系统刚更新过驱动，或该设备正被别的程序独占，请重新插拔后再试。"
        )
    })?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let feed = Arc::new(Feed {
        producer: Mutex::new(producer),
        first_at,
        channels: config.channels as usize,
        level,
        live,
    });
    let stream = build_by_format!(&device, &config, feed, sample_format)
        .map_err(|error| format!("无法打开麦克风: {error}"))?;
    // cpal 0.15 的流构建完成后是 **暂停** 状态，必须显式 play 才会触发回调。
    // 漏掉这一步的表现就是「设备能打开、录音文件全零、没有任何报错」。
    stream
        .play()
        .map_err(|error| format!("无法启动麦克风采集: {error}"))?;
    Ok((
        CaptureInfo {
            sample_rate: config.sample_rate.0,
        },
        stream,
    ))
}

#[cfg(test)]
mod tests {
    /// 真机试音：会真的打开麦克风 1.5 秒。默认 ignore（CI 没有采集设备）；
    /// 本地排查「麦克风没声音」时用
    /// `cargo test --lib recorder::capture::tests::probe_input -- --ignored --nocapture`
    #[test]
    #[ignore = "需要真实麦克风设备"]
    fn probe_input() {
        match super::probe(None, 1_500) {
            Ok(report) => println!(
                "试音峰值 {:.4}（{} Hz）{}",
                report.peak,
                report.sample_rate,
                if report.peak < 0.002 {
                    "→ 没有信号：检查系统麦克风权限或输入设备"
                } else {
                    "→ 麦克风正常"
                }
            ),
            Err(error) => println!("试音失败: {error}"),
        }
    }

    /// 枚举链路本身不能 panic：无声卡/无麦克风的机器上返回空列表或错误都算正常，
    /// 但不能因为某个设备名读不出来就崩掉整个录音棚
    #[test]
    fn lists_input_devices_without_panic() {
        match super::list_input_devices() {
            Ok(devices) => println!("输入设备: {devices:?}"),
            Err(error) => println!("枚举失败（可接受）: {error}"),
        }
    }
}
