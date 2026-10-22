package com.luminculler.app.cleaner.magic

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
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
 * „Foto 3D”, ca „Fotografiile cinematice” din Google Foto: o hartă de
 * adâncime (Depth Anything) face din poză o suprafață în relief, iar camera
 * se apropie și alunecă puțin. Fiecare punct se mișcă după cât e de aproape,
 * deci și fundalul are adâncime (pământul din față se mișcă mai mult decât
 * stâlpii din spate), nu doar persoana. Persoana e un strat separat, iar
 * locul ei din fundal e refăcut de radiera AI, ca mișcarea să nu lase fantome.
 */
class Photo3D(private val context: Context, private val magic: PhotoMagic, private val depth: Depth, private val eraser: Eraser) {

    /** Clipul de 5 s; null doar dacă modelul de adâncime nu poate rula. */
    suspend fun render(src: Bitmap, onProgress: (Float) -> Unit): File? = withContext(Dispatchers.Default) {
        val map = try { depth.estimate(src) } catch (_: Throwable) { return@withContext null }
        onProgress(0.05f)
        val mask = try { magic.personMask(src) } catch (_: Throwable) { null }
        val person = mask?.let { magic.cutout(src, it) }
        // Fundalul fără persoană: locul ei (puțin lățit) refăcut de radieră; fără radieră, varianta estompată.
        val plate = if (mask == null) src else try {
            eraser.erase(src, widen(mask))
        } catch (_: Throwable) {
            magic.background(src, mask)
        }
        mask?.recycle()
        onProgress(0.15f)

        // Adâncimea fundalului în spatele persoanei: nu are voie să „iasă în față” odată cu ea.
        val behind = if (person == null) null else backgroundLevel(map, src, person)

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

        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        val frames = FPS * SECONDS
        val gx = GRID
        val gy = (GRID * src.height / src.width.toFloat()).toInt().coerceIn(8, 96)
        val verts = FloatArray((gx + 1) * (gy + 1) * 2)
        // Adâncimea în fiecare vârf, calculată o dată: pentru fundal, locul persoanei e coborât
        // la nivelul fundalului din jur (altfel fundalul refăcut s-ar mișca odată cu ea).
        val dPerson = FloatArray((gx + 1) * (gy + 1))
        val dPlate = FloatArray((gx + 1) * (gy + 1))
        for (j in 0..gy) for (i in 0..gx) {
            val u = i / gx.toFloat(); val t = j / gy.toFloat()
            val d = map.at(u, t)
            val k = j * (gx + 1) + i
            dPerson[k] = d
            val inside = person != null && (person.getPixel(
                (u * (person.width - 1)).toInt(), (t * (person.height - 1)).toInt()
            ) ushr 24) > 40
            dPlate[k] = if (inside && behind != null) minOf(d, behind) else d
        }
        try {
            for (f in 0 until frames) {
                ensureActive()
                // Dus-întors lin: clipul se poate pune pe repeat fără „săritură”.
                val x = f.toFloat() / (frames - 1)
                val e = 0.5f - 0.5f * kotlin.math.cos(x * Math.PI.toFloat() * 2f)
                val pan = kotlin.math.sin(x * Math.PI.toFloat() * 2f)
                drain(false)
                val c = surface.lockHardwareCanvas()
                try {
                    c.drawColor(Color.BLACK)
                    mesh(verts, gx, gy, src, dPlate, w, h, cover, e, pan)
                    c.drawBitmapMesh(plate, gx, gy, verts, 0, null, 0, paint)
                    if (person != null) {
                        mesh(verts, gx, gy, src, dPerson, w, h, cover, e, pan)
                        c.drawBitmapMesh(person, gx, gy, verts, 0, null, 0, paint)
                    }
                } finally {
                    surface.unlockCanvasAndPost(c)
                }
                drain(false)
                if (f % 15 == 0) onProgress(0.15f + 0.85f * f / frames.toFloat())
            }
            codec.signalEndOfInputStream()
            drain(true)
        } finally {
            try { codec.stop() } catch (_: Throwable) { }
            codec.release()
            surface.release()
            try { if (started) muxer.stop() } catch (_: Throwable) { }
            muxer.release()
            person?.recycle()
            if (plate !== src) plate.recycle()
        }
        onProgress(1f)
        out
    }

    /**
     * Vârfurile grilei pentru un cadru: fiecare punct al pozei, pus pe ecran
     * după cât e de aproape. [e] e apropierea camerei (0..1), [pan] alunecarea
     * laterală (-1..1); [depths] are adâncimea fiecărui vârf.
     */
    private fun mesh(v: FloatArray, gx: Int, gy: Int, src: Bitmap, depths: FloatArray, w: Int, h: Int, cover: Float, e: Float, pan: Float) {
        var k = 0
        for (j in 0..gy) for (i in 0..gx) {
            val u = i / gx.toFloat()
            val t = j / gy.toFloat()
            val d = depths[j * (gx + 1) + i]
            // Mai aproape = mărit mai tare și deplasat mai mult: asta e paralaxa.
            val zoom = cover * (1.03f + 0.09f * e * d)
            val bx = (u - 0.5f) * src.width
            val by = (t - 0.5f) * src.height
            v[k++] = w / 2f + bx * zoom + pan * 0.028f * w * (d - 0.35f)
            v[k++] = h / 2f + by * zoom - 0.012f * h * e * (d - 0.35f)
        }
    }

    /** Masca lățită cu câțiva pixeli, ca radiera să ia și conturul persoanei. */
    private fun widen(mask: Bitmap): Bitmap {
        val r = maxOf(4f, mask.width / 90f)
        val out = Bitmap.createBitmap(mask.width, mask.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = Paint()
        for (a in 0 until 12) {
            val ang = a * Math.PI.toFloat() / 6f
            c.drawBitmap(mask, r * kotlin.math.cos(ang), r * kotlin.math.sin(ang), p)
        }
        c.drawBitmap(mask, 0f, 0f, p)
        return out
    }

    /** Adâncimea tipică a fundalului din jurul persoanei (percentila 70 din afara ei). */
    private fun backgroundLevel(map: DepthMap, src: Bitmap, person: Bitmap): Float {
        val vals = ArrayList<Float>()
        val step = 6
        for (j in 0 until map.height step step) for (i in 0 until map.width step step) {
            val x = (i * src.width / map.width).coerceIn(0, person.width - 1)
            val y = (j * src.height / map.height).coerceIn(0, person.height - 1)
            if ((person.getPixel(x, y) ushr 24) < 40) vals.add(map.near[j * map.width + i])
        }
        if (vals.isEmpty()) return 0.6f
        vals.sort()
        return vals[(vals.size * 0.7f).toInt().coerceAtMost(vals.size - 1)]
    }

    companion object {
        const val FPS = 30
        const val SECONDS = 5
        /** Câte coloane are grila de relief; destul de fină pentru contururi, destul de mică pentru viteză. */
        const val GRID = 64
    }
}
