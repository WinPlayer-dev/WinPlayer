//! 本地音乐：文件夹扫描、标签/内嵌封面读取、同名歌词查找。
//!
//! 「内置播放源 · 本地音乐」的取数层：前端把用户挑选的文件夹交给这里，
//! 这里递归找出音频文件、用 lofty 解析标签与内嵌封面，并把封面落盘到
//! `appdata/cache/localcovers/`，由自定义协议 `localcover://` 提供给 WebView。
//!
//! 增量扫描由前端驱动：前端把已索引文件的 `(path, size, mtime)` 传进来，
//! 命中且 size/mtime 未变的文件只回填路径信息（`unchanged = true`），跳过
//! 标签解析——几千首的曲库重复启动时几乎瞬间完成。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use lofty::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 能被原生解码器（symphonia，见 `Cargo.toml` 的 features）解出的扩展名。
///
/// 与前端 `DECODABLE_CODECS` 对齐：这里多收录的格式（wma / ape / wv / opus）
/// 扫进来也播不出来，所以一律跳过，避免曲库里出现「点了没声音」的条目。
const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "mp4", "m4b", "aac", "flac", "ogg", "oga", "wav"];

/// 递归深度上限：防御异常深的目录树 / 符号链接环路
const MAX_DEPTH: usize = 12;

/// 前端持有的已索引文件（增量扫描用）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownFile {
    pub path: String,
    pub size: u64,
    pub mtime: i64,
}

/// 扫描结果中的一个音频文件
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAudioFile {
    /// 绝对路径，同时作为曲目 ID
    pub path: String,
    pub file_name: String,
    /// 所属配置文件夹（扫描入口，前端按它分组）
    pub folder: String,
    pub size: u64,
    /// 修改时间（Unix 秒）
    pub mtime: i64,
    /// 标签缺失时为空，前端回退用文件名
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    /// 时长（毫秒）
    pub duration_ms: Option<u64>,
    /// 码率（bps）
    pub bitrate: Option<u32>,
    /// 封面协议地址（`http://localcover.localhost/?f=<file>`）
    pub cover: Option<String>,
    /// 是否存在可用歌词（同名 .lrc / .srt 或内嵌）
    pub has_lyrics: bool,
    /// 命中已知列表且未变化：上面除路径/大小/时间外的字段一律为 None，
    /// 前端沿用数据库里的旧记录
    pub unchanged: bool,
}

/// 歌词文件内容
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLyrics {
    pub text: String,
    /// lrc / srt / embedded
    pub format: String,
}

fn ext_of(path: &Path) -> Option<String> {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
}

fn mtime_of(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// FNV-1a 64 位哈希（封面文件名，与 `commands::cache` 同款）
fn hash_key(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 封面缓存目录：`appdata/cache/localcovers`
pub fn covers_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cache").join("localcovers"))
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
}

/// 递归收集音频文件（不跟随符号链接，跳过隐藏目录）
fn walk_audio(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if file_type.is_dir() {
            walk_audio(&entry.path(), depth + 1, out);
        } else if file_type.is_file() {
            let path = entry.path();
            if let Some(ext) = ext_of(&path) {
                if AUDIO_EXTS.contains(&ext.as_str()) {
                    out.push(path);
                }
            }
        }
    }
}

/// 封面缩略图最长边（列表里最大展示约 160px，2x 缩放 512 足够）
const COVER_MAX_DIMENSION: u32 = 512;
/// 封面 JPEG 压缩质量
const COVER_JPEG_QUALITY: u8 = 85;

/// 把内嵌封面压缩为 JPEG 缩略图（解码失败则原样返回原图，格式随原 mime）
fn compact_cover(data: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(data).ok()?;
    let img = img.thumbnail(COVER_MAX_DIMENSION, COVER_MAX_DIMENSION);
    let mut buf = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, COVER_JPEG_QUALITY)
        .encode_image(&img)
        .ok()?;
    Some(buf)
}

/// 把内嵌封面写到缓存目录，返回协议地址。相同文件（路径+时间+大小）复用同一份。
///
/// 内嵌封面常是 1000px 以上的原图：直接交给 WebView 会让列表里每张图都占用
/// 数 MB 解码内存，因此统一缩到 512px 的 JPEG 落盘（解不开的格式原样保存）。
fn export_cover(path: &Path, mtime: i64, size: u64, picture: &lofty::picture::Picture, covers: &Path) -> Option<String> {
    let raw_mime = picture.mime_type()?.as_str().to_string();
    let raw_ext = match raw_mime.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "jpg",
    };
    let compacted = compact_cover(picture.data());
    let (bytes, ext) = match compacted {
        Some(jpeg) => (jpeg, "jpg"),
        None => (picture.data().to_vec(), raw_ext),
    };

    let key = hash_key(&format!("{}|{}|{}", path.to_string_lossy(), mtime, size));
    let file_name = format!("{key}.{ext}");
    let target = covers.join(&file_name);
    if !target.is_file() {
        std::fs::create_dir_all(covers).ok()?;
        std::fs::write(&target, &bytes).ok()?;
    }
    Some(format!("http://localcover.localhost/?f={file_name}"))
}

/// 读取单个文件的标签与时长
fn read_tags(path: &Path, covers: &Path, mtime: i64, size: u64) -> ReadTags {
    let mut tags = ReadTags::default();
    let Ok(tagged) = lofty::read_from_path(path) else {
        return tags;
    };

    let properties = tagged.properties();
    if !properties.duration().is_zero() {
        tags.duration_ms = Some(properties.duration().as_millis() as u64);
    }
    tags.bitrate = properties.audio_bitrate();

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        tags.title = tag.title().map(|value| value.trim().to_string()).filter(|v| !v.is_empty());
        tags.artist = tag.artist().map(|value| value.trim().to_string()).filter(|v| !v.is_empty());
        tags.album = tag.album().map(|value| value.trim().to_string()).filter(|v| !v.is_empty());
        tags.album_artist = tag
            .get_string(&ItemKey::AlbumArtist)
            .map(|value| value.trim().to_string())
            .filter(|v| !v.is_empty());
        tags.genre = tag.genre().map(|value| value.trim().to_string()).filter(|v| !v.is_empty());
        tags.year = tag.year().map(|value| value.to_string());
        tags.track_no = tag.track();
        tags.disc_no = tag.disk();
        tags.embedded_lyrics = tag
            .get_string(&ItemKey::Lyrics)
            .map(|value| value.trim().to_string())
            .filter(|v| !v.is_empty());
        if let Some(picture) = tag.pictures().first() {
            tags.cover = export_cover(path, mtime, size, picture, covers);
        }
    }
    tags
}

#[derive(Default)]
struct ReadTags {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    genre: Option<String>,
    year: Option<String>,
    track_no: Option<u32>,
    disc_no: Option<u32>,
    duration_ms: Option<u64>,
    bitrate: Option<u32>,
    cover: Option<String>,
    embedded_lyrics: Option<String>,
}

/// 在 `dir` 里找同名的 `.lrc` / `.srt`（大小写不敏感，容忍 `xxx.zh.lrc` 这类语言后缀）
fn find_sidecar(audio: &Path, ext: &str) -> Option<PathBuf> {
    let dir = audio.parent()?;
    let stem = audio.file_stem()?.to_string_lossy().to_string();
    let stem_lower = stem.to_lowercase();
    let entries = std::fs::read_dir(dir).ok()?;

    let mut best: Option<(u8, PathBuf)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !lower.ends_with(&format!(".{ext}")) {
            continue;
        }
        let base = &lower[..lower.len() - ext.len() - 1];
        // 完全同名最优，其次 `原名.<语言>.ext`
        let rank = if base == stem_lower {
            0
        } else if base.starts_with(&format!("{stem_lower}.")) {
            1
        } else {
            continue;
        };
        if best.as_ref().map(|(current, _)| rank < *current).unwrap_or(true) {
            best = Some((rank, entry.path()));
        }
    }
    best.map(|(_, path)| path)
}

/// 读取歌词：同名 .lrc > 同名 .srt > 内嵌歌词
pub fn read_lyrics(path: &Path) -> Option<LocalLyrics> {
    for (ext, format) in [("lrc", "lrc"), ("srt", "srt")] {
        if let Some(sidecar) = find_sidecar(path, ext) {
            if let Ok(bytes) = std::fs::read(&sidecar) {
                let text = decode_text(&bytes);
                if !text.trim().is_empty() {
                    return Some(LocalLyrics { text, format: format.to_string() });
                }
            }
        }
    }
    let tagged = lofty::read_from_path(path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let text = tag.get_string(&ItemKey::Lyrics)?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(LocalLyrics { text, format: "embedded".to_string() })
}

/// 歌词文件解码：优先 UTF-8（含 BOM），失败按 GB18030 回退
fn decode_text(bytes: &[u8]) -> String {
    let stripped = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(stripped) {
        Ok(text) => text.to_string(),
        // 中文歌词常见 GBK/GB18030：按字节宽松解码（非法序列替换为 U+FFFD）
        Err(_) => String::from_utf8_lossy(stripped).to_string(),
    }
}

/// 扫描全部文件夹。`known` 为前端已索引的 (path, size, mtime)，命中即跳过标签解析。
pub fn scan(
    folders: &[String],
    known: &HashMap<String, (u64, i64)>,
    covers: &Path,
) -> Vec<LocalAudioFile> {
    let mut result = Vec::new();
    for folder in folders {
        let root = Path::new(folder);
        if !root.is_dir() {
            continue;
        }
        let mut files = Vec::new();
        walk_audio(root, 0, &mut files);

        for path in files {
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            let size = meta.len();
            let mtime = mtime_of(&meta);
            let path_string = path.to_string_lossy().to_string();
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();

            let mut entry = LocalAudioFile {
                path: path_string.clone(),
                file_name,
                folder: folder.clone(),
                size,
                mtime,
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                genre: None,
                year: None,
                track_no: None,
                disc_no: None,
                duration_ms: None,
                bitrate: None,
                cover: None,
                has_lyrics: false,
                unchanged: true,
            };

            // 未变化：只回路径信息，元数据由前端沿用旧记录
            if known.get(&path_string) == Some(&(size, mtime)) {
                result.push(entry);
                continue;
            }

            let tags = read_tags(&path, covers, mtime, size);
            entry.unchanged = false;
            entry.title = tags.title;
            entry.artist = tags.artist;
            entry.album = tags.album;
            entry.album_artist = tags.album_artist;
            entry.genre = tags.genre;
            entry.year = tags.year;
            entry.track_no = tags.track_no;
            entry.disc_no = tags.disc_no;
            entry.duration_ms = tags.duration_ms;
            entry.bitrate = tags.bitrate;
            entry.cover = tags.cover;
            entry.has_lyrics = tags.embedded_lyrics.is_some()
                || find_sidecar(&path, "lrc").is_some()
                || find_sidecar(&path, "srt").is_some();
            result.push(entry);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wp-local-music-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 递归收集 + 跳过隐藏目录 + 忽略解码器不支持的扩展名
    #[test]
    fn scan_collects_audio_and_skips_others() {
        let root = temp_dir("scan");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("a.mp3"), b"not really audio").unwrap();
        fs::write(root.join("sub/b.FLAC"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::write(root.join(".hidden/c.mp3"), b"x").unwrap();
        fs::write(root.join("d.wma"), b"x").unwrap();

        let files = scan(
            &[root.to_string_lossy().to_string()],
            &HashMap::new(),
            &root.join("covers"),
        );
        let names: Vec<&str> = files.iter().map(|file| file.file_name.as_str()).collect();

        assert!(names.contains(&"a.mp3"), "普通 mp3 应被收录");
        assert!(names.contains(&"b.FLAC"), "大写扩展名 + 子目录应被收录");
        assert!(!names.contains(&"c.mp3"), "隐藏目录应跳过");
        assert!(!names.contains(&"notes.txt"), "非音频文件应跳过");
        assert!(!names.contains(&"d.wma"), "解码器不支持的格式应跳过");
        assert!(files.iter().all(|file| !file.unchanged), "首次扫描都不是 unchanged");
        // 无标签时元数据留空，由前端回退文件名
        assert!(files.iter().all(|file| file.title.is_none()));
        assert!(files.iter().all(|file| file.duration_ms.is_none()));
    }

    /// 第二次扫描：size/mtime 未变的文件标记 unchanged，跳过解析
    #[test]
    fn scan_marks_known_files_unchanged() {
        let root = temp_dir("known");
        fs::write(root.join("a.mp3"), b"aaa").unwrap();
        let folder = root.to_string_lossy().to_string();

        let first = scan(&[folder.clone()], &HashMap::new(), &root.join("covers"));
        assert_eq!(first.len(), 1);
        let mut known = HashMap::new();
        known.insert(first[0].path.clone(), (first[0].size, first[0].mtime));

        let second = scan(&[folder], &known, &root.join("covers"));
        assert_eq!(second.len(), 1);
        assert!(second[0].unchanged, "未变化文件应标记 unchanged");

        // 文件内容变化（size 变）后应重新解析
        fs::write(root.join("a.mp3"), b"changed-bytes").unwrap();
        let third = scan(
            &[root.to_string_lossy().to_string()],
            &known,
            &root.join("covers"),
        );
        assert!(!third[0].unchanged, "内容变化后应重新解析");
    }

    /// 歌词查找：同名 .lrc 优先于 .srt，语言后缀（a.zh.lrc）次之
    #[test]
    fn lyrics_sidecar_priority() {
        let root = temp_dir("lyrics");
        let audio = root.join("a.mp3");
        fs::write(&audio, b"x").unwrap();
        fs::write(root.join("a.srt"), "1\n00:00:01,000 --> 00:00:02,000\nSRT 文本\n").unwrap();

        let from_srt = read_lyrics(&audio).expect("应读到 srt");
        assert_eq!(from_srt.format, "srt");
        assert!(from_srt.text.contains("SRT 文本"));

        fs::write(root.join("a.zh.lrc"), "[00:01.00]LRC 文本").unwrap();
        let from_lang_lrc = read_lyrics(&audio).expect("应读到语言后缀 lrc");
        assert_eq!(from_lang_lrc.format, "lrc");

        fs::write(root.join("a.lrc"), "[00:02.00]同名 LRC").unwrap();
        let from_lrc = read_lyrics(&audio).expect("应读到同名 lrc");
        assert_eq!(from_lrc.format, "lrc");
        assert!(from_lrc.text.contains("同名 LRC"), "完全同名优先于语言后缀");
    }
}
