package com.luminculler.app.plugins

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Size
import android.view.View
import android.widget.RemoteViews
import com.luminculler.app.R
import org.json.JSONArray

/**
 * „Rama vie”: pe ecranul telefonului, patru poze ale familiei care se schimbă
 * lin una după alta (intră încet, apropiindu-se ușor). Lista o trimite aplicația
 * (NotificationsPlugin.updateFrameWidget): cele mai frumoase poze păstrate, cu
 * oameni, fiecare cu o etichetă („Acum 2 ani · iulie”). La fiecare oră rama ia
 * următoarele patru din listă. O atingere deschide aplicația.
 */
class FrameWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val PREFS = "lumin-frame-widget"
        private const val REQUEST_CODE = 4320
        private val IMGS = intArrayOf(R.id.frame_img0, R.id.frame_img1, R.id.frame_img2, R.id.frame_img3)
        private val TXTS = intArrayOf(R.id.frame_txt0, R.id.frame_txt1, R.id.frame_txt2, R.id.frame_txt3)

        /** items: [{uri, label}] */
        fun save(context: Context, items: JSONArray) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("items", items.toString())
                .apply()
            refreshAll(context)
        }

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, FrameWidgetProvider::class.java))
            if (ids.isEmpty()) return
            Thread { for (id in ids) render(context, manager, id) }.start()
        }

        private fun thumbnail(context: Context, raw: String): Bitmap? {
            if (raw.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
            return runCatching { context.contentResolver.loadThumbnail(Uri.parse(raw), Size(540, 540), null) }.getOrNull()
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val items = runCatching { JSONArray(prefs.getString("items", "[]")) }.getOrDefault(JSONArray())
            val views = RemoteViews(context.packageName, R.layout.frame_widget)
            views.setOnClickPendingIntent(R.id.frame_root, LuminWidgetProvider.launch(context, DailyDigestReceiver.ACTION_TODAY, REQUEST_CODE))
            if (items.length() == 0) {
                views.setViewVisibility(R.id.frame_flipper, View.GONE)
                views.setViewVisibility(R.id.frame_empty, View.VISIBLE)
                runCatching { manager.updateAppWidget(id, views) }
                return
            }
            // Următoarele patru din listă, la fiecare oră altele.
            val start = prefs.getInt("next", 0) % items.length()
            var shown = 0
            var k = 0
            while (shown < IMGS.size && k < items.length()) {
                val item = items.optJSONObject((start + k) % items.length())
                k++
                val bmp = item?.optString("uri")?.let { thumbnail(context, it) } ?: continue
                views.setImageViewBitmap(IMGS[shown], bmp)
                views.setTextViewText(TXTS[shown], item?.optString("label", "") ?: "")
                shown++
            }
            // Dacă au ieșit mai puține de patru, golurile repetă primele (rama nu arată niciodată negru).
            for (i in shown until IMGS.size) if (shown > 0) {
                val item = items.optJSONObject(start % items.length())
                item?.optString("uri")?.let { thumbnail(context, it) }?.let { views.setImageViewBitmap(IMGS[i], it) }
                views.setTextViewText(TXTS[i], item?.optString("label", "") ?: "")
            }
            prefs.edit().putInt("next", (start + k) % items.length()).apply()
            views.setViewVisibility(R.id.frame_flipper, if (shown > 0) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.frame_empty, if (shown > 0) View.GONE else View.VISIBLE)
            runCatching { manager.updateAppWidget(id, views) }
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        Thread { for (id in appWidgetIds) render(context, appWidgetManager, id) }.start()
    }
}
