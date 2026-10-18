package com.luminculler.app.plugins

import android.Manifest
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * Scanarea de galerie pentru ecranul de curățare.
 *
 * Nu înlocuiește analiza AI din WebView (fețe, ochi, învățare). Măsoară ce se
 * poate măsura din MediaStore fără să urce nimic: mărime, dosar, o amprentă
 * pe două felii pentru fișierele care împart aceeași mărime, și varianța de
 * claritate pe o miniatură. Gruparea în coșuri o face TypeScript-ul
 * (src/core/cleanScan.ts), ca regulile să aibă teste fără telefon.
 *
 * Videoclipurile cer READ_MEDIA_VIDEO pe Android 13+. Pe versiunile mai vechi
 * READ_EXTERNAL_STORAGE (maxSdk 32) acoperă și pozele, și video. Accesul
 * limitat din Android 14 rămâne vizibil prin aliasul photosPartial din
 * MediaLibraryPlugin; aici, dacă pozele sunt refuzate, scanarea nu pornește.
 */
@CapacitorPlugin(
    name = "CleanScan",
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES], alias = "photos33"),
        Permission(strings = [Manifest.permission.READ_MEDIA_VIDEO], alias = "videos33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "storageLegacy")
    ]
)
class CleanScanPlugin : Plugin() {

    private val photosAlias: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "photos33" else "storageLegacy"

    private val videosAlias: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "videos33" else "storageLegacy"

    /** Aceeași limită ca în comentariul din JS: un pod de 8 000 de rânduri rămâne răspuns, nu un import. */
    private val maxImages = 8000
    private val maxBlurScores = 400
    private val burstGapMs = 2500L
    private val blurSample = 48

    private fun granted(alias: String): Boolean = getPermissionState(alias) == PermissionState.GRANTED

    @PluginMethod
    fun videoAccess(call: PluginCall) {
        call.resolve(JSObject().put("access", if (granted(videosAlias)) "full" else "denied"))
    }

    @PluginMethod
    fun requestVideoAccess(call: PluginCall) {
        if (granted(videosAlias)) {
            call.resolve(JSObject().put("access", "full"))
            return
        }
        requestPermissionForAlias(videosAlias, call, "videoAccessCallback")
    }

    @PermissionCallback
    private fun videoAccessCallback(call: PluginCall) {
        call.resolve(JSObject().put("access", if (granted(videosAlias)) "full" else "denied"))
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (!granted(photosAlias)) {
            requestPermissionForAlias(photosAlias, call, "scanPermissionCallback")
            return
        }
        resolveScan(call)
    }

    @PermissionCallback
    private fun scanPermissionCallback(call: PluginCall) {
        if (granted(photosAlias)) resolveScan(call)
        else call.resolve(JSObject().put("granted", false).put("videosGranted", granted(videosAlias)))
    }

    /** Nu e data class: hash/blur se completează după ce rândul e într-un set, iar equals pe câmpuri l-ar strica. */
    private class ImageRow(
        val uri: String,
        val name: String,
        val bytes: Long,
        val width: Int,
        val height: Int,
        val taken: Long,
        val bucket: String,
        var hash: String?,
        var blur: Double?,
        var exposure: Double? = null
    )

    private fun resolveScan(call: PluginCall) {
        try {
            val images = readImages()
            hashSizeCollisions(images)
            scoreSharpness(images)
            val videosGranted = granted(videosAlias)
            val videos = if (videosGranted) readLargeVideos() else JSArray()
            val payload = JSArray()
            for (row in images) {
                val obj = JSObject()
                    .put("uri", row.uri)
                    .put("name", row.name)
                    .put("bytes", row.bytes)
                    .put("width", row.width)
                    .put("height", row.height)
                    .put("taken", row.taken)
                    .put("bucket", row.bucket)
                row.hash?.let { obj.put("hash", it) }
                row.blur?.let { obj.put("blur", it) }
                row.exposure?.let { obj.put("exposure", it) }
                payload.put(obj)
            }
            call.resolve(
                JSObject()
                    .put("granted", true)
                    .put("videosGranted", videosGranted)
                    .put("images", payload)
                    .put("videos", videos)
            )
        } catch (e: Exception) {
            call.reject("Nu am putut scana galeria: ${e.message}", e)
        }
    }

    private fun readImages(): MutableList<ImageRow> {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME
        )
        val rows = ArrayList<ImageRow>()
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_TAKEN} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val widthCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
            val heightCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
            val takenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val bucketCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            while (cursor.moveToNext() && rows.size < maxImages) {
                val id = cursor.getLong(idCol)
                val taken = cursor.getLong(takenCol)
                val added = cursor.getLong(addedCol)
                rows.add(
                    ImageRow(
                        uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString()).toString(),
                        name = cursor.getString(nameCol) ?: "photo_$id.jpg",
                        bytes = cursor.getLong(sizeCol),
                        width = cursor.getInt(widthCol),
                        height = cursor.getInt(heightCol),
                        taken = if (taken > 0) taken else added * 1000,
                        bucket = cursor.getString(bucketCol) ?: "",
                        hash = null,
                        blur = null
                    )
                )
            }
        }
        return rows
    }

    /** Doar fișierele care împart o mărime merită citite. Restul nu pot fi copii identice. */
    private fun hashSizeCollisions(rows: List<ImageRow>) {
        val bySize = rows.groupBy { it.bytes }
        for ((size, group) in bySize) {
            if (size <= 0 || group.size < 2) continue
            for (row in group) row.hash = sampleHash(Uri.parse(row.uri), size)
        }
    }

    private fun sampleHash(uri: Uri, size: Long): String? {
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).use { input ->
                    val channel = input.channel
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buf = ByteBuffer.allocate(65536)
                    val head = channel.read(buf)
                    if (head > 0) digest.update(buf.array(), 0, head)
                    if (size > 65536) {
                        channel.position((size - 65536).coerceAtLeast(0))
                        buf.clear()
                        val tail = channel.read(buf)
                        if (tail > 0) digest.update(buf.array(), 0, tail)
                    }
                    digest.digest().joinToString("") { "%02x".format(it) }
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Claritatea se măsoară pe membrii de rafală (ca să alegem cadrul păstrat)
     * și pe cele mai noi poze care nu sunt capturi. Nu pe toată galeria:
     * decodarea a mii de miniaturi întârzie cifra pe care omul a venit s-o vadă.
     */
    private fun scoreSharpness(rows: List<ImageRow>) {
        val wanted = LinkedHashSet<ImageRow>()
        val ordered = rows.filter { it.taken > 0 && !it.bucket.contains("screenshot", ignoreCase = true) }
            .sortedBy { it.taken }
        var cluster = ArrayList<ImageRow>()
        fun flush() {
            if (cluster.size >= 3) wanted.addAll(cluster)
            cluster = ArrayList()
        }
        for (row in ordered) {
            val prev = cluster.lastOrNull()
            if (prev != null && (row.bucket != prev.bucket || row.taken - prev.taken > burstGapMs)) flush()
            cluster.add(row)
        }
        flush()
        for (row in rows) {
            if (wanted.size >= maxBlurScores) break
            if (row.bucket.contains("screenshot", ignoreCase = true)) continue
            wanted.add(row)
        }
        for (row in wanted) {
            val score = scoreFrame(Uri.parse(row.uri)) ?: continue
            row.blur = score.blur
            row.exposure = score.exposure
        }
    }

    private class FrameScore(val blur: Double, val exposure: Double)

    /**
     * Aceeași miniatură dă și claritatea, și expunerea (luma medie, 0–100).
     * Ochii nu se citesc aici: ar însemna un model pe fiecare poză, iar
     * scanarea trebuie să rămână o măsurătoare, nu o analiză.
     */
    private fun scoreFrame(uri: Uri): FrameScore? {
        val bitmap = loadSmall(uri) ?: return null
        return try {
            val w = bitmap.width
            val h = bitmap.height
            if (w < 3 || h < 3) return null
            var sum = 0.0
            var sumSq = 0.0
            var luma = 0.0
            var n = 0
            fun gray(x: Int, y: Int): Int {
                val pixel = bitmap.getPixel(x, y)
                return (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3
            }
            for (y in 1 until h - 1) {
                for (x in 1 until w - 1) {
                    val center = gray(x, y)
                    val lap = gray(x, y - 1) + gray(x, y + 1) + gray(x - 1, y) + gray(x + 1, y) - 4 * center
                    sum += lap
                    sumSq += lap.toDouble() * lap
                    luma += center
                    n++
                }
            }
            if (n == 0) null else FrameScore(
                sumSq / n - (sum / n) * (sum / n),
                (luma / n) / 255.0 * 100.0
            )
        } catch (_: Exception) {
            null
        } finally {
            bitmap.recycle()
        }
    }

    private fun loadSmall(uri: Uri): Bitmap? {
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                context.contentResolver.loadThumbnail(uri, Size(blurSample, blurSample), null)
            } else {
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    val opts = BitmapFactory.Options().apply { inSampleSize = 16 }
                    BitmapFactory.decodeStream(stream, null, opts)
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readLargeVideos(): JSArray {
        val minBytes = 50L * 1024L * 1024L
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.WIDTH,
            MediaStore.Video.Media.HEIGHT,
            MediaStore.Video.Media.DURATION
        )
        val videos = JSArray()
        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Video.Media.SIZE} >= ?",
            arrayOf(minBytes.toString()),
            "${MediaStore.Video.Media.SIZE} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
            val widthCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.WIDTH)
            val heightCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.HEIGHT)
            val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
            var count = 0
            while (cursor.moveToNext() && count < 150) {
                val id = cursor.getLong(idCol)
                videos.put(
                    JSObject()
                        .put("uri", Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString()).toString())
                        .put("name", cursor.getString(nameCol) ?: "video_$id.mp4")
                        .put("bytes", cursor.getLong(sizeCol))
                        .put("width", cursor.getInt(widthCol))
                        .put("height", cursor.getInt(heightCol))
                        .put("durationMs", cursor.getLong(durationCol))
                )
                count++
            }
        }
        return videos
    }
}
