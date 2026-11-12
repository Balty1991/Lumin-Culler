package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.nio.LongBuffer
import java.text.Normalizer

/**
 * Traducerea descrierilor făcute de AI (Florence-2 scrie în engleză) în limba
 * aplicației: OPUS-MT (Helsinki-NLP, Apache-2.0), exportat ONNX de Xenova.
 * Fișierele (encoder, decoder, tokenizer) le descarcă lista de motoare;
 * aici doar le folosim. Totul pe telefon.
 *
 * Tokenizer: SentencePiece Unigram (Viterbi pe scorurile din tokenizer.json),
 * fiecare cuvânt cu prefixul „▁”. Decodare lacomă, fără <pad>, până la </s>.
 */
@CapacitorPlugin(name = "Translate")
class TranslatePlugin : Plugin() {
    private val executor = pluginExecutor("Translate")
    private var env: OrtEnvironment? = null
    private var lang: String? = null
    private var enc: OrtSession? = null
    private var dec: OrtSession? = null
    private var pieces: Array<String> = emptyArray()
    private var scores: FloatArray = FloatArray(0)
    private var index: HashMap<String, Int> = HashMap()
    private var maxLen = 1
    private var startId = 0
    private var padId = 0

    override fun handleOnDestroy() {
        executor.shutdown()
        close()
        super.handleOnDestroy()
    }

    private fun close() {
        runCatching { enc?.close() }; runCatching { dec?.close() }
        enc = null; dec = null; lang = null
    }

    private fun load(l: String) {
        if (lang == l && enc != null) return
        close()
        val dir = context.filesDir
        val fEnc = File(dir, "opusmt_en_${l}_enc.onnx"); val fDec = File(dir, "opusmt_en_${l}_dec.onnx"); val fTok = File(dir, "opusmt_en_${l}_tok.json")
        if (fEnc.length() < 1_000_000 || fDec.length() < 1_000_000 || fTok.length() < 100_000) throw IllegalStateException("model lipsă")
        val vocab = JSONObject(fTok.readText()).getJSONObject("model").getJSONArray("vocab")
        val n = vocab.length()
        pieces = Array(n) { vocab.getJSONArray(it).getString(0) }
        scores = FloatArray(n) { vocab.getJSONArray(it).getDouble(1).toFloat() }
        index = HashMap(n * 2)
        maxLen = 1
        for (i in 0 until n) { index[pieces[i]] = i; if (pieces[i].length > maxLen) maxLen = pieces[i].length }
        padId = index["<pad>"] ?: (n - 1)
        startId = padId // Marian: decoder_start_token_id = pad
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2); addConfigEntry("session.intra_op.allow_spinning", "0") }
        enc = e.createSession(fEnc.absolutePath, opts)
        dec = e.createSession(fDec.absolutePath, opts)
        lang = l
    }

    private fun encode(text: String): LongArray {
        val unk = index["<unk>"] ?: 1
        val out = ArrayList<Long>()
        val norm = Normalizer.normalize(text, Normalizer.Form.NFKC)
        for (w in norm.split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            val s = "▁$w"; val n = s.length
            val best = FloatArray(n + 1) { Float.NEGATIVE_INFINITY }; best[0] = 0f
            val from = IntArray(n + 1) { -1 }; val tok = IntArray(n + 1) { -1 }
            for (i in 0 until n) {
                if (best[i] == Float.NEGATIVE_INFINITY) continue
                for (j in i + 1..minOf(n, i + maxLen)) {
                    val t = index[s.substring(i, j)] ?: continue
                    val v = best[i] + scores[t]
                    if (v > best[j]) { best[j] = v; from[j] = i; tok[j] = t }
                }
                // Caracter necunoscut: <unk> pentru el, ca drumul să continue.
                if (best[i + 1] == Float.NEGATIVE_INFINITY) { best[i + 1] = best[i] - 10f; from[i + 1] = i; tok[i + 1] = unk }
            }
            val ids = ArrayList<Long>(); var j = n
            while (j > 0) { ids.add(tok[j].toLong()); j = from[j] }
            ids.reverse(); out.addAll(ids)
        }
        out.add(0L) // </s>
        return out.toLongArray()
    }

    private fun translateOne(text: String): String {
        val e = env!!; val en = enc!!; val de = dec!!
        val ids = encode(text.take(400))
        val shape = longArrayOf(1, ids.size.toLong())
        val mask = LongArray(ids.size) { 1L }
        OnnxTensor.createTensor(e, LongBuffer.wrap(ids), shape).use { ii ->
        OnnxTensor.createTensor(e, LongBuffer.wrap(mask), shape).use { am ->
            en.run(mapOf("input_ids" to ii, "attention_mask" to am)).use { encOut ->
                val hidden = encOut[0] as OnnxTensor
                val outIds = arrayListOf(startId.toLong())
                for (step in 0 until 48) {
                    OnnxTensor.createTensor(e, LongBuffer.wrap(outIds.toLongArray()), longArrayOf(1, outIds.size.toLong())).use { di ->
                        de.run(mapOf("input_ids" to di, "encoder_hidden_states" to hidden, "encoder_attention_mask" to am), setOf("logits")).use { r ->
                            val fb = (r[0] as OnnxTensor).floatBuffer
                            val vocab = pieces.size
                            val base = (outIds.size - 1) * vocab
                            var best = -1; var bv = Float.NEGATIVE_INFINITY
                            for (k in 0 until vocab) {
                                if (k == padId) continue
                                val v = fb.get(base + k)
                                if (v > bv) { bv = v; best = k }
                            }
                            outIds.add(best.toLong())
                        }
                    }
                    if (outIds.last() == 0L) break
                }
                val sb = StringBuilder()
                for (t in outIds.drop(1)) { val k = t.toInt(); if (k == 0 || k == padId) continue; sb.append(pieces[k]) }
                var s = sb.toString().replace('▁', ' ').trim()
                // Română: virgula de dedesubt, nu sedila (modelul scrie „fetiţă”).
                if (lang == "ro") s = s.replace('ţ', 'ț').replace('ş', 'ș').replace('Ţ', 'Ț').replace('Ş', 'Ș')
                return s
            }
        } }
    }

    /** { lang, texts: [en…] } → { texts: [traduse…] } */
    @PluginMethod
    fun translate(call: PluginCall) {
        val l = call.getString("lang") ?: run { call.reject("lang"); return }
        val texts = call.getArray("texts") ?: JSArray()
        executor.ruleaza(call, "Traducerea n-a mers") {
            load(l)
            val out = JSArray()
            for (i in 0 until texts.length()) out.put(runCatching { translateOne(texts.getString(i)) }.getOrDefault(""))
            call.resolve(JSObject().put("texts", out))
        }
    }

    /** Eliberează memoria (după o trecere în fundal). */
    @PluginMethod
    fun release(call: PluginCall) {
        executor.ruleaza(call, "release") { close(); call.resolve() }
    }
}
