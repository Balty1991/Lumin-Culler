package com.luminculler.app.cleaner

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.luminculler.app.plugins.CleanReminderWorker
import java.util.Locale
import java.util.concurrent.TimeUnit

private const val ENABLED = "enabled"

fun reminderEnabled(context: Context): Boolean =
    context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, true)

fun saveReclaimable(context: Context, bytes: Long) {
    val locale = Locale.getDefault().language
    context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putLong(CleanReminderWorker.KEY_BYTES, bytes.coerceAtLeast(0L))
        .putString(CleanReminderWorker.KEY_LOCALE, if (locale == "ro") "ro" else locale)
        .apply()
}

fun setReminderEnabled(context: Context, enabled: Boolean) {
    val prefs = context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(ENABLED, enabled).putInt(CleanReminderWorker.KEY_DAYS, 7).apply()
    val manager = WorkManager.getInstance(context)
    if (!enabled) {
        manager.cancelUniqueWork(CleanReminderWorker.UNIQUE_WORK)
        return
    }
    val request = PeriodicWorkRequestBuilder<CleanReminderWorker>(7, TimeUnit.DAYS).build()
    manager.enqueueUniquePeriodicWork(
        CleanReminderWorker.UNIQUE_WORK,
        ExistingPeriodicWorkPolicy.UPDATE,
        request
    )
}
