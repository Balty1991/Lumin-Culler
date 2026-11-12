package com.luminculler.app.plugins

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Descărcarea motoarelor AI, una singură pentru toate plugin-urile.
 *
 * Raportat: „eraserHd: Descărcarea a eșuat: Software caused connection abort”. Fiecare
 * plugin își avea propria descărcare, dintr-o bucată: o singură cădere a rețelei la un
 * fișier de 200 MB o lua de la zero (sau, la LaMa, n-o mai relua deloc). Aici:
 *  - se reia de unde a rămas (cererea HTTP „Range” pe fișierul `.part`);
 *  - până la 5 încercări, cu pauze tot mai lungi (2, 4, 8, 16, 30 s);
 *  - redirecționările Hugging Face → CDN urmate și între domenii.
 */
object ModelDownload {
    fun fetch(url: String, dest: File, minBytes: Long, attempts: Int = 5, onProgress: ((Long, Long) -> Unit)? = null) {
        if (dest.length() > minBytes) return
        val tmp = File(dest.parentFile, dest.name + ".part")
        var last: Exception? = null
        for (attempt in 0 until attempts) {
            try {
                if (once(url, tmp, onProgress)) {
                    if (tmp.length() > minBytes) {
                        dest.delete()
                        if (!tmp.renameTo(dest)) throw IllegalStateException("redenumire eșuată")
                        return
                    }
                    tmp.delete()
                    throw IllegalStateException("fișier trunchiat")
                }
            } catch (e: Exception) {
                last = e
            }
            if (attempt < attempts - 1) Thread.sleep(minOf(30_000L, 2000L shl attempt))
        }
        throw last ?: IllegalStateException("descărcare eșuată")
    }

    /** `true` când fișierul `.part` e complet. */
    private fun once(url: String, tmp: File, onProgress: ((Long, Long) -> Unit)?): Boolean {
        val have = if (tmp.exists()) tmp.length() else 0L
        var conn = open(URL(url), have)
        var hops = 0
        while (conn.responseCode in 301..308 && hops < 5) {
            val next = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = open(URL(URL(url), next), have)
            hops++
        }
        try {
            val code = conn.responseCode
            if (code == 416 && have > 0) return true // deja tot
            if (code != 200 && code != 206) throw IllegalStateException("model $code")
            val append = code == 206 && have > 0
            val length = conn.contentLengthLong
            val total = if (length <= 0) -1L else if (append) have + length else length
            var done = if (append) have else 0L
            conn.inputStream.use { inp ->
                FileOutputStream(tmp, append).use { out ->
                    val buf = ByteArray(1 shl 16)
                    var sent = done
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (onProgress != null && done - sent > 2_000_000) { sent = done; onProgress(done, total) }
                    }
                }
            }
            return total <= 0 || done >= total
        } finally {
            conn.disconnect()
        }
    }

    private fun open(u: URL, from: Long): HttpURLConnection = (u.openConnection() as HttpURLConnection).apply {
        connectTimeout = 20000
        readTimeout = 120000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "Cherrypic-Android")
        if (from > 0) setRequestProperty("Range", "bytes=$from-")
    }
}
