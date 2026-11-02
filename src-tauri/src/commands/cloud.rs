//! 同频服务器上传。
//!
//! 为什么不复用 `http_fetch`：那个命令的请求体是字符串 / base64，一首 60MB 的 FLAC
//! 走 base64 会变成 80MB 的 JSON 字符串过 IPC，内存和延迟都不划算。
//! 这里直接走 reqwest 发原始字节流，并在下载阶段（曲目来自插件源直链时）
//! 用 `cloud-upload-progress` 事件回报真实进度。
//!
//! 客户端调用时会传入 `taskId`，进度事件按它对应到具体的上传任务。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// 进度事件的节流间隔（与下载链路一致）
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// 上传来源：本地文件路径（本地音乐 / 离线 / 录音）或远程直链（插件源）
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum UploadSource {
    Path {
        path: String,
    },
    Url {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UploadProgress {
    task_id: String,
    /// `download`（从源站拉取）或 `upload`（推到同频服务器）
    phase: String,
    transferred: u64,
    total: u64,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .user_agent("WinPlayer/0.1")
            .build()
            .expect("构建上传 HTTP 客户端失败")
    })
}

fn emit(app: &AppHandle, task_id: &str, phase: &str, transferred: u64, total: u64) {
    let _ = app.emit(
        "cloud-upload-progress",
        UploadProgress {
            task_id: task_id.to_string(),
            phase: phase.to_string(),
            transferred,
            total,
        },
    );
}

/// 查询参数里的文件名需要百分号编码（中文名不编码会被服务端截断）
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 从服务端的错误响应里抠出 `error` 字段（没有就返回 None）
fn server_error(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value
        .get("error")
        .and_then(|item| item.as_str())
        .map(|message| message.to_string())
}

/// 从直链把音频读进内存（带进度）；防盗链音源需要调用方给全请求头
async fn fetch_source(
    app: &AppHandle,
    task_id: &str,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let mut request = client()
        .get(url)
        .header("Accept", "*/*")
        .header("Accept-Encoding", "identity");
    for (name, value) in headers {
        request = request.header(name.as_str(), value.as_str());
    }

    let mut response = request.send().await.map_err(|e| format!("拉取音频失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("拉取音频失败：HTTP {}", status.as_u16()));
    }
    let total = response.content_length().unwrap_or(0);

    let mut data: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last_emit = Instant::now();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                data.extend_from_slice(&chunk);
                if last_emit.elapsed() >= PROGRESS_INTERVAL {
                    last_emit = Instant::now();
                    emit(app, task_id, "download", data.len() as u64, total);
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("拉取音频中断：{e}")),
        }
    }
    let received = data.len() as u64;
    emit(app, task_id, "download", received, received.max(total));
    Ok(data)
}

/// 上传一首歌到同频服务器。返回服务端的 JSON 原文（`{ track, duplicate }`）。
#[tauri::command]
pub async fn cloud_upload(
    app: AppHandle,
    task_id: String,
    server: String,
    token: String,
    filename: String,
    source: UploadSource,
) -> Result<String, String> {
    let server = server.trim().trim_end_matches('/').to_string();
    if server.is_empty() {
        return Err("未配置同频服务器服务器地址".to_string());
    }
    if token.is_empty() {
        return Err("未登录同频服务器".to_string());
    }

    let data = match source {
        UploadSource::Path { path } => {
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("读取本地文件失败：{e}"))?;
            if bytes.is_empty() {
                return Err("文件为空".to_string());
            }
            bytes
        }
        UploadSource::Url { url, headers } => fetch_source(&app, &task_id, &url, &headers).await?,
    };

    let size = data.len() as u64;
    emit(&app, &task_id, "upload", 0, size);

    let response = client()
        .put(format!(
            "{server}/api/tracks/upload?filename={}",
            percent_encode(&filename)
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/octet-stream")
        .timeout(Duration::from_secs(1800))
        .body(data)
        .send()
        .await
        .map_err(|e| format!("上传失败：{e}"))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_error(&text).unwrap_or_else(|| format!("HTTP {}", status.as_u16())));
    }

    emit(&app, &task_id, "upload", size, size);
    Ok(text)
}
