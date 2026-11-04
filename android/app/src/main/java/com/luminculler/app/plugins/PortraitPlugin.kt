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
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val MODNET_URL = "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx"
private const val MODNET_FILE = "modnet_q.onnx"
private const val DEPTH_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx"
private const val DEPTH_FILE = "depth_anything_v2_small_q.onnx"
private const val MODNET_SIDE = 512
private const val DEPTH_SIDE = 518

/**
 * „Portret”: fundalul estompat, ca la camerele cu două obiective, pe orice poză.
 *
 *  - Oameni: MODNet (Apache-2.0, ~7 MB) desparte omul de fundal, cu tot cu păr.
 *  - Altceva (un animal, o floare, o cană): Depth Anything V2 Small (Apache-2.0,
 *    ~27 MB) spune ce e aproape și ce e departe; aproape rămâne clar.
 *
 * Modelele vin de la Hugging Face la prima folosire. Nimic nu pleacă de pe telefon.
 */
@CapacitorPlugin(name = "Portrait")
class PortraitPlugin : Plugin() {
    private val executor = pluginExecutor("Portrait")
    private var env: OrtEnvironment? = null
    private var modnet: OrtSession? = null
    private var depth: OrtSession? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { modnet?.close() }
        runCatching { depth?.close() }
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

    private fun session(which: String): OrtSession {
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(4) }
        return if (which == "modnet") modnet ?: e.createSession(file(MODNET_FILE, MODNET_URL, 5_000_000).absolutePath, opts).also { modnet = it }
        else depth ?: e.createSession(file(DEPTH_FILE, DEPTH_URL, 20_000_000).absolutePath, opts).also { depth = it }
    }

    private fun input(src: Bitmap, side: Int, mean: FloatArray, std: FloatArray): FloatBuffer {
        val s = Bitmap.createScaledBitmap(src, side, side, true)
        val px = IntArray(side * side); s.getPixels(px, 0, side, 0, 0, side, side)
        if (s !== src) s.recycle()
        val plane = side * side
        val buf = FloatBuffer.allocate(3 * plane)
        for (i in 0 until plane) {
            val p = px[i]
            buf.put(i, (((p shr 16) and 0xFF) / 255f - mean[0]) / std[0])
            buf.put(plane + i, (((p shr 8) and 0xFF) / 255f - mean[1]) / std[1])
            buf.put(2 * plane + i, ((p and 0xFF) / 255f - mean[2]) / std[2])
        }
        return buf
    }

    @Suppress("UNCHECKED_CAST")
    private fun personMatte(src: Bitmap): FloatArray {
        val s = session("modnet")
        val e = env!!
        val buf = input(src, MODNET_SIDE, floatArrayOf(0.5f, 0.5f, 0.5f), floatArrayOf(0.5f, 0.5f, 0.5f))
        OnnxTensor.createTensor(e, buf, longArrayOf(1, 3, MODNET_SIDE.toLong(), MODNET_SIDE.toLong())).use { t ->
            s.run(mapOf(s.inputNames.first() to t)).use { r ->
                val m = (r[0].value as Array<Array<Array<FloatArray>>>)[0][0]
                val out = FloatArray(MODNET_SIDE * MODNET_SIDE)
                for (y in 0 until MODNET_SIDE) for (x in 0 until MODNET_SIDE) out[y * MODNET_SIDE + x] = m[y][x]
                return out
            }
        }
    }

    /** Harta „aproape”, 0..1: 1 = planul cel mai apropiat. */
    @Suppress("UNCHECKED_CAST")
    private fun nearMap(src: Bitmap): FloatArray {
        val s = session("depth")
        val e = env!!
        val buf = input(src, DEPTH_SIDE, floatArrayOf(0.485f, 0.456f, 0.406f), floatArrayOf(0.229f, 0.224f, 0.225f))
        OnnxTensor.createTensor(e, buf, longArrayOf(1, 3, DEPTH_SIDE.toLong(), DEPTH_SIDE.toLong())).use { t ->
            s.run(mapOf(s.inputNames.first() to t)).use { r ->
                val d = (r[0].value as Array<Array<FloatArray>>)[0]
                val h = d.size; val w = d[0].size
                val flat = FloatArray(w * h)
                for (y in 0 until h) for (x in 0 until w) flat[y * w + x] = d[y][x]
                val sorted = flat.copyOf().also { it.sort() }
                // Subiectul = ce e mai aproape decât ~70% din cadru, cu o trecere lină.
                val lo = sorted[(sorted.size * 0.55).toInt()]
                val hi = sorted[(sorted.size * 0.80).toInt()]
                val span = max(1e-6f, hi - lo)
                return FloatArray(flat.size) { i -> ((flat[i] - lo) / span).coerceIn(0f, 1f) }
            }
        }
    }

    /** Mapa de focalizare (0..1) la mărimea pozei, ca alfa într-un Bitmap. */
    private fun focusBitmap(map: FloatArray, side: Int, w: Int, h: Int): IntArray {
        val px = IntArray(side * side) { i -> ((map[i] * 255f).roundToInt().coerceIn(0, 255) shl 24) or 0xFFFFFF }
        val b = Bitmap.createBitmap(px, side, side, Bitmap.Config.ARGB_8888)
        // Puțin înmuiată: marginea subiectului nu trebuie să se vadă tăiată.
        val soft = Bitmap.createScaledBitmap(Bitmap.createScaledBitmap(b, side / 4, side / 4, true), w, h, true)
        val out = IntArray(w * h); soft.getPixels(out, 0, w, 0, 0, w, h)
        return out
    }

    /** { imageBase64, strength 0..1 } → { imageBase64 (JPEG), subject: "person" | "depth" } */
    @PluginMethod
    fun portrait(call: PluginCall) {
        val b64 = call.getString("imageBase64")
        if (b64.isNullOrEmpty()) { call.reject("imageBase64 is required"); return }
        val strength = (call.getDouble("strength") ?: 0.7).toFloat().coerceIn(0.1f, 1f)
        executor.ruleaza(call, "Portretul nu s-a putut face") {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { call.reject("imagine invalidă"); return@ruleaza }
            val w = src.width; val h = src.height
            val matte = personMatte(src)
            val personShare = matte.count { it > 0.5f }.toFloat() / matte.size
            val usePerson = personShare > 0.04f
            val focus = if (usePerson) focusBitmap(matte, MODNET_SIDE, w, h) else focusBitmap(nearMap(src), DEPTH_SIDE, w, h)

            // Estomparea: în jos și înapoi în sus, în doi pași (o lentilă, nu pixeli mari).
            val k = max(2, (max(w, h) / (40f + 60f * (1 - strength))).roundToInt())
            val tiny = Bitmap.createScaledBitmap(src, max(1, w / k), max(1, h / k), true)
            val mid = Bitmap.createScaledBitmap(tiny, max(1, w / 4), max(1, h / 4), true)
            val blur = Bitmap.createScaledBitmap(mid, w, h, true)
            val sp = IntArray(w * h); src.getPixels(sp, 0, w, 0, 0, w, h)
            val bp = IntArray(w * h); blur.getPixels(bp, 0, w, 0, 0, w, h)
            for (i in 0 until w * h) {
                val a = ((focus[i] ushr 24) and 0xFF) / 255f
                val t = min(1f, a * 1.15f)
                val r = (((sp[i] shr 16) and 0xFF) * t + ((bp[i] shr 16) and 0xFF) * (1 - t)).toInt()
                val g = (((sp[i] shr 8) and 0xFF) * t + ((bp[i] shr 8) and 0xFF) * (1 - t)).toInt()
                val bl = ((sp[i] and 0xFF) * t + (bp[i] and 0xFF) * (1 - t)).toInt()
                sp[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
            }
            val out = Bitmap.createBitmap(sp, w, h, Bitmap.Config.ARGB_8888)
            val stream = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, 94, stream)
            val o = JSObject()
            o.put("imageBase64", Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
            o.put("subject", if (usePerson) "person" else "depth")
            call.resolve(o)
        }
    }
}
