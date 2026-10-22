//! 本地音乐相关命令 + 封面协议 `localcover://`
//!
//! 封面不落进前端：扫描时把内嵌图片写到 `appdata/cache/localcovers/`，
//! 这里按文件名提供读取，只允许读该目录下的文件名（不接受任意路径，避免
//! 被前端拼出越权读取）。

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use crate::local_music::{self, KnownFile, LocalAudioFile, LocalLyrics};

fn covers_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    local_music::covers_dir(app)
}

/// 扫描全部已配置文件夹。
///
/// `known` 是前端已索引的 (path, size, mtime)，命中且 size/mtime 未变的文件
/// 只返回路径信息（`unchanged = true`），前端沿用数据库里的旧元数据。
#[tauri::command]
pub async fn local_music_scan(
    app: tauri::AppHandle,
    folders: Vec<String>,
    known: Vec<KnownFile>,
) -> Result<Vec<LocalAudioFile>, String> {
    let covers = covers_dir(&app)?;
    let known_map: HashMap<String, (u64, i64)> = known
        .into_iter()
        .map(|item| (item.path, (item.size, item.mtime)))
        .collect();

    tauri::async_runtime::spawn_blocking(move || local_music::scan(&folders, &known_map, &covers))
        .await
        .map_err(|error| format!("扫描任务失败: {error}"))
}

/// 读取某首本地歌曲的歌词（同名 .lrc > 同名 .srt > 内嵌），无歌词返回 null
#[tauri::command]
pub fn local_music_lyrics(path: String) -> Option<LocalLyrics> {
    local_music::read_lyrics(Path::new(&path))
}

/// 封面协议：`http://localcover.localhost/?f=<文件名>`
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("localcover", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            responder.respond(handle_request(&app, request).await);
        });
    })
}

fn respond(status: u16, content_type: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

async fn handle_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Ok(url) = tauri::Url::parse(&request.uri().to_string()) else {
        return respond(404, "text/plain; charset=utf-8", b"bad request".to_vec());
    };
    let Some(file) = url
        .query_pairs()
        .find(|(key, _)| key == "f")
        .map(|(_, value)| value.into_owned())
    else {
        return respond(404, "text/plain; charset=utf-8", b"missing f".to_vec());
    };
    // 只接受纯文件名：任何路径分隔符 / 上级目录都拒绝
    let candidate = Path::new(&file);
    if candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return respond(400, "text/plain; charset=utf-8", b"invalid file".to_vec());
    }

    let Ok(dir) = covers_dir(app) else {
        return respond(500, "text/plain; charset=utf-8", b"no cache dir".to_vec());
    };
    let path = dir.join(&file);
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return respond(404, "text/plain; charset=utf-8", b"not found".to_vec());
    };
    let content_type = match path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/jpeg",
    };
    respond(200, content_type, bytes)
}
