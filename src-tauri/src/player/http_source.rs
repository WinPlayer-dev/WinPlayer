//! HTTP 流式音频源：实现 symphonia 的 `MediaSource`（Read + Seek）。
//!
//! 采用「滑窗文件缓冲」模型：
//! - 一个本地临时文件保存当前下载会话的数据（绝对字节区间 [offset, offset+watermark)）
//! - 后台下载线程从 `offset` 起以 Range 请求顺序拉流写入，推进 watermark
//! - `read`：落在窗口内直接读文件；到达窗口边缘且未到文件尾时阻塞等待；
//!   落在窗口之前（回拖超窗）触发新下载会话
//! - `seek`：窗口内纯本地定位（零网络）；窗口外放弃当前会话，从新位置重拉
//!
//! 不维护多区间缓存——大幅回拖的代价只是一次 Range 请求，换取实现简单可靠。

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use symphonia::core::io::MediaSource;

/// 每次通知读取方前的下载等待上限（毫秒），超时后重查会话/错误标志
const WAIT_TIMEOUT_MS: u64 = 200;
/// 首个数据块到达的等待上限（毫秒）
const PRIME_TIMEOUT_MS: u64 = 15_000;
/// 下载块大小（字节）
const CHUNK: usize = 64 * 1024;

struct Inner {
    client: reqwest::blocking::Client,
    url: String,
    /// 直链必需请求头（防盗链的 Referer 等）：由插件在 `getSongUrl` 结果里给出，
    /// 每一次 Range 请求（含 seek 重开的下载会话）都必须原样带上，否则 403。
    headers: reqwest::header::HeaderMap,
    /// 缓冲临时文件（读/写各持一个独立句柄）
    read_file: Mutex<File>,
    write_file: Mutex<File>,
    path: PathBuf,
    /// 当前下载会话的绝对起始字节
    offset: AtomicU64,
    /// 自 offset 起已缓冲的字节数
    watermark: AtomicU64,
    /// 文件总字节数，0 表示未知
    total_len: AtomicU64,
    /// 服务器不支持 Range（返回 200 全量响应）：全量顺序下载模式，
    /// seek 仅本地定位，不做窗口重拉
    no_range: AtomicBool,
    /// 当前会话已下载到文件末尾
    eof: AtomicBool,
    /// 下载会话代号，变更即要求旧下载线程退出
    session: AtomicU64,
    /// 下载线程失败原因（非 None 时读取方返回 IO 错误）
    error: Mutex<Option<String>>,
    /// 读取方等待用
    cond: Condvar,
    gate: Mutex<()>,
}

pub struct HttpMediaSource {
    inner: Arc<Inner>,
    pos: u64,
}

impl HttpMediaSource {
    /// 创建源并同步等待首个数据块（保证 probe 有数据可读、总长已知）。
    /// `headers` 为直链必需请求头（防盗链，空表示不需要）。
    pub fn new(
        client: reqwest::blocking::Client,
        url: String,
        headers: &[(String, String)],
        dir: &Path,
    ) -> io::Result<Self> {
        let path = dir.join(format!("player-buffer-{:016x}.tmp", rand::random::<u64>()));
        let write_file = OpenOptions::new().create(true).write(true).truncate(true).open(&path)?;
        let read_file = File::open(&path)?;
        let inner = Arc::new(Inner {
            client,
            url,
            headers: build_headers(headers),
            read_file: Mutex::new(read_file),
            write_file: Mutex::new(write_file),
            path,
            offset: AtomicU64::new(0),
            watermark: AtomicU64::new(0),
            total_len: AtomicU64::new(0),
            no_range: AtomicBool::new(false),
            eof: AtomicBool::new(false),
            session: AtomicU64::new(1),
            error: Mutex::new(None),
            cond: Condvar::new(),
            gate: Mutex::new(()),
        });
        start_download(inner.clone(), 0);
        // 等首个数据块（或 EOF/错误），确保 probe 立即有数据且尽量拿到总长
        let deadline = std::time::Instant::now() + Duration::from_millis(PRIME_TIMEOUT_MS);
        let mut gate = inner.gate.lock().unwrap();
        loop {
            if inner.watermark.load(Ordering::Acquire) > 0
                || inner.eof.load(Ordering::Acquire)
                || inner.error.lock().unwrap().is_some()
            {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let mut error = inner.error.lock().unwrap();
                if error.is_none() {
                    *error = Some("连接音频源超时".to_string());
                }
                drop(error);
                inner.cond.notify_all();
                break;
            }
            let (guard, _) = inner
                .cond
                .wait_timeout(gate, Duration::from_millis(WAIT_TIMEOUT_MS))
                .unwrap();
            gate = guard;
        }
        drop(gate);
        Ok(HttpMediaSource { inner, pos: 0 })
    }

    pub fn temp_path(&self) -> PathBuf {
        self.inner.path.clone()
    }
}

impl Drop for HttpMediaSource {
    fn drop(&mut self) {
        // 会话代号归零：要求下载线程退出
        self.inner.session.store(0, Ordering::Release);
        self.inner.cond.notify_all();
        // 下载线程可能还握着写句柄，尽力删除
        let _ = std::fs::remove_file(&self.inner.path);
    }
}

/// 启动一个下载会话线程（调用前应已递增 session 代号并重置 watermark）
fn start_download(inner: Arc<Inner>, offset: u64) {
    let session = inner.session.load(Ordering::Acquire);
    std::thread::Builder::new()
        .name("audio-download".into())
        .spawn(move || download_loop(inner, offset, session))
        .ok();
}

/// 把 [名, 值] 请求头转成 HeaderMap（非法头名/头值直接跳过，不让一个坏头毁掉整次播放）
fn build_headers(headers: &[(String, String)]) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let Ok(name) = HeaderName::from_bytes(name.trim().as_bytes()) else {
            continue;
        };
        let Ok(value) = HeaderValue::from_str(value) else {
            continue;
        };
        map.insert(name, value);
    }
    map
}

fn download_loop(inner: Arc<Inner>, offset: u64, session: u64) {
    let result = (|| -> Result<(), String> {
        let mut response = inner
            .client
            .get(&inner.url)
            .headers(inner.headers.clone())
            .header("Range", format!("bytes={offset}-"))
            .send()
            .map_err(|e| format!("连接音频源失败: {e}"))?;

        let status = response.status();
        if offset > 0 && status.as_u16() == 200 {
            return Err("该音源不支持拖动进度".to_string());
        }
        if !status.is_success() {
            return Err(format!("音频源返回 HTTP {status}"));
        }

        // 服务器忽略 Range 返回 200 全量响应：无法随机访问，退化为
        // 全量顺序下载模式（与浏览器 <audio> 行为一致）——seek 仅移动
        // 本地读取位置，由 read 等待下载推进到目标
        if status.as_u16() == 200 {
            inner.no_range.store(true, Ordering::Release);
        }

        // 解析总长：优先 Content-Range（206），退回 Content-Length
        let mut total = 0u64;
        if let Some(range) = response.headers().get("content-range").and_then(|v| v.to_str().ok()) {
            // 形如 "bytes 0-1023/4096"
            if let Some(raw) = range.rsplit('/').next() {
                total = raw.trim().parse().unwrap_or(0);
            }
        }
        if total == 0 {
            if let Some(len) = response.headers().get("content-length").and_then(|v| v.to_str().ok()) {
                total = len.trim().parse().unwrap_or(0);
                if total > 0 && status.as_u16() == 206 {
                    total += offset;
                }
            }
        }
        if total > 0 {
            inner.total_len.store(total, Ordering::Release);
        }

        let mut downloaded: u64 = 0;
        let mut chunk = vec![0u8; CHUNK];
        loop {
            if inner.session.load(Ordering::Acquire) != session {
                return Ok(()); // 被新会话取代，静默退出
            }
            let n = response.read(&mut chunk).map_err(|e| format!("下载数据失败: {e}"))?;
            if n == 0 {
                if total == 0 {
                    // 无 Content-Length：读到流结束即为文件尾
                    inner.total_len.store(offset + downloaded, Ordering::Release);
                }
                inner.eof.store(true, Ordering::Release);
                inner.cond.notify_all();
                return Ok(());
            }
            {
                let mut file = inner.write_file.lock().unwrap();
                file.seek(SeekFrom::Start(offset + downloaded))
                    .map_err(|e| format!("写入缓冲失败: {e}"))?;
                file.write_all(&chunk[..n]).map_err(|e| format!("写入缓冲失败: {e}"))?;
            }
            downloaded += n as u64;
            inner.watermark.store(downloaded, Ordering::Release);
            inner.cond.notify_all();
        }
    })();

    if let Err(message) = result {
        let mut error = inner.error.lock().unwrap();
        if error.is_none() {
            *error = Some(message);
        }
        drop(error);
        inner.cond.notify_all();
    }
}

impl Inner {
    /// 放弃当前下载会话，从 `pos` 重新开始拉流。
    /// 需要外部持有 `Arc<Inner>` 时经由 `HttpMediaSource::restart_at` 调用。
    fn clear_error(&self) {
        if let Ok(mut error) = self.error.lock() {
            *error = None;
        }
    }
}

impl HttpMediaSource {
    fn restart_at(&self, pos: u64) {
        let inner = &self.inner;
        inner.session.fetch_add(1, Ordering::AcqRel);
        inner.offset.store(pos, Ordering::Release);
        inner.watermark.store(0, Ordering::Release);
        inner.eof.store(false, Ordering::Release);
        inner.clear_error();
        if let Ok(file) = inner.write_file.lock() {
            let _ = file.set_len(0);
        }
        start_download(inner.clone(), pos);
        inner.cond.notify_all();
    }

    /// 判断绝对位置是否落在当前下载窗口（含右边缘）内
    fn in_window(&self, pos: u64) -> bool {
        let offset = self.inner.offset.load(Ordering::Acquire);
        let watermark = self.inner.watermark.load(Ordering::Acquire);
        pos >= offset && pos <= offset + watermark
    }
}

impl Read for HttpMediaSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let inner = &self.inner;
        let mut gate = inner.gate.lock().unwrap();
        loop {
            if let Some(message) = inner.error.lock().unwrap().as_ref() {
                return Err(io::Error::other(message.clone()));
            }
            let offset = inner.offset.load(Ordering::Acquire);
            let watermark = inner.watermark.load(Ordering::Acquire);
            let total = inner.total_len.load(Ordering::Acquire);
            let pos = self.pos;

            if total > 0 && pos >= total {
                return Ok(0);
            }
            if pos < offset {
                drop(gate);
                self.restart_at(pos);
                gate = inner.gate.lock().unwrap();
                continue;
            }
            if pos < offset + watermark {
                let available = (offset + watermark - pos) as usize;
                let want = buf.len().min(available);
                let mut file = inner.read_file.lock().unwrap();
                file.seek(SeekFrom::Start(pos - offset))?;
                let n = file.read(&mut buf[..want])?;
                drop(file);
                if n == 0 {
                    continue; // 极端竞态：立即重查窗口
                }
                self.pos += n as u64;
                return Ok(n);
            }
            // 窗口边缘：EOF 则结束，否则等待下载推进
            if inner.eof.load(Ordering::Acquire) {
                return Ok(0);
            }
            let (guard, _) = inner
                .cond
                .wait_timeout(gate, Duration::from_millis(WAIT_TIMEOUT_MS))
                .unwrap();
            gate = guard;
        }
    }
}

impl Seek for HttpMediaSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let total = self.inner.total_len.load(Ordering::Acquire);
        let target = match pos {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
            SeekFrom::End(d) => {
                if total == 0 {
                    return Err(io::Error::new(io::ErrorKind::Unsupported, "音源长度未知"));
                }
                total.checked_add_signed(d)
            }
        };
        let Some(target) = target else {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek 越界"));
        };
        let clamped = if total > 0 { target.min(total) } else { target };
        // 窗口外处理：no_range 模式（服务器不支持 Range）仅本地定位，
        // read 会等待下载推进；否则窗口外（含向前跳出已缓冲区）触发新下载会话
        if !self.in_window(clamped) {
            if self.inner.no_range.load(Ordering::Acquire) {
                // 全量下载模式：直接移动读取位置
            } else if total == 0 {
                return Err(io::Error::new(io::ErrorKind::Unsupported, "音源长度未知，无法拖动"));
            } else {
                self.restart_at(clamped);
            }
        }
        self.pos = clamped;
        Ok(clamped)
    }
}

impl MediaSource for HttpMediaSource {
    fn is_seekable(&self) -> bool {
        // 已知总长可 seek；no_range 全量下载模式即使总长未知也允许
        // （MP4/FLAC 用 seek 表绝对定位不依赖总长；依赖总长的格式
        // 会在 seek 时明确报错，不会更糟）
        self.inner.total_len.load(Ordering::Acquire) > 0
            || self.inner.no_range.load(Ordering::Acquire)
    }

    fn byte_len(&self) -> Option<u64> {
        match self.inner.total_len.load(Ordering::Acquire) {
            0 => None,
            total => Some(total),
        }
    }
}
