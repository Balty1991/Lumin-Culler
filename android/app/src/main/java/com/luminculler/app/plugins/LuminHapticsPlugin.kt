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
        val style = call.getString("style")
        val waveform = when (style) {
            "delete" -> longArrayOf(0, 12, 28, 18)
            "undo" -> longArrayOf(0, 8, 24, 14)
            "keep" -> longArrayOf(0, 9)
            "chip" -> longArrayOf(0, 6)
            "medium" -> longArrayOf(0, 20)
            else -> longArrayOf(0, 12)
        }
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createWaveform(waveform, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(waveform[1])
        }
        call.resolve()
    }
}
