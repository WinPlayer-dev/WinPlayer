//! 触感反馈（震动）插件（桌面端为 no-op）。
//!
//! Android WebView 不提供 `navigator.vibrate`（Vibration API 仅 Chrome
//! 浏览器实现），因此触感反馈必须走原生 Vibrator 服务。本插件向前端
//! 暴露单一 `vibrate` 命令，参数为震动/停顿交替的毫秒数组（同
//! `navigator.vibrate` 的 pattern 语义）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
use tauri::Manager;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.haptics";

/// 原生震动器的句柄。
#[cfg(mobile)]
pub struct Haptics<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(mobile)]
impl<R: Runtime> Haptics<R> {
    /// 按pattern 触发震动。
    ///
    /// `pattern` 为震动/停顿交替的毫秒数组，如 `[12, 32, 18]`
    /// （震 12ms、停 32ms、再震 18ms）。
    pub fn vibrate(&self, pattern: Vec<u64>) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>("vibrate", serde_json::json!({ "pattern": pattern }))
            .map_err(|e| format!("{e}"))
    }
}

/// 从任意 Tauri Manager 取到原生震动器。
#[cfg(mobile)]
pub trait HapticsExt<R: Runtime> {
    fn haptics(&self) -> &Haptics<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: Manager<R>> HapticsExt<R> for T {
    fn haptics(&self) -> &Haptics<R> {
        self.state::<Haptics<R>>().inner()
    }
}

/// 初始化插件；桌面端注册一个空插件，跨平台编译无需 cfg 门控。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // cfg 放在 let 上而不是函数上：rust-analyzer 对 build 脚本注入的
    // cfg(mobile)/cfg(desktop) 别名支持不完整，函数级门控会误报
    #[cfg(mobile)]
    let builder = Builder::new("haptics")
        .setup(|_app, _api| {
            // 仅 Android 注册原生实现（无 iOS Swift 实现；iOS 的 WKWebView
            // 本就不支持 navigator.vibrate，前端回退后自然 no-op）
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin(PLUGIN_IDENTIFIER, "HapticsPlugin")?;
                _app.manage(Haptics(handle));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::vibrate]);
    #[cfg(desktop)]
    let builder = Builder::new("haptics");
    builder.build()
}

#[cfg(mobile)]
mod commands;
