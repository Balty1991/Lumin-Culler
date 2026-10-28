package com.luminculler.app.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.ContentUris
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.util.Size
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.luminculler.app.MainActivity
import java.util.Calendar

/**
 * „Ziua de azi”: seara, dacă azi s-au făcut poze, o notificare care spune câte
 * și deschide aplicația direct pe sortarea lor.
 *
 * Scopul aplicației, în cuvintele utilizatorului: „fac multe poze, dar uit să
 * le sortez; din 20–30 pe zi aș opri 3–5”. Uitarea e problema, deci aplicația
 * trebuie să vină ea, o dată pe zi, nu să aștepte să fie deschisă.
 *
 * Alarmă inexactă zilnică (fără permisiunea de alarme exacte), numărare
 * MediaStore pe ziua de azi, fără să citească nicio poză. Sub MIN_PHOTOS nu
 * deranjează. Textele vin din JS, în limba aplicației (scheduleDailyDigest).
 * Programarea se reface la fiecare pornire a aplicației, deci nu e nevoie de
 * BOOT_COMPLETED.
 */
class DailyDigestReceiver : BroadcastReceiver() {

    companion object {
        private const val PREFS = "lumin-daily-digest"
        private const val CHANNEL_ID = "lumin-culler-daily"
        private const val NOTIFICATION_ID = 4203
        private const val REQUEST_CODE = 4203
        private const val MIN_PHOTOS = 3
        const val EXTRA_ACTION = "lumin_action"
        const val ACTION_TODAY = "today"

        private fun alarmIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context, REQUEST_CODE,
                Intent(context, DailyDigestReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun schedule(context: Context, hour: Int, minute: Int, title: String, body: String, channelName: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("title", title)
                .putString("body", body)
                .putString("channel", channelName)
                .apply()
            val next = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
            }
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.timeInMillis, AlarmManager.INTERVAL_DAY, alarmIntent(context))
        }

        fun cancel(context: Context) {
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarms.cancel(alarmIntent(context))
        }

        private fun photosToday(context: Context): Int {
            val start = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            return runCatching {
                context.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Images.Media._ID),
                    "${MediaStore.Images.Media.DATE_TAKEN} >= ?",
                    arrayOf(start.toString()),
                    null
                )?.use { it.count } ?: 0
            }.getOrDefault(0)
        }

        /**
         * Miniatura ultimei poze de azi, pentru notificarea mare. Doar Android 10+
         * (loadThumbnail); fără ea notificarea rămâne text, ca înainte.
         */
        private fun latestThumbToday(context: Context): Bitmap? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
            val start = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            return runCatching {
                val id = context.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Images.Media._ID),
                    "${MediaStore.Images.Media.DATE_TAKEN} >= ?",
                    arrayOf(start.toString()),
                    "${MediaStore.Images.Media.DATE_TAKEN} DESC"
                )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null } ?: return null
                val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                context.contentResolver.loadThumbnail(uri, Size(720, 720), null)
            }.getOrNull()
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val count = photosToday(context)
        if (count < MIN_PHOTOS) return
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!enabled || !permitted) return

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val title = (prefs.getString("title", null) ?: "{n} photos today").replace("{n}", count.toString())
        val body = (prefs.getString("body", null) ?: "Tap and the AI picks the best ones.").replace("{n}", count.toString())
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, prefs.getString("channel", null) ?: "Today", NotificationManager.IMPORTANCE_DEFAULT)
        )
        val open = PendingIntent.getActivity(
            context, REQUEST_CODE,
            Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_ACTION, ACTION_TODAY)
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(open)
        // Cu poza zilei în notificare: îți amintește de ce merită deschisă.
        latestThumbToday(context)?.let { thumb ->
            builder.setLargeIcon(thumb)
                .setStyle(NotificationCompat.BigPictureStyle().bigPicture(thumb).bigLargeIcon(null as Bitmap?).setSummaryText(body))
        }
        val notification = builder.build()
        runCatching { manager.notify(NOTIFICATION_ID, notification) }
    }
}
