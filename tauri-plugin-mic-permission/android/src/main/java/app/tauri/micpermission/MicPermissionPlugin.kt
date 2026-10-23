package app.tauri.micpermission

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

private const val TAG = "MicPermission"

/** 请求码：与宿主其他权限请求错开，避免结果回调串号 */
private const val REQUEST_CODE = 0x4D50

/**
 * 麦克风（RECORD_AUDIO）运行时授权。
 *
 * 权限本身由本模块的 AndroidManifest.xml 声明（Gradle 会合并进 App），
 * 这里只负责 Android 6.0+ 的运行时弹窗：原生采集（cpal/AAudio）在没有
 * 授权时打开输入流会直接失败，且系统不会再自动提示。
 */
@TauriPlugin
class MicPermissionPlugin(private val activity: Activity) : Plugin(activity) {

    /** 等待结果的 invoke：同一时刻只允许一个在飞 */
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
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_CODE,
            )
        } catch (ex: Exception) {
            pending = null
            Log.e(TAG, "requestPermissions failed", ex)
            invoke.reject(ex.message ?: "无法申请麦克风权限")
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CODE) return
        val invoke = pending ?: return
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
