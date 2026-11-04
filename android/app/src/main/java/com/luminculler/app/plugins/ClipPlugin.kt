package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

private const val CLIP_FILE = "clip_vit_b32_vision_q.onnx"
/** OpenAI CLIP ViT-B/32 (MIT), exportat ONNX și cuantizat int8 de Xenova; ~89 MB. */
private const val CLIP_URL = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx"
private const val CLIP_MIN_BYTES = 80_000_000L
private const val SIDE = 224
private val MEAN = floatArrayOf(0.48145466f, 0.4578275f, 0.40821073f)
private val STD = floatArrayOf(0.26862954f, 0.26130258f, 0.27577711f)

/**
 * „Ochiul” general al aplicației: CLIP, pe telefon. Dă pentru fiecare poză 512
 * numere care descriu ce e în ea; din ele, în JS, ies etichete mai sigure
 * (ursuleț de pluș, nu câine) și scorul estetic LAION (cât de frumoasă e poza).
 *
 * Modelul nu e în APK: se descarcă o singură dată, doar pe Wi-Fi, direct de la
 * Hugging Face (nu de pe site-ul nostru — fără costuri de trafic la mulți
 * utilizatori). Nicio poză nu pleacă de pe telefon.
 */
@CapacitorPlugin(name = "Clip")
class ClipPlugin : Plugin() {
    private val executor = pluginExecutor("Clip")
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { session?.close() }
        session = null
        super.handleOnDestroy()
    }

    private fun modelFile(): File = File(context.filesDir, CLIP_FILE)
    private fun ready(): Boolean = modelFile().length() > CLIP_MIN_BYTES

    private fun unmetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun session(): OrtSession {
        session?.let { return it }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
        // Din fișier, nu din memorie: 89 MB citiți în heap ar fi riscul de OOM.
        return e.createSession(modelFile().absolutePath, opts).also { session = it }
    }

    @PluginMethod
    fun available(call: PluginCall) {
        val out = JSObject()
        out.put("ready", ready())
        out.put("wifi", unmetered(context))
        call.resolve(out)
    }

    /** Descarcă modelul o dată. Implicit doar pe Wi-Fi (`anyNetwork: true` ca să forțezi). */
    @PluginMethod
    fun prepare(call: PluginCall) {
        executor.ruleaza(call, "Modelul CLIP nu s-a putut descărca") {
            val out = JSObject()
            if (!ready()) {
                if (call.getBoolean("anyNetwork") != true && !unmetered(context)) {
                    out.put("ready", false); out.put("reason", "metered"); call.resolve(out); return@ruleaza
                }
                val tmp = File(context.filesDir, "$CLIP_FILE.part")
                val conn = java.net.URL(CLIP_URL).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 15000; conn.readTimeout = 120000
                conn.instanceFollowRedirects = true
                try {
                    if (conn.responseCode != 200) throw IllegalStateException("model ${conn.responseCode}")
                    conn.inputStream.use { inp -> tmp.outputStream().use { inp.copyTo(it, 1 shl 16) } }
                } finally { conn.disconnect() }
                if (tmp.length() <= CLIP_MIN_BYTES) { tmp.delete(); throw IllegalStateException("model trunchiat") }
                tmp.renameTo(modelFile())
            }
            out.put("ready", ready())
            call.resolve(out)
        }
    }

    /** { imageUri | imageBase64 } → { embedding: number[512] } normalizat (lungime 1). */
    @PluginMethod
    fun embed(call: PluginCall) {
        executor.ruleaza(call, "CLIP a eșuat") {
            if (!ready()) { call.reject("Modelul CLIP nu e descărcat"); return@ruleaza }
            val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return@ruleaza
            val input = preprocess(bitmap)
            val s = session()
            val e = env ?: run { call.reject("ORT"); return@ruleaza }
            OnnxTensor.createTensor(e, input, longArrayOf(1, 3, SIDE.toLong(), SIDE.toLong())).use { tensor ->
                s.run(mapOf(s.inputNames.first() to tensor)).use { res ->
                    val idx = s.outputNames.indexOf("image_embeds").takeIf { it >= 0 } ?: 0
                    @Suppress("UNCHECKED_CAST")
                    val raw = (res[idx].value as Array<FloatArray>)[0]
                    var n = 0.0
                    for (v in raw) n += v * v
                    val norm = sqrt(n).toFloat().takeIf { it > 0f } ?: 1f
                    val arr = JSArray()
                    for (v in raw) arr.put(((v / norm) * 10000f).roundToInt() / 10000.0)
                    val out = JSObject()
                    out.put("embedding", arr)
                    call.resolve(out)
                }
            }
        }
    }

    /** Ca procesorul CLIP: latura mică la 224 (bicubic ≈ filtru), decupaj central, normalizare. */
    private fun preprocess(src: Bitmap): FloatBuffer {
        val scale = SIDE.toFloat() / minOf(src.width, src.height)
        val w = max(SIDE, (src.width * scale).roundToInt())
        val h = max(SIDE, (src.height * scale).roundToInt())
        val scaled = Bitmap.createScaledBitmap(src, w, h, true)
        val crop = Bitmap.createBitmap(scaled, (w - SIDE) / 2, (h - SIDE) / 2, SIDE, SIDE)
        val px = IntArray(SIDE * SIDE)
        crop.getPixels(px, 0, SIDE, 0, 0, SIDE, SIDE)
        if (crop !== scaled) crop.recycle()
        if (scaled !== src) scaled.recycle()
        val plane = SIDE * SIDE
        val buf = FloatBuffer.allocate(3 * plane)
        for (i in 0 until plane) {
            val p = px[i]
            buf.put(i, (((p shr 16) and 0xFF) / 255f - MEAN[0]) / STD[0])
            buf.put(plane + i, (((p shr 8) and 0xFF) / 255f - MEAN[1]) / STD[1])
            buf.put(2 * plane + i, ((p and 0xFF) / 255f - MEAN[2]) / STD[2])
        }
        return buf
    }
}
