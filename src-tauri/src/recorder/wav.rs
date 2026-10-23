//! 极简 WAV（RIFF / PCM 16-bit 小端）读写。
//!
//! 录音是边录边写的：创建时先占位 44 字节头，`finish` 再把 RIFF/data 长度
//! 回填进去。这样录制过程中进程异常退出最多丢长度字段（数据本身仍在），
//! 不需要在内存里攒完整首歌。
//!
//! 读取器按帧流式返回，混音时内存恒定（不把两条音轨整段载入）。
//! 只支持本项目自己写出的格式（PCM 16-bit），其他 WAV 直接报错而不是猜测。

use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// canonical WAV 头长度（无附加 chunk）
const HEADER_LEN: usize = 44;

/// 流式 WAV 写入器（PCM 16-bit）
pub struct WavWriter {
    file: BufWriter<File>,
    sample_rate: u32,
    channels: u16,
    /// 已写入的**单样本**总数（含所有声道）
    samples: u64,
    bytes: Vec<u8>,
}

impl WavWriter {
    /// 创建并写入占位头（`sample_rate` / `channels` 必须在整个文件内保持一致）
    pub fn create(path: &Path, sample_rate: u32, channels: u16) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut writer = WavWriter {
            file: BufWriter::new(File::create(path)?),
            sample_rate: sample_rate.max(8_000),
            channels: channels.max(1),
            samples: 0,
            bytes: Vec::new(),
        };
        writer.write_header()?;
        Ok(writer)
    }

    fn write_header(&mut self) -> io::Result<()> {
        let channels = self.channels;
        let sample_rate = self.sample_rate;
        let byte_rate = sample_rate * channels as u32 * 2;
        let block_align = channels * 2;
        let mut header = [0u8; HEADER_LEN];
        header[0..4].copy_from_slice(b"RIFF");
        header[4..8].copy_from_slice(&0u32.to_le_bytes());
        header[8..12].copy_from_slice(b"WAVE");
        header[12..16].copy_from_slice(b"fmt ");
        header[16..20].copy_from_slice(&16u32.to_le_bytes());
        header[20..22].copy_from_slice(&1u16.to_le_bytes());
        header[22..24].copy_from_slice(&channels.to_le_bytes());
        header[24..28].copy_from_slice(&sample_rate.to_le_bytes());
        header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
        header[32..34].copy_from_slice(&block_align.to_le_bytes());
        header[34..36].copy_from_slice(&16u16.to_le_bytes());
        header[36..40].copy_from_slice(b"data");
        header[40..44].copy_from_slice(&0u32.to_le_bytes());
        self.file.write_all(&header)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// 批量写入交错 f32 样本，越界自动限幅
    pub fn write_samples(&mut self, samples: &[f32]) -> io::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        self.bytes.clear();
        self.bytes.reserve(samples.len() * 2);
        for sample in samples {
            let clamped = if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            let value = (clamped * 32767.0) as i16;
            self.bytes.extend_from_slice(&value.to_le_bytes());
        }
        self.file.write_all(&self.bytes)?;
        self.samples += samples.len() as u64;
        Ok(())
    }

    /// 回填长度并落盘
    pub fn finish(mut self) -> io::Result<()> {
        let data_bytes = self.samples * 2;
        let data_len = data_bytes.min(u32::MAX as u64) as u32;
        let riff_len = data_len.saturating_add((HEADER_LEN - 8) as u32);
        self.file.flush()?;
        let mut file = self.file.into_inner().map_err(|error| error.into_error())?;
        file.seek(SeekFrom::Start(4))?;
        file.write_all(&riff_len.to_le_bytes())?;
        file.seek(SeekFrom::Start(40))?;
        file.write_all(&data_len.to_le_bytes())?;
        file.flush()?;
        Ok(())
    }
}

/// 流式 WAV 读取器（仅 PCM 16-bit）
pub struct WavReader {
    inner: BufReader<File>,
    pub sample_rate: u32,
    pub channels: u16,
    /// data chunk 里包含的总帧数
    pub frames: u64,
    /// 已读出的帧数
    position: u64,
    bytes: Vec<u8>,
}

impl WavReader {
    pub fn open(path: &Path) -> io::Result<Self> {
        let mut inner = BufReader::new(File::open(path)?);
        let mut riff = [0u8; 12];
        inner.read_exact(&mut riff)?;
        if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
            return Err(invalid("不是合法的 WAV 文件"));
        }
        let mut sample_rate = 0u32;
        let mut channels = 0u16;
        let mut bits = 0u16;
        // data 段长度：循环只可能从这里 break（其余路径都已 return Err）
        let data_bytes;
        loop {
            let mut head = [0u8; 8];
            if inner.read_exact(&mut head).is_err() {
                return Err(invalid("WAV 缺少 data 段"));
            }
            let id = [head[0], head[1], head[2], head[3]];
            let size = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
            match &id {
                b"fmt " => {
                    let mut fmt = vec![0u8; size as usize];
                    inner.read_exact(&mut fmt)?;
                    if fmt.len() < 16 {
                        return Err(invalid("WAV fmt 段过短"));
                    }
                    let format = u16::from_le_bytes([fmt[0], fmt[1]]);
                    if format != 1 {
                        return Err(invalid("只支持 PCM 编码的 WAV"));
                    }
                    channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                    sample_rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                    bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                }
                b"data" => {
                    data_bytes = size;
                    break;
                }
                _ => {
                    // 跳过未知 chunk（LIST / fact 等），保持 2 字节对齐
                    let skip = size as i64 + (size % 2) as i64;
                    inner.seek(SeekFrom::Current(skip))?;
                }
            }
        }
        if bits != 16 {
            return Err(invalid("只支持 16-bit 的 WAV"));
        }
        if channels == 0 || sample_rate == 0 {
            return Err(invalid("WAV 头信息不完整"));
        }
        let frame_bytes = channels as u64 * 2;
        Ok(WavReader {
            inner,
            sample_rate,
            channels,
            frames: data_bytes as u64 / frame_bytes,
            position: 0,
            bytes: Vec::new(),
        })
    }

    /// 从当前位置读最多 `want` 帧，追加交错 f32 样本到 `out`，返回实际读到的帧数
    pub fn read_frames(&mut self, out: &mut Vec<f32>, want: usize) -> io::Result<usize> {
        let remaining = self.frames.saturating_sub(self.position);
        let frames = (want as u64).min(remaining) as usize;
        if frames == 0 {
            return Ok(0);
        }
        let frame_bytes = self.channels as usize * 2;
        let need = frames * frame_bytes;
        self.bytes.resize(need, 0);
        let read = self.inner.read(&mut self.bytes[..need])?;
        let got = read / frame_bytes;
        if got == 0 {
            return Ok(0);
        }
        out.clear();
        out.reserve(got * self.channels as usize);
        for index in 0..got * self.channels as usize {
            let offset = index * 2;
            let value = i16::from_le_bytes([self.bytes[offset], self.bytes[offset + 1]]);
            out.push(value as f32 / 32768.0);
        }
        self.position += got as u64;
        Ok(got)
    }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}
