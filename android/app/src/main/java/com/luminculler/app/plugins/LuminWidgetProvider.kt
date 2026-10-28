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

        fun save(context: Context, title: String, subtitle: String, uri: String?) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("title", title)
                .putString("subtitle", subtitle)
                .putString("uri", uri)
                .apply()
            refreshAll(context)
        }

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
            views.setTextViewText(R.id.widget_title, prefs.getString("title", null) ?: "Lumin AI")
            views.setTextViewText(R.id.widget_subtitle, prefs.getString("subtitle", null) ?: "")
            val photo = thumbnail(context, prefs.getString("uri", null))
            if (photo != null) {
                views.setImageViewBitmap(R.id.widget_photo, photo)
                views.setViewVisibility(R.id.widget_photo, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.widget_photo, View.GONE)
            }
            val open = PendingIntent.getActivity(
                context, REQUEST_CODE,
                Intent(context, MainActivity::class.java).apply {
                    putExtra(DailyDigestReceiver.EXTRA_ACTION, DailyDigestReceiver.ACTION_TODAY)
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)
            runCatching { manager.updateAppWidget(id, views) }
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        Thread { for (id in appWidgetIds) render(context, appWidgetManager, id) }.start()
    }
}
