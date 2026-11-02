//! 歌曲自定义信息的宿主侧辅助命令。
//!
//! 用户给歌曲换封面时，图片可能来自本地文件；要让封面在「清缓存 / 离线 / 系统
//! 媒体控件」下都还在，就必须像本地音乐的内嵌封面一样落到 `cache/localcovers`，
//! 再由 `localcover://` 协议交给 WebView。这里只做这一件事：读图 → 压到 512px →
//! 落盘 → 返回协议地址（前端把它存进 `track_meta.meta.cover`）。

use std::path::PathBuf;
use std::time::Duration;

use crate::local_music;

/// 允许导入的图片大小上限（原图，压完通常只有几十 KB）
const MAX_SOURCE_BYTES: u64 = 20 * 1024 * 1024;

/// 按内容哈希命名：同一张图重复导入复用同一个文件，不同图不会撞名
fn hash_bytes(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 把一张封面写进封面缓存目录，返回 `http://localcover.localhost/?f=<文件名>`。
///
/// 文件按内容哈希命名，同一张图重复导入不会堆文件；解码不了的原图也照存
/// （`localcover` 按 .jpg 返回，浏览器靠内容嗅探仍能显示）。
async fn store_cover(dir: PathBuf, bytes: Vec<u8>) -> Result<String, String> {
    let compacted = tokio::task::spawn_blocking({
        let bytes = bytes.clone();
        move || local_music::compact_cover(&bytes)
    })
    .await
    .map_err(|e| format!("压缩封面任务失败: {e}"))?;

    let (data, ext) = match compacted {
        Some(jpeg) => (jpeg, "jpg"),
        None => (bytes, "bin"),
    };
    let key = hash_bytes(&data);
    let file_name = format!("u-{key}.{ext}");
    let target = dir.join(&file_name);

    if !target.is_file() {
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("创建封面缓存目录失败: {e}"))?;
        tokio::fs::write(&target, data)
            .await
            .map_err(|e| format!("写入封面缓存失败: {e}"))?;
    }
    Ok(format!("http://localcover.localhost/?f={file_name}"))
}

/// 导入用户选中的本地图片作为歌曲封面。
#[tauri::command]
pub async fn custom_cover_import(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("图片文件不存在".into());
    }
    let meta = tokio::fs::metadata(&source)
        .await
        .map_err(|e| format!("读取图片信息失败: {e}"))?;
    if meta.len() > MAX_SOURCE_BYTES {
        return Err("图片太大了（上限 20 MB）".into());
    }
    let bytes = tokio::fs::read(&source)
        .await
        .map_err(|e| format!("读取图片失败: {e}"))?;
    if bytes.is_empty() {
        return Err("图片文件是空的".into());
    }
    let dir = local_music::covers_dir(&app)?;
    store_cover(dir, bytes).await
}

/// 把网络封面抓回本地缓存，返回 `localcover` 协议地址。
///
/// 与 `builtin_cover_fetch`（WebDAV 用，带 Basic Auth）的区别：这里不带额外
/// 请求头，只服务于用户在编辑框里粘贴的图片地址——存到本地后即使原图失效、
/// 或者清掉图片缓存，封面依然在。
#[tauri::command]
pub async fn custom_cover_fetch(app: tauri::AppHandle, url: String) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持 http(s) 图片地址".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("WinPlayer/0.1")
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("图片请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("图片请求失败: HTTP {}", response.status().as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片数据失败: {e}"))?;
    if bytes.is_empty() {
        return Err("图片内容为空".into());
    }
    let dir = local_music::covers_dir(&app)?;
    store_cover(dir, bytes.to_vec()).await
}
