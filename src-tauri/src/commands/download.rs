//! 离线下载：把插件解析出的播放直链原样保存到本地，供离线播放。
//!
//! - 目录：默认「音乐目录/WinPlayer」（桌面）或应用私有目录（移动端），
//!   可在设置中自定义；文件名/子目录由模板变量生成（见 `expand_template`）。
//! - 断点续传：下载写入 `<名字>.part`，中断后保留；再次下载时带 `Range`
//!   续传（服务端不支持 Range 则从 0 重下），完成后才改名为最终文件。
//! - 进度：通过 `download://progress` 事件上报（约 200ms 一次），
//!   按 `taskId` 区分任务，可随时 `download_cancel` 取消（保留断点）。
//! - 歌词：调用方传入 LRC 文本时写同名 `.lrc` 边车文件。
//!
//! 保存的是原始音频字节流，不做任何转码；扩展名优先取 URL，其次
//! Content-Type，兜底 `mp3`。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 下载进度事件名
const EVENT_PROGRESS: &str = "download://progress";
/// 进度事件的最小间隔，避免高频 IPC 拖慢下载
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);
/// 默认文件名模板
const DEFAULT_TEMPLATE: &str = "{artist} - {name}";

/* ------------------------------ 数据结构 ------------------------------ */

/// 文件名模板变量（由前端按曲目字段传入）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadVars {
    #[serde(default)]
    name: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    album: String,
    /// 来源插件显示名（`{source}`）
    #[serde(default)]
    source: String,
    /// 曲目 ID（`{id}` / `{track}`）
    #[serde(default)]
    id: String,
}

/// 下载进度（节流后上报给前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    task_id: String,
    downloaded: u64,
    total: u64,
    /// 平均速度（字节/秒）
    speed: f64,
}

/// 单曲下载结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    /// 音频文件落盘绝对路径
    path: String,
    size: u64,
    /// 是否写入了同名 .lrc 歌词
    has_lyrics: bool,
}

/* ------------------------------ 内部状态 ------------------------------ */

/// 任务取消标记：按 taskId 索引，任务结束时移除
fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 共享 HTTP 客户端：只限制连接超时，音频流不受总时长限制
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .user_agent("WinPlayer/0.1")
            .build()
            .expect("构建下载 HTTP 客户端失败")
    })
}

/* ------------------------------ 文件名模板 ------------------------------ */

/// 清理单个路径段：剔除文件系统非法字符与控制字符，去掉首尾空格与点
/// （Windows 不允许以点/空格结尾，也会造成隐藏文件与路径穿越）
fn sanitize_segment(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            continue;
        }
        out.push(ch);
    }
    out.trim().trim_matches(|c| c == '.' || c == ' ').to_string()
}

/// 展开文件名模板为路径段列表：
/// - 按 `/` 切分，前若干段作为子目录，最后一段作为文件名（不含扩展名）
/// - 支持 `{name} {artist} {album} {source} {id}`（`{track}` 为 `{id}` 别名）
/// - 变量值里的非法字符被清理，空段落被丢弃
fn expand_template(template: &str, vars: &DownloadVars) -> Vec<String> {
    let template = if template.trim().is_empty() { DEFAULT_TEMPLATE } else { template };
    let mut segments: Vec<String> = Vec::new();
    for raw in template.split('/') {
        let mut seg = String::new();
        let mut chars = raw.chars();
        while let Some(ch) = chars.next() {
            if ch == '{' {
                let mut key = String::new();
                let mut closed = false;
                for inner in chars.by_ref() {
                    if inner == '}' {
                        closed = true;
                        break;
                    }
                    key.push(inner);
                }
                if closed {
                    match key.trim() {
                        "name" => seg.push_str(&vars.name),
                        "artist" => seg.push_str(&vars.artist),
                        "album" => seg.push_str(&vars.album),
                        "source" => seg.push_str(&vars.source),
                        "id" | "track" => seg.push_str(&vars.id),
                        // 未知变量替换为空，避免把 `{xxx}` 原样写进文件名
                        _ => {}
                    }
                } else {
                    seg.push('{');
                    seg.push_str(&key);
                }
            } else {
                seg.push(ch);
            }
        }
        let cleaned = sanitize_segment(&seg);
        if !cleaned.is_empty() {
            segments.push(cleaned);
        }
    }
    if segments.is_empty() {
        segments.push("track".to_string());
    }
    segments
}

/// 拆分路径段：末段为文件名，其余为子目录
fn split_segments(mut segments: Vec<String>) -> (Vec<String>, String) {
    let file = segments.pop().unwrap_or_else(|| "track".to_string());
    (segments, file)
}

/// 在目录内选一个不冲突的最终路径（重名则追加 " (n)"）
fn unique_target(parent: &Path, stem: &str, ext: &str) -> PathBuf {
    let stem = if stem.trim().is_empty() { "track" } else { stem };
    let mut candidate = parent.join(format!("{stem}.{ext}"));
    if !candidate.exists() {
        return candidate;
    }
    let mut n = 1u32;
    loop {
        candidate = parent.join(format!("{stem} ({n}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/* ------------------------------ 扩展名解析 ------------------------------ */

/// 从 URL 路径提取音频扩展名（白名单，避免把 .php 之类当成扩展名）
fn ext_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let name = path.rsplit('/').next()?;
    let ext = name.rsplit('.').next()?.to_ascii_lowercase();
    if is_audio_ext(&ext) {
        Some(ext)
    } else {
        None
    }
}

/// 从 Content-Type 推断扩展名
fn ext_from_content_type(content_type: &str) -> Option<String> {
    let mime = content_type.split(';').next()?.trim().to_ascii_lowercase();
    let ext = match mime.as_str() {
        "audio/mpeg" | "audio/mp3" | "audio/mpeg3" | "audio/x-mpeg-3" => "mp3",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/webm" => "webm",
        "audio/aiff" | "audio/x-aiff" => "aiff",
        _ => return None,
    };
    Some(ext.to_string())
}

fn is_audio_ext(ext: &str) -> bool {
    matches!(
        ext,
        "mp3" | "m4a" | "mp4" | "flac" | "ogg" | "oga" | "opus" | "wav" | "aac" | "webm" | "aiff" | "aif" | "wma" | "ape" | "m4b"
    )
}

/* ------------------------------ 命令 ------------------------------ */

/// 默认下载目录：桌面 → 音乐目录/WinPlayer；移动端 → 应用私有目录/downloads
#[tauri::command]
pub fn download_default_dir(app: AppHandle) -> Result<String, String> {
    let dir = default_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

fn default_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if cfg!(mobile) {
        // 安卓作用域存储下公共音乐目录不可写，改用应用私有目录（导出另行处理）
        return app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("downloads"))
            .map_err(|e| format!("获取应用目录失败：{e}"));
    }
    // 桌面：优先音乐目录，逐级回退到下载目录 / 主目录
    app.path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| app.path().home_dir())
        .map(|dir| dir.join("WinPlayer"))
        .map_err(|e| format!("获取默认下载目录失败：{e}"))
}

/// 下载单曲到本地。`template` 为文件名模板，`vars` 为模板变量；
/// `lyrics` 非空时写同名 `.lrc` 边车文件。可通过 `download_cancel` 取消。
#[tauri::command]
pub async fn download_song(
    app: AppHandle,
    task_id: String,
    url: String,
    dir: String,
    template: String,
    vars: DownloadVars,
    lyrics: Option<String>,
) -> Result<DownloadResult, String> {
    if url.trim().is_empty() {
        return Err("播放地址为空".into());
    }
    if dir.trim().is_empty() {
        return Err("下载目录为空".into());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    cancel_flags()
        .lock()
        .expect("cancel flags lock poisoned")
        .insert(task_id.clone(), cancel.clone());

    let result = download_inner(&app, &task_id, &cancel, &url, &dir, &template, &vars, lyrics.as_deref()).await;

    cancel_flags().lock().expect("cancel flags lock poisoned").remove(&task_id);
    result
}

/// 取消指定任务的下载（保留 `.part` 断点，可稍后续传）
#[tauri::command]
pub fn download_cancel(task_id: String) {
    if let Some(flag) = cancel_flags()
        .lock()
        .expect("cancel flags lock poisoned")
        .get(&task_id)
        .cloned()
    {
        flag.store(true, Ordering::SeqCst);
    }
}

/// 删除离线文件：音频与其同名 `.lrc`、`.part` 残留一并清理
#[tauri::command]
pub async fn download_delete(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if file.is_file() {
        tokio::fs::remove_file(&file)
            .await
            .map_err(|e| format!("删除文件失败：{e}"))?;
    }
    for extra in [file.with_extension("lrc"), file.with_extension("part")] {
        if extra.is_file() {
            let _ = tokio::fs::remove_file(&extra).await;
        }
    }
    Ok(())
}

/// 写入文本文件（离线歌词 .lrc 边车）
#[tauri::command]
pub async fn download_write_text(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("写入文件失败：{e}"))
}

/// 读取文本文件（离线歌词读取，无文件返回 null）
#[tauri::command]
pub async fn download_read_text(path: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取文件失败：{e}")),
    }
}

/// 复制文件（导出到用户选择的目录）
#[tauri::command]
pub async fn download_copy(src: String, dest: String) -> Result<(), String> {
    tokio::fs::copy(&src, &dest)
        .await
        .map(|_| ())
        .map_err(|e| format!("导出文件失败：{e}"))
}

/// 在系统文件管理器中定位文件
#[tauri::command]
pub fn download_reveal(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err("文件不存在".to_string());
    }
    let spawn = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", file.display()))
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(&file).spawn()
    } else {
        let dir = file.parent().unwrap_or_else(|| Path::new("."));
        std::process::Command::new("xdg-open").arg(dir).spawn()
    };
    spawn.map(|_| ()).map_err(|e| format!("打开文件管理器失败：{e}"))
}

/// 批量检查文件是否仍然存在（离线索引导入时标记失效项）
#[tauri::command]
pub fn download_check(paths: Vec<String>) -> Vec<bool> {
    paths
        .into_iter()
        .map(|path| PathBuf::from(&path).is_file())
        .collect()
}

/* ------------------------------ 下载实现 ------------------------------ */

#[allow(clippy::too_many_arguments)]
async fn download_inner(
    app: &AppHandle,
    task_id: &str,
    cancel: &AtomicBool,
    url: &str,
    dir: &str,
    template: &str,
    vars: &DownloadVars,
    lyrics: Option<&str>,
) -> Result<DownloadResult, String> {
    let base = PathBuf::from(dir);
    let segments = expand_template(template, vars);
    let (dirs, stem) = split_segments(segments);

    let mut parent = base.clone();
    for part in &dirs {
        parent.push(part);
    }
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|e| format!("创建下载目录失败：{e}"))?;

    // 断点文件：以最终文件名为基底，扩展名随响应确定，故 .part 不带扩展名
    let part = parent.join(format!("{stem}.part"));
    let existing = tokio::fs::metadata(&part).await.map(|meta| meta.len()).unwrap_or(0);

    let mut request = http_client()
        .get(url)
        .header("Accept", "*/*")
        // 要求原始内容，保证 progress 的字节数准确
        .header("Accept-Encoding", "identity");
    if existing > 0 {
        request = request.header("Range", format!("bytes={existing}-"));
    }
    let response = request.send().await.map_err(|e| format!("下载失败：{e}"))?;

    let status = response.status();
    let mut append = false;
    let mut written = 0u64;
    if existing > 0 {
        if status.as_u16() == 206 {
            append = true;
            written = existing;
        } else if !status.is_success() {
            return Err(format!("下载失败：HTTP {}", status.as_u16()));
        }
    } else if !status.is_success() {
        return Err(format!("下载失败：HTTP {}", status.as_u16()));
    }

    let total = parse_total(response.headers(), status.as_u16(), if append { existing } else { 0 });
    let ext = ext_from_url(url)
        .or_else(|| {
            response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .and_then(ext_from_content_type)
        })
        .unwrap_or_else(|| "mp3".to_string());

    let mut file = if append {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .await
            .map_err(|e| format!("打开断点文件失败：{e}"))?
    } else {
        tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("创建下载文件失败：{e}"))?
    };

    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut response = response;

    loop {
        if cancel.load(Ordering::SeqCst) {
            flush_file(&mut file).await;
            drop(file);
            return Err("已取消下载".to_string());
        }
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                flush_file(&mut file).await;
                drop(file);
                return Err(format!("下载中断：{e}"));
            }
        };
        use tokio::io::AsyncWriteExt;
        if let Err(e) = file.write_all(&chunk).await {
            drop(file);
            return Err(format!("写入文件失败：{e}"));
        }
        written += chunk.len() as u64;
        if last_emit.elapsed() >= PROGRESS_INTERVAL || (total > 0 && written >= total) {
            last_emit = Instant::now();
            emit_progress(app, task_id, written, total, started);
        }
    }

    flush_file(&mut file).await;
    drop(file);

    if total > 0 && written != total {
        return Err(format!("下载不完整（{written}/{total} 字节），已保留断点，可重试"));
    }

    let target = unique_target(&parent, &stem, &ext);
    tokio::fs::rename(&part, &target)
        .await
        .map_err(|e| format!("保存文件失败：{e}"))?;

    let mut has_lyrics = false;
    if let Some(text) = lyrics {
        if !text.trim().is_empty() {
            let lrc = target.with_extension("lrc");
            if tokio::fs::write(&lrc, text).await.is_ok() {
                has_lyrics = true;
            }
        }
    }

    emit_progress(app, task_id, written, written.max(total), started);

    Ok(DownloadResult {
        path: target.to_string_lossy().to_string(),
        size: written,
        has_lyrics,
    })
}

async fn flush_file(file: &mut tokio::fs::File) {
    use tokio::io::AsyncWriteExt;
    let _ = file.flush().await;
}

/// 解析文件总字节数：优先 Content-Range（206），退回 Content-Length
fn parse_total(headers: &reqwest::header::HeaderMap, status: u16, offset: u64) -> u64 {
    if let Some(range) = headers.get("content-range").and_then(|v| v.to_str().ok()) {
        if let Some(raw) = range.rsplit('/').next() {
            if let Ok(total) = raw.trim().parse::<u64>() {
                if total > 0 {
                    return total;
                }
            }
        }
    }
    let len = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);
    if len > 0 && status == 206 {
        len + offset
    } else {
        len
    }
}

fn emit_progress(app: &AppHandle, task_id: &str, downloaded: u64, total: u64, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    let _ = app.emit(
        EVENT_PROGRESS,
        ProgressPayload {
            task_id: task_id.to_string(),
            downloaded,
            total,
            speed: downloaded as f64 / elapsed,
        },
    );
}
