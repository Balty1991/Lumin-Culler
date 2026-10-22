package com.luminculler.app.cleaner.magic

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Harta de adâncime a unei poze: pentru fiecare punct, cât de aproape e de
 * aparat (1 = cel mai aproape, 0 = cel mai departe). Din ea vin neclaritatea
 * „ca la aparat” (crește cu distanța față de subiect) și Foto 3D (lucrurile
 * apropiate se mișcă mai mult decât cele depărtate).
 */
class DepthMap(val width: Int, val height: Int, val near: FloatArray) {
    /** Adâncimea la coordonate 0..1 ale pozei (cel mai apropiat punct al hărții). */
    fun at(x: Float, y: Float): Float {
        val i = (x * (width - 1)).roundToInt().coerceIn(0, width - 1)
        val j = (y * (height - 1)).roundToInt().coerceIn(0, height - 1)
        return near[j * width + i]
    }
}

/**
 * Depth Anything V2 Small (Apache-2.0), cuantizat la 27 MB, prin ONNX Runtime.
 * Primește poza la ~518 px pe latura lungă (multiplu de 14) și dă „adâncime
 * inversă” relativă; o aducem la 0..1 cu percentile, ca un punct rătăcit să
 * nu strice scala.
 */
class Depth(private val context: Context) {
    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private val sessionLazy = lazy {
        val bytes = context.assets.open(MODEL).use { it.readBytes() }
        env.createSession(bytes, OrtSession.SessionOptions())
    }
    private val session: OrtSession by sessionLazy

    fun estimate(src: Bitmap): DepthMap = synchronized(this) {
        val scale = SIDE / maxOf(src.width, src.height).toFloat()
        val w = (((src.width * scale) / 14f).roundToInt() * 14).coerceAtLeast(14)
        val h = (((src.height * scale) / 14f).roundToInt() * 14).coerceAtLeast(14)
        val small = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(small).drawBitmap(src, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
        val px = IntArray(w * h)
        small.getPixels(px, 0, w, 0, 0, w, h)
        small.recycle()

        val plane = w * h
        val input = ByteBuffer.allocateDirect(3 * plane * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        for (k in 0 until plane) {
            val p = px[k]
            input.put(k, (((p shr 16) and 0xFF) / 255f - 0.485f) / 0.229f)
            input.put(plane + k, (((p shr 8) and 0xFF) / 255f - 0.456f) / 0.224f)
            input.put(2 * plane + k, ((p and 0xFF) / 255f - 0.406f) / 0.225f)
        }
        val raw = OnnxTensor.createTensor(env, input, longArrayOf(1, 3, h.toLong(), w.toLong())).use { t ->
            session.run(mapOf(session.inputNames.first() to t)).use { r ->
                val out = (r.get(0) as OnnxTensor).floatBuffer
                FloatArray(out.remaining()).also { out.get(it) }
            }
        }
        // Ieșirea are forma intrării (multiplu de 14); dacă nu, o tratăm pătrat-proporțional.
        val ow = if (raw.size == plane) w else kotlin.math.sqrt(raw.size.toDouble()).toInt()
        val oh = raw.size / ow
        val sorted = raw.copyOf().also { it.sort() }
        val lo = sorted[(sorted.size * 0.02f).toInt()]
        val hi = sorted[(sorted.size * 0.98f).toInt().coerceAtMost(sorted.size - 1)]
        val span = (hi - lo).takeIf { it > 1e-6f } ?: 1f
        DepthMap(ow, oh, FloatArray(raw.size) { ((raw[it] - lo) / span).coerceIn(0f, 1f) })
    }

    fun close() {
        synchronized(this) {
            if (sessionLazy.isInitialized()) try { session.close() } catch (_: Throwable) { }
        }
    }

    companion object {
        const val MODEL = "depth_anything_v2_small_q.onnx"
        private const val SIDE = 518f
    }
}
