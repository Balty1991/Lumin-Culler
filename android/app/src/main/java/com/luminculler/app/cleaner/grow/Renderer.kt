package com.luminculler.app.cleaner.grow

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.luminculler.app.cleaner.core.Align
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.core.Grow
import com.luminculler.app.cleaner.core.Media
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import kotlin.math.roundToInt

/** Cum arată filmul. */
enum class Template { Cinematic, Flash, Mosaic, Timelapse }

/** Formatul cadrului, după unde se postează. */
enum class Format(val w: Int, val h: Int) { Story(720, 1280), Square(960, 960), Wide(1280, 720) }

/** O poză din film; fața, dacă o știm, ține subiectul în cadru (și aliniază ochii la Timelapse). */
class Shot(val media: Media, val face: FaceHit? = null)

/**
 * Montajul filmelor Lumin, pe telefon: povești din momente și „Cum a crescut”.
 *
 * Fiecare cadru se desenează cu Canvas pe suprafața de intrare a lui
 * MediaCodec (H.264), iar timpii îi punem noi la scriere (cadrul n = n/30 s),
 * ca durata să nu depindă de viteza telefonului.
 */
class Renderer(private val context: Context) {

    class Options(
        val template: Template,
        val format: Format = Format.Story,
        val title: String = "",
        val subtitle: String = "",
        /** Data pe fiecare poză (Cinematic) sau anul (Timelapse). */
        val dates: Boolean = true,
        val watermark: Boolean = true
    )

    private val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private val smooth = { x: Float -> val t = x.coerceIn(0f, 1f); t * t * (3 - 2 * t) }
    private val easeOut = { x: Float -> val t = x.coerceIn(0f, 1f); 1f - (1f - t) * (1f - t) * (1f - t) }

    suspend fun render(shots: List<Shot>, options: Options, onProgress: (Float) -> Unit): File = withContext(Dispatchers.Default) {
        val w = options.format.w
        val h = options.format.h
        val u = minOf(w, h) / 720f // unitatea textului, ca titlurile să arate la fel în orice format
        val out = File(context.cacheDir, "lumin-film.mp4")
        out.delete()
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 9_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = codec.createInputSurface()
        codec.start()
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val drain = Drain(codec, muxer)
        val filter = Paint(Paint.FILTER_BITMAP_FLAG)

        fun post(draw: (Canvas) -> Unit) {
            drain.pump(false)
            val canvas = surface.lockHardwareCanvas()
            try {
                canvas.drawColor(Color.BLACK)
                draw(canvas)
            } finally {
                surface.unlockCanvasAndPost(canvas)
            }
            drain.pump(false)
        }

        /** Desenează o poză pregătită, cu zoom [z] în jurul punctului (cx, cy) și deplasare (dx, dy). */
        fun drawImage(c: Canvas, bmp: Bitmap, z: Float, alpha: Int, cx: Float = w / 2f, cy: Float = h / 2f, dx: Float = 0f, dy: Float = 0f) {
            c.save()
            c.translate(dx, dy)
            c.scale(z, z, cx, cy)
            filter.alpha = alpha
            c.drawBitmap(bmp, 0f, 0f, filter)
            c.restore()
        }

        val years = shots.mapNotNull { s -> s.media.taken.takeIf { it > 0 }?.let { yearOf(it) } }
        val span = if (years.isEmpty()) "" else if (years.min() == years.max()) "${years.min()}" else "${years.min()} – ${years.max()}"
        val subtitle = options.subtitle.ifBlank { span }

        try {
            when (options.template) {
                Template.Timelapse, Template.Cinematic, Template.Flash -> {
                    val timelapse = options.template == Template.Timelapse
                    val flash = options.template == Template.Flash
                    val per = when (options.template) {
                        Template.Timelapse -> Grow.secondsPerPhoto(shots.size)
                        Template.Flash -> 0.55f
                        else -> 2.6f
                    }
                    val hold = (per * FPS).roundToInt().coerceAtLeast(10)
                    val fade = when (options.template) {
                        Template.Flash -> 0
                        Template.Timelapse -> (hold * 0.5f).roundToInt()
                        else -> (FPS * 0.8f).roundToInt()
                    }
                    val zoom = when (options.template) { Template.Timelapse -> 0.06f; Template.Flash -> 0.12f; else -> 0.10f }
                    val intro = (FPS * if (flash) 1.4f else 2.4f).roundToInt()
                    val outro = (FPS * 2.0f).roundToInt()
                    val total = (intro + shots.size * hold + outro).toFloat()
                    var drawn = 0
                    val life = (hold + fade).toFloat()
                    var prev: Bitmap? = null
                    var prevShot: Shot? = null
                    var index = 0

                    val first = shots.firstNotNullOfOrNull { prepare(it, w, h, timelapse) }
                    for (i in 0 until intro) {
                        ensureActive()
                        val t = i.toFloat() / intro
                        post { c ->
                            if (first != null) drawImage(c, first, 1f + 0.04f * t, (90 * smooth(t * 2f)).roundToInt())
                            drawTitle(c, w, h, u, options.title, subtitle, smooth(t * 2.5f), smooth((t - 0.8f) * 5f))
                        }
                        drawn++
                    }
                    first?.recycle()

                    for (shot in shots) {
                        ensureActive()
                        val current = prepare(shot, w, h, timelapse) ?: continue
                        // Mișcarea alternează, ca filmul să nu pară că „împinge” mereu în aceeași direcție.
                        val dir = if (index % 2 == 0) 1f else -1f
                        val pan = if (timelapse) 0f else 0.03f * w * dir
                        val (cx, cy) = focus(shot, w, h, timelapse)
                        val pShot = prevShot
                        val p = prev
                        val (pcx, pcy) = if (pShot != null) focus(pShot, w, h, timelapse) else (w / 2f to h / 2f)
                        val label = caption(shot, timelapse, options.dates)
                        val prevLabel = pShot?.let { caption(it, timelapse, options.dates) } ?: ""
                        for (k in 0 until hold) {
                            post { c ->
                                val t = k / life
                                if (flash) {
                                    // Zoom „lovit”: pornește apropiat și se așază repede.
                                    val z = 1f + zoom * (1f - easeOut(k / hold.toFloat()))
                                    drawImage(c, current, z, 255, cx, cy)
                                    if (k < 3) c.drawColor(Color.argb(((3 - k) * 70), 255, 255, 255))
                                } else if (p != null && k < fade) {
                                    val f = smooth((k + 1f) / (fade + 1f))
                                    drawImage(c, p, 1f + zoom * ((hold + k) / life), 255, pcx, pcy, -pan * ((hold + k) / life))
                                    drawImage(c, current, 1f + zoom * t, (255 * f).roundToInt(), cx, cy, pan * t)
                                } else {
                                    drawImage(c, current, 1f + zoom * t, 255, cx, cy, pan * t)
                                }
                                val labelAlpha = if (!flash && p != null && k < fade && prevLabel != label) {
                                    kotlin.math.abs(smooth((k + 1f) / (fade + 1f)) - 0.5f) * 2f
                                } else 1f
                                val shown = if (!flash && p != null && k < fade / 2 && prevLabel != label) prevLabel else label
                                drawCaption(c, w, h, u, shown, timelapse, labelAlpha)
                                if (options.watermark) drawMark(c, w, u)
                            }
                            drawn++
                        }
                        prev?.recycle()
                        prev = current
                        prevShot = shot
                        index++
                        onProgress(drawn / total)
                    }
                    for (i in 0 until outro) {
                        ensureActive()
                        val t = i.toFloat() / outro
                        val p = prev
                        post { c ->
                            if (p != null) drawImage(c, p, 1f + zoom, (255 * (1f - smooth(t * 1.6f))).roundToInt())
                            drawOutro(c, w, h, u, smooth((t - 0.35f) * 2.5f))
                        }
                    }
                    prev?.recycle()
                }

                Template.Mosaic -> {
                    // Câte 4 poze pe pagină, într-un grilaj 2×2; fiecare intră pe rând.
                    val pages = shots.chunked(4)
                    val pageFrames = (FPS * 2.8f).roundToInt()
                    val intro = (FPS * 2.2f).roundToInt()
                    val total = (intro + pages.size * pageFrames).toFloat()
                    var drawn = 0
                    for (i in 0 until intro) {
                        val t = i.toFloat() / intro
                        post { c -> drawTitle(c, w, h, u, options.title, subtitle, smooth(t * 2.5f), smooth((t - 0.8f) * 5f)) }
                        drawn++
                    }
                    val gap = 10f * u
                    val cellW = (w - gap * 3) / 2f
                    val cellH = (h - gap * 3) / 2f
                    for (page in pages) {
                        ensureActive()
                        val tiles = page.map { prepare(it, cellW.roundToInt(), cellH.roundToInt(), false) }
                        for (k in 0 until pageFrames) {
                            post { c ->
                                c.drawColor(0xFF0B0B11.toInt())
                                for ((j, bmp) in tiles.withIndex()) {
                                    if (bmp == null) continue
                                    val appear = smooth((k - j * 6f) / 10f)
                                    val leave = smooth((k - (pageFrames - 10f)) / 10f)
                                    val a = (255 * appear * (1f - leave)).roundToInt()
                                    if (a <= 0) continue
                                    val x = gap + (j % 2) * (cellW + gap)
                                    val y = gap + (j / 2) * (cellH + gap)
                                    val z = 0.92f + 0.08f * easeOut(appear) + 0.04f * (k / pageFrames.toFloat())
                                    c.save()
                                    c.clipRect(RectF(x, y, x + cellW, y + cellH))
                                    c.translate(x, y)
                                    c.scale(z, z, cellW / 2f, cellH / 2f)
                                    filter.alpha = a
                                    c.drawBitmap(bmp, 0f, 0f, filter)
                                    c.restore()
                                }
                                if (options.watermark) drawMark(c, w, u)
                            }
                            drawn++
                        }
                        tiles.forEach { it?.recycle() }
                        onProgress(drawn / total)
                    }
                    for (i in 0 until (FPS * 1.6f).roundToInt()) {
                        val t = i / (FPS * 1.6f)
                        post { c -> drawOutro(c, w, h, u, smooth(t * 2f)) }
                    }
                }
            }
            codec.signalEndOfInputStream()
            drain.pump(true)
        } finally {
            try { codec.stop() } catch (_: Throwable) { }
            codec.release()
            surface.release()
            try { if (drain.started) muxer.stop() } catch (_: Throwable) { }
            muxer.release()
        }
        onProgress(1f)
        out
    }

    /** Punctul în jurul căruia se face zoom-ul: între ochi la Timelapse, altfel fața (dacă e) sau centrul. */
    private fun focus(shot: Shot, w: Int, h: Int, timelapse: Boolean): Pair<Float, Float> =
        if (timelapse) w / 2f to eyeY(h) else w / 2f to h / 2f

    private fun eyeY(h: Int) = h * 0.44f

    /**
     * Poza pregătită pe dimensiunea cadrului: la Timelapse rotită și scalată cu
     * ochii pe țintă; altfel umple cadrul, centrată pe față când o știm.
     */
    private fun prepare(shot: Shot, w: Int, h: Int, timelapse: Boolean): Bitmap? {
        val face = shot.face
        val eyeGap = minOf(w, h) * 0.21f
        val wanted = if (timelapse && face != null) {
            val gapNorm = kotlin.math.hypot(face.bx - face.ax, face.by - face.ay).coerceAtLeast(0.01f)
            (eyeGap / gapNorm * 1.15f).roundToInt().coerceIn(900, 3000)
        } else (maxOf(w, h) * 1.3f).roundToInt()
        val src = decodeOriented(context, Uri.parse(shot.media.uri), wanted) ?: return null
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        if (timelapse && face != null) {
            val m = Align.matrix(
                face.ax * src.width, face.ay * src.height, face.bx * src.width, face.by * src.height,
                w / 2f - eyeGap / 2f, eyeY(h), w / 2f + eyeGap / 2f, eyeY(h)
            )
            val bg = Matrix().apply { setValues(m); postScale(1.6f, 1.6f, w / 2f, eyeY(h)) }
            canvas.drawBitmap(src, bg, Paint(paint).apply { alpha = 90 })
            canvas.drawBitmap(src, Matrix().apply { setValues(m) }, paint)
        } else {
            val s = maxOf(w / src.width.toFloat(), h / src.height.toFloat())
            // Centrul decupajului: fața, dacă o știm, ca un portret orizontal să nu-și piardă capul în 9:16.
            val fx = face?.let { (it.ax + it.bx) / 2f * src.width } ?: (src.width / 2f)
            val fy = face?.let { (it.ay + it.by) / 2f * src.height } ?: (src.height / 2f)
            var tx = w / 2f - fx * s
            var ty = h / 2f - fy * s
            tx = tx.coerceIn(w - src.width * s, 0f)
            ty = ty.coerceIn(h - src.height * s, 0f)
            canvas.drawBitmap(src, Matrix().apply { setScale(s, s); postTranslate(tx, ty) }, paint)
        }
        src.recycle()
        return out
    }

    private fun caption(shot: Shot, timelapse: Boolean, dates: Boolean): String {
        if (!dates || shot.media.taken <= 0) return ""
        return if (timelapse) yearOf(shot.media.taken).toString()
        else DateFormat.getDateInstance(DateFormat.LONG).format(Date(shot.media.taken))
    }

    private fun drawCaption(c: Canvas, w: Int, h: Int, u: Float, text: String, big: Boolean, alpha: Float) {
        val shadeTop = h - 320f * u
        c.drawRect(0f, shadeTop, w.toFloat(), h.toFloat(), Paint().apply {
            shader = LinearGradient(0f, shadeTop, 0f, h.toFloat(), Color.TRANSPARENT, 0xA0000000.toInt(), Shader.TileMode.CLAMP)
        })
        if (text.isEmpty()) return
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = bold
            this.alpha = (255 * alpha.coerceIn(0f, 1f)).roundToInt()
            setShadowLayer(16f * u, 0f, 4f * u, 0x80000000.toInt())
        }
        if (big) {
            p.textSize = 112f * u
            p.textAlign = Paint.Align.CENTER
            c.drawText(text, w / 2f, h - 140f * u + (1f - alpha.coerceIn(0f, 1f)) * 24f * u, p)
        } else {
            p.textSize = 38f * u
            p.textAlign = Paint.Align.LEFT
            c.drawText(text, 44f * u, h - 70f * u, p)
        }
    }

    private fun drawMark(c: Canvas, w: Int, u: Float) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xCCFFFFFF.toInt(); textSize = 32f * u; typeface = bold; textAlign = Paint.Align.RIGHT
            setShadowLayer(8f * u, 0f, 2f * u, 0x80000000.toInt())
        }
        c.drawText("Lumin", w - 34f * u, 64f * u, p)
    }

    private fun drawTitle(c: Canvas, w: Int, h: Int, u: Float, title: String, subtitle: String, t: Float, out: Float) {
        val alpha = (255 * t * (1f - out)).roundToInt()
        val rise = (1f - t) * 40f * u
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = bold; this.alpha = alpha
            setShadowLayer(24f * u, 0f, 6f * u, 0xA0000000.toInt())
        }
        if (title.isNotBlank()) {
            p.textSize = fit(p, title, 100f * u, w * 0.86f)
            c.drawText(title, w / 2f, h / 2f - 10f * u + rise, p)
        }
        p.textSize = 48f * u
        p.color = 0xFFC4B5FD.toInt()
        p.alpha = alpha
        c.drawText(subtitle, w / 2f, h / 2f + (if (title.isNotBlank()) 70f else 18f) * u + rise, p)
    }

    /** Micșorează textul până încape pe lățime. */
    private fun fit(p: Paint, text: String, size: Float, maxWidth: Float): Float {
        p.textSize = size
        val width = p.measureText(text)
        return if (width <= maxWidth) size else size * maxWidth / width
    }

    private fun drawOutro(c: Canvas, w: Int, h: Int, u: Float, t: Float) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = bold; textSize = 64f * u; alpha = (255 * t).roundToInt()
        }
        c.drawText("Lumin", w / 2f, h / 2f, p)
        p.textSize = 30f * u
        p.typeface = Typeface.DEFAULT
        p.color = 0xFFC5C5D2.toInt()
        p.alpha = (255 * t).roundToInt()
        c.drawText(context.getString(com.luminculler.app.R.string.lumin_grow_outro), w / 2f, h / 2f + 56f * u, p)
    }

    private fun yearOf(ms: Long): Int = Calendar.getInstance().apply { timeInMillis = ms }.get(Calendar.YEAR)

    /** Scoate ce a codat encoderul și scrie în MP4, cu timpi puși de noi. */
    private class Drain(private val codec: MediaCodec, private val muxer: MediaMuxer) {
        private val info = MediaCodec.BufferInfo()
        private var track = -1
        var started = false
        private var written = 0L

        fun pump(endOfStream: Boolean) {
            while (true) {
                val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
                when {
                    index == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream) return
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        track = muxer.addTrack(codec.outputFormat)
                        muxer.start()
                        started = true
                    }
                    index >= 0 -> {
                        val buffer = codec.getOutputBuffer(index)
                        val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        if (buffer != null && info.size > 0 && !config && started) {
                            info.presentationTimeUs = written * 1_000_000L / FPS
                            written++
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            muxer.writeSampleData(track, buffer, info)
                        }
                        codec.releaseOutputBuffer(index, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }
    }

    companion object {
        const val FPS = 30

        /** Copiază videoul în Galerie (Movies/Lumin). Întoarce Uri-ul sau null. */
        fun saveToGallery(context: Context, file: File): Uri? = try {
            val name = "Lumin_${System.currentTimeMillis()}.mp4"
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, name)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/Lumin")
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
                values.clear()
                values.put(MediaStore.Video.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                uri
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Lumin").apply { mkdirs() }
                val target = File(dir, name)
                file.copyTo(target, overwrite = true)
                MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf("video/mp4"), null)
                Uri.fromFile(target)
            }
        } catch (_: Throwable) {
            null
        }
    }
}
