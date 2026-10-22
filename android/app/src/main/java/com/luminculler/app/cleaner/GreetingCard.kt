package com.luminculler.app.cleaner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint

/**
 * Cardul de felicitare (1080x1350): poza sus, cu colțuri rotunjite, ocazia
 * scrisă mare și textul ales dedesubt, pe un fundal cald.
 */
object GreetingCard {
    fun render(context: Context, photo: Bitmap, occasion: String, text: String, watermark: Boolean): Bitmap {
        val w = 1080
        val h = 1350
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val bg = Paint().apply { shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0xFFFFF4E6.toInt(), 0xFFFFE1EC.toInt(), Shader.TileMode.CLAMP) }
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), bg)

        // Poza: acoperă caseta de sus, tăiată pe centru, cu colțuri rotunjite.
        val box = RectF(60f, 60f, w - 60f, 760f)
        val scale = maxOf(box.width() / photo.width, box.height() / photo.height)
        val sw = box.width() / scale
        val sh = box.height() / scale
        val src = Rect(((photo.width - sw) / 2).toInt(), ((photo.height - sh) / 2).toInt(), ((photo.width + sw) / 2).toInt(), ((photo.height + sh) / 2).toInt())
        c.save()
        c.clipPath(android.graphics.Path().apply { addRoundRect(box, 48f, 48f, android.graphics.Path.Direction.CW) })
        c.drawBitmap(photo, src, box, Paint(Paint.FILTER_BITMAP_FLAG))
        c.restore()

        val title = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFB4235A.toInt()
            textSize = 76f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD_ITALIC)
            textAlign = Paint.Align.CENTER
        }
        c.drawText(occasion, w / 2f, 870f, title)

        val body = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF3A2A33.toInt()
            textSize = 44f
            typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
        }
        // Textul încape în caseta de jos; dacă e lung, literele se micșorează.
        var layout: StaticLayout
        do {
            layout = StaticLayout.Builder.obtain(text, 0, text.length, body, w - 160)
                .setAlignment(Layout.Alignment.ALIGN_CENTER).setLineSpacing(8f, 1f).build()
            if (layout.height <= 360 || body.textSize <= 28f) break
            body.textSize -= 2f
        } while (true)
        c.save()
        c.translate(80f, 910f + (360 - layout.height).coerceAtLeast(0) / 2f)
        layout.draw(c)
        c.restore()

        if (watermark) {
            val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x993A2A33.toInt(); textSize = 28f; textAlign = Paint.Align.CENTER }
            c.drawText(context.getString(com.luminculler.app.R.string.lumin_greet_footer), w / 2f, h - 40f, small)
        }
        return out
    }
}
