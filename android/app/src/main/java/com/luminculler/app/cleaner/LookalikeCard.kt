package com.luminculler.app.cleaner

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.content.FileProvider
import com.luminculler.app.R
import java.io.File

/**
 * Cartonașul „Pe cine seamănă?” (1080x1350, cât o postare): copilul în
 * mijloc, rudele de o parte și de alta cu procentele, bara de împărțire.
 * Gratuit poartă numele aplicației jos — e reclama care aduce oameni noi.
 */
fun shareLookalikeCard(
    activity: Activity,
    childFace: File,
    childName: String,
    relatives: List<Triple<File, String, Int>>,
    watermark: Boolean
) {
    val w = 1080
    val h = 1350
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    p.shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0xFF22164A.toInt(), 0xFF0B0B11.toInt(), Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
    p.shader = null

    val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    fun center(text: String, y: Float, size: Float, color: Int, face: Typeface = Typeface.DEFAULT) {
        p.typeface = face; p.textSize = size; p.color = color; p.textAlign = Paint.Align.CENTER
        c.drawText(text, w / 2f, y, p)
    }
    fun text(text: String, x: Float, y: Float, size: Float, color: Int, face: Typeface = Typeface.DEFAULT) {
        p.typeface = face; p.textSize = size; p.color = color; p.textAlign = Paint.Align.CENTER
        c.drawText(text, x, y, p)
    }
    fun circle(file: File, cx: Float, cy: Float, r: Float, ring: Int) {
        val face = BitmapFactory.decodeFile(file.absolutePath)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        if (face != null) {
            val shader = BitmapShader(face, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            val scale = maxOf(2 * r / face.width, 2 * r / face.height)
            shader.setLocalMatrix(Matrix().apply {
                setScale(scale, scale)
                postTranslate(cx - face.width * scale / 2, cy - face.height * scale / 2)
            })
            fill.shader = shader
        } else {
            fill.color = 0xFF1E1E2A.toInt()
        }
        c.drawCircle(cx, cy, r, fill)
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 8f; color = ring }
        c.drawCircle(cx, cy, r, stroke)
        face?.recycle()
    }

    val winner = relatives.indices.maxByOrNull { relatives[it].third } ?: 0
    center(activity.getString(R.string.lumin_look_card_question, childName), 170f, 66f, 0xFFF4F4F7.toInt(), bold)

    val green = 0xFF5EE6B0.toInt()
    val violet = 0xFFA78BFA.toInt()
    val gold = 0xFFFFC857.toInt()
    circle(childFace, w / 2f, 470f, 190f, gold)
    text(childName, w / 2f, 720f, 46f, 0xFFF4F4F7.toInt(), bold)

    val xs = if (relatives.size == 1) listOf(w / 2f) else listOf(w * 0.25f, w * 0.75f)
    relatives.forEachIndexed { i, (file, name, pct) ->
        val x = xs.getOrElse(i) { w / 2f }
        val ring = if (i == winner) green else violet
        circle(file, x, 900f, 110f, ring)
        text("$pct%", x, 1100f, 110f, if (i == winner) green else 0xFFF4F4F7.toInt(), bold)
        text(name, x, 1160f, 42f, 0xFF9B9BAA.toInt())
    }

    if (relatives.size == 2) {
        val bar = RectF(110f, 1210f, w - 110f, 1232f)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFF1E1E2A.toInt(); c.drawRoundRect(bar, 11f, 11f, fill)
        val split = bar.left + bar.width() * relatives[0].third / 100f
        fill.color = if (winner == 0) green else violet
        c.drawRoundRect(RectF(bar.left, bar.top, split, bar.bottom), 11f, 11f, fill)
        fill.color = if (winner == 1) green else violet
        c.drawRoundRect(RectF(split, bar.top, bar.right, bar.bottom), 11f, 11f, fill)
    }
    if (watermark) center(activity.getString(R.string.lumin_look_card_footer), 1310f, 34f, 0xFF9B9BAA.toInt())

    val file = File(activity.cacheDir, "lumin-lookalike.png")
    file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bmp.recycle()
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, activity.getString(R.string.lumin_look_share_text, childName))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, null))
}
