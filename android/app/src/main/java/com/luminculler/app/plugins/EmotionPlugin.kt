package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val FER_URL = "https://huggingface.co/onnxmodelzoo/emotion-ferplus-8/resolve/main/emotion-ferplus-8.onnx"
private const val FER_FILE = "emotion_ferplus8.onnx"
private const val FER_SIDE = 64

/**
 * Expresia fețelor: FER+ (Microsoft, ONNX Model Zoo, Apache-2.0), ~35 MB.
 * Intrare: fața în tonuri de gri, 64×64, valori 0..255; ieșire: 8 emoții
 * (neutru, bucurie, surpriză, tristețe, furie, dezgust, frică, dispreț).
 * Ne interesează mai ales bucuria: „râde de-adevăratelea” vs. zâmbet de poză.
 */
@CapacitorPlugin(name = "Emotion")
class EmotionPlugin : Plugin() {
    private val executor = pluginExecutor("Emotion")
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { session?.close() }
        super.handleOnDestroy()
    }

    private fun model(): File {
        val f = File(context.filesDir, FER_FILE)
        if (f.length() > 30_000_000) return f
        val tmp = File(context.filesDir, "$FER_FILE.part")
        val conn = java.net.URL(FER_URL).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 20000; conn.readTimeout = 90000; conn.instanceFollowRedirects = true
        try {
            if (conn.responseCode != 200) throw IllegalStateException("model ${conn.responseCode}")
            conn.inputStream.use { inp -> tmp.outputStream().use { inp.copyTo(it, 1 shl 16) } }
        } finally { conn.disconnect() }
        if (tmp.length() <= 30_000_000) { tmp.delete(); throw IllegalStateException("model trunchiat") }
        tmp.renameTo(f)
        return f
    }

    private fun session(): OrtSession {
        session?.let { return it }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        return e.createSession(model().absolutePath, OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }).also { session = it }
    }

    /** { imageUri, boxes: [[x,y,w,h] 0..1, …] } → { faces: [[8 probabilități], …] } */
    @PluginMethod
    fun faces(call: PluginCall) {
        executor.ruleaza(call, "Expresiile n-au mers") {
            val boxes = call.getArray("boxes") ?: JSArray()
            val src: Bitmap = resolveInputBitmap(context, call) ?: return@ruleaza
            val s = session()
            val e = env!!
            val out = JSArray()
            for (i in 0 until boxes.length()) {
                val b = boxes.getJSONArray(i)
                val w = src.width.toDouble(); val h = src.height.toDouble()
                val side = max(b.getDouble(2) * w, b.getDouble(3) * h) * 1.1
                val cx = (b.getDouble(0) + b.getDouble(2) / 2) * w
                val cy = (b.getDouble(1) + b.getDouble(3) / 2) * h
                if (side < 20) { out.put(JSArray()); continue }
                val left = (cx - side / 2).coerceIn(0.0, w - 1); val top = (cy - side / 2).coerceIn(0.0, h - 1)
                val cw = min(side, w - left).roundToInt().coerceAtLeast(1); val ch = min(side, h - top).roundToInt().coerceAtLeast(1)
                val crop = Bitmap.createBitmap(src, left.roundToInt(), top.roundToInt(), cw, ch)
                val face = Bitmap.createScaledBitmap(crop, FER_SIDE, FER_SIDE, true)
                val px = IntArray(FER_SIDE * FER_SIDE); face.getPixels(px, 0, FER_SIDE, 0, 0, FER_SIDE, FER_SIDE)
                if (crop !== src) crop.recycle(); face.recycle()
                val buf = FloatBuffer.allocate(FER_SIDE * FER_SIDE)
                for (k in px.indices) {
                    val p = px[k]
                    buf.put(k, 0.299f * ((p shr 16) and 0xFF) + 0.587f * ((p shr 8) and 0xFF) + 0.114f * (p and 0xFF))
                }
                OnnxTensor.createTensor(e, buf, longArrayOf(1, 1, FER_SIDE.toLong(), FER_SIDE.toLong())).use { t ->
                    s.run(mapOf(s.inputNames.first() to t)).use { r ->
                        @Suppress("UNCHECKED_CAST")
                        val lg = (r[0].value as Array<FloatArray>)[0]
                        val m = lg.max()
                        val ex = lg.map { exp((it - m).toDouble()) }
                        val sum = ex.sum()
                        val arr = JSArray()
                        for (v in ex) arr.put((v / sum * 1000).roundToInt() / 1000.0)
                        out.put(arr)
                    }
                }
            }
            val o = JSObject(); o.put("faces", out); call.resolve(o)
        }
    }
}
