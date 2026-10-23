//! 人声 + 伴奏混音：按录音时间戳对齐、人声增益归一化、首尾短淡入淡出。
//!
//! 三条约束决定了这里的写法：
//! - **人声整段载入**：单声道、几十兆，换取线性重采样的随机访问（简单且够用）；
//! - **伴奏流式块读**：双声道原采样率，整段载入在移动端会吃掉上百兆；
//! - **不做效果处理**：只做电平归一化与 10ms 淡入淡出（防爆音），
//!   混响/均衡留给后续版本。
//!
//! 时间轴以伴奏为准：人声第 0 帧对齐到伴奏的第 `offset_ms` 毫秒处，
//! 正值 = 人声比伴奏晚，负值 = 人声开头被裁掉（麦克风比伴奏先启动）。

use std::path::Path;

use super::wav::{WavReader, WavWriter};

/// 混音参数
pub struct MixParams {
    /// 在录音测得的偏移之上再叠加的手动微调（毫秒）
    pub offset_ms: i32,
    /// 人声增益（dB）
    pub voice_gain_db: f32,
    /// 伴奏增益（dB）
    pub song_gain_db: f32,
    /// 是否把人声峰值归一到 -3dBFS
    pub normalize: bool,
}

impl Default for MixParams {
    fn default() -> Self {
        MixParams {
            offset_ms: 0,
            voice_gain_db: 0.0,
            song_gain_db: 0.0,
            normalize: true,
        }
    }
}

/// 每次从伴奏读出/写出的帧数
const BLOCK: usize = 1024;
/// 归一化目标峰值（≈ -3dBFS）
const TARGET_PEAK: f32 = 0.707;
/// 归一化最多提升的倍数（≈ +24dB）：手机/笔记本内置麦克风电平常低到 0.05，
/// 上限太小会导致「已经拉满还是听不见」
const MAX_BOOST: f32 = 16.0;
/// 人声首尾淡入淡出时长（秒）
const FADE_SECONDS: f32 = 0.01;

fn db_to_gain(db: f32) -> f32 {
    if db.abs() < 0.01 {
        1.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// 把 `voice.wav` 混入 `song.wav`，产出 `mix.wav`。返回成品时长（毫秒）。
pub fn render(dir: &Path, base_offset_ms: i32, params: &MixParams) -> Result<u64, String> {
    let voice_path = dir.join("voice.wav");
    let song_path = dir.join("song.wav");
    let out_path = dir.join("mix.wav");

    if !voice_path.exists() {
        return Err("录音文件缺失（没有人声轨）".to_string());
    }

    // ---------- 人声：整段载入为单声道 ----------
    let mut voice_reader =
        WavReader::open(&voice_path).map_err(|error| format!("读取人声轨失败: {error}"))?;
    let voice_sr = voice_reader.sample_rate;
    let voice_channels = voice_reader.channels as usize;
    let mut voice: Vec<f32> = Vec::with_capacity(voice_reader.frames as usize);
    {
        let mut chunk = Vec::new();
        loop {
            let got = voice_reader
                .read_frames(&mut chunk, 8192)
                .map_err(|error| format!("解码人声轨失败: {error}"))?;
            if got == 0 {
                break;
            }
            if voice_channels == 1 {
                voice.extend_from_slice(&chunk);
            } else {
                for frame in chunk.chunks(voice_channels) {
                    voice.push(frame[0]);
                }
            }
        }
    }

    // ---------- 伴奏：流式块读 ----------
    let mut song_reader = if song_path.exists() {
        match WavReader::open(&song_path) {
            Ok(reader) => Some(reader),
            Err(e) => {
                eprintln!("[recorder] 伴奏轨不可用（{e}），只导出人声");
                None
            }
        }
    } else {
        None
    };
    let out_sr = song_reader
        .as_ref()
        .map(|reader| reader.sample_rate)
        .filter(|value| *value > 0)
        .unwrap_or(voice_sr);
    let song_frames = song_reader.as_ref().map(|reader| reader.frames).unwrap_or(0);
    let song_channels = song_reader
        .as_ref()
        .map(|reader| reader.channels as usize)
        .unwrap_or(2)
        .max(1);

    // ---------- 人声电平归一化 ----------
    let peak = voice.iter().fold(0.0f32, |acc, sample| acc.max(sample.abs()));
    // 低于 -54dBFS 视作没人声（只有底噪）：放大底噪比不放大更难受
    let normalize_gain = if params.normalize && peak > 0.002 {
        (TARGET_PEAK / peak).clamp(0.1, MAX_BOOST)
    } else {
        1.0
    };
    let voice_gain = normalize_gain * db_to_gain(params.voice_gain_db);
    let song_gain = db_to_gain(params.song_gain_db);

    // ---------- 时间轴 ----------
    let ratio = voice_sr as f64 / out_sr as f64;
    let offset_total_ms = base_offset_ms as i64 + params.offset_ms as i64;
    let offset_frames = (offset_total_ms * out_sr as i64 / 1000).max(i32::MIN as i64 + 1);
    let voice_out_frames = (voice.len() as f64 * out_sr as f64 / voice_sr as f64).ceil() as i64;
    let total_frames = if song_frames > 0 {
        (song_frames as i64).max(offset_frames + voice_out_frames)
    } else if offset_frames > 0 {
        offset_frames + voice_out_frames
    } else {
        voice_out_frames
    }
    .max(0);

    let mut writer = WavWriter::create(&out_path, out_sr, 2)
        .map_err(|error| format!("创建混音文件失败: {error}"))?;

    let fade_frames = (out_sr as f32 * FADE_SECONDS).max(1.0) as i64;
    let mut out_buf: Vec<f32> = Vec::with_capacity(BLOCK * 2);
    let mut song_buf: Vec<f32> = Vec::new();

    let mut start: i64 = 0;
    while start < total_frames {
        let count = ((total_frames - start) as usize).min(BLOCK);
        out_buf.clear();

        // 伴奏块：顺序读，i 直接对应伴奏帧号
        song_buf.clear();
        if let Some(reader) = song_reader.as_mut() {
            let _ = reader
                .read_frames(&mut song_buf, count)
                .map_err(|error| format!("读取伴奏轨失败: {error}"))?;
        }

        for index in 0..count {
            let absolute = start + index as i64;

            // 伴奏（未读到的部分补静音）
            let mut left = 0.0f32;
            let mut right = 0.0f32;
            let frame_start = index * song_channels;
            if frame_start + song_channels <= song_buf.len() {
                if song_channels == 1 {
                    left = song_buf[frame_start];
                    right = left;
                } else {
                    left = song_buf[frame_start];
                    right = song_buf[frame_start + 1];
                }
                left *= song_gain;
                right *= song_gain;
            }

            // 人声（线性重采样，单声道复制到左右）
            let mut mic = 0.0f32;
            let position = (absolute - offset_frames) as f64 * ratio;
            if position >= 0.0 {
                let low = position.floor() as usize;
                if low < voice.len() {
                    let frac = (position - low as f64) as f32;
                    let first = voice[low];
                    let second = *voice.get(low + 1).unwrap_or(&first);
                    mic = first + (second - first) * frac;
                }
            }
            // 首尾淡入淡出（人声有效区间）
            let voice_start = offset_frames.max(0);
            let voice_end = (offset_frames + voice_out_frames).min(total_frames);
            if absolute >= voice_start && absolute < voice_start + fade_frames {
                mic *= (absolute - voice_start) as f32 / fade_frames as f32;
            }
            if absolute < voice_end && absolute >= voice_end - fade_frames {
                mic *= (voice_end - absolute) as f32 / fade_frames as f32;
            }
            mic *= voice_gain;

            let mixed_left = (left + mic).clamp(-1.0, 1.0);
            let mixed_right = (right + mic).clamp(-1.0, 1.0);
            out_buf.push(mixed_left);
            out_buf.push(mixed_right);
        }

        writer
            .write_samples(&out_buf)
            .map_err(|error| format!("写入混音文件失败: {error}"))?;
        start += count as i64;
    }

    writer
        .finish()
        .map_err(|error| format!("混音文件落盘失败: {error}"))?;
    Ok((total_frames as u64 * 1000) / out_sr.max(1) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::wav::WavReader;
    use std::path::PathBuf;

    const SR: u32 = 8_000;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("winplayer-mix-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_tone(path: &Path, seconds: f32, channels: u16, value: f32) {
        let mut writer = WavWriter::create(path, SR, channels).unwrap();
        let frames = (SR as f32 * seconds) as usize;
        let mut data = Vec::with_capacity(frames * channels as usize);
        for _ in 0..frames {
            for _ in 0..channels {
                data.push(value);
            }
        }
        writer.write_samples(&data).unwrap();
        writer.finish().unwrap();
    }

    fn read_all(path: &Path) -> (Vec<f32>, u16, u32) {
        let mut reader = WavReader::open(path).unwrap();
        let channels = reader.channels;
        let sample_rate = reader.sample_rate;
        let mut all = Vec::new();
        let mut chunk = Vec::new();
        loop {
            let got = reader.read_frames(&mut chunk, 1024).unwrap();
            if got == 0 {
                break;
            }
            all.extend_from_slice(&chunk);
        }
        (all, channels, sample_rate)
    }

    fn flat() -> MixParams {
        MixParams {
            offset_ms: 0,
            voice_gain_db: 0.0,
            song_gain_db: 0.0,
            normalize: false,
        }
    }

    /// 人声应按 offset 落在伴奏时间轴上：offset 之前只有伴奏，之后两者叠加
    #[test]
    fn voice_is_placed_at_offset() {
        let dir = temp_dir("offset");
        write_tone(&dir.join("song.wav"), 1.0, 2, 0.2);
        write_tone(&dir.join("voice.wav"), 0.5, 1, 0.4);

        let duration = render(&dir, 200, &flat()).unwrap();
        assert_eq!(duration, 1_000, "总长取「伴奏 1s」与「200ms + 500ms」的较大者");

        let (all, channels, _) = read_all(&dir.join("mix.wav"));
        assert_eq!(channels, 2);
        let at = |ms: usize| all[(ms * SR as usize / 1000) * 2];

        assert!((at(100) - 0.2).abs() < 0.02, "人声介入前只有伴奏: {}", at(100));
        assert!((at(300) - 0.6).abs() < 0.03, "人声区间应叠加: {}", at(300));
        assert!((at(800) - 0.2).abs() < 0.02, "人声结束后回到伴奏: {}", at(800));
    }

    /// 没有伴奏轨时只导出人声，且按人声采样率出双声道
    #[test]
    fn renders_voice_only_without_song() {
        let dir = temp_dir("voice-only");
        write_tone(&dir.join("voice.wav"), 0.4, 1, 0.5);

        let duration = render(&dir, 0, &flat()).unwrap();
        assert_eq!(duration, 400);

        let (all, channels, sample_rate) = read_all(&dir.join("mix.wav"));
        assert_eq!(channels, 2);
        assert_eq!(sample_rate, SR);
        // 首帧在淡入区间内为 0，取中段检查电平
        assert!((all[all.len() / 2] - 0.5).abs() < 0.02);
    }

    /// 负偏移表示人声比伴奏先开始，应以伴奏为基准裁掉人声开头
    #[test]
    fn negative_offset_trims_voice_head() {
        let dir = temp_dir("negative");
        write_tone(&dir.join("song.wav"), 1.0, 2, 0.1);
        write_tone(&dir.join("voice.wav"), 1.0, 1, 0.3);

        // 人声早 500ms：输出 0ms 处对应人声的 500ms
        let duration = render(&dir, -500, &flat()).unwrap();
        assert_eq!(duration, 1_000);

        let (all, _, _) = read_all(&dir.join("mix.wav"));
        let at = |ms: usize| all[(ms * SR as usize / 1000) * 2];
        // 人声在 500ms 处结束（人声总长 1000ms，从 -500ms 开始）
        assert!((at(200) - 0.4).abs() < 0.03, "叠加区: {}", at(200));
        assert!((at(700) - 0.1).abs() < 0.02, "人声收尾后: {}", at(700));
    }

    /// 人声增益归一化：低电平人声应被拉起来
    #[test]
    fn normalizes_quiet_voice() {
        let dir = temp_dir("normalize");
        write_tone(&dir.join("voice.wav"), 0.3, 1, 0.05);

        let params = MixParams {
            offset_ms: 0,
            voice_gain_db: 0.0,
            song_gain_db: 0.0,
            normalize: true,
        };
        render(&dir, 0, &params).unwrap();

        let (all, _, _) = read_all(&dir.join("mix.wav"));
        // 目标峰值 ≈ 0.707（-3dBFS），取中段避开淡入淡出
        let mid = all[all.len() / 2];
        assert!((mid - 0.707).abs() < 0.06, "归一化后峰值 {}", mid);
    }
}
