//! 解码线程：symphonia probe → 解码为 f32 交错样本 → EQ → ring buffer。
//!
//! 采样率/声道转换交给 rodio 混音器（UniformSourceIterator 自动把
//! RingSource 声明的原始参数转换到设备参数），解码线程不做重采样。
//!
//! 会话分两种模式：
//! - Live：首帧即装配 Sink 出声（正常加载 / seek 重建）
//! - Preload：首帧把音源存入引擎预加载槽，不出声；由引擎在衔接时装配
//!
//! 线程随时可能退出：代际变化（load/stop）、既不活跃也不在淡出、预加载槽
//! 被替换。所有事件广播（progress/duration/state/error/ended）仅由活跃
//! 会话发出，避免 crossfade 期间新旧进度互相干扰。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use super::eq::EqChain;
use super::http_source::HttpMediaSource;
use super::local_source::LocalFileSource;
use super::output::RingSource;
use super::stretch::TimeStretch;
use super::PlayerEngine;

/// progress 事件的发射间隔
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// ring buffer 容量（样本数）：按 1 秒估算，下限 65536
fn ring_capacity(sample_rate: u32, channels: usize) -> usize {
    (sample_rate as usize * channels.max(1)).max(65_536)
}

/// 从 URL / 本地路径提取扩展名作为 probe 提示
fn extension_hint(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    // 同时兼容 URL 的正斜杠与 Windows 本地路径的反斜杠
    let name = path.rsplit(['/', '\\']).next()?;
    let ext = name.rsplit('.').next()?;
    if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(ext.to_ascii_lowercase())
    } else {
        None
    }
}

/// 离线播放标记：`local://` 前缀后为本地文件绝对路径（见前端 resolvePlayUrl）
fn local_path_from_url(url: &str) -> Option<PathBuf> {
    url.strip_prefix("local://").map(PathBuf::from)
}

/// 启动 Live 解码会话线程（engine.load 调用）
pub(crate) fn spawn_live(
    engine: Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    url: String,
    headers: Vec<(String, String)>,
) {
    spawn(engine, id, generation, url, headers, false);
}

/// 启动预加载解码会话线程（engine.preload 调用，不出声）
pub(crate) fn spawn_preload(
    engine: Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    url: String,
    headers: Vec<(String, String)>,
) {
    spawn(engine, id, generation, url, headers, true);
}

fn spawn(
    engine: Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    url: String,
    headers: Vec<(String, String)>,
    preload: bool,
) {
    std::thread::Builder::new()
        .name("audio-decode".into())
        .spawn(move || {
            let outcome = run_session(&engine, id, generation, &url, &headers, preload);
            // 仅活跃会话才向外广播结果（预加载失败静默，前端走 ended 回退）
            if engine.is_active(id) {
                match outcome {
                    Ok(SessionOutcome::Ended) => engine.emit_ended(),
                    Ok(SessionOutcome::Advanced) => {}
                    Ok(SessionOutcome::Superseded) => {}
                    Err(message) => engine.emit_error(message),
                }
            }
        })
        .ok();
}

enum SessionOutcome {
    /// 自然播完且未衔接（ring 已排空，由外层广播 ended）
    Ended,
    /// 已衔接至预加载曲目 / 正在淡出（静默退出）
    Advanced,
    /// 被新会话取代（静默退出）
    Superseded,
}

fn run_session(
    engine: &Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    url: &str,
    headers: &[(String, String)],
    preload: bool,
) -> Result<SessionOutcome, String> {
    // 创建音源：local:// 前缀走本地文件（离线播放），否则走 HTTP 流式缓冲
    let (source, cleanup): (Box<dyn MediaSource>, Option<TempFileGuard>) =
        match local_path_from_url(url) {
            Some(path) => {
                let file =
                    LocalFileSource::open(&path).map_err(|e| format!("打开本地音频失败: {e}"))?;
                (Box::new(file), None)
            }
            None => {
                let dir = engine
                    .buffer_dir()
                    .ok_or_else(|| "无法定位音频缓冲目录".to_string())?;
                // 同步等待首块数据，保证 probe 立即有数据可读
                let http = HttpMediaSource::new(engine.client(), url.to_string(), headers, &dir)
                    .map_err(|e| format!("加载音频失败: {e}"))?;
                let guard = TempFileGuard(http.temp_path());
                (Box::new(http), Some(guard))
            }
        };
    if engine.is_retired(id, generation) {
        return Ok(SessionOutcome::Superseded);
    }

    // 退出时清理缓冲临时文件（仅 HTTP 源；结束/错误/被取代都经过这里）
    let _cleanup = cleanup;

    let mut hint = Hint::new();
    if let Some(ext) = extension_hint(url) {
        hint.with_extension(&ext);
    }

    let mss = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(describe_probe_error)?;
    if engine.is_retired(id, generation) {
        return Ok(SessionOutcome::Superseded);
    }

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "音频文件中没有可播放的轨道".to_string())?;
    let track_id = track.id;
    let time_base = track.codec_params.time_base;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(describe_codec_error)?;

    // 总时长：容器/轨道元数据（n_frames × time_base）优先，退回按总字节数 × 平均码率估算
    let mut duration_secs = match (track.codec_params.n_frames, time_base) {
        (Some(n_frames), Some(tb)) => n_frames as f64 * tb.numer as f64 / tb.denom as f64,
        _ => 0.0,
    };
    // duration 事件在活跃后发射（预加载会话转正前不上报，防止前端时长被提前改写）
    let mut duration_emitted = false;

    // 会话级 EQ 链：主配置仅承载开关/增益，双流混音时各会话滤波状态独立
    let eq = EqChain::new();
    let (eq_enabled, eq_gains) = engine.eq_master.snapshot();
    let mut eq_version = engine.eq_master.version();
    eq.update(|state| {
        state.set_enabled(eq_enabled);
        state.set_gains(eq_gains);
    });

    // 首帧解码前采样率/声道未知，ring 延迟创建
    let mut ring: Option<(rtrb::Producer<f32>, usize)> = None;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    // 保持音调的时间伸缩器（首帧确定流参数后创建；复用输出缓冲避免频繁分配）
    let mut stretch: Option<TimeStretch> = None;
    let mut stretch_out: Vec<f32> = Vec::new();
    let mut channels = 0usize;
    let mut sample_rate = 0u32;

    let mut current_time = 0.0f64;
    let mut last_progress = Instant::now();
    let mut was_buffering = false;

    // 恢复会话（长时间空闲后重建输出流）可能带着上次播放位置：probe 完成
    // 后立即定位，避免从 0 位置解码几十毫秒再跳转的瞬时爆音
    if engine.is_active(id) {
        if let Some(secs) = engine.take_pending_seek() {
            let target = Time::from(secs);
            if format
                .seek(SeekMode::Coarse, SeekTo::Time { time: target, track_id: Some(track_id) })
                .is_ok()
            {
                decoder.reset();
                current_time = secs;
                engine.emit_progress(current_time, duration_secs);
            }
        }
    }

    loop {
        if engine.is_retired(id, generation) {
            return Ok(SessionOutcome::Superseded);
        }

        // duration 事件：转正（或本就是活跃会话）后补发
        if !duration_emitted && duration_secs > 0.0 && engine.is_active(id) {
            duration_emitted = true;
            engine.emit_duration(duration_secs);
        }

        // 处理 seek 请求（仅活跃会话消费；可能在 push 阻塞期间被设置）
        if engine.is_active(id) {
            if let Some(secs) = engine.take_pending_seek() {
                apply_seek(
                    engine,
                    &mut format,
                    &mut decoder,
                    track_id,
                    secs,
                    channels,
                    sample_rate,
                    &mut ring,
                    &mut sample_buf,
                    &mut stretch,
                    &mut current_time,
                    &mut was_buffering,
                    duration_secs,
                )?;
                last_progress = Instant::now();
                continue;
            }
        }

        // crossfade 触发检测（仅活跃的 Live 会话；预加载会话不触发）
        if !preload && engine.is_active(id) && duration_secs > 0.0 && engine.is_playing() {
            let (cf_enabled, fade_secs) = engine.crossfade_config();
            let remaining = duration_secs - current_time;
            if cf_enabled && fade_secs > 0.0 && duration_secs > fade_secs * 2.0 && remaining <= fade_secs
            {
                if engine.try_begin_crossfade(id) {
                    // 身份已移交：以「淡出中」身份继续供数，直至排空
                    continue;
                }
            }
        }

        // 读取下一包
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                // 自然结束：MP3 无 Xing 头等场景到结尾才知道真实时长
                if engine.is_active(id) && duration_secs <= 0.0 && current_time > 0.0 {
                    duration_secs = current_time;
                    engine.emit_duration(duration_secs);
                    engine.emit_progress(current_time, duration_secs);
                }
                // 冲刷变速器尾部样本（不足一帧的部分零填充合成，避免截断尾声）
                if let Some(st) = stretch.as_mut() {
                    st.finish(engine.playback_rate(), &mut stretch_out);
                    if !stretch_out.is_empty() {
                        if let PushOutcome::Superseded =
                            push_all(engine, id, generation, &mut ring, &stretch_out)
                        {
                            return Ok(SessionOutcome::Superseded);
                        }
                    }
                }
                // 等 ring 排空（退休时提前返回）
                if let Some((producer, capacity)) = ring.as_ref() {
                    while !engine.is_retired(id, generation) && producer.slots() < *capacity {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
                if engine.is_retired(id, generation) {
                    return Ok(SessionOutcome::Superseded);
                }
                if engine.is_active(id) {
                    // 尝试 gapless 衔接；预载未就绪则沿播放链（前端提前下发的
                    // 后续曲目直链）前进，现场起预载并等待就绪；仍失败才回退
                    // ended（前端换曲）
                    if engine.try_gapless_append(id) {
                        return Ok(SessionOutcome::Advanced);
                    }
                    if engine.promote_chain_and_wait(id) {
                        return Ok(SessionOutcome::Advanced);
                    }
                    if !engine.is_active(id) {
                        // 兜底等待期间发生硬切换：不广播 ended 误导前端
                        return Ok(SessionOutcome::Superseded);
                    }
                    return Ok(SessionOutcome::Ended);
                }
                // 淡出中（crossfade 已触发）：静默退出
                return Ok(SessionOutcome::Advanced);
            }
            Err(SymphoniaError::ResetRequired) => return Err("音频流被重置".to_string()),
            Err(e) => return Err(format!("解码出错: {e}")),
        };

        if let Some(tb) = time_base {
            current_time = packet.ts as f64 * tb.numer as f64 / tb.denom as f64;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue, // 单包损坏：跳过
            Err(e) => return Err(describe_codec_error(e)),
        };

        // 首帧：确定流参数并装配 ring
        if ring.is_none() {
            let spec = *decoded.spec();
            channels = spec.channels.count();
            sample_rate = spec.rate;
            eq.update(|state| state.set_stream_format(sample_rate, channels));

            let capacity = ring_capacity(sample_rate, channels);
            let (producer, consumer) = rtrb::RingBuffer::new(capacity);
            let ring_source = RingSource::new(consumer, channels as u16, sample_rate);
            if preload {
                // 预加载：不出声，把音源交给引擎预加载槽等待衔接
                if !engine.store_preload_source(id, ring_source) {
                    return Ok(SessionOutcome::Superseded);
                }
            } else {
                engine.swap_sink(ring_source)?;
            }
            ring = Some((producer, capacity));
            stretch = Some(TimeStretch::new(channels, sample_rate));

            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buffer.copy_interleaved_ref(decoded);
            match apply_eq_and_push(
                engine,
                id,
                generation,
                &eq,
                &mut eq_version,
                &mut ring,
                &mut buffer,
                &mut stretch,
                &mut stretch_out,
            ) {
                PushOutcome::Superseded => return Ok(SessionOutcome::Superseded),
                // 首帧期间收到 seek：回到主循环顶部统一应用
                PushOutcome::SeekRequested => continue,
                PushOutcome::Completed => {}
            }
            if !engine.is_retired(id, generation) {
                last_progress = Instant::now();
                if engine.is_active(id) {
                    engine.emit_progress(current_time, duration_secs);
                }
            }
            continue;
        }

        // buffering 检测：播放中且 ring 已空 → 广播 buffering；恢复后广播 playing
        let buffering_now = engine.is_playing() && ring_full(&ring);
        if engine.is_active(id) {
            if buffering_now && !was_buffering {
                was_buffering = true;
                engine.set_buffering(true);
                engine.emit_state("buffering");
            } else if !buffering_now && was_buffering {
                was_buffering = false;
                engine.set_buffering(false);
                engine.emit_state("playing");
            }
        } else {
            was_buffering = buffering_now;
        }

        let spec = *decoded.spec();
        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        }
        let buffer = sample_buf.as_mut().unwrap();
        buffer.copy_interleaved_ref(decoded);
        match apply_eq_and_push(
            engine,
            id,
            generation,
            &eq,
            &mut eq_version,
            &mut ring,
            &mut *buffer,
            &mut stretch,
            &mut stretch_out,
        ) {
            PushOutcome::Superseded => return Ok(SessionOutcome::Superseded),
            // ring 满阻塞期间收到 seek：样本丢弃，回到主循环顶部应用
            PushOutcome::SeekRequested => continue,
            PushOutcome::Completed => {}
        }

        // progress 事件（节流，仅活跃会话）
        if engine.is_active(id) && last_progress.elapsed() >= PROGRESS_INTERVAL {
            last_progress = Instant::now();
            engine.emit_progress(current_time, duration_secs);
        }
    }
}

/// EQ 配置同步 + 均衡器处理 + 时间伸缩 + 推入 ring（含中断检查）
#[allow(clippy::too_many_arguments)]
fn apply_eq_and_push(
    engine: &Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    eq: &EqChain,
    eq_version: &mut u64,
    ring: &mut Option<(rtrb::Producer<f32>, usize)>,
    buffer: &mut SampleBuffer<f32>,
    stretch: &mut Option<TimeStretch>,
    stretch_out: &mut Vec<f32>,
) -> PushOutcome {
    // 主配置版本变化（用户调 EQ）：同步到本会话链
    let master_version = engine.eq_master.version();
    if master_version != *eq_version {
        *eq_version = master_version;
        let (enabled, gains) = engine.eq_master.snapshot();
        eq.update(|state| {
            state.set_enabled(enabled);
            state.set_gains(gains);
        });
    }
    eq.process(buffer.samples_mut());
    // 保持音调的时间伸缩（倍速实时读取）；原速直通（透明且零开销）
    let rate = engine.playback_rate();
    let identity = (rate - 1.0).abs() < 1e-3;
    match stretch.as_mut() {
        Some(st) if !identity => {
            st.process(buffer.samples(), rate, stretch_out);
            push_all(engine, id, generation, ring, stretch_out)
        }
        Some(st) => {
            // 由变速回到原速：丢弃伸缩器内残留样本，改直通原始样本
            if !st.is_idle() {
                st.reset();
            }
            push_all(engine, id, generation, ring, buffer.samples())
        }
        None => push_all(engine, id, generation, ring, buffer.samples()),
    }
}

/// push_all 的结果：ring 满阻塞期间可能发生会话退休或收到新 seek
enum PushOutcome {
    /// 全部推完
    Completed,
    /// 会话已退休（静默退出）
    Superseded,
    /// 期间收到新的 seek 请求（样本已丢弃，交由主循环统一应用）
    SeekRequested,
}

/// 把样本推入 ring（阻塞直到推完）；期间退休/新 seek 时中断（样本丢弃）
fn push_all(
    engine: &Arc<PlayerEngine>,
    id: u64,
    generation: u64,
    ring: &mut Option<(rtrb::Producer<f32>, usize)>,
    samples: &[f32],
) -> PushOutcome {
    let Some((producer, _)) = ring.as_mut() else {
        return PushOutcome::Completed;
    };
    let mut offset = 0usize;
    while offset < samples.len() {
        match producer.push(samples[offset]) {
            Ok(()) => offset += 1,
            Err(_) => {
                // ring 已满：检查是否需要中断，否则等待消费端腾出空间
                if engine.is_retired(id, generation) {
                    return PushOutcome::Superseded;
                }
                // 只窥探不取走：seek 值由主循环顶部统一取出应用
                if engine.is_active(id) && engine.has_pending_seek() {
                    return PushOutcome::SeekRequested;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
    PushOutcome::Completed
}

fn ring_full(ring: &Option<(rtrb::Producer<f32>, usize)>) -> bool {
    match ring {
        Some((producer, capacity)) => producer.slots() == *capacity,
        None => true,
    }
}

/// 应用 seek：symphonia 时间寻址 + 重置解码器 + 换新 ring/Sink
#[allow(clippy::too_many_arguments)]
fn apply_seek(
    engine: &Arc<PlayerEngine>,
    format: &mut Box<dyn symphonia::core::formats::FormatReader>,
    decoder: &mut Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    secs: f64,
    channels: usize,
    sample_rate: u32,
    ring: &mut Option<(rtrb::Producer<f32>, usize)>,
    sample_buf: &mut Option<SampleBuffer<f32>>,
    stretch: &mut Option<TimeStretch>,
    current_time: &mut f64,
    was_buffering: &mut bool,
    duration_secs: f64,
) -> Result<(), String> {
    let target = Time::from(secs);
    if format.seek(SeekMode::Coarse, SeekTo::Time { time: target, track_id: Some(track_id) }).is_err() {
        return Err("该音源不支持拖动进度".to_string());
    }
    decoder.reset();
    sample_buf.take();
    // 清空变速器状态，避免拖动后残留旧位置的样本
    if let Some(st) = stretch.as_mut() {
        st.reset();
    }

    // 换新 ring + Sink，瞬时切断旧数据
    let capacity = ring_capacity(sample_rate, channels);
    let (producer, consumer) = rtrb::RingBuffer::new(capacity);
    let ring_source =
        RingSource::new(consumer, channels.max(1) as u16, if sample_rate > 0 { sample_rate } else { 44_100 });
    engine.swap_sink(ring_source)?;
    *ring = Some((producer, capacity));
    *was_buffering = engine.is_playing();
    if *was_buffering {
        engine.emit_state("buffering");
    }
    *current_time = secs;
    engine.emit_progress(*current_time, duration_secs);
    Ok(())
}

fn describe_probe_error(e: SymphoniaError) -> String {
    match e {
        SymphoniaError::Unsupported(_) => "音频格式不支持（可能是 OPUS 等暂不支持的编码）".to_string(),
        SymphoniaError::IoError(err) => format!("读取音频数据失败: {err}"),
        _ => format!("无法识别音频格式: {e}"),
    }
}

fn describe_codec_error(e: SymphoniaError) -> String {
    match e {
        SymphoniaError::Unsupported(_) => "音频编码不支持".to_string(),
        SymphoniaError::IoError(err) => format!("读取音频数据失败: {err}"),
        _ => format!("解码失败: {e}"),
    }
}

/// 退出作用域时删除临时缓冲文件
struct TempFileGuard(std::path::PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
