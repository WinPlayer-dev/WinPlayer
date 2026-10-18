//! 本地文件音频源：实现 symphonia 的 `MediaSource`（Read + Seek）。
//!
//! 用于离线播放：前端把下载得到的绝对路径以 `local://` 前缀交给原生引擎，
//! 解码线程识别后直接打开本地文件，不再经过网络。

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use symphonia::core::io::MediaSource;

pub struct LocalFileSource {
    file: File,
    len: u64,
}

impl LocalFileSource {
    /// 打开本地音频文件（读取其长度用于 seek 与总时长估算）
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Ok(LocalFileSource { file, len })
    }
}

impl Read for LocalFileSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.file.read(buf)
    }
}

impl Seek for LocalFileSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.file.seek(pos)
    }
}

impl MediaSource for LocalFileSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}
