package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.roundToInt

// RIFE 4.9 (hzwer, MIT), exportat ONNX. DE VERIFICAT înainte de Play: conversia
// găzduită n-are licență scrisă; de refăcut din greutățile originale MIT.
private const val RIFE_URL = "https://huggingface.co/yuvraj108c/rife-onnx/resolve/main/rife49_ensemble_True_scale_1_sim.onnx"
private const val RIFE_FILE = "rife49.onnx"
private const val RIFE_MAX = 768

/**
 * „Mini-film din serie”: cadre intermediare între două poze din aceeași rafală,
 * ca mișcarea să curgă (RIFE). Intrări img0/img1 [1,3,H,W] 0..1 și timestep;
 * ieșire cadrul de la momentul t. Laturile se rotunjesc la multiplu de 32.
 */
@CapacitorPlugin(name = "Rife")
class RifePlugin : Plugin() {
    private val executor = pluginExecutor("Rife")
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { session?.close() }
        super.handleOnDestroy()
    }

    private fun session(): OrtSession {
        session?.let { return it }
        val f = File(context.filesDir, RIFE_FILE)
        if (f.length() < 18_000_000) {
            val tmp = File(context.filesDir, "$RIFE_FILE.part")
            val conn = java.net.URL(RIFE_URL).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 20000; conn.readTimeout = 90000; conn.instanceFollowRedirects = true
            try {
                if (conn.responseCode != 200) throw IllegalStateException("model ${conn.responseCode}")
                conn.inputStream.use { inp -> tmp.outputStream().use { inp.copyTo(it, 1 shl 16) } }
            } finally { conn.disconnect() }
            if (tmp.length() < 18_000_000) { tmp.delete(); throw IllegalStateException("model trunchiat") }
            tmp.renameTo(f)
        }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        return e.createSession(f.absolutePath, OrtSession.SessionOptions().apply { setIntraOpNumThreads(4) }).also { session = it }
    }

    private fun toTensor(b: Bitmap): FloatBuffer {
        val w = b.width; val h = b.height; val plane = w * h
        val px = IntArray(plane); b.getPixels(px, 0, w, 0, 0, w, h)
        val buf = FloatBuffer.allocate(3 * plane)
        for (i in 0 until plane) {
            val p = px[i]
            buf.put(i, ((p shr 16) and 0xFF) / 255f)
            buf.put(plane + i, ((p shr 8) and 0xFF) / 255f)
            buf.put(2 * plane + i, (p and 0xFF) / 255f)
        }
        return buf
    }

    /** { a, b (JPEG base64), steps } → { frames: [JPEG base64 …] } fără capete, în ordine. */
    @PluginMethod
    fun between(call: PluginCall) {
        val a64 = call.getString("a"); val b64 = call.getString("b")
        if (a64.isNullOrEmpty() || b64.isNullOrEmpty()) { call.reject("a și b sunt necesare"); return }
        val steps = (call.getInt("steps") ?: 3).coerceIn(1, 7)
        executor.ruleaza(call, "Mini-filmul n-a mers") {
            val ba = Base64.decode(a64, Base64.DEFAULT); val bb = Base64.decode(b64, Base64.DEFAULT)
            val ia = BitmapFactory.decodeByteArray(ba, 0, ba.size); val ib = BitmapFactory.decodeByteArray(bb, 0, bb.size)
            if (ia == null || ib == null) { call.reject("imagine invalidă"); return@ruleaza }
            val k = minOf(1f, RIFE_MAX.toFloat() / max(ia.width, ia.height))
            val w = max(32, ((ia.width * k) / 32f).roundToInt() * 32)
            val h = max(32, ((ia.height * k) / 32f).roundToInt() * 32)
            val sa = Bitmap.createScaledBitmap(ia, w, h, true); val sb = Bitmap.createScaledBitmap(ib, w, h, true)
            val s = session(); val e = env!!
            val ta = toTensor(sa); val tb = toTensor(sb)
            val frames = JSArray()
            for (i in 1..steps) {
                val t = i.toFloat() / (steps + 1)
                OnnxTensor.createTensor(e, ta.duplicate(), longArrayOf(1, 3, h.toLong(), w.toLong())).use { x0 ->
                OnnxTensor.createTensor(e, tb.duplicate(), longArrayOf(1, 3, h.toLong(), w.toLong())).use { x1 ->
                OnnxTensor.createTensor(e, FloatBuffer.wrap(floatArrayOf(t)), longArrayOf(1)).use { ts ->
                    s.run(mapOf("img0" to x0, "img1" to x1, "timestep" to ts)).use { r ->
                        val fb = (r[0] as OnnxTensor).floatBuffer
                        val plane = w * h
                        val px = IntArray(plane) { j ->
                            val rr = (fb.get(j) * 255f).roundToInt().coerceIn(0, 255)
                            val gg = (fb.get(plane + j) * 255f).roundToInt().coerceIn(0, 255)
                            val bl = (fb.get(2 * plane + j) * 255f).roundToInt().coerceIn(0, 255)
                            (0xFF shl 24) or (rr shl 16) or (gg shl 8) or bl
                        }
                        val out = ByteArrayOutputStream()
                        Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, out)
                        frames.put(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                    }
                } } }
            }
            val o = JSObject(); o.put("frames", frames); o.put("width", w); o.put("height", h); call.resolve(o)
        }
    }
}
