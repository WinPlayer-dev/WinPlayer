package app.tauri.micpermission

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

private const val TAG = "MicPermission"

/** 权限别名：交给 Tauri 的权限框架解析成 Manifest.permission.RECORD_AUDIO */
private const val ALIAS_RECORD_AUDIO = "recordAudio"

/**
 * 麦克风（RECORD_AUDIO）运行时授权。
 *
 * 权限本身由本模块的 AndroidManifest.xml 声明（Gradle 会合并进 App），
 * 这里只负责 Android 6.0+ 的运行时弹窗：原生采集（cpal/AAudio）在没有
 * 授权时打开输入流会直接失败，且系统不会再自动提示。
 *
 * 注意：Tauri 2 的 `Plugin` 基类没有 `onRequestPermissionsResult` 可重写，
 * 权限结果统一由 PluginManager 的 ActivityResultLauncher 分发，插件侧只能用
 * `requestPermissionForAlias(...)` + `@PermissionCallback` 接收。自己调
 * `ActivityCompat.requestPermissions` 会拿不到回调。
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = ALIAS_RECORD_AUDIO),
    ]
)
class MicPermissionPlugin(private val activity: Activity) : Plugin(activity) {

    /** 等待结果的 invoke：系统授权框同一时刻只允许弹一个 */
    private var pending: Invoke? = null

    @Command
    fun request(invoke: Invoke) {
        if (hasPermission()) {
            invoke.resolve()
            return
        }
        if (pending != null) {
            invoke.reject("上一次麦克风授权请求还在进行中")
            return
        }
        pending = invoke
        try {
            requestPermissionForAlias(ALIAS_RECORD_AUDIO, invoke, "onPermissionResult")
        } catch (ex: Exception) {
            pending = null
            Log.e(TAG, "requestPermissions failed", ex)
            invoke.reject(ex.message ?: "无法申请麦克风权限")
        }
    }

    /** 授权框关闭后的回调（由 Tauri 反射调用，名字需与 request 里传的一致） */
    @PermissionCallback
    fun onPermissionResult(invoke: Invoke) {
        pending = null
        if (hasPermission()) {
            invoke.resolve()
        } else {
            invoke.reject("麦克风权限被拒绝，请在系统设置里允许本应用录音")
        }
    }

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
}
