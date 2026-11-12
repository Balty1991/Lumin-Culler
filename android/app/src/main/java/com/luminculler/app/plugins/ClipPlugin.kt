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
/** Textul: sentence-transformers clip-ViT-B-32-multilingual-v1 (Apache-2.0), aliniat cu CLIP ViT-B/32; ~135 MB int8. */
private const val TEXT_FILE = "clip_multilingual_text_q.onnx"
private const val VOCAB_FILE = "clip_multilingual_vocab.txt"
private const val TEXT_BASE = "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/resolve/main"
private const val TEXT_MIN_BYTES = 120_000_000L
private const val MAX_TOKENS = 64
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
    private val executor = pluginExecutor("Clip", fundal = true)
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var textSession: OrtSession? = null
    private var vocab: Map<String, Int>? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { session?.close() }
        runCatching { textSession?.close() }
        session = null
        textSession = null
        super.handleOnDestroy()
    }

    private fun modelFile(): File = File(context.filesDir, CLIP_FILE)
    private fun ready(): Boolean = modelFile().length() > CLIP_MIN_BYTES

    /**
     * Wi-Fi sau cablu, chiar dacă Android le marchează „contorizate”
     * (Xiaomi și unele rețele de acasă). Raportat: Wi-Fi activ, iar fereastra
     * de după instalare zice să descarci când ai Wi-Fi. Datele mobile rămân blocate
     * cât omul a ales „Doar pe Wi-Fi”.
     */
    private fun unmetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return true
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun session(): OrtSession {
        session?.let { return it }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
        // Din fișier, nu din memorie: 89 MB citiți în heap ar fi riscul de OOM.
        return e.createSession(modelFile().absolutePath, opts).also { session = it }
    }

    private fun textReady(): Boolean =
        File(context.filesDir, TEXT_FILE).length() > TEXT_MIN_BYTES && File(context.filesDir, VOCAB_FILE).length() > 500_000

    /** Descarcă, cu progres către JS (evenimentul „progress”), ca omul să vadă că se întâmplă ceva. */
    private fun download(url: String, dest: File, minBytes: Long, what: String = "text") {
        ModelDownload.fetch(url, dest, minBytes) { loaded, total ->
            val ev = JSObject()
            ev.put("what", what); ev.put("loaded", loaded.toDouble()); ev.put("total", total.toDouble())
            notifyListeners("progress", ev)
        }
    }

    @PluginMethod
    fun available(call: PluginCall) {
        val out = JSObject()
        out.put("ready", ready())
        out.put("textReady", textReady())
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
                download(CLIP_URL, modelFile(), CLIP_MIN_BYTES, "vision")
            }
            out.put("ready", ready())
            call.resolve(out)
        }
    }

    /** Cât de puternic e telefonul: { ramMb } — pentru a alege cât de grele sunt trecerile din fundal. */
    @PluginMethod
    fun device(call: PluginCall) {
        call.resolve(JSObject().put("ramMb", totalRamMb(context)))
    }

    /** Ce modele sunt deja pe telefon: { files: { nume: octeți } } (toate .onnx și .json din spațiul aplicației). */
    @PluginMethod
    fun files(call: PluginCall) {
        val out = JSObject()
        val map = JSObject()
        context.filesDir.listFiles()?.forEach { f -> if (f.isFile && (f.name.endsWith(".onnx") || f.name.endsWith(".json") || f.name.endsWith(".txt") || f.name.endsWith(".tflite"))) map.put(f.name, f.length()) }
        out.put("files", map)
        call.resolve(out)
    }

    /**
     * Descarcă un model oarecare (motoarele din Setări → „Descarcă tot”), cu progres.
     * Doar de la Hugging Face și doar nume simple de fișier, ca să nu poată scrie altundeva.
     */
    @PluginMethod
    fun fetchModel(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val name = call.getString("file") ?: ""
        val min = (call.getDouble("min") ?: 1_000_000.0).toLong()
        if (!url.startsWith("https://huggingface.co/") || !Regex("^[a-z0-9_.-]+$").matches(name)) { call.reject("model nepermis"); return }
        executor.ruleaza(call, "Descărcarea a eșuat") {
            val dest = File(context.filesDir, name)
            if (dest.length() <= min) download(url, dest, min, name)
            val o = JSObject(); o.put("ok", dest.length() > min); call.resolve(o)
        }
    }

    /** Descarcă modelul de text (căutarea în cuvinte, în orice limbă). Implicit doar pe Wi-Fi. */
    @PluginMethod
    fun prepareText(call: PluginCall) {
        executor.ruleaza(call, "Modelul de căutare nu s-a putut descărca") {
            val out = JSObject()
            if (!textReady()) {
                if (call.getBoolean("anyNetwork") != true && !unmetered(context)) {
                    out.put("ready", false); out.put("reason", "metered"); call.resolve(out); return@ruleaza
                }
                val v = File(context.filesDir, VOCAB_FILE)
                if (v.length() <= 500_000) download("$TEXT_BASE/vocab.txt", v, 500_000)
                val m = File(context.filesDir, TEXT_FILE)
                if (m.length() <= TEXT_MIN_BYTES) download("$TEXT_BASE/onnx/model_qint8_arm64.onnx", m, TEXT_MIN_BYTES)
            }
            out.put("ready", textReady())
            call.resolve(out)
        }
    }

    /** { text } → { pooled: number[768] } — media stării finale; stratul Dense se aplică în JS. */
    @PluginMethod
    fun embedText(call: PluginCall) {
        executor.ruleaza(call, "Căutarea a eșuat") {
            if (!textReady()) { call.reject("Modelul de căutare nu e descărcat"); return@ruleaza }
            val text = call.getString("text") ?: ""
            val ids = tokenize(text)
            val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
            val s = textSession ?: e.createSession(File(context.filesDir, TEXT_FILE).absolutePath,
                OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }).also { textSession = it }
            val n = ids.size.toLong()
            val idT = OnnxTensor.createTensor(e, java.nio.LongBuffer.wrap(ids.map { it.toLong() }.toLongArray()), longArrayOf(1, n))
            val mT = OnnxTensor.createTensor(e, java.nio.LongBuffer.wrap(LongArray(ids.size) { 1L }), longArrayOf(1, n))
            idT.use { mT.use {
                val feeds = HashMap<String, OnnxTensor>()
                for (name in s.inputNames) when (name) {
                    "input_ids" -> feeds[name] = idT
                    "attention_mask" -> feeds[name] = mT
                }
                s.run(feeds).use { res ->
                    @Suppress("UNCHECKED_CAST")
                    val h = (res[0].value as Array<Array<FloatArray>>)[0]
                    val dim = h[0].size
                    val pooled = DoubleArray(dim)
                    for (row in h) for (j in 0 until dim) pooled[j] += row[j].toDouble()
                    val arr = JSArray()
                    for (j in 0 until dim) arr.put(pooled[j] / h.size)
                    val out = JSObject()
                    out.put("pooled", arr)
                    call.resolve(out)
                }
            } }
        }
    }

    private fun loadVocab(): Map<String, Int> {
        vocab?.let { return it }
        val map = HashMap<String, Int>(130_000)
        File(context.filesDir, VOCAB_FILE).bufferedReader().useLines { lines ->
            lines.forEachIndexed { i, line -> map[line] = i }
        }
        return map.also { vocab = it }
    }

    /** BERT WordPiece, varianta „cased” (fără litere mici, cu diacritice), ca tokenizer-ul modelului. */
    private fun tokenize(text: String): List<Int> {
        val v = loadVocab()
        val unk = v["[UNK]"] ?: 100
        val out = ArrayList<Int>()
        out.add(v["[CLS]"] ?: 101)
        val words = ArrayList<String>()
        val sb = StringBuilder()
        fun flush() { if (sb.isNotEmpty()) { words.add(sb.toString()); sb.setLength(0) } }
        for (ch in text) {
            when {
                ch.isWhitespace() -> flush()
                ch.code == 0 || ch.code == 0xFFFD || Character.isISOControl(ch) -> {}
                isPunct(ch) || isCjk(ch) -> { flush(); words.add(ch.toString()) }
                else -> sb.append(ch)
            }
        }
        flush()
        for (w in words) {
            if (out.size >= MAX_TOKENS - 1) break
            if (w.length > 100) { out.add(unk); continue }
            var start = 0
            val pieces = ArrayList<Int>()
            var bad = false
            while (start < w.length) {
                var end = w.length
                var cur: Int? = null
                while (start < end) {
                    val sub = (if (start > 0) "##" else "") + w.substring(start, end)
                    val id = v[sub]
                    if (id != null) { cur = id; break }
                    end--
                }
                if (cur == null) { bad = true; break }
                pieces.add(cur); start = end
            }
            if (bad) out.add(unk) else out.addAll(pieces)
        }
        while (out.size > MAX_TOKENS - 1) out.removeAt(out.size - 1)
        out.add(v["[SEP]"] ?: 102)
        return out
    }

    private fun isPunct(c: Char): Boolean {
        val cp = c.code
        if ((cp in 33..47) || (cp in 58..64) || (cp in 91..96) || (cp in 123..126)) return true
        val t = Character.getType(c)
        return t == Character.CONNECTOR_PUNCTUATION.toInt() || t == Character.DASH_PUNCTUATION.toInt() ||
            t == Character.START_PUNCTUATION.toInt() || t == Character.END_PUNCTUATION.toInt() ||
            t == Character.INITIAL_QUOTE_PUNCTUATION.toInt() || t == Character.FINAL_QUOTE_PUNCTUATION.toInt() ||
            t == Character.OTHER_PUNCTUATION.toInt()
    }

    private fun isCjk(c: Char): Boolean {
        val cp = c.code
        return (cp in 0x4E00..0x9FFF) || (cp in 0x3400..0x4DBF) || (cp in 0xF900..0xFAFF)
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
