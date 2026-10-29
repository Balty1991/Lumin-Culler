package com.luminculler.app.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Calendar

/**
 * „Acum un an”, dimineața: dacă în ziua asta, în anii trecuți, ai făcut poze,
 * o notificare cu cea mai bună dintre ele și butoanele „Trimite” și „Vezi”.
 *
 * Poza o alege aplicația (păstrată / scor AI), pentru zilele următoare, la
 * fiecare pornire (schedule). Dacă aplicația n-a mai fost deschisă de mult și
 * ziua nu e în listă, se ia prima poză găsită în MediaStore din aceeași zi.
 * Alarmă inexactă zilnică, ca DailyDigestReceiver; programarea se reface la
 * fiecare pornire.
 */
class MorningMemoryReceiver : BroadcastReceiver() {

    companion object {
        private const val PREFS = "lumin-morning-memory"
        private const val CHANNEL_ID = "lumin-culler-memories"
        private const val NOTIFICATION_ID = 4204
        private const val REQUEST_CODE = 4204
        private const val MAX_YEARS = 15
        const val ACTION_SHARE = "share_memory"
        const val ACTION_SEE = "see_memory"

        private fun alarmIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context, REQUEST_CODE,
                Intent(context, MorningMemoryReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun schedule(
            context: Context, hour: Int, minute: Int,
            texts: JSONObject, picks: JSONObject
        ) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("texts", texts.toString())
                .putString("picks", picks.toString())
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

        fun dayKey(cal: Calendar): String =
            String.format("%02d-%02d", cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))

        /** Prima poză din aceeași zi, din anii trecuți (cel mai recent an întâi). */
        private fun fallbackPick(context: Context): Pair<String, Int>? {
            val today = Calendar.getInstance()
            for (years in 1..MAX_YEARS) {
                val start = (today.clone() as Calendar).apply {
                    add(Calendar.YEAR, -years)
                    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                val end = start + 86_400_000L
                val id = runCatching {
                    context.contentResolver.query(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        arrayOf(MediaStore.Images.Media._ID),
                        "${MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${MediaStore.Images.Media.DATE_TAKEN} < ?",
                        arrayOf(start.toString(), end.toString()),
                        "${MediaStore.Images.Media.DATE_TAKEN} ASC"
                    )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
                }.getOrNull() ?: continue
                return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString() to years
            }
            return null
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!enabled || !permitted) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val texts = runCatching { JSONObject(prefs.getString("texts", "{}")!!) }.getOrDefault(JSONObject())
        val picks = runCatching { JSONObject(prefs.getString("picks", "{}")!!) }.getOrDefault(JSONObject())
        val today = picks.optJSONObject(dayKey(Calendar.getInstance()))
        val (uri, years) = if (today != null) today.optString("uri") to today.optInt("years", 1)
            else fallbackPick(context) ?: return
        if (uri.isEmpty()) return

        val title = (if (years == 1) texts.optString("title1", "1 year ago today") else texts.optString("titleN", "{years} years ago today"))
            .replace("{years}", years.toString())
        val body = texts.optString("body", "")
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, texts.optString("channel", "Memories"), NotificationManager.IMPORTANCE_DEFAULT)
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(LuminWidgetProvider.launch(context, ACTION_SEE, REQUEST_CODE))
        texts.optString("share").takeIf { it.isNotEmpty() }?.let {
            builder.addAction(0, it, LuminWidgetProvider.launch(context, ACTION_SHARE, REQUEST_CODE + 1))
        }
        texts.optString("see").takeIf { it.isNotEmpty() }?.let {
            builder.addAction(0, it, LuminWidgetProvider.launch(context, ACTION_SEE, REQUEST_CODE + 2))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { context.contentResolver.loadThumbnail(Uri.parse(uri), Size(720, 720), null) }.getOrNull()?.let { thumb ->
                builder.setLargeIcon(thumb)
                    .setStyle(NotificationCompat.BigPictureStyle().bigPicture(thumb).bigLargeIcon(null as Bitmap?).setSummaryText(body))
            }
        }
        // Ce poză a arătat notificarea: „Trimite” trimite exact poza asta.
        prefs.edit().putString("shown", uri).apply()
        runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
    }
}
