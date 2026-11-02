//! 图片磁盘缓存：自定义协议 `cachedimg://`
//!
//! 前端把 http(s) 图片地址改写为 `http://cachedimg.localhost/?src=<encoded>`，
//! 本模块按「URL 哈希 → 磁盘文件」的策略处理请求：
//! - 命中：直接回源磁盘文件（图片始终走缓存，不重新请求网络）；
//! - 未命中：下载原图 → 压缩（最长边 512px、JPEG q75）→ 落盘 → 返回。
//!
//! 页面数据缓存（主页推荐/歌单详情）存于 SQLite settings 表，由前端 services/cache.ts 处理。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tokio::sync::{Notify, Semaphore};

/// 压缩后最长边（界面最大展示约 160px，2x 缩放下 512 足够清晰）
const MAX_DIMENSION: u32 = 512;
/// JPEG 压缩质量
const JPEG_QUALITY: u8 = 75;
/// 等待其它请求完成下载的上限（下载者受并发限制排队，需留足等待时间）
const INFLIGHT_WAIT: Duration = Duration::from_secs(30);
/// 下载+压缩的并发上限：全尺寸 JPEG 解码很吃 CPU，不限制时长列表会打满所有核心
const MAX_CONCURRENT_FETCH: usize = 4;

/// 正在下载中的图片：hash -> 完成通知。等待者收到通知后重读磁盘，
/// 避免同一张图被并发下载多次。
fn inflight() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    static INFLIGHT: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fetch_limiter() -> &'static Semaphore {
    static LIMITER: OnceLock<Semaphore> = OnceLock::new();
    LIMITER.get_or_init(|| Semaphore::new(MAX_CONCURRENT_FETCH))
}

/// 共享 HTTP 客户端：复用连接池与 TLS 会话，避免每张图都重新握手
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("WinPlayer/0.1")
            .build()
            .expect("构建共享 HTTP 客户端失败")
    })
}

/// FNV-1a 64 位哈希，作为缓存文件名（64 位空间下碰撞概率可忽略）
fn hash_url(url: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn images_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
        .map(|dir| dir.join("cache").join("images"))
}

fn image_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, source_url: &str) -> Result<PathBuf, String> {
    Ok(images_dir(app)?.join(format!("{}.jpg", hash_url(source_url))))
}

fn not_found(message: &'static str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(404)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

/// 处理一次图片请求：先查磁盘，未命中则下载并压缩落盘
async fn process_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Ok(url) = tauri::Url::parse(&request.uri().to_string()) else {
        eprintln!("[cachedimg] bad request uri: {}", request.uri());
        return not_found("bad request");
    };
    let Some(source_url) = url
        .query_pairs()
        .find(|(key, _)| key == "src")
        .map(|(_, value)| value.into_owned())
    else {
        eprintln!("[cachedimg] missing src, uri={}", request.uri());
        return not_found("missing src");
    };
    // 只允许代理 http(s) 图片
    if !source_url.starts_with("http://") && !source_url.starts_with("https://") {
        eprintln!("[cachedimg] unsupported scheme: {source_url}");
        return not_found("unsupported scheme");
    }

    let Ok(path) = image_path(app, &source_url) else {
        eprintln!("[cachedimg] no cache dir for {source_url}");
        return not_found("no cache dir");
    };

    // 命中磁盘缓存：图片始终从缓存读取
    if let Ok(bytes) = tokio::fs::read(&path).await {
        return serve_jpeg(bytes);
    }

    // 去重：同一张图只允许一个请求下载，其余等待完成通知后再读磁盘
    let hash = hash_url(&source_url);
    let (is_fetcher, notify) = {
        let mut map = inflight().lock().expect("inflight lock poisoned");
        match map.get(&hash) {
            Some(n) => (false, n.clone()),
            None => {
                let n = Arc::new(Notify::new());
                map.insert(hash.clone(), n.clone());
                (true, n)
            }
        }
    };

    if !is_fetcher {
        // 等待下载者完成：收到通知或下载者移除自身后重读磁盘。
        // 轮询兜底，防止通知竞态导致无限等待。
        let deadline = tokio::time::Instant::now() + INFLIGHT_WAIT;
        loop {
            if let Ok(bytes) = tokio::fs::read(&path).await {
                return serve_jpeg(bytes);
            }
            let still_inflight = inflight()
                .lock()
                .expect("inflight lock poisoned")
                .contains_key(&hash);
            if !still_inflight {
                // 下载者已结束且磁盘无文件（下载失败）→ 交给前端回退远程图
                return not_found("fetch failed");
            }
            if tokio::time::Instant::now() >= deadline {
                eprintln!("[cachedimg] inflight wait timeout: {source_url}");
                return not_found("image fetch in progress");
            }
            let _ = tokio::time::timeout(Duration::from_secs(1), notify.notified()).await;
        }
    }

    let result = fetch_and_cache(&source_url, &path).await;
    // 先移除再通知：新请求会重新成为下载者，等待者则自行重读磁盘
    inflight()
        .lock()
        .expect("inflight lock poisoned")
        .remove(&hash);
    notify.notify_waiters();

    match result {
        Ok(bytes) => serve_jpeg(bytes),
        Err(e) => {
            eprintln!("[cachedimg] fetch failed for {source_url}: {e}");
            not_found("fetch failed")
        }
    }
}

fn serve_jpeg(bytes: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", "image/jpeg")
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap()
}

/// 下载 → 解码 → 压缩 → 写入磁盘（失败自动重试一次，解码失败除外）
async fn fetch_and_cache(source_url: &str, path: &PathBuf) -> Result<Vec<u8>, String> {
    // 限制并发：解码压缩是 CPU 大户，排队执行避免卡顿
    let _permit = fetch_limiter()
        .acquire()
        .await
        .map_err(|_| "并发限制器已关闭".to_string())?;

    let mut last_err = String::new();
    for attempt in 0..2 {
        match fetch_once(source_url, path).await {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                // 内容不是可解码图片（如 SVG），重试也不会成功
                if e.contains("图片解码失败") {
                    return Err(e);
                }
                last_err = e;
                if attempt == 0 {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
            }
        }
    }
    Err(last_err)
}

async fn fetch_once(source_url: &str, path: &PathBuf) -> Result<Vec<u8>, String> {
    let response = http_client()
        .get(source_url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应体失败: {e}"))?;

    // 压缩：解码后缩放到最长边 MAX_DIMENSION，再编码为 JPEG
    let compressed = tokio::task::spawn_blocking(move || -> Option<Vec<u8>> {
        let img = image::load_from_memory(&bytes).ok()?;
        let img = img.thumbnail(MAX_DIMENSION, MAX_DIMENSION);
        let mut buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY)
            .encode_image(&img)
            .ok()?;
        Some(buf)
    })
    .await
    .map_err(|e| format!("压缩任务失败: {e}"))?;

    match compressed {
        Some(jpeg) => {
            // 确保缓存目录存在（首次运行时尚无 cache/images），再写临时文件并改名
            if let Some(dir) = path.parent() {
                tokio::fs::create_dir_all(dir).await.map_err(|e| format!("创建缓存目录失败: {e}"))?;
            }
            let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
            tokio::fs::write(&tmp, &jpeg).await.map_err(|e| format!("写缓存失败: {e}"))?;
            if tokio::fs::rename(&tmp, path).await.is_err() {
                let _ = tokio::fs::remove_file(&tmp).await;
            }
            Ok(jpeg)
        }
        // 内容不是可解码图片（如 SVG）：直接透传，不缓存
        None => Err("图片解码失败".to_string()),
    }
}

/// 注册 cachedimg 自定义协议（Windows 下通过 http://cachedimg.localhost/ 访问）
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("cachedimg", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            responder.respond(process_request(&app, request).await);
        });
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    image_count: u64,
    image_bytes: u64,
}

/// 统计图片缓存目录（页面数据缓存在 SQLite，由前端统计）
fn scan_images(dir: &PathBuf) -> CacheStats {
    let mut stats = CacheStats { image_count: 0, image_bytes: 0 };
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    stats.image_count += 1;
                    stats.image_bytes += meta.len();
                }
            }
        }
    }
    stats
}

#[tauri::command]
pub async fn cache_stats(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let dir = images_dir(&app)?;
    Ok(scan_images(&dir))
}

/// 清空图片缓存，返回清理前的占用（页面数据缓存由前端另行删除）
#[tauri::command]
pub async fn cache_clear(app: tauri::AppHandle) -> Result<CacheStats, String> {
    let dir = images_dir(&app)?;
    let stats = scan_images(&dir);
    if dir.exists() {
        tokio::fs::remove_dir_all(&dir)
            .await
            .map_err(|e| format!("删除缓存目录失败: {e}"))?;
    }
    Ok(stats)
}

/// 后台预取：把远程图片下载压缩进缓存（已缓存则直接返回）。
/// 供前端在「协议请求失败、回退显示远程原图」时调用，保证下次能命中缓存。
#[tauri::command]
pub async fn image_cache_prefetch(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("unsupported scheme".to_string());
    }
    let path = image_path(&app, &url)?;
    if tokio::fs::metadata(&path).await.is_ok() {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        let _ = tokio::fs::create_dir_all(dir).await;
    }
    fetch_and_cache(&url, &path).await.map(|_| ())
}

/// 查询图片的本地缓存路径：命中返回 `file://` URI（供系统媒体控件直接读取本地文件），
/// 未命中返回 `null` 且**不触发下载**——系统侧展示封面另有原图直连兜底，这里保持零阻塞
#[tauri::command]
pub fn cover_cache_path(app: tauri::AppHandle, url: String) -> Option<String> {
    // 离线 / 本地音乐的封面走 localcover 协议：直接映射到 `cache/localcovers` 里的文件，
    // 否则系统媒体控件只能拿到 WebView 专属域名，离线时显示不出封面
    if let Some(path) = local_cover_path(&app, &url) {
        if path.is_file() {
            return tauri::Url::from_file_path(path).ok().map(|uri| uri.to_string());
        }
        return None;
    }
    let path = image_path(&app, &url).ok()?;
    if !path.is_file() {
        return None;
    }
    tauri::Url::from_file_path(path).ok().map(|uri| uri.to_string())
}

/// 把 `http://localcover.localhost/?f=<文件名>` 解析成缓存目录下的实际路径。
/// 非该协议、或文件名里带路径分隔符（越权读取）时返回 None。
fn local_cover_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &str) -> Option<PathBuf> {
    let parsed = tauri::Url::parse(url).ok()?;
    if parsed.host_str()? != "localcover.localhost" {
        return None;
    }
    let name = parsed
        .query_pairs()
        .find(|(key, _)| key == "f")
        .map(|(_, value)| value.into_owned())?;
    if std::path::Path::new(&name)
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return None;
    }
    crate::local_music::covers_dir(app).ok().map(|dir| dir.join(name))
}

/// 提取封面主色（跟随封面的动态强调色用）：优先读磁盘缓存；
/// 刚切歌时封面可能仍由 cachedimg 协议在下载中，这里等待下载完成（上限 15s）
/// 再取色，仍拿不到返回 null，前端保持当前强调色。返回 "#rrggbb"。
#[tauri::command]
pub async fn cover_dominant_color(app: tauri::AppHandle, url: String) -> Option<String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let path = image_path(&app, &url).ok()?;
    let hash = hash_url(&url);
    // 展示请求与取色请求几乎同时发出：先稍等一下让协议侧把下载挂进 inflight
    tokio::time::sleep(Duration::from_millis(400)).await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(bytes) = tokio::fs::read(&path).await {
            // 解码取色是 CPU 操作，放阻塞线程池避免卡异步运行时
            return tokio::task::spawn_blocking(move || dominant_color_hex(&bytes))
                .await
                .ok()
                .flatten();
        }
        let notify = inflight().lock().expect("inflight lock poisoned").get(&hash).cloned();
        match notify {
            // 有下载在进行：等它完成通知后重读磁盘
            Some(notify) => {
                let _ = tokio::time::timeout(Duration::from_secs(2), notify.notified()).await;
            }
            // 没有下载在进行且磁盘无文件（下载失败 / 非缓存图源）→ 放弃
            None => return None,
        }
        if tokio::time::Instant::now() >= deadline {
            return None;
        }
    }
}

/// 饱和度加权主色提取：跳过近黑/近白/低饱和像素避免被背景色淹没，
/// 再把结果的亮度规整到可读区间，保证亮/暗主题下作为强调色都可用
fn dominant_color_hex(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let img = img.thumbnail(48, 48).to_rgb8();

    let mut sum = [0f32; 3];
    let mut total = 0f32;
    let mut plain_sum = [0f32; 3];
    let mut plain_total = 0f32;
    for px in img.pixels() {
        let [r, g, b] = px.0.map(f32::from);
        plain_sum[0] += r;
        plain_sum[1] += g;
        plain_sum[2] += b;
        plain_total += 1.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let sat = if max > 0.0 { (max - min) / max } else { 0.0 };
        let val = max / 255.0;
        // 跳过近黑、近白与低饱和像素；越鲜艳权重越高，亮度适中再加权
        if val < 0.06 || val > 0.97 || sat < 0.18 {
            continue;
        }
        let w = sat * sat * (1.0 - (val - 0.55).abs());
        sum[0] += r * w;
        sum[1] += g * w;
        sum[2] += b * w;
        total += w;
    }

    let (r, g, b) = if total > 0.0 {
        (sum[0] / total, sum[1] / total, sum[2] / total)
    } else {
        (
            plain_sum[0] / plain_total,
            plain_sum[1] / plain_total,
            plain_sum[2] / plain_total,
        )
    };

    // 规整饱和度与亮度：全灰封面给一点淡色，亮度钳到 [0.45, 0.72] 避免刺眼或不可读
    let (_, s, v) = rgb_to_hsv(r, g, b);
    let s = if total > 0.0 { s.clamp(0.45, 0.9) } else { 0.35 };
    let v = v.clamp(0.45, 0.72);
    let (r, g, b) = hsv_to_rgb(rgb_to_hsv(r, g, b).0, s, v);
    Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
}

/// RGB（0-255）→ HSV（h 0-360 / s、v 0-1）
fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let h = if d == 0.0 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    let s = if max <= 0.0 { 0.0 } else { d / max };
    (h, s, max / 255.0)
}

/// HSV（h 0-360 / s、v 0-1）→ RGB（0-255）
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match h as u32 / 60 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (
        ((r + m) * 255.0).round() as u8,
        ((g + m) * 255.0).round() as u8,
        ((b + m) * 255.0).round() as u8,
    )
}
