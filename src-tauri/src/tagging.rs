//! 离线歌曲标签：把元数据、封面与歌词写进音频文件本身。
//!
//! 离线曲库不再依赖数据库里的 `track` JSON：下载完成后由这里用 lofty 写入
//! ID3v2 / Vorbis / MP4 标签，封面作为前置封面图内嵌，歌词写进 `Lyrics`
//! 项（`USLT` / `LYRICS` / `©lyr`）。载入离线索引时用同一套读取逻辑
//! （[`crate::local_music`]）回读，文件换目录、换机器都还在。
//!
//! 写入失败（如 ADTS `.aac` 这类不支持标签的容器）不视为下载失败：
//! 返回 `hasTags = false`，前端会退回把元数据存进数据库的旧路径。

use std::path::Path;
use std::time::Duration;

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{ItemKey, Tag, TagType};
use serde::{Deserialize, Serialize};

use crate::local_music;

/// 封面下载上限：正常封面几百 KB，超过这个尺寸基本是误抓了网页
const MAX_COVER_BYTES: usize = 12 * 1024 * 1024;

/// 写入标签的元数据（由前端按曲目字段传入）
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWriteMeta {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub album_artist: String,
    #[serde(default)]
    pub genre: String,
    #[serde(default)]
    pub year: Option<u32>,
    #[serde(default)]
    pub track_no: Option<u32>,
    #[serde(default)]
    pub disc_no: Option<u32>,
}

/// 标签写入结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWriteResult {
    /// 元数据是否成功写进文件（false 时前端退回数据库存储）
    pub has_tags: bool,
    /// 封面是否已内嵌
    pub has_cover: bool,
    /// 歌词是否已内嵌
    pub has_lyrics: bool,
}

/// 离线文件标签回读结果（一条对应一个已下载文件）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineTagInfo {
    pub path: String,
    /// 文件里是否有可用标签（false 表示得退回数据库里的旧记录）
    pub has_tags: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub year: Option<String>,
    /// 时长（毫秒）
    pub duration_ms: Option<u64>,
    /// 封面协议地址（`http://localcover.localhost/?f=<file>`）
    pub cover: Option<String>,
    /// 是否有歌词（内嵌或同名 `.lrc` / `.srt`）
    pub has_lyrics: bool,
}

/// 把元数据 / 封面 / 歌词写进音频文件（原地写入，覆盖同名标签项）。
pub fn write_tags(
    path: &Path,
    meta: &TagWriteMeta,
    cover: Option<&[u8]>,
    lyrics: Option<&str>,
) -> TagWriteResult {
    let failed = TagWriteResult {
        has_tags: false,
        has_cover: false,
        has_lyrics: false,
    };

    // 解析不了的文件（非常规容器 / 已损坏）直接放弃，交给前端走数据库兜底
    let Ok(mut tagged) = lofty::read_from_path(path) else {
        eprintln!("[tags] 无法解析音频文件: {}", path.display());
        return failed;
    };

    // 没有标签的裸文件：先按容器默认标签类型建一个空标签
    if tagged.primary_tag_mut().is_none() {
        // `primary_tag_type` 默认取文件类型支持的首选标签类型
        let tag_type: TagType = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let Some(tag) = tagged.primary_tag_mut() else {
        eprintln!("[tags] 文件不支持写入标签: {}", path.display());
        return failed;
    };

    let title = meta.title.trim();
    if !title.is_empty() {
        tag.set_title(title.to_string());
    }
    let artist = meta.artist.trim();
    if !artist.is_empty() {
        tag.set_artist(artist.to_string());
    }
    let album = meta.album.trim();
    if !album.is_empty() {
        tag.set_album(album.to_string());
    }
    let album_artist = meta.album_artist.trim();
    if !album_artist.is_empty() {
        tag.insert_text(ItemKey::AlbumArtist, album_artist.to_string());
    }
    let genre = meta.genre.trim();
    if !genre.is_empty() {
        tag.set_genre(genre.to_string());
    }
    if let Some(year) = meta.year.filter(|value| *value > 0) {
        tag.set_year(year);
    }
    if let Some(track_no) = meta.track_no.filter(|value| *value > 0) {
        tag.set_track(track_no);
    }
    if let Some(disc_no) = meta.disc_no.filter(|value| *value > 0) {
        tag.set_disk(disc_no);
    }

    let has_cover = match cover {
        Some(bytes) if !bytes.is_empty() => {
            // 旧的前置封面先摘掉，避免同一文件里堆多张
            tag.remove_picture_type(PictureType::CoverFront);
            tag.push_picture(Picture::new_unchecked(
                PictureType::CoverFront,
                Some(MimeType::Jpeg),
                None,
                bytes.to_vec(),
            ));
            true
        }
        _ => false,
    };

    let lyrics_text = lyrics.map(str::trim).filter(|text| !text.is_empty());
    let mut has_lyrics = false;
    if let Some(text) = lyrics_text {
        has_lyrics = tag.insert_text(ItemKey::Lyrics, text.to_string());
    }

    let options = WriteOptions::default();
    let mut saved = tagged.save_to_path(path, options);
    // 部分容器（RIFF INFO / 裸 ADTS 等）不支持内嵌图片：去掉封面再试一次，
    // 至少把标题 / 歌手 / 专辑 / 歌词写进去
    let mut cover_embedded = has_cover;
    if saved.is_err() && has_cover {
        if let Some(tag) = tagged.primary_tag_mut() {
            tag.remove_picture_type(PictureType::CoverFront);
        }
        cover_embedded = false;
        saved = tagged.save_to_path(path, options);
    }

    match saved {
        Ok(()) => {
            // 写后自检：文件仍能被解析才认为标签写入成功，避免损坏的文件被当作正常曲目
            if lofty::read_from_path(path).is_err() {
                eprintln!("[tags] 写入后文件无法解析: {}", path.display());
                return failed;
            }
            TagWriteResult {
                has_tags: true,
                has_cover: cover_embedded,
                has_lyrics,
            }
        }
        Err(error) => {
            eprintln!("[tags] 写入标签失败 {}: {error}", path.display());
            failed
        }
    }
}

/// 批量回读离线文件的标签（封面按需导出到 `localcover` 缓存目录）
pub fn read_offline_tags(paths: &[String], covers: &Path) -> Vec<OfflineTagInfo> {
    paths
        .iter()
        .map(|path| {
            let file = Path::new(path);
            let tags = local_music::probe(file, covers);
            OfflineTagInfo {
                path: path.clone(),
                has_tags: tags.has_tags,
                title: tags.title,
                artist: tags.artist,
                album: tags.album,
                album_artist: tags.album_artist,
                track_no: tags.track_no,
                year: tags.year,
                duration_ms: tags.duration_ms,
                cover: tags.cover.clone(),
                has_lyrics: tags.embedded_lyrics.is_some()
                    || local_music::find_sidecar(file, "lrc").is_some()
                    || local_music::find_sidecar(file, "srt").is_some(),
            }
        })
        .collect()
}

/// 下载封面原图并压成 512px JPEG（失败返回 None，不影响标签写入）。
///
/// 不带 `Referer`：图床（哔哩哔哩封面 CDN 等）对非本域 Referer 会直接 403。
pub async fn fetch_cover(url: &str) -> Option<Vec<u8>> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("WinPlayer/0.1")
        .build()
        .ok()?;
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
        return None;
    }
    // 解码压缩很吃 CPU，放阻塞线程池
    tauri::async_runtime::spawn_blocking(move || local_music::compact_cover(&bytes))
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 生成一段 0.1s 的静音 WAV（lofty 能读写其 RIFF INFO 标签）
    fn write_silent_wav(path: &Path) {
        let sample_rate: u32 = 8000;
        let data_len: u32 = 800 * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.extend_from_slice(&vec![0u8; data_len as usize]);
        std::fs::write(path, bytes).unwrap();
    }

    /// 写入后用回读接口拿回同样的元数据
    #[test]
    fn writes_and_reads_back_metadata() {
        let dir = std::env::temp_dir().join(format!("wp-tag-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.wav");
        write_silent_wav(&file);

        let meta = TagWriteMeta {
            title: "歌曲标题".into(),
            artist: "歌手 / 另一位".into(),
            album: "专辑名".into(),
            ..Default::default()
        };
        let result = write_tags(&file, &meta, None, Some("[00:01.00]第一句\n"));
        assert!(result.has_tags, "标签应写入成功");

        let path = file.to_string_lossy().to_string();
        let infos = read_offline_tags(&[path], &dir.join("covers"));
        assert_eq!(infos.len(), 1);
        assert!(infos[0].has_tags, "回读应识别到标签");
        assert_eq!(infos[0].title.as_deref(), Some("歌曲标题"));
        assert_eq!(infos[0].artist.as_deref(), Some("歌手 / 另一位"));
        assert_eq!(infos[0].album.as_deref(), Some("专辑名"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 生成一段伪 MP3（MPEG-1 Layer III 128kbps 44.1kHz 的静音帧）
    fn write_silent_mp3(path: &Path, frames: usize) {
        let mut bytes = Vec::new();
        for _ in 0..frames {
            bytes.push(0xFF);
            bytes.push(0xFB);
            bytes.push(0x90);
            bytes.push(0x64);
            bytes.extend_from_slice(&[0u8; 413]);
        }
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn mp3_embeds_tags_cover_and_lyrics() {
        let dir = std::env::temp_dir().join(format!("wp-tag-mp3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.mp3");
        write_silent_mp3(&file, 200);

        // 一张 8x8 的最小 JPEG
        let cover = {
            let img = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 40, 40]));
            let mut buf = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80)
                .encode_image(&img)
                .unwrap();
            buf
        };

        let meta = TagWriteMeta {
            title: "歌名".into(),
            artist: "歌手A / 歌手B".into(),
            album: "专辑".into(),
            track_no: Some(3),
            ..Default::default()
        };
        let lyrics = "[00:01.00]第一句\n[00:05.00]第二句\n";
        let result = write_tags(&file, &meta, Some(&cover), Some(lyrics));
        assert!(result.has_tags, "MP3 标签应写入成功");
        assert!(result.has_cover, "封面应内嵌");
        assert!(result.has_lyrics, "歌词应内嵌");

        let path = file.to_string_lossy().to_string();
        let infos = read_offline_tags(&[path], &dir.join("covers"));
        assert_eq!(infos[0].title.as_deref(), Some("歌名"));
        assert_eq!(infos[0].artist.as_deref(), Some("歌手A / 歌手B"));
        assert_eq!(infos[0].album.as_deref(), Some("专辑"));
        assert!(infos[0].cover.is_some(), "应导出内嵌封面");
        assert!(infos[0].has_lyrics, "应识别到内嵌歌词");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
