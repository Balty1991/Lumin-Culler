package com.luminculler.app.cleaner

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import androidx.core.content.ContextCompat
import com.luminculler.app.cleaner.core.ImageMath
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Signals
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

/** Ce poate citi aplicația din galerie. */
enum class Access { None, Partial, Full }

fun galleryAccess(context: Context): Access {
    fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
    return when {
        Build.VERSION.SDK_INT >= 33 && granted(Manifest.permission.READ_MEDIA_IMAGES) -> Access.Full
        Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> Access.Partial
        Build.VERSION.SDK_INT < 33 && granted(Manifest.permission.READ_EXTERNAL_STORAGE) -> Access.Full
        else -> Access.None
    }
}

fun galleryPermissions(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
    )
    Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    Build.VERSION.SDK_INT >= 30 -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    // Android 8–10: ștergerea fără coșul de gunoi al sistemului cere și scriere.
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
}

class Snapshot(val photos: List<Media>, val videos: List<Media>)

/**
 * Citirea galeriei: întâi lista completă (rapidă, doar metadate), apoi
 * semnalele pe miniaturi, în fundal, cu progres. Semnalele se țin pe disc,
 * pe id + data modificării, ca a doua pornire să nu le mai calculeze.
 */
class Library(private val context: Context) {
    private val cacheFile = File(context.filesDir, "lumin-signals.bin")
    private val cache = HashMap<Long, CachedSignals>()
    private var cacheLoaded = false

    private data class CachedSignals(val modified: Long, val signals: Signals)

    fun snapshot(): Snapshot = Snapshot(readImages(), readVideos())

    private val modifiedById = HashMap<Long, Long>()

    private fun readImages(): List<Media> {
        val rows = ArrayList<Media>()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME
        )
        try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null,
                "${MediaStore.Images.Media.DATE_ADDED} DESC"
            )?.use { c ->
                val id = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val name = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val size = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                val taken = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
                val added = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val modified = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED)
                val folder = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                while (c.moveToNext()) {
                    val rowId = c.getLong(id)
                    val t = c.getLong(taken)
                    modifiedById[rowId] = c.getLong(modified)
                    rows.add(
                        Media(
                            id = rowId,
                            uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, rowId).toString(),
                            name = c.getString(name) ?: "IMG_$rowId",
                            bytes = c.getLong(size),
                            folder = c.getString(folder) ?: "",
                            taken = if (t > 0) t else c.getLong(added) * 1000
                        )
                    )
                }
            }
        } catch (_: SecurityException) {
            return emptyList()
        }
        return rows
    }

    private fun readVideos(): List<Media> {
        val rows = ArrayList<Media>()
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DURATION,
            MediaStore.Video.Media.DATE_TAKEN,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME
        )
        try {
            context.contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI, projection, null, null,
                "${MediaStore.Video.Media.SIZE} DESC"
            )?.use { c ->
                val id = c.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                val name = c.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                val size = c.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                val duration = c.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
                val taken = c.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_TAKEN)
                val added = c.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
                val folder = c.getColumnIndexOrThrow(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)
                while (c.moveToNext()) {
                    val rowId = c.getLong(id)
                    val t = c.getLong(taken)
                    rows.add(
                        Media(
                            id = rowId,
                            uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, rowId).toString(),
                            name = c.getString(name) ?: "VID_$rowId",
                            bytes = c.getLong(size),
                            folder = c.getString(folder) ?: "",
                            taken = if (t > 0) t else c.getLong(added) * 1000,
                            isVideo = true,
                            durationMs = c.getLong(duration)
                        )
                    )
                }
            }
        } catch (_: SecurityException) {
            return emptyList()
        }
        return rows
    }

    /** Semnalele deja calculate, fără să atingă vreo poză. */
    fun cachedSignals(photos: List<Media>): Map<Long, Signals> {
        loadCache()
        val out = HashMap<Long, Signals>(photos.size)
        for (m in photos) {
            val c = cache[m.id] ?: continue
            if (c.modified == (modifiedById[m.id] ?: c.modified)) out[m.id] = c.signals
        }
        return out
    }

    /**
     * Calculează ce lipsește, de la cele mai noi la cele mai vechi, câte
     * [PARALLEL] deodată. `onProgress(done, total)` vine din fundal.
     */
    suspend fun computeMissing(
        photos: List<Media>,
        onProgress: (done: Int, total: Int, partial: Map<Long, Signals>) -> Unit
    ): Map<Long, Signals> = withContext(Dispatchers.IO) {
        loadCache()
        val have = HashMap(cachedSignals(photos))
        val missing = photos.filter { it.id !in have }
        val total = missing.size
        var done = 0
        for (batch in missing.chunked(BATCH)) {
            ensureActive()
            val results = coroutineScope {
                batch.chunked(maxOf(1, batch.size / PARALLEL)).map { part ->
                    async { part.mapNotNull { m -> measure(m)?.let { m.id to it } } }
                }.awaitAll().flatten()
            }
            synchronized(cache) {
                for ((id, s) in results) {
                    cache[id] = CachedSignals(modifiedById[id] ?: 0L, s)
                    have[id] = s
                }
            }
            done += batch.size
            saveCache()
            onProgress(done, total, HashMap(have))
        }
        have
    }

    private fun measure(m: Media): Signals? {
        val bitmap = thumbnail(Uri.parse(m.uri)) ?: return null
        return try {
            val scaled = scaleDown(bitmap, SIDE)
            val w = scaled.width
            val h = scaled.height
            val pixels = IntArray(w * h)
            scaled.getPixels(pixels, 0, w, 0, 0, w, h)
            if (scaled !== bitmap) scaled.recycle()
            val gray = IntArray(pixels.size) { i ->
                val p = pixels[i]
                (((p shr 16) and 0xFF) * 299 + ((p shr 8) and 0xFF) * 587 + (p and 0xFF) * 114) / 1000
            }
            ImageMath.signals(gray, w, h)
        } catch (_: Throwable) {
            null
        } finally {
            bitmap.recycle()
        }
    }

    private fun thumbnail(uri: Uri): Bitmap? = try {
        if (Build.VERSION.SDK_INT >= 29) {
            context.contentResolver.loadThumbnail(uri, Size(THUMB, THUMB), null)
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            if (longest <= 0) {
                null
            } else {
                var sample = 1
                while (longest / (sample * 2) >= THUMB) sample *= 2
                val opts = BitmapFactory.Options().apply { inSampleSize = sample }
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            }
        }
    } catch (_: Throwable) {
        null
    }

    private fun scaleDown(bitmap: Bitmap, side: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= side) return bitmap
        val f = side.toFloat() / longest
        return Bitmap.createScaledBitmap(bitmap, maxOf(3, (bitmap.width * f).toInt()), maxOf(3, (bitmap.height * f).toInt()), true)
    }

    private fun loadCache() {
        if (cacheLoaded) return
        cacheLoaded = true
        if (!cacheFile.exists()) return
        try {
            DataInputStream(cacheFile.inputStream().buffered()).use { input ->
                if (input.readInt() != CACHE_VERSION) return
                val n = input.readInt()
                repeat(n) {
                    val id = input.readLong()
                    val modified = input.readLong()
                    val blur = input.readFloat()
                    val hash = input.readLong()
                    val flat = input.readBoolean()
                    val fine = LongArray(4) { input.readLong() }
                    cache[id] = CachedSignals(modified, Signals(blur, hash, flat, fine))
                }
            }
        } catch (_: Throwable) {
            cache.clear() // un fișier stricat se recalculează, nu blochează pornirea
        }
    }

    private fun saveCache() {
        val tmp = File(cacheFile.parentFile, cacheFile.name + ".tmp")
        try {
            val copy = synchronized(cache) { HashMap(cache) }
            DataOutputStream(tmp.outputStream().buffered()).use { out ->
                out.writeInt(CACHE_VERSION)
                out.writeInt(copy.size)
                for ((id, c) in copy) {
                    out.writeLong(id)
                    out.writeLong(c.modified)
                    out.writeFloat(c.signals.blur)
                    out.writeLong(c.signals.hash)
                    out.writeBoolean(c.signals.flat)
                    for (i in 0 until 4) out.writeLong(c.signals.fine.getOrElse(i) { 0L })
                }
            }
            tmp.renameTo(cacheFile)
        } catch (_: Throwable) {
            tmp.delete()
        }
    }

    companion object {
        private const val CACHE_VERSION = 2
        private const val THUMB = 160
        private const val SIDE = 96
        private const val BATCH = 120
        private const val PARALLEL = 4
    }
}
