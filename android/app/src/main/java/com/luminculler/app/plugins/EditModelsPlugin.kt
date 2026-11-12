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
private const val MIGAN_URL = "https://huggingface.co/litert-community/MI-GAN-512-Places2-LiteRT/resolve/main/migan_fp16.tflite"
private const val ZERODCE_FILE = "zerodce_512_fp16.tflite"
private const val SIDE = 512
private const val ESRGAN_FILE = "realesr_general_x4v3.tflite"
private const val U2NET_FILE = "u2netp.tflite"
/** Claritate și decupaj: nu mai intră în APK (−10 MB); se descarcă la prima folosire. */
private val DOWNLOADS = mapOf(
    ESRGAN_FILE to ("https://huggingface.co/litert-community/real-esrgan-x4v3-litert/resolve/main/realesr_general_x4v3.tflite" to 2_000_000L),
    U2NET_FILE to ("https://huggingface.co/abhimanyu666/u2nettflite/resolve/main/u2netp.tflite" to 3_000_000L)
)
/** LaMa (Samsung/Carve, Apache-2.0, ~208 MB): guma pentru obiecte mari; descărcată doar pe Wi-Fi. */
private const val LAMA_FILE = "lama_fp32.onnx"
private const val LAMA_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
private const val LAMA_MIN = 200_000_000L
/** Peste această parte ștearsă din bucată, LaMa umple mai curat decât MI-GAN. */
private const val LAMA_FROM = 0.06f
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
    /** Sub atâtea px pe latura mare poza e „mică” și primește Real-ESRGAN. */
    private val SMALL_PHOTO = 1200
    private val ESRGAN_MIX = 0.6f
    /** Descărcarea mare stă pe firul ei, ca guma să meargă între timp. */
    private val downloader = pluginExecutor("EditModels-dl")
    private var ortEnv: ai.onnxruntime.OrtEnvironment? = null
    private var lama: ai.onnxruntime.OrtSession? = null

    private fun lamaFile() = java.io.File(context.filesDir, LAMA_FILE)
    private fun lamaReady() = lamaFile().length() > LAMA_MIN

    private fun unmetered(): Boolean {
        val cm = context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    /** Pornește în fundal descărcarea LaMa (doar pe Wi-Fi, o singură dată). */
    @PluginMethod
    fun prepareLama(call: PluginCall) {
        val out = JSObject()
        out.put("ready", lamaReady())
        call.resolve(out)
        if (lamaReady() || totalRamMb(context) < 5000) return
        downloader.execute {
            // Firul `downloader` e unul singur, deci două descărcări nu se suprapun. Bucata deja
            // luată (.part) rămâne: data viitoare se continuă de acolo, nu de la zero.
            runCatching { ModelDownload.fetch(LAMA_URL, lamaFile(), LAMA_MIN) }
        }
    }

    /** LaMa pe 512×512: imagine 0..1, mască 1 = de umplut; ieșire 0..255. Null dacă nu se poate. */
    private fun runLama(px: IntArray, grown: BooleanArray): IntArray? = runCatching {
        val e = ortEnv ?: ai.onnxruntime.OrtEnvironment.getEnvironment().also { ortEnv = it }
        val s = lama ?: e.createSession(lamaFile().absolutePath, ai.onnxruntime.OrtSession.SessionOptions().apply { setIntraOpNumThreads(4) }).also { lama = it }
        val plane = SIDE * SIDE
        val img = java.nio.FloatBuffer.allocate(3 * plane)
        val msk = java.nio.FloatBuffer.allocate(plane)
        for (i in 0 until plane) {
            img.put(i, ((px[i] shr 16) and 0xFF) / 255f)
            img.put(plane + i, ((px[i] shr 8) and 0xFF) / 255f)
            img.put(2 * plane + i, (px[i] and 0xFF) / 255f)
            msk.put(i, if (grown[i]) 1f else 0f)
        }
        ai.onnxruntime.OnnxTensor.createTensor(e, img, longArrayOf(1, 3, SIDE.toLong(), SIDE.toLong())).use { iT ->
            ai.onnxruntime.OnnxTensor.createTensor(e, msk, longArrayOf(1, 1, SIDE.toLong(), SIDE.toLong())).use { mT ->
                s.run(mapOf("image" to iT, "mask" to mT)).use { r ->
                    @Suppress("UNCHECKED_CAST")
                    val o = (r[0].value as Array<Array<Array<FloatArray>>>)[0]
                    IntArray(plane) { i ->
                        if (!grown[i]) px[i] else {
                            val y = i / SIDE; val x = i % SIDE
                            val rr = o[0][y][x].toInt().coerceIn(0, 255)
                            val gg = o[1][y][x].toInt().coerceIn(0, 255)
                            val bb = o[2][y][x].toInt().coerceIn(0, 255)
                            (0xFF shl 24) or (rr shl 16) or (gg shl 8) or bb
                        }
                    }
                }
            }
        }
    }.getOrElse {
        // Fără memorie sau model stricat: închidem sesiunea și rămânem pe MI-GAN.
        runCatching { lama?.close() }; lama = null
        null
    }

    private fun interpreter(name: String): Interpreter {
        val bytes = when {
            name == MIGAN_FILE -> modelBytes(name, 10_000_000)
            DOWNLOADS.containsKey(name) -> modelBytes(name, DOWNLOADS.getValue(name).second)
            else -> context.assets.open(name).use { it.readBytes() }
        }
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
        downloader.shutdown()
        runCatching { lama?.close() }
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
        // MI-GAN direct de pe Hugging Face (ca restul motoarelor); celelalte, de pe site.
        val url = if (file == MIGAN_FILE) MIGAN_URL else DOWNLOADS[file]?.first ?: "$MODELS_URL/$file"
        ModelDownload.fetch(url, f, minSize)
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
        out.put("clarity", true) // din APK, din cache sau descărcat la prima folosire
        out.put("cutout", true)
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
            val share = grown.count { it }.toFloat() / plane
            // Pe telefoanele cu puțină memorie LaMa (~1 GB în lucru) ar închide aplicația: rămâne MI-GAN.
            val viaLama = if (share >= LAMA_FROM && totalRamMb(context) >= 5000 && lamaReady()) runLama(px, grown) else null
            if (viaLama != null) {
                val back = Bitmap.createScaledBitmap(Bitmap.createBitmap(viaLama, SIDE, SIDE, Bitmap.Config.ARGB_8888), w, h, true)
                val o = JSObject()
                o.put("imageBase64", encode(back, png = true))
                o.put("width", w); o.put("height", h); o.put("engine", "lama")
                call.resolve(o)
                return@ruleaza
            }
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
        val uri = call.getString("imageUri")
        if (img64.isNullOrEmpty() && uri.isNullOrEmpty()) { call.reject("imageBase64 or imageUri is required"); return }
        val inSide = (call.getInt("inSide") ?: 640).coerceIn(128, 900)
        val outSide = (call.getInt("outSide") ?: 2048).coerceIn(256, 3200)
        // Puțin / Mediu / Mult din ecran: 0,4 / 0,7 / 1.
        val strength = ((call.getDouble("strength") ?: 0.7).toFloat()).coerceIn(0.1f, 1.2f)
        executor.ruleaza(call, "Clarity failed") {
            // Originalul direct din galerie, nu o copie mică trimisă ca text.
            if (!uri.isNullOrEmpty() && call.getInt("maxSide") == null) call.data.put("maxSide", outSide)
            val full = if (!uri.isNullOrEmpty()) (resolveInputBitmap(context, call) ?: return@ruleaza) else decode(img64!!)
            // Raportat: „prea glow, fața și dinții par sparți”. Real-ESRGAN pe o copie de
            // 640 px inventa detaliul (piele de ceară, dinți rupți) și dura câteva secunde.
            // O poză de telefon are deja detaliul: îl scoatem la iveală, nu-l inventăm.
            // Modelul rămâne doar pentru pozele mici (WhatsApp, capturi vechi).
            val big = max(full.width, full.height)
            val result = if (big >= SMALL_PHOTO) detailClarity(full, outSide, strength) else esrganClarity(full, inSide, outSide, strength)
            val o = JSObject()
            o.put("imageBase64", encode(result))
            call.resolve(o)
        }
    }

    /** Claritate fidelă: detaliul fin (cu prag peste zgomot) + contrast local în tonurile medii. */
    private fun detailClarity(src: Bitmap, outSide: Int, strength: Float = 0.7f): Bitmap {
        val gain = strength / 0.7f
        val k = min(1f, outSide.toFloat() / max(src.width, src.height))
        val b = if (k < 1f) Bitmap.createScaledBitmap(src, max(1, (src.width * k).toInt()), max(1, (src.height * k).toInt()), true) else src
        val w = b.width; val h = b.height; val n = w * h
        val px = IntArray(n); b.getPixels(px, 0, w, 0, 0, w, h)
        val y = FloatArray(n)
        for (i in 0 until n) {
            val p = px[i]
            y[i] = 0.299f * ((p shr 16) and 0xFF) + 0.587f * ((p shr 8) and 0xFF) + 0.114f * (p and 0xFF)
        }
        val side = max(w, h)
        val fine = boxBlur(y, w, h, max(1, side / 700))
        val wide = boxBlur(y, w, h, max(4, side / 50))
        for (i in 0 until n) {
            val yi = y[i]
            val d = yi - fine[i]
            // Sub ~1,5 nivele e zgomot de senzor: nu-l ascuțim.
            val gate = ((kotlin.math.abs(d) - 1.5f) / 3f).coerceIn(0f, 1f)
            val dFine = (d * gate * 0.9f * gain).coerceIn(-12f * gain, 12f * gain)
            // Contrast local doar în tonurile medii: luminile și umbrele rămân curate (fără „glow”).
            val t = (yi - 128f) / 128f
            val dWide = (yi - wide[i]).coerceIn(-30f, 30f) * 0.18f * gain * (1f - t * t)
            val dy = dFine + dWide
            val p = px[i]
            val r = (((p shr 16) and 0xFF) + dy).toInt().coerceIn(0, 255)
            val g = (((p shr 8) and 0xFF) + dy).toInt().coerceIn(0, 255)
            val bl = ((p and 0xFF) + dy).toInt().coerceIn(0, 255)
            px[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
        }
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }

    /** Estompare cutie în două treceri pe fiecare axă (aproape gaussiană), O(n). */
    private fun boxBlur(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        var a = src.copyOf(); var tmp = FloatArray(src.size)
        repeat(2) {
            boxPass(a, tmp, w, h, r, true); boxPass(tmp, a, w, h, r, false)
        }
        return a
    }

    private fun boxPass(inp: FloatArray, out: FloatArray, w: Int, h: Int, r: Int, horizontal: Boolean) {
        val len = if (horizontal) w else h
        val lines = if (horizontal) h else w
        val step = if (horizontal) 1 else w
        val inv = 1f / (2 * r + 1)
        for (l in 0 until lines) {
            val base = if (horizontal) l * w else l
            var sum = 0f
            for (j in -r..r) sum += inp[base + j.coerceIn(0, len - 1) * step]
            for (i in 0 until len) {
                out[base + i * step] = sum * inv
                val add = (i + r + 1).coerceAtMost(len - 1)
                val sub = (i - r).coerceAtLeast(0)
                sum += inp[base + add * step] - inp[base + sub * step]
            }
        }
    }

    /** Poze mici: Real-ESRGAN ×4, amestecat cu mărirea clasică ca să nu inventeze prea mult. */
    private fun esrganClarity(full: Bitmap, inSide: Int, outSide: Int, strength: Float = 0.7f): Bitmap {
        val mix = (ESRGAN_MIX * strength / 0.7f).coerceIn(0.2f, 0.85f)
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
        val fw = max(1, (ow * f).toInt()); val fh = max(1, (oh * f).toInt())
        val model = if (f < 1f) Bitmap.createScaledBitmap(big, fw, fh, true) else big
        val plain = Bitmap.createScaledBitmap(full, fw, fh, true)
        val a = IntArray(fw * fh); model.getPixels(a, 0, fw, 0, 0, fw, fh)
        val c = IntArray(fw * fh); plain.getPixels(c, 0, fw, 0, 0, fw, fh)
        for (i in a.indices) {
            val p = a[i]; val q = c[i]
            val r = (((p shr 16) and 0xFF) * mix + ((q shr 16) and 0xFF) * (1 - mix)).toInt()
            val g = (((p shr 8) and 0xFF) * mix + ((q shr 8) and 0xFF) * (1 - mix)).toInt()
            val b = ((p and 0xFF) * mix + (q and 0xFF) * (1 - mix)).toInt()
            a[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        return Bitmap.createBitmap(a, fw, fh, Bitmap.Config.ARGB_8888)
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
