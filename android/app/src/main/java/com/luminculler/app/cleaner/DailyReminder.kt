package com.luminculler.app.cleaner

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.luminculler.app.R
import com.luminculler.app.plugins.CleanReminderWorker
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.concurrent.TimeUnit

/**
 * Mementoul de seară: „teancul de azi te așteaptă”. Doar dacă omul l-a
 * pornit, doar dacă teancul de azi nu e gata, și nu șterge nimic.
 */
class DailyReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val store = Store(applicationContext)
        if (!store.dailyReminder) return Result.success()
        if (!CleanReminderWorker.canNotify(applicationContext)) return Result.success()
        // Amintirea zilei are întâietate: e motivul pentru care omul deschide aplicația.
        val memory = try { findMemory(applicationContext) } catch (_: Throwable) { null }
        if (memory != null) {
            showMemory(applicationContext, memory)
            return Result.success()
        }
        if (LocalDate.now().toString() in store.completedDays) return Result.success()
        show(applicationContext)
        return Result.success()
    }

    /** O poză făcută în ziua de azi, într-un an trecut. */
    class Memory(val uri: android.net.Uri, val years: Int)

    companion object {
        private const val WORK = "lumin-daily-stack"
        private const val CHANNEL = "lumin-daily-stack"

        fun schedule(context: Context, on: Boolean) {
            val wm = WorkManager.getInstance(context)
            if (!on) {
                wm.cancelUniqueWork(WORK)
                return
            }
            val now = LocalDateTime.now()
            var next = now.toLocalDate().atTime(19, 0)
            if (!next.isAfter(now)) next = next.plusDays(1)
            val request = PeriodicWorkRequestBuilder<DailyReminderWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(Duration.between(now, next).toMinutes(), TimeUnit.MINUTES)
                .build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        private fun show(context: Context) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL, context.getString(R.string.lumin_reminder_channel), NotificationManager.IMPORTANCE_DEFAULT)
                )
            }
            val open = PendingIntent.getActivity(
                context, 0,
                Intent(context, CleanerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle(context.getString(R.string.lumin_reminder_title))
                .setContentText(context.getString(R.string.lumin_reminder_body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(7043, notification)
        }
    
        /** Cea mai apropiată amintire: acum 1 an, apoi 2..15, cu poza cea mai mare (de obicei cea mai bună) din ziua aceea. */
        fun findMemory(context: Context): Memory? {
            val today = LocalDate.now()
            val zone = java.time.ZoneId.systemDefault()
            for (years in 1..15) {
                val day = today.minusYears(years.toLong())
                val from = day.atStartOfDay(zone).toInstant().toEpochMilli()
                val to = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                context.contentResolver.query(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(android.provider.MediaStore.Images.Media._ID),
                    "${android.provider.MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${android.provider.MediaStore.Images.Media.DATE_TAKEN} < ? AND ${android.provider.MediaStore.Images.Media.SIZE} > ?",
                    arrayOf(from.toString(), to.toString(), (300 * 1024).toString()),
                    "${android.provider.MediaStore.Images.Media.SIZE} DESC"
                )?.use { c ->
                    if (c.moveToFirst()) {
                        val id = c.getLong(0)
                        return Memory(android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id), years)
                    }
                }
            }
            return null
        }

        private fun showMemory(context: Context, memory: Memory) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(
                    NotificationChannel(MEMORY_CHANNEL, context.getString(R.string.lumin_memory_channel), NotificationManager.IMPORTANCE_DEFAULT)
                )
            }
            val open = PendingIntent.getActivity(
                context, 1,
                Intent(context, CleanerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val picture = com.luminculler.app.cleaner.grow.decodeOriented(context, memory.uri, 720)
            val title = context.resources.getQuantityString(R.plurals.lumin_years_ago, memory.years, memory.years)
            val builder = NotificationCompat.Builder(context, MEMORY_CHANNEL)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle(context.getString(R.string.lumin_memory_title, title))
                .setContentText(context.getString(R.string.lumin_memory_body))
                .setContentIntent(open)
                .setAutoCancel(true)
            if (picture != null) {
                builder.setLargeIcon(picture)
                builder.setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon(null as android.graphics.Bitmap?))
            }
            NotificationManagerCompat.from(context).notify(7044, builder.build())
        }

        private const val MEMORY_CHANNEL = "lumin-memories"
    }
}
