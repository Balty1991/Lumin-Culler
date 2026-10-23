package com.luminculler.app.cleaner.search

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import android.util.Base64
import android.util.Half
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.grow.decodeOriented
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.Normalizer

/** Un lucru care se poate căuta: numele în engleză (pentru model), cuvintele românești și vectorul lui. */
class Concept(val en: String, val words: List<String>, val vector: FloatArray)

/**
 * Căutarea în poze cu cuvinte, pe telefon: partea de imagine a lui CLIP
 * (OpenAI, MIT; export ONNX cuantizat) dă fiecărei poze un vector, o singură
 * dată, ținut minte într-un fișier. Cuvintele au vectorii gata calculați la
 * build (assets/clip_vocab.json, vezi tools/build_clip_vocab.py). Nicio poză
 * nu pleacă de pe telefon.
 */
class ClipIndex(private val context: Context) {
    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private val sessionLazy = lazy { env.createSession(context.assets.open(MODEL).use { it.readBytes() }, OrtSession.SessionOptions()) }
    private val session: OrtSession by sessionLazy
    private val file = File(context.filesDir, "clip_index.bin")
    private val vectors = HashMap<Long, ShortArray>()
    private var loaded = false

    val concepts: List<Concept> by lazy {
        try {
            val o = JSONObject(context.assets.open(VOCAB).bufferedReader().use { it.readText() })
            val arr = o.getJSONArray("items")
            List(arr.length()) { i ->
                val it = arr.getJSONObject(i)
                val raw = Base64.decode(it.getString("v"), Base64.DEFAULT)
                val sb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                val v = FloatArray(sb.remaining()) { k -> Half.toFloat(sb.get(k)) }
                val ro = it.getJSONArray("ro")
                Concept(it.getString("en"), List(ro.length()) { k -> fold(ro.getString(k)) }, v)
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    val available: Boolean get() = concepts.isNotEmpty() && try { context.assets.open(MODEL).close(); true } catch (_: Throwable) { false }

    fun indexed(): Int = synchronized(vectors) { load(); vectors.size }

    private fun load() {
        if (loaded) return
        loaded = true
        if (!file.exists()) return
        try {
            DataInputStream(file.inputStream().buffered()).use { inp ->
                val dim = inp.readInt()
                val n = inp.readInt()
                repeat(n) {
                    val id = inp.readLong()
                    vectors[id] = ShortArray(dim) { inp.readShort() }
                }
            }
        } catch (_: Throwable) {
            vectors.clear()
        }
    }

    private fun save() {
        val snapshot = synchronized(vectors) { HashMap(vectors) }
        val tmp = File(file.parentFile, "clip_index.tmp")
        DataOutputStream(tmp.outputStream().buffered()).use { out ->
            out.writeInt(DIM)
            out.writeInt(snapshot.size)
            for ((id, v) in snapshot) {
                out.writeLong(id)
                for (x in v) out.writeShort(x.toInt())
            }
        }
        tmp.renameTo(file)
    }

    /** Vectorul unei poze: tăiată pe centru la 224×224, normalizată ca la antrenarea lui CLIP. */
    private fun embed(src: Bitmap): FloatArray {
        val s = 224f / minOf(src.width, src.height)
        val w = (src.width * s).toInt()
        val h = (src.height * s).toInt()
        val crop = Bitmap.createBitmap(224, 224, Bitmap.Config.ARGB_8888)
        Canvas(crop).drawBitmap(src, null, Rect((224 - w) / 2, (224 - h) / 2, (224 - w) / 2 + w, (224 - h) / 2 + h), Paint(Paint.FILTER_BITMAP_FLAG))
        val px = IntArray(224 * 224)
        crop.getPixels(px, 0, 224, 0, 0, 224, 224)
        crop.recycle()
        val plane = 224 * 224
        val buf = ByteBuffer.allocateDirect(3 * plane * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        for (k in 0 until plane) {
            val p = px[k]
            buf.put(k, (((p shr 16) and 0xFF) / 255f - 0.48145466f) / 0.26862954f)
            buf.put(plane + k, (((p shr 8) and 0xFF) / 255f - 0.4578275f) / 0.26130258f)
            buf.put(2 * plane + k, ((p and 0xFF) / 255f - 0.40821073f) / 0.27577711f)
        }
        val out = synchronized(this) {
            OnnxTensor.createTensor(env, buf, longArrayOf(1, 3, 224, 224)).use { t ->
                session.run(mapOf(session.inputNames.first() to t)).use { r ->
                    val o = (r.get("image_embeds").orElse(r.get(0)) as OnnxTensor).floatBuffer
                    FloatArray(o.remaining()).also { o.get(it) }
                }
            }
        }
        return normalize(out)
    }

    /** Trece prin pozele încă necunoscute, în fundal; salvează din când în când. */
    suspend fun scan(photos: List<Media>, onProgress: (done: Int, total: Int) -> Unit) = withContext(Dispatchers.Default) {
        synchronized(vectors) { load() }
        val todo = photos.filter { synchronized(vectors) { it.id !in vectors } }.sortedByDescending { it.taken }
        var done = 0
        for (m in todo) {
            ensureActive()
            val bmp = decodeOriented(context, Uri.parse(m.uri), 320)
            if (bmp != null) {
                try {
                    val v = embed(bmp)
                    synchronized(vectors) { vectors[m.id] = ShortArray(v.size) { Half.toHalf(v[it]) } }
                } catch (_: Throwable) {
                } finally {
                    bmp.recycle()
                }
            }
            done++
            if (done % 50 == 0 || done == todo.size) onProgress(done, todo.size)
            if (done % 300 == 0) save()
        }
        if (todo.isNotEmpty()) save()
    }

    /** Conceptele numite în text (în română sau engleză, fără diacritice). */
    fun match(query: String): List<Concept> {
        val q = fold(query)
        if (q.length < 2) return emptyList()
        val words = q.split(' ').filter { it.length >= 3 }
        return concepts.filter { c ->
            fold(c.en) == q || c.words.any { w -> q.contains(w) || (w.length >= 4 && words.any { it == w || (it.length >= 5 && w.startsWith(it)) }) }
        }.take(3)
    }

    /** Pozele cele mai apropiate de conceptele date, cele mai potrivite primele. */
    fun search(concepts: List<Concept>, limit: Int = 120): List<Pair<Long, Float>> {
        if (concepts.isEmpty()) return emptyList()
        val q = FloatArray(concepts[0].vector.size)
        for (c in concepts) for (i in q.indices) q[i] += c.vector[i]
        val qn = normalize(q)
        val scored = synchronized(vectors) {
            load()
            vectors.map { (id, v) ->
                var s = 0f
                for (i in qn.indices) s += qn[i] * Half.toFloat(v[i])
                id to s
            }
        }.sortedByDescending { it.second }
        if (scored.isEmpty()) return emptyList()
        // CLIP dă similarități mici (0,2–0,35); păstrăm ce e aproape de cel mai bun rezultat.
        val best = scored.first().second
        return scored.takeWhile { it.second >= maxOf(MIN_SIM, best - 0.07f) }.take(limit)
    }

    fun close() {
        synchronized(this) { if (sessionLazy.isInitialized()) try { session.close() } catch (_: Throwable) { } }
    }

    companion object {
        const val MODEL = "clip_vision_q.onnx"
        const val VOCAB = "clip_vocab.json"
        const val DIM = 512
        const val MIN_SIM = 0.20f

        private fun normalize(v: FloatArray): FloatArray {
            var s = 0.0
            for (x in v) s += x * x
            val n = kotlin.math.sqrt(s).toFloat().takeIf { it > 0f } ?: 1f
            return FloatArray(v.size) { v[it] / n }
        }

        /** Litere mici, fără diacritice și semne: „Zăpadă!” → „zapada”. */
        fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "").replace(Regex("[^a-z0-9 ]"), " ").replace(Regex(" +"), " ").trim()
    }
}
