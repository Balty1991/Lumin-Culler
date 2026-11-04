package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.max
import kotlin.math.roundToInt

private const val SAM_BASE = "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx"
private const val ENC_FILE = "slimsam_encoder_q.onnx"
private const val DEC_FILE = "slimsam_decoder_q.onnx"
private const val SAM_SIDE = 1024
private const val MASK_SIDE = 256

/**
 * „Atinge obiectul”: SlimSAM (Segment Anything comprimat, Apache-2.0), pe
 * telefon. Pregătirea pozei (encoder, ~2–5 s) se face o dată la deschiderea
 * gumei; fiecare atingere (decoder) durează sub o zecime de secundă.
 *
 * Modelele (~14 MB) vin o dată de la Hugging Face, la prima folosire.
 */
@CapacitorPlugin(name = "Sam")
class SamPlugin : Plugin() {
    private val executor = pluginExecutor("Sam")
    private var env: OrtEnvironment? = null
    private var enc: OrtSession? = null
    private var dec: OrtSession? = null
    private var embeddings: FloatArray? = null
    private var positional: FloatArray? = null
    private var scale = 1f
    private var srcW = 0
    private var srcH = 0

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { enc?.close() }
        runCatching { dec?.close() }
        super.handleOnDestroy()
    }

    private fun file(name: String, url: String, min: Long): File {
        val f = File(context.filesDir, name)
        if (f.length() > min) return f
        val tmp = File(context.filesDir, "$name.part")
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 15000; conn.readTimeout = 90000; conn.instanceFollowRedirects = true
        try {
            if (conn.responseCode != 200) throw IllegalStateException("model ${conn.responseCode}")
            conn.inputStream.use { inp -> tmp.outputStream().use { inp.copyTo(it, 1 shl 16) } }
        } finally { conn.disconnect() }
        if (tmp.length() <= min) { tmp.delete(); throw IllegalStateException("model trunchiat") }
        tmp.renameTo(f)
        return f
    }

    private fun sessions(): Pair<OrtSession, OrtSession> {
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(4) }
        val en = enc ?: e.createSession(file(ENC_FILE, "$SAM_BASE/vision_encoder_quantized.onnx", 8_000_000).absolutePath, opts).also { enc = it }
        val de = dec ?: e.createSession(file(DEC_FILE, "$SAM_BASE/prompt_encoder_mask_decoder_quantized.onnx", 4_000_000).absolutePath, opts).also { dec = it }
        return en to de
    }

    /** { imageBase64 } → pregătește poza pentru atingeri. */
    @PluginMethod
    fun encode(call: PluginCall) {
        val b64 = call.getString("imageBase64")
        if (b64.isNullOrEmpty()) { call.reject("imageBase64 is required"); return }
        executor.ruleaza(call, "Selecția nu s-a putut pregăti") {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { call.reject("imagine invalidă"); return@ruleaza }
            val (en, _) = sessions()
            srcW = src.width; srcH = src.height
            scale = SAM_SIDE.toFloat() / max(srcW, srcH)
            val nw = (srcW * scale).roundToInt().coerceIn(1, SAM_SIDE)
            val nh = (srcH * scale).roundToInt().coerceIn(1, SAM_SIDE)
            val small = Bitmap.createScaledBitmap(src, nw, nh, true)
            val px = IntArray(nw * nh); small.getPixels(px, 0, nw, 0, 0, nw, nh)
            val plane = SAM_SIDE * SAM_SIDE
            val buf = FloatBuffer.allocate(3 * plane) // umplutura (zero) rămâne zero, ca la antrenare
            val mean = floatArrayOf(0.485f, 0.456f, 0.406f); val std = floatArrayOf(0.229f, 0.224f, 0.225f)
            for (y in 0 until nh) for (x in 0 until nw) {
                val p = px[y * nw + x]; val i = y * SAM_SIDE + x
                buf.put(i, (((p shr 16) and 0xFF) / 255f - mean[0]) / std[0])
                buf.put(plane + i, (((p shr 8) and 0xFF) / 255f - mean[1]) / std[1])
                buf.put(2 * plane + i, ((p and 0xFF) / 255f - mean[2]) / std[2])
            }
            val e = env!!
            OnnxTensor.createTensor(e, buf, longArrayOf(1, 3, SAM_SIDE.toLong(), SAM_SIDE.toLong())).use { t ->
                en.run(mapOf("pixel_values" to t)).use { r ->
                    embeddings = flat(r.get("image_embeddings").get().value)
                    positional = flat(r.get("image_positional_embeddings").get().value)
                }
            }
            val o = JSObject(); o.put("ok", true); call.resolve(o)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun flat(v: Any): FloatArray {
        val a = (v as Array<Array<Array<FloatArray>>>)[0]
        val out = FloatArray(256 * 64 * 64)
        var k = 0
        for (c in a) for (row in c) for (x in row) out[k++] = x
        return out
    }

    /** { x, y } în 0..1 din poză → { maskBase64 (PNG alb pe transparent), width, height }. */
    @PluginMethod
    fun select(call: PluginCall) {
        val x = call.getDouble("x") ?: run { call.reject("x"); return }
        val y = call.getDouble("y") ?: run { call.reject("y"); return }
        executor.ruleaza(call, "Selecția a eșuat") {
            val emb = embeddings ?: run { call.reject("Poza nu e pregătită"); return@ruleaza }
            val pos = positional!!
            val (_, de) = sessions()
            val e = env!!
            val shape = longArrayOf(1, 256, 64, 64)
            val pts = FloatBuffer.wrap(floatArrayOf((x * srcW * scale).toFloat(), (y * srcH * scale).toFloat()))
            OnnxTensor.createTensor(e, pts, longArrayOf(1, 1, 1, 2)).use { pT ->
            OnnxTensor.createTensor(e, LongBuffer.wrap(longArrayOf(1)), longArrayOf(1, 1, 1)).use { lT ->
            OnnxTensor.createTensor(e, FloatBuffer.wrap(emb), shape).use { eT ->
            OnnxTensor.createTensor(e, FloatBuffer.wrap(pos), shape).use { qT ->
                de.run(mapOf("input_points" to pT, "input_labels" to lT, "image_embeddings" to eT, "image_positional_embeddings" to qT)).use { r ->
                    @Suppress("UNCHECKED_CAST")
                    val iou = (r.get("iou_scores").get().value as Array<Array<FloatArray>>)[0][0]
                    // Cea mai sigură dintre cele trei variante, dar nu cea mai mare: la
                    // egalitate aproape, varianta mai mică e de obicei obiectul atins.
                    var best = 0
                    for (k in iou.indices) if (iou[k] > iou[best] + 0.02f) best = k
                    @Suppress("UNCHECKED_CAST")
                    val m = (r.get("pred_masks").get().value as Array<Array<Array<Array<FloatArray>>>>)[0][0][best]
                    val vw = max(1, (srcW * scale / 4f).roundToInt().coerceAtMost(MASK_SIDE))
                    val vh = max(1, (srcH * scale / 4f).roundToInt().coerceAtMost(MASK_SIDE))
                    val px = IntArray(vw * vh)
                    var on = 0
                    for (yy in 0 until vh) for (xx in 0 until vw) {
                        if (m[yy][xx] > 0f) { px[yy * vw + xx] = -1; on++ }
                    }
                    val bmp = Bitmap.createBitmap(px, vw, vh, Bitmap.Config.ARGB_8888)
                    val out = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                    val o = JSObject()
                    o.put("maskBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                    o.put("width", vw); o.put("height", vh)
                    o.put("coverage", on.toDouble() / (vw * vh))
                    o.put("score", iou[best].toDouble())
                    call.resolve(o)
                }
            } } } }
        }
    }
}
