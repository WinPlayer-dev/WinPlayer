fn main() {
    // 自定义 cfg 别名：真正的「桌面端」= 非 Android 且非 iOS。
    //
    // 为什么不直接用 tauri-build 注入的 `desktop`：它只区分「移动端 / 桌面端」
    // 两档，而 `tauri-plugin-global-shortcut` 的源码是对 android / ios 逐个
    // `#![cfg(...)]` 掉的，两者并非严格互补（例如将来出现新的移动目标）。
    // 统一用一个别名，能保证「模块声明」与「调用点」不会各写一套条件而错位。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    println!("cargo:rustc-check-cfg=cfg(winplayer_desktop)");
    if target_os != "android" && target_os != "ios" {
        println!("cargo:rustc-cfg=winplayer_desktop");
    }

    // Android 上动态链接 C++ 运行时：cpal 的 Oboe 宿主是 C++ 库，
    // 新版 NDK 不再把 libc++ 静态链入，缺 __cxa_pure_virtual 等符号
    // 会导致 dlopen 失败（应用启动即闪退）。libc++_shared.so 由
    // CI 在 gen/android/app/src/main/jniLibs 提供打包。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-lib=dylib=c++_shared");
    }
    tauri_build::build()
}
