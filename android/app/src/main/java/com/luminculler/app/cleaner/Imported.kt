package com.luminculler.app.cleaner

import android.content.Context
import android.graphics.Bitmap
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.grow.decodeOriented
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Pozele aduse din Google Foto (sau de oriunde) prin selectorul de poze al
 * telefonului. Google nu mai lasă aplicațiile să citească singure biblioteca
 * din cloud, așa că omul alege, iar noi păstrăm o copie în spațiul aplicației.
 *
 * Copiile intră în amintiri, oameni, jocuri și „Atunci și acum”, dar NU în
 * curățenie: nu sunt în galeria telefonului, deci n-avem ce șterge acolo.
 * Id-urile sunt negative, ca să nu se ciocnească niciodată cu cele din MediaStore.
 */
class Imported(private val context: Context) {
    private val dir = File(context.filesDir, "imported")
    private val index = File(dir, "index.json")

    private class Entry(val id: Long, val file: String, val taken: Long, val name: String, val source: String)

    private fun read(): List<Entry> = try {
        val arr = JSONArray(index.readText())
        List(arr.length()) { i ->
            val o = arr.getJSONObject(i)
            Entry(o.getLong("id"), o.getString("file"), o.optLong("taken"), o.optString("name"), o.optString("source"))
        }
    } catch (_: Throwable) {
        emptyList()
    }

    private fun write(entries: List<Entry>) {
        dir.mkdirs()
        val arr = JSONArray()
        for (e in entries) arr.put(JSONObject().put("id", e.id).put("file", e.file).put("taken", e.taken).put("name", e.name).put("source", e.source))
        val tmp = File(dir, "index.tmp")
        tmp.writeText(arr.toString())
        tmp.renameTo(index)
    }

    private fun uriOf(file: File): String = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file).toString()

    fun list(): List<Media> = read().mapNotNull { e ->
        val f = File(dir, e.file)
        if (!f.exists()) null else Media(e.id, uriOf(f), e.name, f.length(), FOLDER, e.taken)
    }

    val bytes: Long get() = dir.listFiles()?.sumOf { it.length() } ?: 0L

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** Copiază pozele alese; întoarce câte au fost noi. */
    suspend fun add(uris: List<Uri>, onProgress: (Int, Int) -> Unit): Int = withContext(Dispatchers.IO) {
        dir.mkdirs()
        val entries = read().toMutableList()
        val known = entries.mapTo(HashSet()) { it.source }
        var nextId = (entries.minOfOrNull { it.id } ?: 0L).coerceAtMost(0L) - 1
        var added = 0
        uris.forEachIndexed { i, uri ->
            ensureActive()
            onProgress(i, uris.size)
            if (uri.toString() in known) return@forEachIndexed
            val taken = takenOf(uri)
            val bmp = decodeOriented(context, uri, MAX_SIDE) ?: return@forEachIndexed
            val name = "g_${-nextId}.jpg"
            try {
                File(dir, name).outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }
            } finally {
                bmp.recycle()
            }
            entries.add(Entry(nextId, name, taken, name, uri.toString()))
            known.add(uri.toString())
            nextId--
            added++
        }
        write(entries)
        onProgress(uris.size, uris.size)
        added
    }

    /**
     * Data fotografierii: întâi din selector (coloana „datetaken”), apoi din
     * EXIF. Fără ea, poza merge la oameni, dar nu la „acum X ani” sau la joc.
     */
    private fun takenOf(uri: Uri): Long {
        try {
            context.contentResolver.query(uri, arrayOf("datetaken"), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) {
                    val v = c.getLong(0)
                    if (v > 0) return v
                }
            }
        } catch (_: Throwable) { }
        try {
            context.contentResolver.openInputStream(uri)?.use { s ->
                val exif = ExifInterface(s)
                val raw = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) ?: exif.getAttribute(ExifInterface.TAG_DATETIME)
                if (raw != null) {
                    return LocalDateTime.parse(raw.trim(), EXIF_DATE).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
                }
            }
        } catch (_: Throwable) { }
        return 0L
    }

    companion object {
        const val FOLDER = "Google Foto"
        /** Destul pentru fețe, filme și „Atunci și acum”, fără să umple telefonul. */
        const val MAX_SIDE = 2048
        private val EXIF_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy:MM:dd HH:mm:ss")
    }
}
