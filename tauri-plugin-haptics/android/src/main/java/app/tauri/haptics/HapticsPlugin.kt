package app.tauri.haptics

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

private const val TAG = "Haptics"
/** 单段时长上限（毫秒），防止误传超大值长时间占用马达 */
private const val MAX_SEGMENT_MS = 10_000L

@InvokeArg
class VibrateArgs {
    var pattern: List<Double>? = null
}

@TauriPlugin
class HapticsPlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * 按 pattern 触发震动。
     *
     * pattern 为震动/停顿交替的毫秒数组（同 navigator.vibrate 语义）：
     * 奇数位（下标 0 起）为震动时长，偶数位为停顿时长。
     * API 26+ 走 VibrationEffect.createWaveform，旧设备回退已废弃但可用的
     * Vibrator.vibrate(longArray)。
     */
    @Command
    fun vibrate(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(VibrateArgs::class.java)
            val pattern = args.pattern
                ?.map { it.toLong().coerceIn(0L, MAX_SEGMENT_MS) }
                ?.toLongArray()
                ?: LongArray(0)

            if (pattern.isEmpty()) {
                invoke.resolve()
                return
            }

            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
                    as? android.os.VibratorManager
                manager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (vibrator == null || !vibrator.hasVibrator()) {
                Log.d(TAG, "no vibrator available, skip")
                invoke.resolve()
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                // API < 26：vibrate(long[]) 旧重载在运行时仍存在，但 API 31+ 的
                // SDK stub 已将其移除（仅剩 vibrate(VibrationEffect/Long)），
                // compileSdk 36 下无法直接编译调用，走反射回退
                try {
                    Vibrator::class.java
                        .getMethod("vibrate", LongArray::class.java)
                        .invoke(vibrator, pattern)
                } catch (ex: ReflectiveOperationException) {
                    Log.w(TAG, "legacy vibrate unavailable", ex)
                }
            }
            invoke.resolve()
        } catch (ex: Exception) {
            Log.e(TAG, "vibrate failed", ex)
            invoke.reject(ex.message ?: "震动失败")
        }
    }
}
