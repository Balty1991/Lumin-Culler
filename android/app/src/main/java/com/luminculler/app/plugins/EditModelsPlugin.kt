package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.luminculler.app.ReleasableModel
import org.tensorflow.lite.Interpreter
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

private const val MIGAN_FILE = "migan_fp16.tflite"
private const val ZERODCE_FILE = "zerodce_512_fp16.tflite"
private const val SIDE = 512
private const val ESRGAN_FILE = "realesr_general_x4v3.tflite"
private const val U2NET_FILE = "u2netp.tflite"
// Modelele mari se descarcă o dată, la prima folosire, de pe site (nu intră în APK).
private const val MODELS_URL = "https://balty1991.github.io/Lumin-Culler/models"

/**
 * Editorul pe telefon, cu modele mici și gratuite (cerut: „editorul să fie
 * foarte performant, fără costuri când sunt mulți utilizatori”):
 *
 *  - `erase`: guma, cu MI-GAN (Picsart, MIT). Intrare [1,4,512,512] NCHW =
 *    concat(mask−0.5, rgb·mask), rgb în [−1,1], mask 1 = păstrez, 0 = șterg;
 *    ieșire [1,3,512,512] în [−1,1]. Se compune rgb·mask + out·(1−mask).
 *  - `lowLight`: lumina, cu Zero-DCE (Apache-2.0). Intrare/ieșire [1,512,512,3]
 *    NHWC în [0,1]. Modelul dă curba la 512 px; pe poza mare se aplică doar
 *    câștigul (ieșire/intrare), estompat — detaliul rămâne cel original.
 *
 * Totul pe procesorul telefonului (XNNPACK, 4 fire), fără server.
 */
@CapacitorPlugin(name = "EditModels")
class EditModelsPlugin : Plugin() {
    private val executor = pluginExecutor("EditModels")

    private fun interpreter(name: String): Interpreter {
        val bytes = if (name == MIGAN_FILE) modelBytes(name, 10_000_000) else context.assets.open(name).use { it.readBytes() }
        val buf = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
        buf.put(bytes).rewind()
        return Interpreter(buf, Interpreter.Options().setNumThreads(4))
    }

    private val migan = ReleasableModel<Interpreter>({ interpreter(MIGAN_FILE) }, { it.close() })
    private val zeroDce = ReleasableModel<Interpreter>({ interpreter(ZERODCE_FILE) }, { it.close() })
    private val esrgan = ReleasableModel<Interpreter>({ interpreter(ESRGAN_FILE) }, { it.close() })
    private val u2net = ReleasableModel<Interpreter>({ interpreter(U2NET_FILE) }, { it.close() })

    override fun handleOnDestroy() {
        executor.shutdown()
        super.handleOnDestroy()
    }

    /**
     * Modelele mari nu intră în APK (limita de mărime): se iau din APK dacă există,
     * altfel din cache, altfel se descarcă o dată de pe site și rămân pe telefon.
     */
    private fun modelBytes(file: String, minSize: Long): ByteArray {
        if (hasAsset(file)) return context.assets.open(file).use { it.readBytes() }
        val f = java.io.File(context.filesDir, file)
        if (f.length() > minSize) return f.readBytes()
        val conn = java.net.URL("$MODELS_URL/$file").openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 15000; conn.readTimeout = 90000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("model ${conn.responseCode}")
            val tmp = java.io.File(context.filesDir, "$file.part")
            conn.inputStream.use { inp -> tmp.outputStream().use { inp.copyTo(it) } }
            if (tmp.length() <= minSize) { tmp.delete(); throw IllegalStateException("model trunchiat") }
            tmp.renameTo(f)
        } finally { conn.disconnect() }
        return f.readBytes()
    }

    private fun hasAsset(name: String): Boolean = try {
        context.assets.open(name).use { true }
    } catch (_: Exception) { false }

    @PluginMethod
    fun available(call: PluginCall) {
        val out = JSObject()
        out.put("erase", true) // din APK, din cache sau descărcat la prima folosire
        out.put("lowLight", hasAsset(ZERODCE_FILE))
        out.put("clarity", hasAsset(ESRGAN_FILE))
        out.put("cutout", hasAsset(U2NET_FILE))
        call.resolve(out)
    }

    private fun decode(b64: String): Bitmap {
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw IllegalArgumentException("bad image")
    }

    private fun encode(b: Bitmap, png: Boolean = false): String {
        val out = ByteArrayOutputStream()
        b.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 94, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /**
     * Guma pe o bucată din poză (apelantul trimite cutia din jurul zonei, cu
     * context). `maskBase64`: alb = de șters. Întoarce bucata, aceeași mărime.
     */
    @PluginMethod
    fun erase(call: PluginCall) {
        val img64 = call.getString("imageBase64")
        val mask64 = call.getString("maskBase64")
        if (img64.isNullOrEmpty() || mask64.isNullOrEmpty()) { call.reject("imageBase64 and maskBase64 are required"); return }
        executor.ruleaza(call, "Erase failed") {
            val src = decode(img64)
            val w = src.width; val h = src.height
            val img = Bitmap.createScaledBitmap(src, SIDE, SIDE, true)
            val m = Bitmap.createScaledBitmap(decode(mask64), SIDE, SIDE, true)
            val px = IntArray(SIDE * SIDE); img.getPixels(px, 0, SIDE, 0, 0, SIDE, SIDE)
            val mp = IntArray(SIDE * SIDE); m.getPixels(mp, 0, SIDE, 0, 0, SIDE, SIDE)
            // 1 = păstrez, 0 = șterg; zona ștearsă puțin lărgită, ca marginea obiectului să dispară și ea.
            val erase = BooleanArray(SIDE * SIDE) { i -> ((mp[i] shr 8) and 0xFF) > 100 || ((mp[i] shr 16) and 0xFF) > 100 }
            val grown = dilate(erase, SIDE, 5)
            val plane = SIDE * SIDE
            val input = ByteBuffer.allocateDirect(4 * 4 * plane).order(ByteOrder.nativeOrder())
            val fin = input.asFloatBuffer()
            for (i in 0 until plane) fin.put(i, if (grown[i]) -0.5f else 0.5f)
            for (c in 0 until 3) {
                val shift = 16 - c * 8
                for (i in 0 until plane) {
                    val v = ((px[i] shr shift) and 0xFF) / 127.5f - 1f
                    fin.put((c + 1) * plane + i, if (grown[i]) 0f else v)
                }
            }
            val output = ByteBuffer.allocateDirect(4 * 3 * plane).order(ByteOrder.nativeOrder())
            migan.use { it.run(input, output) }
            output.rewind()
            val fo = output.asFloatBuffer()
            val res = IntArray(plane)
            for (i in 0 until plane) {
                if (!grown[i]) { res[i] = px[i]; continue }
                val r = ((fo.get(i) + 1f) * 127.5f).toInt().coerceIn(0, 255)
                val g = ((fo.get(plane + i) + 1f) * 127.5f).toInt().coerceIn(0, 255)
                val b = ((fo.get(2 * plane + i) + 1f) * 127.5f).toInt().coerceIn(0, 255)
                res[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
            val out512 = Bitmap.createBitmap(res, SIDE, SIDE, Bitmap.Config.ARGB_8888)
            val back = Bitmap.createScaledBitmap(out512, w, h, true)
            val o = JSObject()
            o.put("imageBase64", encode(back, png = true))
            o.put("width", w); o.put("height", h)
            call.resolve(o)
        }
    }

    private fun dilate(mask: BooleanArray, side: Int, r: Int): BooleanArray {
        // Două treceri separabile (orizontal, vertical): un pătrat de (2r+1)².
        val tmp = BooleanArray(mask.size)
        for (y in 0 until side) {
            var run = -1
            for (x in 0 until side) { if (mask[y * side + x]) run = x; tmp[y * side + x] = run >= 0 && x - run <= r }
            run = -1
            for (x in side - 1 downTo 0) { if (mask[y * side + x]) run = x; if (run >= 0 && run - x <= r) tmp[y * side + x] = true }
        }
        val out = BooleanArray(mask.size)
        for (x in 0 until side) {
            var run = -1
            for (y in 0 until side) { if (tmp[y * side + x]) run = y; out[y * side + x] = run >= 0 && y - run <= r }
            run = -1
            for (y in side - 1 downTo 0) { if (tmp[y * side + x]) run = y; if (run >= 0 && run - y <= r) out[y * side + x] = true }
        }
        return out
    }

    /**
     * Lumina pentru pozele întunecate (Zero-DCE). `strength` 0..1. Întoarce poza
     * la mărimea primită (până la `maxSide`), JPEG.
     */
    @PluginMethod
    fun lowLight(call: PluginCall) {
        val img64 = call.getString("imageBase64")
        if (img64.isNullOrEmpty()) { call.reject("imageBase64 is required"); return }
        val strength = (call.getDouble("strength") ?: 1.0).toFloat().coerceIn(0f, 1f)
        executor.ruleaza(call, "Low light failed") {
            val src = decode(img64)
            val small = Bitmap.createScaledBitmap(src, SIDE, SIDE, true)
            val plane = SIDE * SIDE
            val px = IntArray(plane); small.getPixels(px, 0, SIDE, 0, 0, SIDE, SIDE)
            val input = ByteBuffer.allocateDirect(4 * 3 * plane).order(ByteOrder.nativeOrder())
            val fi = input.asFloatBuffer()
            for (i in 0 until plane) {
                fi.put(i * 3, ((px[i] shr 16) and 0xFF) / 255f)
                fi.put(i * 3 + 1, ((px[i] shr 8) and 0xFF) / 255f)
                fi.put(i * 3 + 2, (px[i] and 0xFF) / 255f)
            }
            val output = ByteBuffer.allocateDirect(4 * 3 * plane).order(ByteOrder.nativeOrder())
            zeroDce.use { it.run(input, output) }
            output.rewind()
            val fo = output.asFloatBuffer()
            // Câștigul pe luminanță (nu pe canale: culoarea rămâne a pozei), 1..3,5.
            val gain = FloatArray(plane)
            for (i in 0 until plane) {
                val li = 0.299f * fi.get(i * 3) + 0.587f * fi.get(i * 3 + 1) + 0.114f * fi.get(i * 3 + 2)
                val lo = 0.299f * fo.get(i * 3) + 0.587f * fo.get(i * 3 + 1) + 0.114f * fo.get(i * 3 + 2)
                gain[i] = ((lo + 0.03f) / (li + 0.03f)).coerceIn(1f, 3.5f)
            }
            val smooth = boxBlur(boxBlur(gain, SIDE, 6), SIDE, 6)
            // Câștigul în tonuri de gri (1..3,5 → 0..255), întins la mărimea pozei cu filtrare.
            val gp = IntArray(plane) { i -> val v = ((smooth[i] - 1f) / 2.5f * 255f).toInt().coerceIn(0, 255); (0xFF shl 24) or (v shl 16) or (v shl 8) or v }
            val gBmp = Bitmap.createScaledBitmap(Bitmap.createBitmap(gp, SIDE, SIDE, Bitmap.Config.ARGB_8888), src.width, src.height, true)
            val n = src.width * src.height
            val sp = IntArray(n); src.getPixels(sp, 0, src.width, 0, 0, src.width, src.height)
            val gpx = IntArray(n); gBmp.getPixels(gpx, 0, src.width, 0, 0, src.width, src.height)
            for (i in 0 until n) {
                val g = 1f + ((gpx[i] and 0xFF) / 255f * 2.5f) * strength
                val r = min(255f, ((sp[i] shr 16) and 0xFF) * g).toInt()
                val gg = min(255f, ((sp[i] shr 8) and 0xFF) * g).toInt()
                val b = min(255f, (sp[i] and 0xFF) * g).toInt()
                sp[i] = (0xFF shl 24) or (r shl 16) or (gg shl 8) or b
            }
            val result = Bitmap.createBitmap(sp, src.width, src.height, Bitmap.Config.ARGB_8888)
            val o = JSObject()
            o.put("imageBase64", encode(result))
            o.put("meanGain", smooth.average())
            call.resolve(o)
        }
    }

    /**
     * Claritate (Real-ESRGAN x4v3, BSD-3): poza micșorată la ≤ `inSide`, mărită ×4 pe
     * bucăți de 128 px (cu margine, ca să nu se vadă cusăturile), apoi adusă la
     * `outSide`. Detaliul refăcut de model, nu doar accentuat.
     */
    @PluginMethod
    fun clarity(call: PluginCall) {
        val img64 = call.getString("imageBase64")
        if (img64.isNullOrEmpty()) { call.reject("imageBase64 is required"); return }
        val inSide = (call.getInt("inSide") ?: 640).coerceIn(128, 900)
        val outSide = (call.getInt("outSide") ?: 2048).coerceIn(256, 3200)
        executor.ruleaza(call, "Clarity failed") {
            val full = decode(img64)
            val k = min(1f, inSide.toFloat() / max(full.width, full.height))
            val w = max(16, (full.width * k).toInt()); val h = max(16, (full.height * k).toInt())
            val src = Bitmap.createScaledBitmap(full, w, h, true)
            val sp = IntArray(w * h); src.getPixels(sp, 0, w, 0, 0, w, h)
            val ow = w * 4; val oh = h * 4
            val outPx = IntArray(ow * oh)
            val T = 128; val PAD = 8; val core = T - 2 * PAD
            val input = ByteBuffer.allocateDirect(4 * T * T * 3).order(ByteOrder.nativeOrder())
            val output = ByteBuffer.allocateDirect(4 * 3 * 512 * 512).order(ByteOrder.nativeOrder())
            val fi = input.asFloatBuffer()
            esrgan.use { model ->
                var ty = 0
                while (ty < h) {
                    var tx = 0
                    while (tx < w) {
                        val x0 = tx - PAD; val y0 = ty - PAD
                        for (yy in 0 until T) for (xx in 0 until T) {
                            val sx = (x0 + xx).coerceIn(0, w - 1); val sy = (y0 + yy).coerceIn(0, h - 1)
                            val p = sp[sy * w + sx]; val o = (yy * T + xx) * 3
                            fi.put(o, ((p shr 16) and 0xFF) / 255f); fi.put(o + 1, ((p shr 8) and 0xFF) / 255f); fi.put(o + 2, (p and 0xFF) / 255f)
                        }
                        output.rewind()
                        model.run(input, output)
                        output.rewind()
                        val fo = output.asFloatBuffer()
                        val plane = 512 * 512
                        for (yy in PAD * 4 until (PAD + core) * 4) {
                            val oy = (ty - PAD) * 4 + yy; if (oy < 0 || oy >= oh) continue
                            for (xx in PAD * 4 until (PAD + core) * 4) {
                                val ox = (tx - PAD) * 4 + xx; if (ox < 0 || ox >= ow) continue
                                val i = yy * 512 + xx
                                val r = (fo.get(i).coerceIn(0f, 1f) * 255f).toInt()
                                val g = (fo.get(plane + i).coerceIn(0f, 1f) * 255f).toInt()
                                val b = (fo.get(2 * plane + i).coerceIn(0f, 1f) * 255f).toInt()
                                outPx[oy * ow + ox] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                            }
                        }
                        tx += core
                    }
                    ty += core
                }
            }
            val big = Bitmap.createBitmap(outPx, ow, oh, Bitmap.Config.ARGB_8888)
            val f = min(1f, outSide.toFloat() / max(ow, oh))
            val result = if (f < 1f) Bitmap.createScaledBitmap(big, (ow * f).toInt(), (oh * f).toInt(), true) else big
            val o = JSObject()
            o.put("imageBase64", encode(result))
            call.resolve(o)
        }
    }

    /**
     * Subiectul decupat (U²-Net p, Apache-2.0): masca la 320 px, întinsă pe poză.
     * `background`: "white" (fundal alb, pentru vânzare) sau "none" (PNG transparent).
     */
    @PluginMethod
    fun cutout(call: PluginCall) {
        val img64 = call.getString("imageBase64")
        if (img64.isNullOrEmpty()) { call.reject("imageBase64 is required"); return }
        val white = call.getString("background") != "none"
        executor.ruleaza(call, "Cutout failed") {
            val src = decode(img64)
            val S = 320
            val small = Bitmap.createScaledBitmap(src, S, S, true)
            val px = IntArray(S * S); small.getPixels(px, 0, S, 0, 0, S, S)
            val input = ByteBuffer.allocateDirect(4 * S * S * 3).order(ByteOrder.nativeOrder())
            val fi = input.asFloatBuffer()
            val mean = floatArrayOf(0.485f, 0.456f, 0.406f); val std = floatArrayOf(0.229f, 0.224f, 0.225f)
            for (i in 0 until S * S) for (c in 0 until 3) {
                val v = ((px[i] shr (16 - 8 * c)) and 0xFF) / 255f
                fi.put(i * 3 + c, (v - mean[c]) / std[c])
            }
            val outputs = HashMap<Int, Any>()
            val bufs = Array(7) { ByteBuffer.allocateDirect(4 * S * S).order(ByteOrder.nativeOrder()) }
            bufs.forEachIndexed { i, b -> outputs[i] = b }
            u2net.use { it.runForMultipleInputsOutputs(arrayOf<Any>(input), outputs) }
            val d0 = bufs[0].apply { rewind() }.asFloatBuffer()
            var lo = Float.MAX_VALUE; var hi = -Float.MAX_VALUE
            for (i in 0 until S * S) { val v = d0.get(i); if (v < lo) lo = v; if (v > hi) hi = v }
            val span = max(1e-6f, hi - lo)
            val mp = IntArray(S * S) { i -> val a = (((d0.get(i) - lo) / span) * 255f).toInt().coerceIn(0, 255); (a shl 24) or 0xFFFFFF }
            val mask = Bitmap.createScaledBitmap(Bitmap.createBitmap(mp, S, S, Bitmap.Config.ARGB_8888), src.width, src.height, true)
            val n = src.width * src.height
            val sp = IntArray(n); src.getPixels(sp, 0, src.width, 0, 0, src.width, src.height)
            val ma = IntArray(n); mask.getPixels(ma, 0, src.width, 0, 0, src.width, src.height)
            for (i in 0 until n) {
                val a = (ma[i] ushr 24) and 0xFF
                if (white) {
                    val t = a / 255f
                    val r = (((sp[i] shr 16) and 0xFF) * t + 255 * (1 - t)).toInt()
                    val g = (((sp[i] shr 8) and 0xFF) * t + 255 * (1 - t)).toInt()
                    val b = ((sp[i] and 0xFF) * t + 255 * (1 - t)).toInt()
                    sp[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                } else sp[i] = (a shl 24) or (sp[i] and 0xFFFFFF)
            }
            val result = Bitmap.createBitmap(sp, src.width, src.height, Bitmap.Config.ARGB_8888)
            val o = JSObject()
            o.put("imageBase64", encode(result, png = !white))
            call.resolve(o)
        }
    }

    private fun boxBlur(a: FloatArray, side: Int, r: Int): FloatArray {
        val tmp = FloatArray(a.size); val out = FloatArray(a.size)
        for (y in 0 until side) for (x in 0 until side) {
            var s = 0f; var c = 0
            for (k in max(0, x - r)..min(side - 1, x + r)) { s += a[y * side + k]; c++ }
            tmp[y * side + x] = s / c
        }
        for (x in 0 until side) for (y in 0 until side) {
            var s = 0f; var c = 0
            for (k in max(0, y - r)..min(side - 1, y + r)) { s += tmp[k * side + x]; c++ }
            out[y * side + x] = s / c
        }
        return out
    }
}
