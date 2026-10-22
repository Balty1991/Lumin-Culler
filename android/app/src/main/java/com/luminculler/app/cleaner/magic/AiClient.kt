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
enum class AiJob(val wire: String) { Alive("alive"), Style("style"), Restore("restore"), Edit("edit") }

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

    suspend fun download(url: String, target: File): File = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20_000
        c.readTimeout = 60_000
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

    private fun encode(image: Bitmap): String {
        val longest = maxOf(image.width, image.height)
        val scaled = if (longest > MAX_SIDE) {
            val f = MAX_SIDE.toFloat() / longest
            Bitmap.createScaledBitmap(image, (image.width * f).toInt(), (image.height * f).toInt(), true)
        } else image
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 86, out)
        if (scaled !== image) scaled.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun request(method: String, url: String, body: String?): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 20_000
        c.readTimeout = 60_000
        c.setRequestProperty("content-type", "application/json")
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
    }
}
