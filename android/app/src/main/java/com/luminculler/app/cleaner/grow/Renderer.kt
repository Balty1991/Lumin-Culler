package com.luminculler.app.cleaner.grow

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
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
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * Montează videoul „Cum a crescut”: fiecare poză e rotită și scalată astfel
 * încât ochii să cadă mereu în același loc, cu trecere lină între poze și
 * anul jos. 720×1280, vertical, gata de Reels/TikTok/Stories.
 *
 * Codarea: MediaCodec cu suprafață de intrare, pe care desenăm cu Canvas.
 * Timpii din video îi punem noi, la scriere (cadrul n = n/30 s), ca durata
 * să nu depindă de cât de repede desenează telefonul.
 */
class Renderer(private val context: Context) {

    class Options(val title: String, val watermark: Boolean)

    suspend fun render(
        frames: List<FaceHit>,
        media: Map<Long, Media>,
        options: Options,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.Default) {
        val out = File(context.cacheDir, "lumin-grow.mp4")
        out.delete()
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, W, H).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = codec.createInputSurface()
        codec.start()
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val drain = Drain(codec, muxer)

        val per = Grow.secondsPerPhoto(frames.size)
        val holdFrames = (per * FPS).roundToInt().coerceAtLeast(3)
        val fadeFrames = (holdFrames * 0.45f).roundToInt().coerceAtLeast(1)
        val introFrames = (FPS * 1.6f).roundToInt()
        val outroFrames = (FPS * 1.4f).roundToInt()
        val total = introFrames + frames.size * holdFrames + outroFrames
        var drawn = 0

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
            drawn++
        }

        try {
            val years = frames.mapNotNull { f -> f.taken.takeIf { it > 0 }?.let { yearOf(it) } }
            val span = if (years.isEmpty()) "" else if (years.first() == years.last()) "${years.first()}" else "${years.first()} → ${years.last()}"

            var prev: Bitmap? = null
            for (i in 0 until introFrames) {
                ensureActive()
                post { c -> drawTitle(c, options.title, span, (i.toFloat() / introFrames).coerceIn(0f, 1f)) }
            }
            for ((index, face) in frames.withIndex()) {
                ensureActive()
                val m = media[face.mediaId] ?: continue
                val current = aligned(m, face) ?: continue
                val label = if (face.taken > 0) yearOf(face.taken).toString() else ""
                for (k in 0 until holdFrames) {
                    val p = prev
                    post { c ->
                        if (p != null && k < fadeFrames) {
                            c.drawBitmap(p, 0f, 0f, null)
                            c.drawBitmap(current, 0f, 0f, Paint().apply { alpha = (255 * (k + 1) / (fadeFrames + 1)) })
                        } else {
                            c.drawBitmap(current, 0f, 0f, null)
                        }
                        drawOverlay(c, label, options.watermark)
                    }
                }
                prev?.recycle()
                prev = current
                onProgress(drawn.toFloat() / total)
            }
            for (i in 0 until outroFrames) {
                ensureActive()
                val p = prev
                post { c ->
                    if (p != null) c.drawBitmap(p, 0f, 0f, Paint().apply { alpha = (255 * (1f - i.toFloat() / outroFrames)).roundToInt() })
                    drawOutro(c, (i.toFloat() / (outroFrames * 0.5f)).coerceIn(0f, 1f))
                }
            }
            prev?.recycle()
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

    /** Poza rotită și scalată cu ochii pe țintă, pe un cadru 720×1280. */
    private fun aligned(m: Media, face: FaceHit): Bitmap? {
        // Destui pixeli cât fața să nu fie mărită mult: distanța dintre ochi țintă e EYE_GAP.
        val eyeGapNorm = kotlin.math.hypot(face.bx - face.ax, face.by - face.ay).coerceAtLeast(0.01f)
        val wanted = (EYE_GAP / eyeGapNorm * 1.15f).roundToInt().coerceIn(900, 3000)
        val src = decodeOriented(context, Uri.parse(m.uri), wanted) ?: return null
        val out = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val ax = face.ax * src.width; val ay = face.ay * src.height
        val bx = face.bx * src.width; val by = face.by * src.height
        val cx = W / 2f
        val matrix = Align.matrix(ax, ay, bx, by, cx - EYE_GAP / 2f, EYE_Y, cx + EYE_GAP / 2f, EYE_Y)
        // Fundal: aceeași poză, mărită și întunecată, ca marginile să nu fie negre.
        val bg = Matrix().apply { setValues(matrix); postScale(1.6f, 1.6f, cx, EYE_Y) }
        canvas.drawBitmap(src, bg, Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = 90 })
        canvas.drawBitmap(src, Matrix().apply { setValues(matrix) }, Paint(Paint.FILTER_BITMAP_FLAG))
        src.recycle()
        return out
    }

    private val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)

    private fun drawOverlay(c: Canvas, year: String, watermark: Boolean) {
        val shade = Paint().apply {
            shader = LinearGradient(0f, H - 360f, 0f, H.toFloat(), Color.TRANSPARENT, 0xB0000000.toInt(), Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, H - 360f, W.toFloat(), H.toFloat(), shade)
        if (year.isNotEmpty()) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 112f; typeface = bold; textAlign = Paint.Align.CENTER }
            c.drawText(year, W / 2f, H - 150f, p)
        }
        if (watermark) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCCFFFFFF.toInt(); textSize = 34f; typeface = bold; textAlign = Paint.Align.RIGHT }
            c.drawText("Lumin", W - 36f, 70f, p)
        }
    }

    private fun drawTitle(c: Canvas, title: String, span: String, t: Float) {
        val alpha = (255 * minOf(1f, t * 3f)).roundToInt()
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = bold; this.alpha = alpha }
        if (title.isNotBlank()) {
            p.textSize = 96f
            c.drawText(title, W / 2f, H / 2f - 20f, p)
        }
        p.textSize = 54f
        p.color = 0xFFA78BFA.toInt()
        p.alpha = alpha
        c.drawText(span, W / 2f, H / 2f + if (title.isNotBlank()) 70f else 20f, p)
    }

    private fun drawOutro(c: Canvas, t: Float) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = bold; textSize = 64f; alpha = (255 * t).roundToInt()
        }
        c.drawText("Lumin", W / 2f, H / 2f, p)
        p.textSize = 30f
        p.typeface = Typeface.DEFAULT
        p.color = 0xFFC5C5D2.toInt()
        p.alpha = (255 * t).roundToInt()
        c.drawText(context.getString(com.luminculler.app.R.string.lumin_grow_outro), W / 2f, H / 2f + 56f, p)
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
        const val W = 720
        const val H = 1280
        const val FPS = 30
        const val EYE_GAP = 150f
        const val EYE_Y = 560f

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
