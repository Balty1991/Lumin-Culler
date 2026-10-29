package com.luminculler.app.plugins

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Size
import android.view.View
import android.widget.RemoteViews
import com.luminculler.app.MainActivity
import com.luminculler.app.R

/**
 * Widgetul de pe ecranul telefonului: cea mai bună poză de azi, „4 poze alese
 * azi” sau „12 poze te așteaptă”. Textul și poza le trimite aplicația
 * (NotificationsPlugin.updateWidget) după fiecare sortare; o atingere deschide
 * alegerea de azi, ca notificarea de seară.
 */
class LuminWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val PREFS = "lumin-widget"
        private const val REQUEST_CODE = 4310

        private const val SHARE_REQUEST_CODE = 4311

        fun save(context: Context, title: String, subtitle: String, uri: String?, shareLabel: String?) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("title", title)
                .putString("subtitle", subtitle)
                .putString("uri", uri)
                .putString("share", shareLabel)
                .putLong("savedAt", System.currentTimeMillis())
                .apply()
            refreshAll(context)
        }

        /**
         * Poza aleasă de AI azi (aceeași ca pe widget), pentru notificarea de seară.
         * Doar dacă aplicația a trimis-o azi; altfel notificarea ia ultima poză a zilei.
         */
        fun bestUriToday(context: Context, startOfDay: Long): String? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (prefs.getLong("savedAt", 0) < startOfDay) return null
            return prefs.getString("uri", null)?.takeIf { it.isNotEmpty() }
        }

        fun launch(context: Context, action: String, requestCode: Int): PendingIntent =
            PendingIntent.getActivity(
                context, requestCode,
                Intent(context, MainActivity::class.java).apply {
                    putExtra(DailyDigestReceiver.EXTRA_ACTION, action)
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, LuminWidgetProvider::class.java))
            if (ids.isEmpty()) return
            Thread { for (id in ids) render(context, manager, id) }.start()
        }

        private fun thumbnail(context: Context, raw: String?): Bitmap? {
            if (raw.isNullOrEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
            return runCatching { context.contentResolver.loadThumbnail(Uri.parse(raw), Size(600, 600), null) }.getOrNull()
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val views = RemoteViews(context.packageName, R.layout.lumin_widget)
            views.setTextViewText(R.id.widget_title, prefs.getString("title", null) ?: "Cherrypic")
            views.setTextViewText(R.id.widget_subtitle, prefs.getString("subtitle", null) ?: "")
            val photo = thumbnail(context, prefs.getString("uri", null))
            val share = prefs.getString("share", null)
            if (photo != null) {
                views.setImageViewBitmap(R.id.widget_photo, photo)
                views.setViewVisibility(R.id.widget_photo, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.widget_photo, View.GONE)
            }
            // „Trimite”: poza zilei pleacă la familie dintr-o atingere, direct de pe ecranul telefonului.
            if (photo != null && !share.isNullOrEmpty()) {
                views.setTextViewText(R.id.widget_share, share)
                views.setViewVisibility(R.id.widget_share, View.VISIBLE)
                views.setOnClickPendingIntent(R.id.widget_share, launch(context, DailyDigestReceiver.ACTION_SHARE, SHARE_REQUEST_CODE))
            } else {
                views.setViewVisibility(R.id.widget_share, View.GONE)
            }
            views.setOnClickPendingIntent(R.id.widget_root, launch(context, DailyDigestReceiver.ACTION_TODAY, REQUEST_CODE))
            runCatching { manager.updateAppWidget(id, views) }
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        Thread { for (id in appWidgetIds) render(context, appWidgetManager, id) }.start()
    }
}
