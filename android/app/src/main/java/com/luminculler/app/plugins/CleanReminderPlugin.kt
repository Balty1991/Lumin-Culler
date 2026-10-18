package com.luminculler.app.plugins

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.TimeUnit

/**
 * Programarea mementoului. JS spune la câte zile și în ce limbă; worker-ul
 * arată notificarea și când aplicația e închisă. Premium se verifică în JS,
 * înainte de apel: aici nu e un magazin, e un ceas.
 */
@CapacitorPlugin(name = "CleanReminder")
class CleanReminderPlugin : Plugin() {

    @PluginMethod
    fun schedule(call: PluginCall) {
        val days = (call.getInt("intervalDays") ?: 30).coerceIn(1, 30)
        val locale = call.getString("locale") ?: "en"
        val bytes = call.getDouble("reclaimableBytes")?.toLong()?.coerceAtLeast(0L) ?: 0L
        val reset = call.getBoolean("reset") ?: false
        val prefs = context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
        prefs.edit()
            .putInt(CleanReminderWorker.KEY_DAYS, days)
            .putString(CleanReminderWorker.KEY_LOCALE, locale)
            .putLong(CleanReminderWorker.KEY_BYTES, bytes)
            .apply()
        val request = PeriodicWorkRequestBuilder<CleanReminderWorker>(days.toLong(), TimeUnit.DAYS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            CleanReminderWorker.UNIQUE_WORK,
            if (reset) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP,
            request
        )
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        WorkManager.getInstance(context).cancelUniqueWork(CleanReminderWorker.UNIQUE_WORK)
        call.resolve()
    }

    @PluginMethod
    fun shouldShow(call: PluginCall) {
        val days = (call.getInt("intervalDays") ?: 30).coerceAtLeast(1)
        val prefs = context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
        val last = prefs.getLong(CleanReminderWorker.KEY_LAST, 0L)
        val due = last <= 0L || System.currentTimeMillis() - last >= TimeUnit.DAYS.toMillis(days.toLong())
        call.resolve(JSObject().put("due", due))
    }

    @PluginMethod
    fun markShown(call: PluginCall) {
        context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(CleanReminderWorker.KEY_LAST, System.currentTimeMillis())
            .apply()
        call.resolve()
    }
}
