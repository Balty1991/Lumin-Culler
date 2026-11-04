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
    private var lastDepth: FloatArray? = null
    /** Ultima poză: subiectul și adâncimea, ca schimbarea tăriei/focusului să fie instantă. */
    private var cacheKey: String? = null
    private var cacheMatte: FloatArray? = null
    private var cacheNear: FloatArray? = null
    private var cacheDepth: FloatArray? = null

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
                // Adâncimea brută 0..1 (1 = cel mai aproape), pentru estomparea treptată.
                val dMin = sorted[(sorted.size * 0.02).toInt()]; val dMax = sorted[(sorted.size * 0.98).toInt()]
                val dSpan = max(1e-6f, dMax - dMin)
                lastDepth = FloatArray(flat.size) { i -> ((flat[i] - dMin) / dSpan).coerceIn(0f, 1f) }
                return FloatArray(flat.size) { i -> ((flat[i] - lo) / span).coerceIn(0f, 1f) }
            }
        }
    }

    /** O hartă pătrată (side×side, 0..1) adusă la w×h, biliniar (fără trepte). */
    private fun resizeMap(map: FloatArray, side: Int, w: Int, h: Int): FloatArray {
        val out = FloatArray(w * h)
        val sx = (side - 1).toFloat() / max(1, w - 1); val sy = (side - 1).toFloat() / max(1, h - 1)
        for (y in 0 until h) {
            val fy = y * sy; val y0 = fy.toInt(); val y1 = min(side - 1, y0 + 1); val ty = fy - y0
            for (x in 0 until w) {
                val fx = x * sx; val x0 = fx.toInt(); val x1 = min(side - 1, x0 + 1); val tx = fx - x0
                val a = map[y0 * side + x0] * (1 - tx) + map[y0 * side + x1] * tx
                val b = map[y1 * side + x0] * (1 - tx) + map[y1 * side + x1] * tx
                out[y * w + x] = a * (1 - ty) + b * ty
            }
        }
        return out
    }

    /** Estompare în cutie, separabilă, cu sume glisante: O(n) oricât de mare e raza. */
    private fun boxBlur(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        if (r < 1) return src.copyOf()
        val tmp = FloatArray(src.size); val out = FloatArray(src.size)
        val win = (2 * r + 1).toFloat()
        for (y in 0 until h) {
            val row = y * w
            var acc = 0f
            for (k in -r..r) acc += src[row + k.coerceIn(0, w - 1)]
            for (x in 0 until w) {
                tmp[row + x] = acc / win
                acc += src[row + min(w - 1, x + r + 1)] - src[row + max(0, x - r)]
            }
        }
        for (x in 0 until w) {
            var acc = 0f
            for (k in -r..r) acc += tmp[k.coerceIn(0, h - 1) * w + x]
            for (y in 0 until h) {
                out[y * w + x] = acc / win
                acc += tmp[min(h - 1, y + r + 1) * w + x] - tmp[max(0, y - r) * w + x]
            }
        }
        return out
    }

    /** Trei treceri în cutie ≈ estompare gaussiană (ca o lentilă, nu pătrățele). */
    private fun gauss(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        val r3 = max(1, r / 2)
        return boxBlur(boxBlur(boxBlur(src, w, h, r3), w, h, r3), w, h, r3)
    }

    /**
     * Fundalul estompat FĂRĂ subiect: convoluție normalizată — doar pixelii de
     * fundal intră în medie. Altfel geaca închisă „curge” în fundal și rămâne un
     * contur întunecat în jurul omului (raportat cu captură).
     */
    private fun blurBackground(ch: Array<FloatArray>, bgW: FloatArray, w: Int, h: Int, r: Int): Array<FloatArray> {
        val wb = gauss(bgW, w, h, r)
        return Array(3) { c ->
            val num = FloatArray(w * h) { i -> ch[c][i] * bgW[i] }
            val nb = gauss(num, w, h, r)
            val plain = if (wb.any { it < 0.02f }) gauss(ch[c], w, h, r) else null
            FloatArray(w * h) { i -> if (wb[i] > 0.02f) nb[i] / wb[i] else plain!![i] }
        }
    }

    /** { imageBase64, strength 0..1 } → { imageBase64 (JPEG), subject: "person" | "depth" } */
    @PluginMethod
    fun portrait(call: PluginCall) {
        val b64 = call.getString("imageBase64")
        val uri = call.getString("imageUri")
        if (b64.isNullOrEmpty() && uri.isNullOrEmpty()) { call.reject("imageBase64 or imageUri is required"); return }
        val strength = (call.getDouble("strength") ?: 0.7).toFloat().coerceIn(0.1f, 1f)
        // Unde a atins omul (0..1): acolo e subiectul. Lipsă = alege aplicația.
        val tapX = call.getDouble("focusX")?.toFloat()
        val tapY = call.getDouble("focusY")?.toFloat()
        executor.ruleaza(call, "Portretul nu s-a putut face") {
            // Originalul, direct din galerie (până la 2560 px): raportat „a estompat și fața” —
            // de fapt primea o copie mică, deci tot portretul ieșea neclar.
            val src: Bitmap = if (!uri.isNullOrEmpty()) {
                if (call.getInt("maxSide") == null) call.data.put("maxSide", 2560)
                resolveInputBitmap(context, call) ?: return@ruleaza
            } else {
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { call.reject("imagine invalidă"); return@ruleaza }
            }
            val w = src.width; val h = src.height

            // 1. Cine e subiectul: omul (MODNet) sau ce e aproape (Depth Anything).
            val key = uri ?: "b64:${b64!!.length}:${b64.hashCode()}"
            val matte: FloatArray
            val near: FloatArray
            if (key == cacheKey && cacheMatte != null && cacheNear != null) {
                matte = cacheMatte!!; near = cacheNear!!; lastDepth = cacheDepth
            } else {
                matte = personMatte(src)
                near = nearMap(src) // și umple lastDepth: adâncimea, pentru estomparea treptată
                cacheKey = key; cacheMatte = matte; cacheNear = near; cacheDepth = lastDepth
            }
            val personShare = matte.count { it > 0.5f }.toFloat() / matte.size
            val tapped = tapX != null && tapY != null

            // 2. Lucrăm la ~1280 px: estomparea e moale oricum, iar marginea rămâne la rezoluția plină.
            val k = min(1f, 1280f / max(w, h))
            val ws = max(1, (w * k).roundToInt()); val hs = max(1, (h * k).roundToInt())
            val small = Bitmap.createScaledBitmap(src, ws, hs, true)
            val px = IntArray(ws * hs); small.getPixels(px, 0, ws, 0, 0, ws, hs)
            if (small !== src) small.recycle()
            val ch = Array(3) { c -> FloatArray(ws * hs) { i -> ((px[i] shr (16 - 8 * c)) and 0xFF).toFloat() } }
            val depth01 = lastDepth?.let { resizeMap(it, DEPTH_SIDE, ws, hs) }
            val matteS = resizeMap(matte, MODNET_SIDE, ws, hs)

            // Ce e clar: ca la camerele telefoanelor, PLANUL de focus (după adâncime), nu
            // „omul găsit de MODNet” — acela e făcut pentru un singur om și, în poze cu mai
            // mulți copii, alegea greșit (raportat: fetița din mijloc estompată, balonul clar).
            var focus: FloatArray
            if (depth01 != null) {
                // Adâncimea planului: mediana din jurul punctului de focus (fața principală sau
                // atingerea); fără punct, cel mai apropiat lucru din centrul cadrului.
                val fd: Float = if (tapped) {
                    val cx = (tapX!! * (ws - 1)).roundToInt(); val cy = (tapY!! * (hs - 1)).roundToInt()
                    val r = max(3, (max(ws, hs) * 0.02f).roundToInt())
                    val vals = ArrayList<Float>()
                    for (y in max(0, cy - r)..min(hs - 1, cy + r)) for (x in max(0, cx - r)..min(ws - 1, cx + r)) vals.add(depth01[y * ws + x])
                    vals.sort(); vals[vals.size / 2]
                } else {
                    val vals = ArrayList<Float>()
                    for (y in hs / 4 until hs * 3 / 4 step 2) for (x in ws / 4 until ws * 3 / 4 step 2) {
                        val i = y * ws + x
                        if (personShare <= 0.04f || matteS[i] > 0.5f) vals.add(depth01[i])
                    }
                    if (vals.isEmpty()) 1f else { vals.sort(); vals[(vals.size * 0.85f).toInt().coerceAtMost(vals.size - 1)] }
                }
                val tol = 0.07f
                focus = FloatArray(ws * hs) { i ->
                    val d = kotlin.math.abs(depth01[i] - fd)
                    val t = ((d - tol) / (tol * 1.5f)).coerceIn(0f, 1f)
                    var f = 1f - t * t * (3f - 2f * t)
                    // Oamenii din planul de focus: silueta ține tot corpul clar (mâini, păr).
                    if (matteS[i] > 0.5f && d < 0.16f) f = max(f, matteS[i])
                    f
                }
                // Marginea după imagine (filtru ghidat): conturul urmează părul și hainele,
                // nu pătrățelele hărții de adâncime mărite.
                val gray = FloatArray(ws * hs) { i -> (0.3f * ch[0][i] + 0.59f * ch[1][i] + 0.11f * ch[2][i]) / 255f }
                focus = guidedFilter(gray, focus, ws, hs, max(2, max(ws, hs) / 200), 1e-3f)
                for (i in focus.indices) focus[i] = focus[i].coerceIn(0f, 1f)
            } else {
                focus = matteS
                for (i in focus.indices) {
                    val t = ((focus[i] - 0.3f) / 0.4f).coerceIn(0f, 1f)
                    focus[i] = t * t * (3f - 2f * t)
                }
            }
            val usePerson = personShare > 0.04f

            // 3. Două niveluri de estompare, din fundal fără subiect.
            val bgW = FloatArray(ws * hs) { i -> (1f - focus[i]).let { v -> if (v > 0.5f) 1f else v * v * 2f } }
            val rBig = max(4, (max(ws, hs) * 0.028f * strength).roundToInt())
            val rMid = max(2, rBig / 3)
            // Luminițe ca la obiectiv: punctele foarte luminoase din fundal câștigă greutate
            // înainte de estompare, deci devin pete rotunde luminoase, nu se pierd în gri.
            val lit = Array(3) { c -> FloatArray(ws * hs) { i ->
                val lum = 0.3f * ch[0][i] + 0.59f * ch[1][i] + 0.11f * ch[2][i]
                val hl = ((lum - 200f) / 55f).coerceIn(0f, 1f)
                ch[c][i] * (1f + 1.6f * hl * (1f - focus[i]))
            } }
            // Patru trepte de estompare (ca un obiectiv: crește lin cu distanța, fără salturi
            // între „clar” și „estompat”, care dădeau aspectul de decupaj lipit).
            val radii = intArrayOf(max(1, rBig / 8), max(2, rBig / 4), max(3, rBig / 2), rBig)
            val levels = Array(4) { L -> blurBackground(if (L >= 2) lit else ch, bgW, ws, hs, radii[L]) }

            // 4. Cât se estompează fiecare punct: după distanța față de subiect (ca la lentilă):
            //    pământul de lângă picioare puțin, copacii din spate mult.
            var subjDepth = 0f; var n = 0
            if (depth01 != null) for (i in focus.indices) if (focus[i] > 0.6f) { subjDepth += depth01[i]; n++ }
            subjDepth = if (n > 0) subjDepth / n else 1f
            val layer = IntArray(ws * hs)
            val sharpness = FloatArray(ws * hs)
            for (i in 0 until ws * hs) {
                // Ca la lentilă: în planul subiectului (asfaltul de la picioare) aproape clar,
                // apoi tot mai estompat cu distanța — de jos în sus, fără prag.
                val y = i / ws
                val dist = if (depth01 != null) {
                    val d = kotlin.math.abs(subjDepth - depth01[i]) / max(0.12f, subjDepth)
                    // Pe aceeași adâncime, sus e de obicei mai departe decât jos.
                    (d * 1.4f + 0.15f * (1f - y.toFloat() / hs)).coerceIn(0f, 1f)
                } else (1f - y.toFloat() / hs) * 0.6f + 0.4f
                val eased = dist * dist * (3f - 2f * dist)
                val amount = eased * (1f - focus[i])
                // amount 0..1 → poziție între original (0) și cele 4 trepte (1..4), interpolat.
                val pos = amount * 4f
                val lo = pos.toInt().coerceIn(0, 3)
                val f = (pos - lo).coerceIn(0f, 1f)
                fun pick(c: Int): Int {
                    val a0 = if (lo == 0) ch[c][i] else levels[lo - 1][c][i]
                    val a1 = levels[lo][c][i]
                    return (a0 * (1 - f) + a1 * f).roundToInt().coerceIn(0, 255)
                }
                layer[i] = (0xFF shl 24) or (pick(0) shl 16) or (pick(1) shl 8) or pick(2)
                sharpness[i] = focus[i]
            }

            // 5. Compunerea la rezoluția plină: subiectul din original, fundalul din stratul estompat.
            val blurFull = Bitmap.createScaledBitmap(Bitmap.createBitmap(layer, ws, hs, Bitmap.Config.ARGB_8888), w, h, true)
            val bp = IntArray(w * h); blurFull.getPixels(bp, 0, w, 0, 0, w, h); blurFull.recycle()
            val sp = IntArray(w * h); src.getPixels(sp, 0, w, 0, 0, w, h)
            val alpha = resizeMapRect(sharpness, ws, hs, w, h)
            for (i in 0 until w * h) {
                val a = alpha[i].coerceIn(0f, 1f)
                val r = (((sp[i] shr 16) and 0xFF) * a + ((bp[i] shr 16) and 0xFF) * (1 - a)).toInt()
                val g = (((sp[i] shr 8) and 0xFF) * a + ((bp[i] shr 8) and 0xFF) * (1 - a)).toInt()
                val bl = ((sp[i] and 0xFF) * a + (bp[i] and 0xFF) * (1 - a)).toInt()
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

    /** Media pe o fereastră (2r+1)², prin imagine integrală: O(N), oricât de mare e r. */
    private fun boxMean(a: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        val sw = w + 1
        val integ = DoubleArray(sw * (h + 1))
        for (y in 0 until h) {
            var row = 0.0
            for (x in 0 until w) { row += a[y * w + x]; integ[(y + 1) * sw + x + 1] = integ[y * sw + x + 1] + row }
        }
        val out = FloatArray(w * h)
        for (y in 0 until h) {
            val y0 = max(0, y - r); val y1 = min(h - 1, y + r)
            for (x in 0 until w) {
                val x0 = max(0, x - r); val x1 = min(w - 1, x + r)
                val sum = integ[(y1 + 1) * sw + x1 + 1] - integ[y0 * sw + x1 + 1] - integ[(y1 + 1) * sw + x0] + integ[y0 * sw + x0]
                out[y * w + x] = (sum / ((y1 - y0 + 1) * (x1 - x0 + 1))).toFloat()
            }
        }
        return out
    }

    /** Filtrul ghidat (He et al.): netezește `p` păstrând marginile din `guide`. */
    private fun guidedFilter(guide: FloatArray, p: FloatArray, w: Int, h: Int, r: Int, eps: Float): FloatArray {
        val n = w * h
        val mI = boxMean(guide, w, h, r); val mp = boxMean(p, w, h, r)
        val mIp = boxMean(FloatArray(n) { guide[it] * p[it] }, w, h, r)
        val mII = boxMean(FloatArray(n) { guide[it] * guide[it] }, w, h, r)
        val a = FloatArray(n) { i -> (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps) }
        val b = FloatArray(n) { i -> mp[i] - a[i] * mI[i] }
        val ma = boxMean(a, w, h, r); val mb = boxMean(b, w, h, r)
        return FloatArray(n) { i -> ma[i] * guide[i] + mb[i] }
    }

    /** Ca resizeMap, dar dintr-o hartă dreptunghiulară sw×sh. */
    private fun resizeMapRect(map: FloatArray, sw: Int, sh: Int, w: Int, h: Int): FloatArray {
        val out = FloatArray(w * h)
        val sx = (sw - 1).toFloat() / max(1, w - 1); val sy = (sh - 1).toFloat() / max(1, h - 1)
        for (y in 0 until h) {
            val fy = y * sy; val y0 = fy.toInt(); val y1 = min(sh - 1, y0 + 1); val ty = fy - y0
            for (x in 0 until w) {
                val fx = x * sx; val x0 = fx.toInt(); val x1 = min(sw - 1, x0 + 1); val tx = fx - x0
                val a = map[y0 * sw + x0] * (1 - tx) + map[y0 * sw + x1] * tx
                val b = map[y1 * sw + x0] * (1 - tx) + map[y1 * sw + x1] * tx
                out[y * w + x] = a * (1 - ty) + b * ty
            }
        }
        return out
    }
}
