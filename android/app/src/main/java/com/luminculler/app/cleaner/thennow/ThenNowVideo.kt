package com.luminculler.app.cleaner.thennow

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.roundToInt

/**
 * Clipul „Atunci și acum” (8 s): poza veche cu anul ei, o linie de lumină
 * care o „șterge” și dezvăluie poza de azi, apoi amândouă alături.
 * Fără sunet, ca să-și pună omul muzica lui în Instagram sau TikTok.
 */
object ThenNowVideo {
    private const val FPS = 30

    /** Latura scurtă 720, cea lungă după forma pozei veche, multiplu de 16. */
    fun size(then: Bitmap): Pair<Int, Int> {
        val ratio = then.height / then.width.toFloat()
        return if (ratio >= 1f) {
            720 to ((720 * ratio / 16).roundToInt() * 16).coerceIn(720, 1280)
        } else {
            ((720 / ratio / 16).roundToInt() * 16).coerceIn(720, 1280) to 720
        }
    }

    suspend fun render(
        context: Context,
        then: Bitmap,
        now: Bitmap,
        thenLabel: String,
        nowLabel: String,
        watermark: String?,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.Default) {
        val (w, h) = size(then)
        val out = File(context.cacheDir, "lumin-then-now.mp4")
        out.delete()
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
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
        val info = MediaCodec.BufferInfo()
        var track = -1
        var started = false
        var written = 0L

        fun drain(end: Boolean) {
            while (true) {
                val i = codec.dequeueOutputBuffer(info, if (end) 10_000 else 0)
                when {
                    i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!end) return
                    i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(codec.outputFormat); muxer.start(); started = true }
                    i >= 0 -> {
                        val buf = codec.getOutputBuffer(i)
                        if (buf != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && started) {
                            info.presentationTimeUs = written * 1_000_000L / FPS
                            written++
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            muxer.writeSampleData(track, buf, info)
                        }
                        codec.releaseOutputBuffer(i, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }

        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textSize = w * 0.13f
            setShadowLayer(18f, 0f, 4f, 0xAA000000.toInt())
        }
        val small = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xCCFFFFFF.toInt()
            textSize = w * 0.035f
            textAlign = Paint.Align.CENTER
        }
        val full = Rect(0, 0, w, h)
        fun cover(c: Canvas, b: Bitmap, dst: Rect, zoom: Float) {
            // Ca ContentScale.Crop, plus un zoom lent, ca să nu pară o poză statică.
            val scale = maxOf(dst.width() / b.width.toFloat(), dst.height() / b.height.toFloat()) * zoom
            val sw = dst.width() / scale
            val sh = dst.height() / scale
            val sx = (b.width - sw) / 2f
            val sy = (b.height - sh) / 2f
            c.save(); c.clipRect(dst)
            c.drawBitmap(b, Rect(sx.toInt(), sy.toInt(), (sx + sw).toInt(), (sy + sh).toInt()), dst, paint)
            c.restore()
        }

        val total = FPS * 8
        try {
            for (f in 0 until total) {
                ensureActive()
                val t = f / FPS.toFloat()
                drain(false)
                val c = surface.lockHardwareCanvas()
                try {
                    c.drawColor(Color.BLACK)
                    when {
                        t < 2.2f -> {
                            cover(c, then, full, 1.0f + 0.03f * t / 2.2f)
                            label.alpha = (minOf(1f, t / 0.5f) * 255).toInt()
                            c.drawText(thenLabel, w * 0.07f, h * 0.9f, label)
                        }
                        t < 4.4f -> {
                            // Linia de lumină coboară de sus: deasupra ei e deja „acum”.
                            val p = ((t - 2.2f) / 2.2f).let { it * it * (3 - 2 * it) }
                            val y = (h * p).toInt()
                            cover(c, then, full, 1.03f)
                            if (y > 0) cover(c, now, Rect(0, 0, w, y), 1.0f)
                            val glow = Paint().apply {
                                shader = LinearGradient(0f, y - 40f, 0f, y + 40f, intArrayOf(0x00FFFFFF, 0xCCFFF3C4.toInt(), 0x00FFFFFF), null, Shader.TileMode.CLAMP)
                            }
                            c.drawRect(0f, y - 40f, w.toFloat(), y + 40f, glow)
                        }
                        t < 6.2f -> {
                            cover(c, now, full, 1.0f + 0.03f * (t - 4.4f) / 1.8f)
                            label.alpha = (minOf(1f, (t - 4.4f) / 0.5f) * 255).toInt()
                            c.drawText(nowLabel, w * 0.07f, h * 0.9f, label)
                        }
                        else -> {
                            // Final: alături, cu o margine subțire între ele.
                            val half = w / 2
                            cover(c, then, Rect(0, 0, half - 3, h), 1.0f)
                            cover(c, now, Rect(half + 3, 0, w, h), 1.0f)
                            val tag = Paint(label).apply { textSize = w * 0.075f; alpha = 255; textAlign = Paint.Align.CENTER }
                            c.drawText(thenLabel, half / 2f, h * 0.93f, tag)
                            c.drawText(nowLabel, half * 1.5f, h * 0.93f, tag)
                            if (watermark != null) {
                                val box = RectF(w / 2f - w * 0.2f, h * 0.03f, w / 2f + w * 0.2f, h * 0.03f + w * 0.07f)
                                c.drawRoundRect(box, 40f, 40f, Paint().apply { color = 0x88000000.toInt() })
                                c.drawText(watermark, w / 2f, box.centerY() + small.textSize / 3f, small)
                            }
                        }
                    }
                } finally {
                    surface.unlockCanvasAndPost(c)
                }
                drain(false)
                if (f % 15 == 0) onProgress(f / total.toFloat())
            }
            codec.signalEndOfInputStream()
            drain(true)
        } finally {
            try { codec.stop() } catch (_: Throwable) { }
            codec.release()
            surface.release()
            try { if (started) muxer.stop() } catch (_: Throwable) { }
            muxer.release()
        }
        onProgress(1f)
        out
    }

    /** Colajul alături, ca imagine (pentru cine vrea doar o poză). */
    fun collage(then: Bitmap, now: Bitmap, thenLabel: String, nowLabel: String): Bitmap {
        val h = 1350
        val w = 1080
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        fun cover(b: Bitmap, dst: Rect) {
            val scale = maxOf(dst.width() / b.width.toFloat(), dst.height() / b.height.toFloat())
            val sw = dst.width() / scale; val sh = dst.height() / scale
            val sx = (b.width - sw) / 2f; val sy = (b.height - sh) / 2f
            c.drawBitmap(b, Rect(sx.toInt(), sy.toInt(), (sx + sw).toInt(), (sy + sh).toInt()), dst, paint)
        }
        c.drawColor(Color.BLACK)
        cover(then, Rect(0, 0, w / 2 - 3, h))
        cover(now, Rect(w / 2 + 3, 0, w, h))
        val tag = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textSize = 76f; textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setShadowLayer(16f, 0f, 4f, 0xAA000000.toInt())
        }
        c.drawText(thenLabel, w / 4f, h - 70f, tag)
        c.drawText(nowLabel, w * 0.75f, h - 70f, tag)
        return out
    }
}
