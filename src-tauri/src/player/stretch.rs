//! 保持音调的时间伸缩（WSOLA）：播放变速（0.5x–2x）的 DSP 核心。
//!
//! 解码出的交错样本经 EQ 后送入本模块。合成端以固定 hop（帧长一半）
//! 重叠相加 Hann 窗帧；分析端在每个新帧的名义起点附近做归一化互相关
//! 搜索，选取与上一帧自然延续最相似的波形起点。如此改变音频时长而不
//! 改变基频（音调保持），适合播客 / 有声书场景。
//!
//! 作为流式变换：输入按解码包喂入，输出即时可取。倍速 >1（加快）时分析
//! 步进大于合成步进（每产出一段就多消耗一段输入）；倍速 <1（放慢）则相反。
//! 停止/跳转时调用 `reset` 清空内部状态，避免旧样本残留。

use std::f32::consts::PI;

/// 最小搜索半径（每声道样本数），低采样率下帧长过小时兜底
const MIN_SEARCH: usize = 64;

pub struct TimeStretch {
    channels: usize,
    /// 帧长（每声道样本数）
    frame: usize,
    /// 合成步进 = frame / 2（50% 重叠，周期 Hann 窗叠加和恒为 1）
    hop: usize,
    /// 互相关搜索半径
    search: usize,
    /// 周期 Hann 窗
    window: Vec<f32>,
    /// 待处理交错输入
    input: Vec<f32>,
    /// input[0] 对应的绝对帧号（以每声道样本计）
    base: usize,
    /// 上一合成帧的分析起点（绝对帧号）
    analysis: usize,
    /// 下一帧的名义分析位置（固定网格，逐帧 +ha；与上一帧实际起点无关，
    /// 保证平均分析步进恰为 ha，避免偏移累积导致时长漂移）
    nominal: usize,
    /// 是否已产生首帧
    started: bool,
    /// 重叠相加累加器（交错，长度 frame*channels），代表当前合成位置起的 frame 个样本
    ola: Vec<f32>,
    /// 互相关参考单声道缓冲（长度 hop）
    reference: Vec<f32>,
}

impl TimeStretch {
    pub fn new(channels: usize, sample_rate: u32) -> Self {
        let channels = channels.max(1);
        // 帧长约 23ms，限制在合理范围并取偶数
        let mut frame = (sample_rate as usize * 23 / 1000).clamp(128, 4096);
        frame -= frame & 1;
        let hop = frame / 2;
        let search = (frame / 4).max(MIN_SEARCH);
        TimeStretch {
            channels,
            frame,
            hop,
            search,
            window: hann(frame),
            input: Vec::new(),
            base: 0,
            analysis: 0,
            nominal: 0,
            started: false,
            ola: vec![0.0; frame * channels],
            reference: vec![0.0; hop],
        }
    }

    /// 请求的倍速映射到分析步进
    fn analysis_hop(&self, speed: f32) -> usize {
        let speed = speed.clamp(0.5, 2.0) as f64;
        ((self.hop as f64 * speed).round() as usize).max(1)
    }

    fn in_frames(&self) -> usize {
        self.input.len() / self.channels
    }

    fn abs_end(&self) -> usize {
        self.base + self.in_frames()
    }

    /// 喂入一段交错样本，产出可播放的交错样本（覆盖写入 out）。
    pub fn process(&mut self, samples: &[f32], speed: f32, out: &mut Vec<f32>) {
        out.clear();
        self.input.extend_from_slice(samples);
        let ha = self.analysis_hop(speed);
        while self.produce_frame(ha, false, out) {}
        self.compact(ha);
    }

    /// 输入结束后冲刷剩余样本（末帧允许零填充），避免丢失尾部。
    pub fn finish(&mut self, speed: f32, out: &mut Vec<f32>) {
        out.clear();
        let ha = self.analysis_hop(speed);
        let real_end = self.abs_end();
        if !self.started {
            if self.in_frames() == 0 {
                return;
            }
            // 输入不足一帧：零填充后合成唯一一帧
            if self.in_frames() < self.frame {
                let need = self.frame - self.in_frames();
                self.input.resize(self.input.len() + need * self.channels, 0.0);
            }
            self.emit_frame(self.base, out);
            self.started = true;
            self.analysis = self.base;
            self.nominal = self.base + ha;
        }
        // 覆盖完真实输入即停止（填充帧仅用于平滑收尾）
        while self.analysis < real_end && self.produce_frame(ha, true, out) {}
    }

    /// 处理一帧；pad=true 时允许零填充凑整（仅结束冲刷用）。
    fn produce_frame(&mut self, ha: usize, pad: bool, out: &mut Vec<f32>) -> bool {
        if !self.started {
            if self.in_frames() < self.frame {
                return false;
            }
            self.emit_frame(self.base, out);
            self.started = true;
            self.analysis = self.base;
            self.nominal = self.base + ha;
            return true;
        }

        let nominal = self.nominal;
        // 至少保证名义起点处有一整帧
        if self.abs_end() < nominal + self.frame {
            if !pad {
                return false;
            }
            let need = nominal + self.frame - self.abs_end();
            self.input.resize(self.input.len() + need * self.channels, 0.0);
        }

        // 参考段：上一帧在输入时间轴上按合成步进的自然延续
        let ref_start = self.analysis + self.hop;
        if ref_start + self.hop > self.abs_end() {
            if !pad {
                return false;
            }
            let need = ref_start + self.hop - self.abs_end();
            self.input.resize(self.input.len() + need * self.channels, 0.0);
        }
        self.fill_reference(ref_start);

        // 搜索区间：名义位置 ± search；下限保证向前推进（防死循环）
        let lo = nominal
            .saturating_sub(self.search)
            .max(self.base)
            .max(self.analysis + 1);
        let hi = (nominal + self.search).min(self.abs_end() - self.frame);
        let p = self.best_offset(lo, hi.max(lo));

        self.emit_frame(p, out);
        self.analysis = p;
        // 名义位置保持在固定网格上（≥ 实际起点以保证推进）
        self.nominal = (nominal + ha).max(p + 1);
        true
    }

    /// 填参考单声道缓冲（各声道下混）
    fn fill_reference(&mut self, ref_start: usize) {
        let ch = self.channels;
        let start = (ref_start - self.base) * ch;
        for i in 0..self.hop {
            let base = start + i * ch;
            let mut acc = 0.0f32;
            for c in 0..ch {
                acc += self.input[base + c];
            }
            self.reference[i] = acc / ch as f32;
        }
    }

    /// 在 [lo, hi] 内找与参考段最相似的起点（归一化互相关）
    fn best_offset(&self, lo: usize, hi: usize) -> usize {
        if hi <= lo {
            return lo.min(hi);
        }
        let ch = self.channels;
        let hop = self.hop;
        let ref_energy: f32 = self.reference.iter().map(|v| v * v).sum();
        if ref_energy <= 1e-9 {
            return lo;
        }
        let ref_norm = ref_energy.sqrt();
        let mut best = lo;
        let mut best_score = f32::NEG_INFINITY;
        for p in lo..=hi {
            let start = (p - self.base) * ch;
            let mut dot = 0.0f32;
            let mut energy = 0.0f32;
            for i in 0..hop {
                let base = start + i * ch;
                let mut acc = 0.0f32;
                for c in 0..ch {
                    acc += self.input[base + c];
                }
                let v = acc / ch as f32;
                dot += v * self.reference[i];
                energy += v * v;
            }
            let score = dot / (energy.sqrt() * ref_norm + 1e-9);
            if score > best_score {
                best_score = score;
                best = p;
            }
        }
        best
    }

    /// 在合成位置加入 p 处的加窗帧，刷出前 hop 个样本并左移累加器
    fn emit_frame(&mut self, p: usize, out: &mut Vec<f32>) {
        let ch = self.channels;
        let frame = self.frame;
        let hop = self.hop;
        let start = (p - self.base) * ch;
        for n in 0..frame {
            let w = self.window[n];
            let src = start + n * ch;
            let dst = n * ch;
            for c in 0..ch {
                self.ola[dst + c] += w * self.input[src + c];
            }
        }
        out.extend_from_slice(&self.ola[..hop * ch]);
        let keep = (frame - hop) * ch;
        self.ola.copy_within(hop * ch..hop * ch + keep, 0);
        for x in &mut self.ola[keep..] {
            *x = 0.0;
        }
    }

    /// 丢弃不再需要的输入前缀（下一帧参考起点与最小搜索起点之前的样本）
    fn compact(&mut self, _ha: usize) {
        let keep = (self.analysis + self.hop).min(self.nominal.saturating_sub(self.search));
        if keep > self.base {
            let drop = (keep - self.base) * self.channels;
            self.input.drain(..drop);
            self.base = keep;
        }
    }

    /// 清空内部状态（seek / 会话重建）
    pub fn reset(&mut self) {
        self.input.clear();
        self.ola.iter_mut().for_each(|v| *v = 0.0);
        self.base = 0;
        self.analysis = 0;
        self.nominal = 0;
        self.started = false;
    }

    /// 是否空闲（未产生帧且无待处理输入）：倍速回到 1x 时据此直通原声
    pub fn is_idle(&self) -> bool {
        !self.started && self.input.is_empty()
    }
}

/// 周期 Hann 窗：50% 重叠时两帧叠加恒为 1，保证合成幅度平稳
fn hann(len: usize) -> Vec<f32> {
    (0..len)
        .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / len as f32).cos()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 生成单声道正弦波
    fn sine(len: usize, rate: u32, freq: f32) -> Vec<f32> {
        (0..len)
            .map(|n| (2.0 * PI * freq * n as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn output_length_matches_speed() {
        let rate = 44_100;
        // 4 秒信号，分块喂入模拟解码包
        let input = sine(rate as usize * 4, rate, 440.0);
        for speed in [0.5f32, 1.0, 1.5, 2.0] {
            let mut st = TimeStretch::new(1, rate);
            let mut out = Vec::new();
            let mut produced = 0usize;
            for chunk in input.chunks(1152) {
                st.process(chunk, speed, &mut out);
                produced += out.len();
                assert!(out.iter().all(|v| v.is_finite()));
            }
            st.finish(speed, &mut out);
            produced += out.len();
            let expected = input.len() as f32 / speed;
            let ratio = produced as f32 / expected;
            assert!(
                (ratio - 1.0).abs() < 0.05,
                "speed {speed}: produced {produced}, expected ~{expected}"
            );
        }
    }

    #[test]
    fn unity_speed_is_finite_and_bounded() {
        let rate = 48_000;
        let input = sine(rate as usize, rate, 220.0);
        let mut st = TimeStretch::new(1, rate);
        let mut out = Vec::new();
        st.process(&input, 1.0, &mut out);
        st.finish(1.0, &mut out);
        assert!(out.iter().all(|v| v.is_finite()));
        let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak <= 1.05, "peak {peak} should stay near unity");
    }

    #[test]
    fn reset_clears_state() {
        let rate = 44_100;
        let mut st = TimeStretch::new(2, rate);
        let mut out = Vec::new();
        st.process(&vec![0.5f32; 4096], 1.5, &mut out);
        st.reset();
        assert_eq!(st.in_frames(), 0);
        assert!(!st.started);
        assert_eq!(st.base, 0);
    }
}
