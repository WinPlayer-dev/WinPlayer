//! 插件包管理：安装（本地目录 / zip / 单文件 JSON / URL）、列出、读取代码、删除，
//! 以及每个插件的私有键值存储。

use base64::Engine;
use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 已安装插件条目（前端据此驱动插件管理 UI）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub manifest: Value,
    /// "dir" = 目录型插件（manifest.json + 入口 JS）；"file" = 单文件 JSON 插件
    pub kind: String,
}

fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建插件目录失败: {e}"))?;
    Ok(dir)
}

fn storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("plugin_storage");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建插件存储目录失败: {e}"))?;
    Ok(dir)
}

/// 插件 ID 仅允许 [a-z0-9._-]，防止路径穿越
fn validate_plugin_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(format!("非法插件 ID: {id}"))
    }
}

fn read_manifest(dir: &Path) -> Result<Value, String> {
    let path = dir.join("manifest.json");
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
    let manifest: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("manifest.json 缺少 id 字段")?;
    validate_plugin_id(id)?;
    if manifest.get("name").and_then(|v| v.as_str()).is_none() {
        return Err("manifest.json 缺少 name 字段".into());
    }
    if manifest.get("apiVersion").and_then(|v| v.as_u64()).unwrap_or(0) < 1 {
        return Err("manifest.json 缺少或过低的 apiVersion 字段（当前支持 1）".into());
    }
    Ok(manifest)
}

/// 列出所有已安装插件
#[tauri::command]
pub fn plugin_list(app: tauri::AppHandle) -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir(&app)?;
    let mut entries: Vec<PluginEntry> = Vec::new();

    for item in std::fs::read_dir(&dir).map_err(|e| format!("读取插件目录失败: {e}"))? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        if path.is_dir() {
            if let Ok(manifest) = read_manifest(&path) {
                let id = manifest["id"].as_str().unwrap_or_default().to_string();
                entries.push(PluginEntry {
                    id,
                    manifest,
                    kind: "dir".into(),
                });
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            // 单文件 JSON 插件：manifest 字段 + code
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(manifest) = serde_json::from_str::<Value>(&text) {
                    if manifest.get("code").and_then(|v| v.as_str()).is_some() {
                        let valid = manifest
                            .get("id")
                            .and_then(|v| v.as_str())
                            .map(validate_plugin_id);
                        if let Some(Ok(())) = valid {
                            entries.push(PluginEntry {
                                id: manifest["id"].as_str().unwrap_or_default().to_string(),
                                manifest,
                                kind: "file".into(),
                            });
                        }
                    }
                }
            }
        }
    }

    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

/// 读取插件入口 JS 代码（交由前端注入沙箱 Worker 执行）
#[tauri::command]
pub fn plugin_read_code(app: tauri::AppHandle, id: String) -> Result<String, String> {
    validate_plugin_id(&id)?;
    let dir = plugins_dir(&app)?;

    let plugin_dir = dir.join(&id);
    if plugin_dir.is_dir() {
        let manifest = read_manifest(&plugin_dir)?;
        let main = manifest
            .get("main")
            .and_then(|v| v.as_str())
            .unwrap_or("main.js");
        // main 仅允许相对路径，禁止越界
        if main.contains("..") || Path::new(main).is_absolute() {
            return Err("manifest.main 必须是插件目录内的相对路径".into());
        }
        let code_path = plugin_dir.join(main);
        return std::fs::read_to_string(code_path).map_err(|e| format!("读取插件代码失败: {e}"));
    }

    let file_path = dir.join(format!("{id}.json"));
    if file_path.is_file() {
        let text = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("读取插件文件失败: {e}"))?;
        let manifest: Value =
            serde_json::from_str(&text).map_err(|e| format!("解析插件文件失败: {e}"))?;
        return manifest
            .get("code")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "单文件插件缺少 code 字段".to_string());
    }

    Err(format!("未找到插件: {id}"))
}

fn temp_suffix() -> String {
    let mut rng = rand::rng();
    format!("{:08x}", rng.random::<u32>())
}

/// 从 zip 字节安装：解压到临时目录，校验后移入插件目录
fn install_from_zip(app: &tauri::AppHandle, bytes: &[u8]) -> Result<PluginEntry, String> {
    let dir = plugins_dir(app)?;
    let tmp_root = dir.join(format!(".install-{}", temp_suffix()));
    std::fs::create_dir_all(&tmp_root).map_err(|e| e.to_string())?;

    let result = (|| -> Result<PluginEntry, String> {
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("打开 zip 失败: {e}"))?;

        let tmp_root_canon = tmp_root.canonicalize().map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("读取 zip 条目失败: {e}"))?;
            let Some(rel) = file.enclosed_name() else {
                continue; // 跳过越界路径
            };
            let out_path = tmp_root_canon.join(rel);
            if file.is_dir() {
                std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut outfile = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }

        // manifest 可能在根目录，也可能被包在单层顶层文件夹里
        let manifest_root = read_manifest(&tmp_root_canon);
        let (src_dir, manifest) = match manifest_root {
            Ok(m) => (tmp_root_canon.clone(), m),
            Err(_) => {
                let mut dirs: Vec<PathBuf> = Vec::new();
                for item in std::fs::read_dir(&tmp_root_canon).map_err(|e| e.to_string())? {
                    let item = item.map_err(|e| e.to_string())?;
                    if item.path().is_dir() {
                        dirs.push(item.path());
                    }
                }
                if dirs.len() != 1 {
                    return Err("zip 内未找到 manifest.json".into());
                }
                let sub = dirs.remove(0);
                let m = read_manifest(&sub)?;
                (sub, m)
            }
        };

        let id = manifest["id"].as_str().unwrap_or_default().to_string();
        let target = dir.join(&id);
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| format!("覆盖旧插件失败: {e}"))?;
        }
        move_dir(&src_dir, &target).map_err(|e| format!("安装插件失败: {e}"))?;

        Ok(PluginEntry {
            id,
            manifest,
            kind: "dir".into(),
        })
    })();

    let _ = std::fs::remove_dir_all(&tmp_root);
    result
}

/// 递归移动目录（跨卷时回退为复制+删除）
fn move_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::rename(src, dst).or_else(|_| {
        std::fs::create_dir_all(dst)?;
        for item in std::fs::read_dir(src)? {
            let item = item?;
            let to = dst.join(item.file_name());
            if item.path().is_dir() {
                move_dir(&item.path(), &to)?;
            } else {
                std::fs::copy(item.path(), to)?;
            }
        }
        std::fs::remove_dir_all(src)
    })
}

/// 安装单文件 JSON 插件
fn install_from_single_json(
    app: &tauri::AppHandle,
    text: &str,
) -> Result<PluginEntry, String> {
    let manifest: Value =
        serde_json::from_str(text).map_err(|e| format!("解析插件 JSON 失败: {e}"))?;
    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("插件 JSON 缺少 id 字段")?
        .to_string();
    validate_plugin_id(&id)?;
    if manifest.get("code").and_then(|v| v.as_str()).is_none() {
        return Err("插件 JSON 缺少 code 字段（目录型插件请打包为 zip）".into());
    }
    let dir = plugins_dir(app)?;
    let target = dir.join(format!("{id}.json"));
    std::fs::write(&target, text).map_err(|e| format!("写入插件文件失败: {e}"))?;
    Ok(PluginEntry {
        id,
        manifest,
        kind: "file".into(),
    })
}

/// 按内容安装插件包：zip（PK 魔数）或单文件 JSON。
/// 仅供「地址型来源」（Android content:// URI 等拿不到扩展名的场景）使用。
fn install_from_bytes(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<PluginEntry, String> {
    if bytes.starts_with(b"PK") {
        return install_from_zip(app, &bytes);
    }
    if let Ok(text) = std::str::from_utf8(&bytes) {
        if let Ok(entry) = install_from_single_json(app, text) {
            return Ok(entry);
        }
    }
    Err("无法识别的插件包：应为 .zip 压缩包或单文件 .json 插件".into())
}

/// 读取选择器返回的文件地址。
/// Android 的 `ACTION_GET_CONTENT` 返回的是 `content://` URI（不是文件系统路径），
/// 必须交给 fs 插件通过 ContentResolver 解析后读取。
fn read_selected_file(app: &tauri::AppHandle, src: &str) -> Result<Vec<u8>, String> {
    use std::str::FromStr;
    use tauri_plugin_fs::FsExt;

    let path =
        tauri_plugin_fs::FilePath::from_str(src).map_err(|_| format!("无法解析文件地址: {src}"))?;
    app.fs()
        .read(path)
        .map_err(|e| format!("读取所选文件失败: {e}"))
}

/// 从本地路径安装：目录 → 直接复制；.zip → 解压；.json → 单文件插件。
/// Android 上选择器给出的是 `content://`（iOS 为 `file://`）URI，改为按内容安装。
#[tauri::command]
pub fn plugin_install_from_path(app: tauri::AppHandle, src: String) -> Result<PluginEntry, String> {
    if src.starts_with("content://") || src.starts_with("file://") {
        let bytes = read_selected_file(&app, &src)?;
        return install_from_bytes(&app, bytes);
    }

    let src_path = PathBuf::from(&src);
    if src_path.is_dir() {
        let manifest = read_manifest(&src_path)?;
        let id = manifest["id"].as_str().unwrap_or_default().to_string();
        let dir = plugins_dir(&app)?;
        let target = dir.join(&id);
        if src_path.canonicalize().ok() == target.canonicalize().ok() {
            return Ok(PluginEntry {
                id,
                manifest,
                kind: "dir".into(),
            });
        }
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| format!("覆盖旧插件失败: {e}"))?;
        }
        move_dir(&src_path, &target).map_err(|e| format!("安装插件失败: {e}"))?;
        Ok(PluginEntry {
            id,
            manifest,
            kind: "dir".into(),
        })
    } else if src_path.extension().and_then(|e| e.to_str()) == Some("zip") {
        let bytes =
            std::fs::read(&src_path).map_err(|e| format!("读取 zip 文件失败: {e}"))?;
        install_from_zip(&app, &bytes)
    } else if src_path.extension().and_then(|e| e.to_str()) == Some("json") {
        let text = std::fs::read_to_string(&src_path)
            .map_err(|e| format!("读取插件文件失败: {e}"))?;
        install_from_single_json(&app, &text)
    } else {
        Err("仅支持插件目录、.zip 包或单文件 .json 插件".into())
    }
}

/* ------------------------------ GitHub 镜像 ------------------------------ */

/// 需要走镜像前缀拼接的 GitHub 系域名
const GITHUB_URL_PREFIXES: [&str; 6] = [
    "https://github.com/",
    "https://raw.githubusercontent.com/",
    "https://codeload.github.com/",
    "https://api.github.com/",
    "https://gist.githubusercontent.com/",
    "https://objects.githubusercontent.com/",
];

/// github.com 下不是「仓库根地址」的路径首段
const GITHUB_NON_REPO_SEGMENTS: [&str; 7] = [
    "orgs", "topics", "features", "settings", "notifications", "explore", "search",
];

/// 归一化镜像前缀：去空白与结尾斜杠，空串视为未配置
pub(crate) fn normalize_mirror(mirror: &str) -> Option<String> {
    let trimmed = mirror.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(crate) fn is_github_url(url: &str) -> bool {
    GITHUB_URL_PREFIXES.iter().any(|p| url.starts_with(p))
}

/// 仅对 GitHub 系地址拼接镜像前缀（prefix + "/" + url）
pub(crate) fn apply_mirror(url: &str, mirror: Option<&str>) -> String {
    match mirror {
        Some(m) if is_github_url(url) => format!("{m}/{url}"),
        _ => url.to_string(),
    }
}

/// 识别 GitHub 仓库根地址（https://github.com/{owner}/{repo}[/tree/{branch}]）。
/// 未指定分支时返回 main/master 两个候选；指定了分支则补充 tag 归档候选。
fn github_repo_candidates(url: &str) -> Option<(String, String, Vec<String>)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let rest = rest.trim_end_matches('/');
    let segs: Vec<&str> = rest.split('/').collect();
    if segs.len() < 2 || segs[0].is_empty() || segs[1].is_empty() {
        return None;
    }
    if GITHUB_NON_REPO_SEGMENTS.contains(&segs[0]) {
        return None;
    }
    match segs.len() {
        2 => Some((
            segs[0].to_string(),
            segs[1].to_string(),
            vec!["main".into(), "master".into()],
        )),
        4 if segs[2] == "tree" && !segs[3].is_empty() => Some((
            segs[0].to_string(),
            segs[1].to_string(),
            vec![format!("heads/{}", segs[3]), format!("tags/{}", segs[3])],
        )),
        _ => None,
    }
}

pub(crate) async fn download_bytes(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("读取内容失败: {e}"))
}

/// 从 URL 安装：支持 .zip / 单文件 .json 直链，以及 GitHub 仓库地址
/// （自动转为默认分支归档下载）；GitHub 系地址会拼接镜像前缀。
#[tauri::command]
pub async fn plugin_install_from_url(
    app: tauri::AppHandle,
    url: String,
    mirror: Option<String>,
) -> Result<PluginEntry, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("WinPlayer/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let mirror = mirror.as_deref().and_then(normalize_mirror);

    // GitHub 仓库地址安装顺序：
    // 1) 下载最新 Release（优先 zip 资产，其次源码 zipball）
    // 2) codeload 分支归档（镜像源优先，直连兜底）
    // 每次尝试的具体失败原因都会收集进最终错误信息，便于排查。
    if let Some((owner, repo, refs)) = github_repo_candidates(&url) {
        let mut errors: Vec<String> = Vec::new();

        // 1) 下载最新 Release（无论是否配置镜像源都尝试，有镜像则走镜像）
        {
            let api = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
            match download_bytes(&client, &apply_mirror(&api, mirror.as_deref())).await {
                Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                    Ok(release) => {
                        let mut candidates: Vec<String> = release
                            .get("assets")
                            .and_then(Value::as_array)
                            .map(|assets| {
                                assets
                                    .iter()
                                    .filter_map(|a| {
                                        a.get("browser_download_url").and_then(Value::as_str)
                                    })
                                    .filter(|u| u.to_lowercase().ends_with(".zip"))
                                    .map(String::from)
                                    .collect()
                            })
                            .unwrap_or_default();
                        if let Some(zipball) = release.get("zipball_url").and_then(Value::as_str) {
                            candidates.push(zipball.to_string());
                        }
                        if candidates.is_empty() {
                            errors.push(format!("{api}: 最新 Release 无 zip 资产"));
                        }
                        for download in candidates {
                            match download_bytes(
                                &client,
                                &apply_mirror(&download, mirror.as_deref()),
                            )
                            .await
                            {
                                Ok(bytes) if bytes.starts_with(b"PK") => {
                                    return install_from_zip(&app, &bytes);
                                }
                                Ok(_) => {
                                    errors.push(format!("{download}: 响应不是有效的 zip"))
                                }
                                Err(e) => errors.push(format!("{download}: {e}")),
                            }
                        }
                    }
                    Err(e) => errors.push(format!("{api}: 解析 Release 信息失败: {e}")),
                },
                Err(e) => errors.push(format!("{api}: {e}")),
            }
        }

        // 2) codeload 分支归档（镜像源优先，直连兜底）
        for reference in refs {
            let archive =
                format!("https://github.com/{owner}/{repo}/archive/refs/heads/{reference}");
            let attempts: Vec<String> = match mirror.as_deref() {
                Some(m) => vec![format!("{m}/{archive}"), archive],
                None => vec![archive],
            };
            for attempt in attempts {
                match download_bytes(&client, &attempt).await {
                    Ok(bytes) if bytes.starts_with(b"PK") => {
                        return install_from_zip(&app, &bytes);
                    }
                    Ok(_) => errors.push(format!("{attempt}: 响应不是有效的 zip")),
                    Err(e) => errors.push(format!("{attempt}: {e}")),
                }
            }
        }

        return Err(format!(
            "从 GitHub 仓库 {owner}/{repo} 安装失败，各下载地址尝试结果：{}",
            errors.join("；")
        ));
    }

    let full_url = apply_mirror(&url, mirror.as_deref());
    let bytes = download_bytes(&client, &full_url).await?;

    // 优先按单文件 JSON 识别，失败则按 zip 处理
    if let Ok(text) = std::str::from_utf8(&bytes) {
        if let Ok(entry) = install_from_single_json(&app, text) {
            return Ok(entry);
        }
    }
    install_from_zip(&app, &bytes)
}

/// 删除已安装插件（同时清理其私有存储）
#[tauri::command]
pub fn plugin_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_plugin_id(&id)?;
    let dir = plugins_dir(&app)?;

    let plugin_dir = dir.join(&id);
    if plugin_dir.is_dir() {
        std::fs::remove_dir_all(&plugin_dir).map_err(|e| format!("删除插件失败: {e}"))?;
    }
    let plugin_file = dir.join(format!("{id}.json"));
    if plugin_file.is_file() {
        std::fs::remove_file(&plugin_file).map_err(|e| format!("删除插件失败: {e}"))?;
    }

    let storage = storage_dir(&app)?.join(format!("{id}.json"));
    if storage.is_file() {
        let _ = std::fs::remove_file(storage);
    }
    Ok(())
}

fn storage_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_plugin_id(id)?;
    Ok(storage_dir(app)?.join(format!("{id}.json")))
}

/// 读取插件私有存储（整个 JSON 对象）
#[tauri::command]
pub fn plugin_storage_get(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let path = storage_path(&app, &id)?;
    if !path.is_file() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("解析插件存储失败: {e}"))
}

/// 写入插件私有存储（整体覆盖 JSON 对象）
#[tauri::command]
pub fn plugin_storage_set(app: tauri::AppHandle, id: String, value: Value) -> Result<(), String> {
    let path = storage_path(&app, &id)?;
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&path).map_err(|e| format!("写入插件存储失败: {e}"))?;
    file.write_all(text.as_bytes())
        .map_err(|e| format!("写入插件存储失败: {e}"))
}

/// 供 base64 解码辅助使用（保留以避免未使用告警的工具函数）
#[allow(dead_code)]
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| e.to_string())
}

/// 简单可读性辅助：读取文件大小（用于调试）
#[allow(dead_code)]
pub fn file_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}

/// 保证 Read trait 在范围内被引用（zip 解压辅助）
#[allow(dead_code)]
fn _assert_read<R: Read>(_: R) {}
