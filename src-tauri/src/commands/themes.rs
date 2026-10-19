//! 主题包管理：安装（本地 zip / 目录 / URL）、列出、读取文本资源、删除，
//! 以及自定义协议 `themeasset://`（Windows 下为 `http://themeasset.localhost/`）。
//!
//! 主题包 = 一个 zip（或目录），根目录或唯一顶层目录内含 `theme.json`：
//!
//! ```json
//! {
//!   "id": "com.example.md3",
//!   "name": "Material You",
//!   "version": "1.0.0",
//!   "apiVersion": 1,
//!   "tokens": { "light": { "--wp-accent": "#6750a4" }, "dark": { … } },
//!   "appearance": { "wallpaper": "assets/bg.jpg", "wallpaperBlur": 18 },
//!   "css": "styles/theme.css",
//!   "components": { "PlayerBar": "components/PlayerBar.vue" }
//! }
//! ```
//!
//! 包内其余文件（壁纸 / 字体 / 组件源码 / CSS）原样解压到
//! `<app_data>/themes/<id>/`，前端通过 `themeasset://` 读取二进制资源，
//! 通过 `theme_read_text` 读取 JSON / CSS / Vue 源码（避免协议权限差异）。

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::plugins::{apply_mirror, download_bytes, normalize_mirror};

/// 已安装主题条目（前端据此驱动主题管理 / 市场 UI）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    pub id: String,
    /// theme.json 原文解析结果
    pub manifest: Value,
    /// 主题目录的绝对路径（调试/展示用）
    pub path: String,
}

fn themes_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("themes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建主题目录失败: {e}"))?;
    Ok(dir)
}

/// 主题 ID 与插件同规则：仅允许 [a-z0-9._-]，防止路径穿越
fn validate_theme_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(format!("非法主题 ID: {id}"))
    }
}

/// 校验并返回主题清单；同时把「缺字段」的错误说得足够具体，便于主题作者排错
fn read_manifest(dir: &Path) -> Result<Value, String> {
    let path = dir.join("theme.json");
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 theme.json 失败: {e}"))?;
    let manifest: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 theme.json 失败: {e}"))?;
    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("theme.json 缺少 id 字段")?;
    validate_theme_id(id)?;
    if manifest.get("name").and_then(|v| v.as_str()).is_none() {
        return Err("theme.json 缺少 name 字段".into());
    }
    if manifest.get("apiVersion").and_then(|v| v.as_u64()).unwrap_or(0) < 1 {
        return Err("theme.json 缺少或过低的 apiVersion 字段（当前支持 1）".into());
    }
    Ok(manifest)
}

/// 列出所有已安装主题
#[tauri::command]
pub fn theme_list(app: tauri::AppHandle) -> Result<Vec<ThemeEntry>, String> {
    let dir = themes_dir(&app)?;
    let mut entries: Vec<ThemeEntry> = Vec::new();
    for item in std::fs::read_dir(&dir).map_err(|e| format!("读取主题目录失败: {e}"))? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        if !path.is_dir() {
            continue;
        }
        // 安装过程中的临时目录（.install-xxxx）忽略
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(true)
        {
            continue;
        }
        if let Ok(manifest) = read_manifest(&path) {
            entries.push(ThemeEntry {
                id: manifest["id"].as_str().unwrap_or_default().to_string(),
                manifest,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

/// 读取主题包内的文本文件（theme.json / CSS / Vue 组件源码 / 文本资源）。
/// 仅允许主题目录内的相对路径，禁止 `..` 与绝对路径。
#[tauri::command]
pub fn theme_read_text(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<Option<String>, String> {
    validate_theme_id(&id)?;
    let root = themes_dir(&app)?.join(&id);
    if !root.is_dir() {
        return Err(format!("未找到主题: {id}"));
    }
    let rel = normalize_rel_path(&path)?;
    let file = root.join(rel);
    if !file.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&file)
        .map(Some)
        .map_err(|e| format!("读取主题文件失败: {e}"))
}

/// 归一化包内相对路径：统一 `/` 分隔、禁止越界与空段
fn normalize_rel_path(path: &str) -> Result<PathBuf, String> {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("主题资源路径为空".into());
    }
    let mut out = PathBuf::new();
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("主题资源路径不允许包含 ..".into());
        }
        out.push(segment);
    }
    if out.as_os_str().is_empty() {
        return Err("主题资源路径为空".into());
    }
    Ok(out)
}

fn temp_suffix() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    format!("{:08x}", rng.random::<u32>())
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

/// 从 zip 字节安装主题：解压到临时目录，校验 theme.json 后移入主题目录
fn install_from_zip(app: &tauri::AppHandle, bytes: &[u8]) -> Result<ThemeEntry, String> {
    let dir = themes_dir(app)?;
    let tmp_root = dir.join(format!(".install-{}", temp_suffix()));
    std::fs::create_dir_all(&tmp_root).map_err(|e| e.to_string())?;

    let result = (|| -> Result<ThemeEntry, String> {
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

        // theme.json 可能在根目录，也可能被包在单层顶层文件夹里
        let (src_dir, manifest) = match read_manifest(&tmp_root_canon) {
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
                    return Err("zip 内未找到 theme.json".into());
                }
                let sub = dirs.remove(0);
                let m = read_manifest(&sub)?;
                (sub, m)
            }
        };

        let id = manifest["id"].as_str().unwrap_or_default().to_string();
        let target = dir.join(&id);
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| format!("覆盖旧主题失败: {e}"))?;
        }
        move_dir(&src_dir, &target).map_err(|e| format!("安装主题失败: {e}"))?;

        Ok(ThemeEntry {
            id,
            manifest,
            path: target.to_string_lossy().to_string(),
        })
    })();

    let _ = std::fs::remove_dir_all(&tmp_root);
    result
}

/// 从本地路径安装：目录（主题开发直接指向源码目录）或 .zip 主题包
#[tauri::command]
pub fn theme_install_from_path(app: tauri::AppHandle, src: String) -> Result<ThemeEntry, String> {
    let src_path = PathBuf::from(&src);
    if src_path.is_dir() {
        let manifest = read_manifest(&src_path)?;
        let id = manifest["id"].as_str().unwrap_or_default().to_string();
        let dir = themes_dir(&app)?;
        let target = dir.join(&id);
        if src_path.canonicalize().ok() == target.canonicalize().ok() {
            return Ok(ThemeEntry {
                id,
                manifest,
                path: target.to_string_lossy().to_string(),
            });
        }
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| format!("覆盖旧主题失败: {e}"))?;
        }
        move_dir(&src_path, &target).map_err(|e| format!("安装主题失败: {e}"))?;
        Ok(ThemeEntry {
            id,
            manifest,
            path: target.to_string_lossy().to_string(),
        })
    } else if src_path.extension().and_then(|e| e.to_str()) == Some("zip") {
        let bytes = std::fs::read(&src_path).map_err(|e| format!("读取 zip 文件失败: {e}"))?;
        install_from_zip(&app, &bytes)
    } else {
        Err("主题包必须是 .zip 文件或包含 theme.json 的目录".into())
    }
}

/// 从 URL 安装主题（GitHub 系地址自动走设置的镜像源）
#[tauri::command]
pub async fn theme_install_from_url(
    app: tauri::AppHandle,
    url: String,
    mirror: Option<String>,
) -> Result<ThemeEntry, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("WinPlayer/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let mirror = mirror.as_deref().and_then(normalize_mirror);
    let full = apply_mirror(&url, mirror.as_deref());
    let bytes = download_bytes(&client, &full).await?;
    if !bytes.starts_with(b"PK") {
        return Err("主题包地址返回的不是有效的 zip 文件".into());
    }
    install_from_zip(&app, &bytes)
}

/// 删除已安装主题（正在使用的主题由前端负责先切回默认）
#[tauri::command]
pub fn theme_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_theme_id(&id)?;
    let target = themes_dir(&app)?.join(&id);
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("删除主题失败: {e}"))?;
    }
    Ok(())
}

/// 按扩展名推断 Content-Type（主题资源以图片 / 字体为主）
fn content_type_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn not_found(message: &'static str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(404)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

fn bad_request(message: &'static str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(400)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

/// 解析 `themeasset://<id>/<rel>`，返回 (id, 相对路径)。
/// Windows 下请求形如 `http://themeasset.localhost/<id>/<rel>`，此时首段即 id。
fn parse_asset_path(uri: &str) -> Option<(String, PathBuf)> {
    let url = tauri::Url::parse(uri).ok()?;
    let mut segments = url
        .path_segments()
        .map(|s| s.filter(|part| !part.is_empty()).collect::<Vec<_>>())
        .unwrap_or_default();
    if segments.is_empty() {
        return None;
    }
    let id = segments.remove(0).to_string();
    if segments.is_empty() {
        return None;
    }
    validate_theme_id(&id).ok()?;
    let rel = normalize_rel_path(&segments.join("/")).ok()?;
    Some((id, rel))
}

/// 注册 themeasset 自定义协议（主题包内的壁纸 / 字体 / 图片等二进制资源）
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("themeasset", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        let uri = request.uri().to_string();
        tauri::async_runtime::spawn(async move {
            let Some((id, rel)) = parse_asset_path(&uri) else {
                responder.respond(bad_request("bad theme asset path"));
                return;
            };
            let Ok(root) = themes_dir(&app) else {
                responder.respond(not_found("no theme dir"));
                return;
            };
            let file = root.join(&id).join(&rel);
            // 二次校验：解析后的路径必须仍在主题目录内
            let Ok(canon_file) = file.canonicalize() else {
                responder.respond(not_found("theme asset not found"));
                return;
            };
            let Ok(canon_root) = root.join(&id).canonicalize() else {
                responder.respond(not_found("theme not found"));
                return;
            };
            if !canon_file.starts_with(&canon_root) || !canon_file.is_file() {
                responder.respond(not_found("theme asset not found"));
                return;
            }
            match tokio::fs::read(&canon_file).await {
                Ok(bytes) => {
                    let response = tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", content_type_of(&canon_file))
                        .header("Cache-Control", "no-cache")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap_or_else(|_| not_found("build response failed"));
                    responder.respond(response);
                }
                Err(_) => responder.respond(not_found("read theme asset failed")),
            }
        });
    })
}

/// 供单元测试 / 未来导入导出使用：打包主题目录为 zip 写入目标路径
#[allow(dead_code)]
pub fn pack_theme_dir(src: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    fn walk(
        writer: &mut zip::ZipWriter<std::fs::File>,
        root: &Path,
        dir: &Path,
        options: zip::write::SimpleFileOptions,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                writer.add_directory(&rel, options).map_err(|e| e.to_string())?;
                walk(writer, root, &path, options)?;
            } else {
                writer.start_file(&rel, options).map_err(|e| e.to_string())?;
                let mut input = std::fs::File::open(&path).map_err(|e| e.to_string())?;
                let mut buffer = Vec::new();
                input.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                writer.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    walk(&mut writer, src, src, options)?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}
