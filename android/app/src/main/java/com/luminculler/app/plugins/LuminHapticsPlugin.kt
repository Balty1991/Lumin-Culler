package com.luminculler.app.plugins

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** O bătaie scurtă la pragul unui swipe. Nu ține un tipar, nu vibrează în buclă. */
@CapacitorPlugin(name = "LuminHaptics")
class LuminHapticsPlugin : Plugin() {
    @PluginMethod
    fun impact(call: PluginCall) {
        val ms = if (call.getString("style") == "medium") 20L else 12L
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(ms)
        }
        call.resolve()
    }
}
