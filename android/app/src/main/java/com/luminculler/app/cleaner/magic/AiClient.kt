package com.luminculler.app.cleaner.magic

import android.graphics.Bitmap
import android.util.Base64
import com.luminculler.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Efectele „super”, pe serverul Lumin (server/). */
enum class AiJob(val wire: String) { Alive("alive"), Style("style"), Restore("restore"), Edit("edit"), Background("background"), Describe("describe"), Caption("caption"), Greeting("greeting") }

/** Stilurile AI de pe server; id-urile sunt cele din server/src/logic.ts. */
enum class AiStyle(val wire: String) { Cartoon3d("cartoon3d"), Anime("anime"), Oil("oil"), Watercolor("watercolor"), Sketch("sketch"), Vintage("vintage") }

class AiException(val code: String) : Exception(code)

/**
 * Vorbește cu serverul de efecte AI: trimite poza (JPEG micșorat, fără EXIF,
 * deci fără locație), așteaptă rezultatul și îl descarcă. Fără bibliotecă de
 * rețea în plus: HttpURLConnection ajunge pentru trei cereri JSON.
 */
class AiClient(private val base: String = BuildConfig.LUMIN_AI_URL.trimEnd('/')) {
    val enabled: Boolean get() = base.isNotEmpty()

    /** Pornește lucrarea și o urmărește până la capăt. Întoarce adresa rezultatului. */
    suspend fun run(job: AiJob, image: Bitmap, installId: String, style: AiStyle? = null, prompt: String? = null, onWaiting: (Int) -> Unit = {}): Pair<String, String> =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("kind", job.wire)
                .put("image", encode(image))
                .put("installId", installId)
            style?.let { body.put("style", it.wire) }
            prompt?.let { body.put("prompt", it) }
            val created = request("POST", "$base/v1/jobs", body.toString())
            val id = created.optString("id").ifEmpty { throw AiException(created.optString("error", "server")) }
            var seconds = 0
            // Un clip durează de obicei 1–3 minute, o poză câteva secunde; ne oprim la 6 minute.
            while (seconds < 360) {
                delay(3000)
                seconds += 3
                onWaiting(seconds)
                val st = request("GET", "$base/v1/jobs/$id", null)
                when (st.optString("status")) {
                    "done" -> return@withContext id to st.getString("url")
                    "failed" -> throw AiException("failed")
                }
            }
            throw AiException("timeout")
        }

    /**
     * Ce efecte poate face serverul acum (fără cheie fal.ai, doar stilurile,
     * gratuit pe Workers AI). Gol dacă serverul nu răspunde.
     */
    suspend fun capabilities(): Set<AiJob> = withContext(Dispatchers.IO) {
        if (!enabled) return@withContext emptySet()
        try {
            val arr = request("GET", "$base/v1/capabilities", null).optJSONArray("kinds") ?: return@withContext emptySet()
            (0 until arr.length()).mapNotNull { i -> AiJob.entries.firstOrNull { it.wire == arr.optString(i) } }.toSet()
        } catch (_: Throwable) {
            emptySet()
        }
    }

    /**
     * Un decor nou, desenat de AI după ce a scris omul (în limba lui), fără
     * oameni în el: persoana decupată pe telefon se pune apoi peste.
     */
    suspend fun background(prompt: String, width: Int, height: Int, installId: String): Bitmap = withContext(Dispatchers.IO) {
        val body = JSONObject().put("prompt", prompt).put("width", width).put("height", height).put("installId", installId)
        val r = request("POST", "$base/v1/background", body.toString(), readTimeoutMs = 120_000)
        val bytes = Base64.decode(r.optString("image"), Base64.DEFAULT)
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw AiException("decode")
    }

    /**
     * Texte scrise de AI din câteva poze mici: titlul și fraza unei amintiri
     * ([AiJob.Describe]), trei texte de postare ([AiJob.Caption]) sau trei
     * felicitări ([AiJob.Greeting]). Pozele pleacă micșorate la 384 px.
     */
    suspend fun describe(kind: AiJob, images: List<Bitmap>, lang: String, context: String, installId: String): JSONObject = withContext(Dispatchers.IO) {
        val arr = org.json.JSONArray()
        for (im in images.take(4)) arr.put(encode(im, 384, 80))
        val body = JSONObject().put("kind", kind.wire).put("images", arr).put("lang", lang).put("context", context).put("installId", installId)
        request("POST", "$base/v1/describe", body.toString(), readTimeoutMs = 120_000)
    }

    suspend fun download(url: String, target: File): File = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20_000
        c.readTimeout = 60_000
        c.setRequestProperty("user-agent", USER_AGENT)
        try {
            if (c.responseCode !in 200..299) throw AiException("download")
            c.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
            target
        } finally {
            c.disconnect()
        }
    }

    suspend fun report(id: String, reason: String) = withContext(Dispatchers.IO) {
        try { request("POST", "$base/v1/report", JSONObject().put("id", id).put("reason", reason).toString()) } catch (_: Throwable) { }
    }

    private fun encode(image: Bitmap, maxSide: Int = MAX_SIDE, quality: Int = 86): String {
        val longest = maxOf(image.width, image.height)
        val scaled = if (longest > maxSide) {
            val f = maxSide.toFloat() / longest
            Bitmap.createScaledBitmap(image, (image.width * f).toInt(), (image.height * f).toInt(), true)
        } else image
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (scaled !== image) scaled.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun request(method: String, url: String, body: String?, readTimeoutMs: Int = 60_000): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 20_000
        c.readTimeout = readTimeoutMs
        c.setRequestProperty("content-type", "application/json")
        // Cloudflare respinge clienții fără un user-agent recunoscut (eroarea 1010).
        c.setRequestProperty("user-agent", USER_AGENT)
        try {
            if (body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            val json = try { JSONObject(text) } catch (_: Throwable) { JSONObject() }
            if (code == 429) throw AiException(json.optString("error", "daily_limit"))
            if (code !in 200..299) throw AiException(json.optString("error", "server"))
            return json
        } finally {
            c.disconnect()
        }
    }

    companion object {
        const val MAX_SIDE = 1280
        val USER_AGENT = "Lumin-Android/${BuildConfig.VERSION_NAME}"
    }
}
