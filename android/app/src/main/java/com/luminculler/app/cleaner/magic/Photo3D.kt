package com.luminculler.app.cleaner.magic

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File

/**
 * „Foto 3D”: persoana și fundalul se mișcă diferit, ca în „Fotografiile
 * cinematice” din Google Foto. Gratuit și pe telefon: masca persoanei vine
 * din segmentare, fundalul are locul persoanei acoperit, iar camera „se
 * apropie” mai repede de persoană decât de fundal — de aici adâncimea.
 */
class Photo3D(private val context: Context, private val magic: PhotoMagic) {

    /** Null dacă nu e nicio persoană în poză (efectul are nevoie de un prim-plan). */
    suspend fun render(src: Bitmap, onProgress: (Float) -> Unit): File? = withContext(Dispatchers.Default) {
        val mask = magic.personMask(src) ?: return@withContext null
        val person = magic.cutout(src, mask)
        val back = magic.background(src, mask)
        mask.recycle()

        // Cadru vertical sau orizontal, după poză; latura lungă 1280.
        val portrait = src.height >= src.width
        val w = if (portrait) 720 else 1280
        val h = if (portrait) 1280 else 720
        val cover = maxOf(w / src.width.toFloat(), h / src.height.toFloat())
        val out = File(context.cacheDir, "lumin-3d.mp4")
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

        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        val frames = FPS * SECONDS
        try {
            for (f in 0 until frames) {
                ensureActive()
                // Dus-întors lin: clipul se poate pune pe repeat fără „săritură”.
                val x = f.toFloat() / (frames - 1)
                val t = 0.5f - 0.5f * kotlin.math.cos(x * Math.PI.toFloat() * 2f)
                drain(false)
                val c = surface.lockHardwareCanvas()
                try {
                    c.drawColor(Color.BLACK)
                    // Fundalul: apropiere mică, alunecă puțin în sus.
                    c.drawBitmap(back, place(src, w, h, cover * (1.04f + 0.05f * t), dy = -0.010f * h * t), paint)
                    // Persoana: apropiere mai mare, alunecă puțin în jos — paralaxa care dă adâncimea.
                    c.drawBitmap(person, place(src, w, h, cover * (1.04f + 0.11f * t), dy = 0.012f * h * t), paint)
                } finally {
                    surface.unlockCanvasAndPost(c)
                }
                drain(false)
                if (f % 15 == 0) onProgress(f / frames.toFloat())
            }
            codec.signalEndOfInputStream()
            drain(true)
        } finally {
            try { codec.stop() } catch (_: Throwable) { }
            codec.release()
            surface.release()
            try { if (started) muxer.stop() } catch (_: Throwable) { }
            muxer.release()
            person.recycle()
            back.recycle()
        }
        onProgress(1f)
        out
    }

    /** Poza centrată, scalată cu [scale], deplasată vertical cu [dy]. */
    private fun place(src: Bitmap, w: Int, h: Int, scale: Float, dy: Float): Matrix = Matrix().apply {
        setScale(scale, scale)
        postTranslate((w - src.width * scale) / 2f, (h - src.height * scale) / 2f + dy)
    }

    companion object {
        const val FPS = 30
        const val SECONDS = 5
    }
}
