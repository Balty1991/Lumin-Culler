package com.luminculler.app.plugins

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Notificarea lunară. Nu șterge, nu urcă, nu deschide pozele: adună o mărime
 * din MediaStore (sau ultima estimare lăsată de ecran) și o arată.
 *
 * WorkManager o poate amâna cât telefonul doarme. Pentru o curățare lunară
 * o zi în plus nu schimbă nimic. Intervalul minim al platformei e 15 minute;
 * noi cerem zile.
 */
class CleanReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val days = prefs.getInt(KEY_DAYS, 30).coerceAtLeast(1)
        val intervalMs = TimeUnit.DAYS.toMillis(days.toLong())
        val last = prefs.getLong(KEY_LAST, 0L)
        val now = System.currentTimeMillis()
        if (last > 0L && now - last < intervalMs) return Result.success()
        if (!canNotify(applicationContext)) return Result.success()

        val stored = prefs.getLong(KEY_BYTES, 0L)
        val bytes = if (stored > 0L) stored else estimateReclaimable(applicationContext)
        val locale = prefs.getString(KEY_LOCALE, "en") ?: "en"
        show(applicationContext, locale, bytes)
        prefs.edit().putLong(KEY_LAST, now).apply()
        return Result.success()
    }

    companion object {
        const val PREFS = "lumin_clean_reminder"
        const val KEY_DAYS = "intervalDays"
        const val KEY_LOCALE = "locale"
        const val KEY_BYTES = "reclaimableBytes"
        const val KEY_LAST = "lastNotifiedAt"
        const val UNIQUE_WORK = "lumin-monthly-clean"
        private const val CHANNEL_ID = "lumin-clean-reminder"
        private const val NOTIFICATION_ID = 7042

        fun canNotify(context: Context): Boolean {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
            if (Build.VERSION.SDK_INT < 33) return true
            return ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        }

        fun show(context: Context, locale: String, bytes: Long) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(CHANNEL_ID, channelName(locale), NotificationManager.IMPORTANCE_DEFAULT)
                manager.createNotificationChannel(channel)
            }
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pending = if (launch != null) {
                PendingIntent.getActivity(
                    context, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            } else {
                null
            }
            val body = message(locale, bytes)
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle("Lumin")
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
            if (pending != null) builder.setContentIntent(pending)
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
        }

        fun message(locale: String, bytes: Long): String {
            if (bytes <= 0L) {
                return when (locale) {
                    "ro" -> "E timpul pentru curățenia lunară."
                    "pt-BR", "pt" -> "Hora da limpeza mensal."
                    "es" -> "Es hora de la limpieza mensual."
                    "de" -> "Zeit für die monatliche Reinigung."
                    else -> "Time for your monthly clean."
                }
            }
            val size = formatBytes(bytes)
            return when (locale) {
                "ro" -> "Ai $size de curățat."
                "pt-BR", "pt" -> "Você tem $size para limpar."
                "es" -> "Tienes $size por limpiar."
                "de" -> "Du hast $size zum Aufräumen."
                else -> "You have $size to clean."
            }
        }

        fun formatBytes(bytes: Long): String {
            val gb = bytes / (1024.0 * 1024.0 * 1024.0)
            if (gb >= 1.0) return String.format(Locale.US, "%.1f GB", gb)
            val mb = bytes / (1024.0 * 1024.0)
            return String.format(Locale.US, "%.0f MB", mb)
        }

        private fun channelName(locale: String): String = when (locale) {
            "ro" -> "Memento de curățare"
            "pt-BR", "pt" -> "Lembrete de limpeza"
            "es" -> "Recordatorio de limpieza"
            "de" -> "Reinigungserinnerung"
            else -> "Clean reminder"
        }

        /** Capturi vechi de o lună plus videoclipuri mari. Aceeași idee ca ecranul, fără să șteargă. */
        fun estimateReclaimable(context: Context): Long {
            var total = 0L
            try {
                val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(30)
                val like = arrayOf("%screenshot%", "%capturi%", "%bildschirm%", "%captura%")
                val selection = buildString {
                    append("(")
                    like.forEachIndexed { index, _ ->
                        if (index > 0) append(" OR ")
                        append("${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} LIKE ?")
                    }
                    append(") AND ${MediaStore.Images.Media.DATE_TAKEN} > 0 AND ${MediaStore.Images.Media.DATE_TAKEN} <= ?")
                }
                val args = like.toMutableList().apply { add(cutoff.toString()) }.toTypedArray()
                context.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Images.Media.SIZE),
                    selection,
                    args,
                    null
                )?.use { cursor ->
                    val size = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                    while (cursor.moveToNext()) total += cursor.getLong(size)
                }
                context.contentResolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Video.Media.SIZE),
                    "${MediaStore.Video.Media.SIZE} >= ?",
                    arrayOf((50L * 1024L * 1024L).toString()),
                    null
                )?.use { cursor ->
                    val size = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                    while (cursor.moveToNext()) total += cursor.getLong(size)
                }
            } catch (_: SecurityException) {
                return 0L
            }
            return total
        }
    }
}
