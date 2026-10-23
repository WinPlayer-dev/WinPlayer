//! 麦克风运行时授权插件（桌面端为 no-op）。
//!
//! Android 6.0+ 的 `RECORD_AUDIO` 属于危险权限：清单一经声明也必须在运行时
//! 弹窗申请，否则用 cpal/AAudio 打开输入流会直接失败，而且系统不会再提示。
//! 本插件向前端暴露单一 `request` 命令：已授权时立即返回，未授权时弹系统
//! 授权框并等待用户选择。权限本身由 `android/src/main/AndroidManifest.xml`
//! 声明（Gradle 合并进宿主 App）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
use tauri::Manager;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.micpermission";

/// 原生权限请求句柄。
#[cfg(mobile)]
pub struct MicPermission<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(mobile)]
impl<R: Runtime> MicPermission<R> {
    /// 确保已获得麦克风权限（必要时弹窗）；被拒绝时返回可直接展示的中文原因。
    pub fn request(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>("request", serde_json::json!({}))
            .map_err(|e| format!("{e}"))
    }
}

/// 从任意 Tauri Manager 取到权限请求句柄。
#[cfg(mobile)]
pub trait MicPermissionExt<R: Runtime> {
    fn mic_permission(&self) -> &MicPermission<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: Manager<R>> MicPermissionExt<R> for T {
    fn mic_permission(&self) -> &MicPermission<R> {
        self.state::<MicPermission<R>>().inner()
    }
}

/// 初始化插件；桌面端注册一个空插件，跨平台编译无需 cfg 门控。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // cfg 放在 let 上而不是函数上：rust-analyzer 对 build 脚本注入的
    // cfg(mobile)/cfg(desktop) 别名支持不完整，函数级门控会误报
    #[cfg(mobile)]
    let builder = Builder::new("mic-permission")
        .setup(|_app, _api| {
            // 仅 Android 注册原生实现（项目不构建 iOS，且 WKWebView 侧无实现）
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(
                    PLUGIN_IDENTIFIER,
                    "MicPermissionPlugin",
                )?;
                _app.manage(MicPermission(handle));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::request]);
    #[cfg(desktop)]
    let builder = Builder::new("mic-permission");
    builder.build()
}

#[cfg(mobile)]
mod commands;
