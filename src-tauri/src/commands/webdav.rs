//! WebDAV 内置播放源的辅助命令。
//!
//! 播放/歌词都由前端的 PROPFIND/GET 驱动（经 `http_fetch` 转发），这里只解决
//! 一件前端做不到的事：**带鉴权的封面加载**。`<img>` 无法自定义请求头，
//! 「需要 Basic Auth 的 WebDAV 服务器」上的 `cover.jpg` 必然 401，因此由这里
//! 抓回远程图片、压缩后落进本地封面缓存，交给已有的 `localcover://` 协议读取。

use std::collections::HashMap;
use std::time::Duration;

use crate::local_music;

fn hash_key(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 抓取远程封面并缓存，返回 `http://localcover.localhost/?f=<file>`。
///
/// `headers` 与播放入口共用同一份（Basic Auth 等）；同一 URL 只下载一次，
/// 之后直接命中磁盘缓存。
#[tauri::command]
pub async fn builtin_cover_fetch(
    app: tauri::AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持 http(s) 封面地址".into());
    }

    let dir = local_music::covers_dir(&app)?;
    let file_name = format!("r-{}.jpg", hash_key(&url));
    let target = dir.join(&file_name);

    if !target.is_file() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("WinPlayer/0.1")
            .build()
            .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
        let mut request = client.get(&url);
        for (name, value) in headers.unwrap_or_default() {
            request = request.header(name, value);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("封面请求失败: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("封面请求失败: HTTP {}", response.status().as_u16()));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("读取封面数据失败: {e}"))?;

        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("创建封面缓存目录失败: {e}"))?;
        // 压到 512px JPEG；解不开的格式原样落盘（localcover 会按 .jpg 返回，
        // 浏览器仍能按内容嗅探出真实格式，不至于整张图失败）
        let data = local_music::compact_cover(&bytes).unwrap_or_else(|| bytes.to_vec());
        tokio::fs::write(&target, data)
            .await
            .map_err(|e| format!("写入封面缓存失败: {e}"))?;
    }

    Ok(format!("http://localcover.localhost/?f={file_name}"))
}
