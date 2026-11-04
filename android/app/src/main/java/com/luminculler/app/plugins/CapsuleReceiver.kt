package com.luminculler.app.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * „Capsula timpului”: o notificare, o singură dată, în ziua în care se deschide
 * o capsulă („Ai o capsulă din noiembrie 2026”). Atingerea deschide Azi, unde
 * capsula așteaptă. Alarmele se refac la fiecare pornire a aplicației (nu
 * supraviețuiesc unei reporniri a telefonului), iar capsula se vede oricum în
 * aplicație când îi vine ziua.
 */
class CapsuleReceiver : BroadcastReceiver() {

    companion object {
        private const val CHANNEL_ID = "lumin-culler-capsules"
        private const val BASE_CODE = 5300

        private fun intentFor(context: Context, id: Int, title: String?, body: String?): PendingIntent =
            PendingIntent.getBroadcast(
                context, BASE_CODE + id,
                Intent(context, CapsuleReceiver::class.java).apply {
                    putExtra("id", id); putExtra("title", title); putExtra("body", body)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun schedule(context: Context, id: Int, at: Long, title: String, body: String) {
            if (at <= System.currentTimeMillis()) return
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarms.set(AlarmManager.RTC_WAKEUP, at, intentFor(context, id, title, body))
        }

        fun cancel(context: Context, id: Int) {
            val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarms.cancel(intentFor(context, id, null, null))
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!enabled || !permitted) return
        val id = intent.getIntExtra("id", 0)
        val title = intent.getStringExtra("title") ?: return
        val body = intent.getStringExtra("body") ?: ""
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Capsule", NotificationManager.IMPORTANCE_DEFAULT))
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(LuminWidgetProvider.launch(context, "today", BASE_CODE + 1000 + id))
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(BASE_CODE + id, n) }
    }
}
