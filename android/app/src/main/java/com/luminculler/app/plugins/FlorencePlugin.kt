package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer

private const val FL_BASE = "https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main"
private val FL_FILES = listOf("vision_encoder_int8", "embed_tokens_int8", "encoder_model_int8", "decoder_model_int8")
private val FL_MIN = mapOf("vision_encoder_int8" to 80_000_000L, "embed_tokens_int8" to 30_000_000L, "encoder_model_int8" to 35_000_000L, "decoder_model_int8" to 80_000_000L)
private const val FL_SIDE = 768
/** „What does the image describe?” tokenizat o dată, în CI (tokenizer-ul Florence-2). */
private val PROMPT_IDS = longArrayOf(0, 2264, 473, 5, 2274, 6190, 116, 2)
private const val EOS = 2L
private const val MAX_NEW = 32

/**
 * Descrierea pozei în cuvinte, pe telefon: Florence-2 base (Microsoft, MIT),
 * int8, ~275 MB descărcați o dată de la Hugging Face. „Two cats laying on a
 * pink blanket” — în engleză, pentru căutare (vezi AnalysisRecord.aiDescription).
 * Verificat în CI pe poze COCO: ~2,3 s pe poză pe procesorul serverului.
 */
@CapacitorPlugin(name = "Florence")
class FlorencePlugin : Plugin() {
    private val executor = pluginExecutor("Florence")
    private var env: OrtEnvironment? = null
    private val sessions = HashMap<String, OrtSession>()
    private var vocab: Array<String>? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        release()
        super.handleOnDestroy()
    }

    private fun release() {
        sessions.values.forEach { runCatching { it.close() } }
        sessions.clear()
    }

    private fun file(name: String) = File(context.filesDir, "florence_$name.onnx")
    private fun tokFile() = File(context.filesDir, "florence_tokenizer.json")
    private fun ready() = FL_FILES.all { file(it).length() > FL_MIN[it]!! } && tokFile().length() > 1_000_000

    private fun download(url: String, dest: File, min: Long) {
        ModelDownload.fetch(url, dest, min)
    }

    @PluginMethod
    fun available(call: PluginCall) {
        val o = JSObject(); o.put("ready", ready()); call.resolve(o)
    }

    @PluginMethod
    fun prepare(call: PluginCall) {
        executor.ruleaza(call, "Descrierea nu s-a putut descărca") {
            download("$FL_BASE/tokenizer.json", tokFile(), 1_000_000)
            for (f in FL_FILES) download("$FL_BASE/onnx/$f.onnx", file(f), FL_MIN[f]!!)
            val o = JSObject(); o.put("ready", ready()); call.resolve(o)
        }
    }

    /** Eliberează memoria (~400 MB) după o trecere prin poze. */
    @PluginMethod
    fun close(call: PluginCall) {
        executor.ruleaza(call, "close") { release(); call.resolve() }
    }

    private fun s(name: String): OrtSession {
        sessions[name]?.let { return it }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
        return e.createSession(file(name).absolutePath, opts).also { sessions[name] = it }
    }

    /** id → text: vocabularul BPE pe octeți (ca GPT-2/BART), din tokenizer.json. */
    private fun vocab(): Array<String> {
        vocab?.let { return it }
        val model = JSONObject(tokFile().readText()).getJSONObject("model").getJSONObject("vocab")
        val arr = Array(model.length() + 600) { "" }
        val keys = model.keys()
        while (keys.hasNext()) { val k = keys.next(); val id = model.getInt(k); if (id < arr.size) arr[id] = k }
        return arr.also { vocab = it }
    }

    /** Inversul lui bytes_to_unicode din GPT-2: caracterele vocabularului → octeți. */
    private val byteDecoder: Map<Char, Int> by lazy {
        val bs = ArrayList<Int>()
        bs.addAll(33..126); bs.addAll(161..172); bs.addAll(174..255)
        val cs = ArrayList(bs)
        var n = 0
        for (b in 0..255) if (b !in bs) { bs.add(b); cs.add(256 + n); n++ }
        val m = HashMap<Char, Int>()
        for (i in bs.indices) m[cs[i].toChar()] = bs[i]
        m
    }

    private fun decode(ids: List<Long>): String {
        val v = vocab()
        val bytes = java.io.ByteArrayOutputStream()
        for (id in ids) {
            if (id <= 3) continue // <s>, <pad>, </s>, <unk>
            val tok = v.getOrNull(id.toInt()) ?: continue
            if (tok.startsWith("<") && tok.endsWith(">")) continue
            for (ch in tok) byteDecoder[ch]?.let { bytes.write(it) }
        }
        return String(bytes.toByteArray(), Charsets.UTF_8).trim()
    }

    @Suppress("UNCHECKED_CAST")
    private fun embed(ids: LongArray): Array<FloatArray> {
        val e = env!!
        OnnxTensor.createTensor(e, LongBuffer.wrap(ids), longArrayOf(1, ids.size.toLong())).use { t ->
            s("embed_tokens_int8").run(mapOf("input_ids" to t)).use { r -> return (r[0].value as Array<Array<FloatArray>>)[0] }
        }
    }

    private fun tensor3(rows: Array<FloatArray>): OnnxTensor {
        val dim = rows[0].size
        val buf = FloatBuffer.allocate(rows.size * dim)
        for (r in rows) buf.put(r)
        buf.rewind()
        return OnnxTensor.createTensor(env!!, buf, longArrayOf(1, rows.size.toLong(), dim.toLong()))
    }

    /** { imageUri } → { caption } */
    @PluginMethod
    fun caption(call: PluginCall) {
        executor.ruleaza(call, "Descrierea a eșuat") {
            if (!ready()) { call.reject("Modelul nu e descărcat"); return@ruleaza }
            val src = resolveInputBitmap(context, call) ?: return@ruleaza
            if (env == null) env = OrtEnvironment.getEnvironment()
            val e = env!!
            // 1. Imaginea: 768×768, normalizare ImageNet.
            val img = Bitmap.createScaledBitmap(src, FL_SIDE, FL_SIDE, true)
            val px = IntArray(FL_SIDE * FL_SIDE); img.getPixels(px, 0, FL_SIDE, 0, 0, FL_SIDE, FL_SIDE)
            if (img !== src) img.recycle()
            val plane = FL_SIDE * FL_SIDE
            val buf = FloatBuffer.allocate(3 * plane)
            val mean = floatArrayOf(0.485f, 0.456f, 0.406f); val std = floatArrayOf(0.229f, 0.224f, 0.225f)
            for (i in 0 until plane) {
                val p = px[i]
                buf.put(i, (((p shr 16) and 0xFF) / 255f - mean[0]) / std[0])
                buf.put(plane + i, (((p shr 8) and 0xFF) / 255f - mean[1]) / std[1])
                buf.put(2 * plane + i, ((p and 0xFF) / 255f - mean[2]) / std[2])
            }
            @Suppress("UNCHECKED_CAST")
            val feats = OnnxTensor.createTensor(e, buf, longArrayOf(1, 3, FL_SIDE.toLong(), FL_SIDE.toLong())).use { t ->
                s("vision_encoder_int8").run(mapOf("pixel_values" to t)).use { r -> (r[0].value as Array<Array<FloatArray>>)[0] }
            }
            // 2. Imagine + întrebarea, prin encoder.
            val inputs = feats + embed(PROMPT_IDS)
            val mask = LongArray(inputs.size) { 1L }
            @Suppress("UNCHECKED_CAST")
            val enc = tensor3(inputs).use { it2 ->
                OnnxTensor.createTensor(e, LongBuffer.wrap(mask), longArrayOf(1, mask.size.toLong())).use { m ->
                    s("encoder_model_int8").run(mapOf("inputs_embeds" to it2, "attention_mask" to m)).use { r -> (r[0].value as Array<Array<FloatArray>>)[0] }
                }
            }
            // 3. Decodare lacomă, cuvânt cu cuvânt, fără trigrame repetate.
            val out = arrayListOf(2L)
            tensor3(enc).use { encT ->
                OnnxTensor.createTensor(e, LongBuffer.wrap(mask), longArrayOf(1, mask.size.toLong())).use { m ->
                    for (step in 0 until MAX_NEW) {
                        val logits = tensor3(embed(out.toLongArray())).use { d ->
                            s("decoder_model_int8").run(mapOf("inputs_embeds" to d, "encoder_hidden_states" to encT, "encoder_attention_mask" to m), setOf("logits")).use { r ->
                                @Suppress("UNCHECKED_CAST")
                                val lg = (r[0].value as Array<Array<FloatArray>>)[0]
                                lg[lg.size - 1]
                            }
                        }
                        val banned = HashSet<Int>()
                        if (out.size >= 2) {
                            val a = out[out.size - 2]; val b = out[out.size - 1]
                            for (k in 0 until out.size - 2) if (out[k] == a && out[k + 1] == b) banned.add(out[k + 2].toInt())
                        }
                        var best = -1; var bv = Float.NEGATIVE_INFINITY
                        for (k in logits.indices) if (k !in banned && logits[k] > bv) { bv = logits[k]; best = k }
                        out.add(best.toLong())
                        if (best.toLong() == EOS) break
                    }
                }
            }
            val o = JSObject()
            o.put("caption", decode(out))
            call.resolve(o)
        }
    }
}
