package com.luminculler.app.cleaner

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import android.widget.RemoteViews
import com.luminculler.app.R
import com.luminculler.app.cleaner.grow.decodeOriented
import java.time.LocalDate
import java.time.ZoneId
import kotlin.random.Random

/**
 * Widgetul „Amintirea zilei”: pe ecranul telefonului, o poză din ziua de azi
 * de acum câțiva ani (sau, dacă azi nu e niciuna, din săptămâna asta, într-un
 * an trecut). Se schimbă de câteva ori pe zi și deschide Lumin la atingere.
 */
class MemoryWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        Thread {
            try {
                update(context.applicationContext, manager, ids)
            } finally {
                pending.finish()
            }
        }.start()
    }

    class Pick(val uri: Uri, val yearsAgo: Int, val sameDay: Boolean)

    companion object {
        /** Reîmprospătează toate widgeturile puse pe ecran (de ex. din mementoul de seară). */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, MemoryWidget::class.java))
            if (ids.isNotEmpty()) Thread { update(context.applicationContext, manager, ids) }.start()
        }

        private fun update(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val pick = try { pick(context) } catch (_: Throwable) { null }
            // Bitmap mic și fără transparență: RemoteViews trec printr-un canal de ~1 MB.
            val bmp = pick?.let { decodeOriented(context, it.uri, 480) }?.let { b ->
                b.copy(Bitmap.Config.RGB_565, false).also { if (it !== b) b.recycle() }
            }
            val open = PendingIntent.getActivity(
                context, 2,
                Intent(context, CleanerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.lumin_memory_widget)
                if (pick != null && bmp != null) {
                    views.setImageViewBitmap(R.id.widget_photo, bmp)
                    val years = context.resources.getQuantityString(R.plurals.lumin_years_ago, pick.yearsAgo, pick.yearsAgo)
                    views.setTextViewText(R.id.widget_title, if (pick.sameDay) context.getString(R.string.lumin_memory_title, years) else years)
                    views.setTextViewText(R.id.widget_sub, context.getString(if (pick.sameDay) R.string.lumin_widget_today else R.string.lumin_widget_week))
                } else {
                    views.setTextViewText(R.id.widget_title, "Lumin")
                    views.setTextViewText(R.id.widget_sub, context.getString(R.string.lumin_widget_empty))
                }
                views.setOnClickPendingIntent(R.id.widget_root, open)
                manager.updateAppWidget(id, views)
            }
        }

        /**
         * Întâi o poză din ziua de azi, de acum 1–15 ani (cea mai mare, de obicei
         * cea mai bună); altfel, una la întâmplare din săptămâna asta, într-un an trecut.
         */
        fun pick(context: Context): Pick? {
            DailyReminderWorker.findMemory(context)?.let { return Pick(it.uri, it.years, true) }
            val today = LocalDate.now()
            val zone = ZoneId.systemDefault()
            val found = ArrayList<Pick>()
            for (years in 1..15) {
                val day = today.minusYears(years.toLong())
                val from = day.minusDays(3).atStartOfDay(zone).toInstant().toEpochMilli()
                val to = day.plusDays(4).atStartOfDay(zone).toInstant().toEpochMilli()
                context.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    arrayOf(MediaStore.Images.Media._ID),
                    "${MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${MediaStore.Images.Media.DATE_TAKEN} < ? AND ${MediaStore.Images.Media.SIZE} > ?",
                    arrayOf(from.toString(), to.toString(), (300 * 1024).toString()),
                    "${MediaStore.Images.Media.SIZE} DESC"
                )?.use { c ->
                    var k = 0
                    while (c.moveToNext() && k < 5) {
                        found += Pick(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, c.getLong(0)), years, false)
                        k++
                    }
                }
            }
            // Aceeași poză toată ziua, dar alta mâine: alegerea depinde de dată.
            return found.takeIf { it.isNotEmpty() }?.let { it[Random(today.toEpochDay()).nextInt(it.size)] }
        }
    }
}
