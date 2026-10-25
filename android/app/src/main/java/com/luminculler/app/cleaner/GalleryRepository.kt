package com.luminculler.app.cleaner

import android.app.RecoverableSecurityException
import android.content.ContentResolver
import android.content.Context
import android.content.IntentSender
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

enum class ScanPhase { Metadata, Thumbnails, Faces, Done }

data class ScanProgress(val done: Int, val total: Int, val phase: ScanPhase)

data class GallerySnapshot(
    val shots: List<Shot>,
    val videos: List<Shot>,
    val progress: ScanProgress
)

sealed class PreparedDelete {
    class Dialog(val sender: IntentSender, val uris: List<String>, val permanent: Boolean) : PreparedDelete()
    class Immediate(val uris: List<String>, val permanent: Boolean) : PreparedDelete()
    class NeedWrite(val uris: List<String>) : PreparedDelete()
    data object Unavailable : PreparedDelete()
}

/**
 * MediaStore only. No all-files access. Metadata comes back first so the
 * rescue screen can show videos, chats and screenshots before sharpness,
 * duplicates and eyes are finished.
 *
 * Eyes use ML Kit on a capped set of burst and near-duplicate frames.
 * The bundled model stays on the device. Voice notes are not read: that
 * would be a separate audio permission a photo cleaner should not ask for.
 */
class GalleryRepository(private val context: Context) {
    suspend fun scan(onUpdate: (GallerySnapshot) -> Unit) {
        val detector = try {
            FaceDetection.getClient(
                FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                    .setMinFaceSize(0.12f)
                    .build()
            )
        } catch (_: Throwable) {
            null
        }
        try {
            withContext(Dispatchers.IO) {
                val shots = readImages().toMutableList()
                val videos = readVideos()
                val total = shots.size
                suspend fun emit(done: Int, phase: ScanPhase) {
                    withContext(Dispatchers.Main) {
                        onUpdate(GallerySnapshot(shots.toList(), videos, ScanProgress(done, total, phase)))
                    }
                }
                emit(0, ScanPhase.Metadata)
                for (index in shots.indices) {
                    ensureActive()
                    val shot = shots[index]
                    val thumb = thumbSignals(context.contentResolver, Uri.parse(shot.uri))
                    if (thumb != null) {
                        shots[index] = shot.copy(blur = thumb.blur, hash = thumb.hash, exposure = thumb.exposure)
                    }
                    if (index % 32 == 31 || index == shots.lastIndex) emit(index + 1, ScanPhase.Thumbnails)
                }
                val order = faceCheckOrder(shots, EYE_CAP)
                var checked = 0
                for (uri in order) {
                    ensureActive()
                    if (detector == null) break
                    val index = shots.indexOfFirst { it.uri == uri }
                    if (index < 0) continue
                    val read = eyesOf(detector, context.contentResolver, Uri.parse(uri))
                    shots[index] = shots[index].copy(faces = read.first, eyesOpen = read.second)
                    checked++
                    if (checked % 8 == 0 || checked == order.size) emit(total, ScanPhase.Faces)
                }
                emit(total, ScanPhase.Done)
            }
        } finally {
            detector?.close()
        }
    }

    fun prepareTrash(uris: List<String>): PreparedDelete = mediaRequest(uris, permanent = false)

    fun prepareUntrash(uris: List<String>): PreparedDelete {
        if (Build.VERSION.SDK_INT < 30 || uris.isEmpty()) return PreparedDelete.Unavailable
        return batch(uris, permanent = false, trashing = false)
    }

    fun preparePermanentDelete(uris: List<String>): PreparedDelete {
        if (uris.isEmpty()) return PreparedDelete.Unavailable
        if (Build.VERSION.SDK_INT >= 30) return batch(uris, permanent = true, trashing = true)
        if (Build.VERSION.SDK_INT == 29) return deleteAndroid10(uris)
        return deleteLegacy(uris)
    }

    private fun mediaRequest(uris: List<String>, permanent: Boolean): PreparedDelete {
        if (uris.isEmpty()) return PreparedDelete.Unavailable
        if (Build.VERSION.SDK_INT < 30) return PreparedDelete.Unavailable
        return batch(uris, permanent = permanent, trashing = true)
    }

    private fun batch(uris: List<String>, permanent: Boolean, trashing: Boolean): PreparedDelete {
        val readable = uris.filter { canRead(it) }
        if (readable.isEmpty()) return PreparedDelete.Unavailable
        val parsed = readable.map { Uri.parse(it) }
        val accepted = acceptedBatch(parsed) { group ->
            try {
                if (permanent) MediaStore.createDeleteRequest(context.contentResolver, group)
                else MediaStore.createTrashRequest(context.contentResolver, group, trashing)
                true
            } catch (_: Exception) {
                false
            }
        }
        if (accepted.isEmpty()) return PreparedDelete.Unavailable
        val pending = if (permanent) {
            MediaStore.createDeleteRequest(context.contentResolver, accepted)
        } else {
            MediaStore.createTrashRequest(context.contentResolver, accepted, trashing)
        }
        return PreparedDelete.Dialog(pending.intentSender, accepted.map { it.toString() }, permanent)
    }

    private fun deleteAndroid10(uris: List<String>): PreparedDelete {
        val uri = Uri.parse(uris.first())
        return try {
            val deleted = context.contentResolver.delete(uri, null, null)
            if (deleted > 0) PreparedDelete.Immediate(listOf(uris.first()), permanent = true)
            else PreparedDelete.Unavailable
        } catch (error: RecoverableSecurityException) {
            PreparedDelete.Dialog(error.userAction.actionIntent.intentSender, listOf(uris.first()), permanent = true)
        } catch (_: SecurityException) {
            PreparedDelete.Unavailable
        }
    }

    private fun deleteLegacy(uris: List<String>): PreparedDelete {
        val granted = context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) return PreparedDelete.NeedWrite(uris)
        val done = ArrayList<String>()
        for (raw in uris) {
            try {
                if (context.contentResolver.delete(Uri.parse(raw), null, null) > 0) done.add(raw)
            } catch (_: SecurityException) {
                break
            }
        }
        return if (done.isEmpty()) PreparedDelete.Unavailable else PreparedDelete.Immediate(done, permanent = true)
    }

    private fun canRead(raw: String): Boolean {
        return try {
            context.contentResolver.query(Uri.parse(raw), arrayOf(MediaStore.MediaColumns._ID), null, null, null)
                ?.use { it.moveToFirst() } == true
        } catch (_: Exception) {
            false
        }
    }

    private fun readImages(): List<Shot> {
        val projection = imageProjection()
        val rows = ArrayList<Shot>()
        try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                hiddenSelection(),
                null,
                "${MediaStore.Images.Media.DATE_TAKEN} DESC"
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                val takenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
                val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val folderCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                val pathCol = cursor.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val name = cursor.getString(nameCol) ?: "photo_$id.jpg"
                    val folder = folderOf(cursor.getString(folderCol), if (pathCol >= 0) cursor.getString(pathCol) else null)
                    val taken = cursor.getLong(takenCol)
                    val added = cursor.getLong(addedCol)
                    rows.add(
                        Shot(
                            uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString()).toString(),
                            name = name,
                            bytes = cursor.getLong(sizeCol),
                            folder = folder,
                            taken = if (taken > 0) taken else added * 1000,
                            messenger = classifyMessenger(name, folder)
                        )
                    )
                }
            }
        } catch (_: SecurityException) {
            return emptyList()
        }
        return rows
    }

    private fun readVideos(): List<Shot> {
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
            MediaStore.Video.Media.DATE_TAKEN,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.RELATIVE_PATH
        ).filter { column ->
            column != MediaStore.Video.Media.RELATIVE_PATH || Build.VERSION.SDK_INT >= 29
        }.toTypedArray()
        val rows = ArrayList<Shot>()
        val selection = buildString {
            append("${MediaStore.Video.Media.SIZE} > ?")
            val hidden = hiddenSelection()
            if (hidden != null) append(" AND ").append(hidden)
        }
        try {
            context.contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                arrayOf(LARGE_VIDEO_BYTES.toString()),
                "${MediaStore.Video.Media.SIZE} DESC"
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                val folderCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)
                val takenCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_TAKEN)
                val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
                val pathCol = cursor.getColumnIndex(MediaStore.Video.Media.RELATIVE_PATH)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val name = cursor.getString(nameCol) ?: "video_$id.mp4"
                    val folder = folderOf(cursor.getString(folderCol), if (pathCol >= 0) cursor.getString(pathCol) else null)
                    val taken = cursor.getLong(takenCol)
                    val added = cursor.getLong(addedCol)
                    rows.add(
                        Shot(
                            uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString()).toString(),
                            name = name,
                            bytes = cursor.getLong(sizeCol),
                            folder = folder,
                            taken = if (taken > 0) taken else added * 1000,
                            messenger = classifyMessenger(name, folder)
                        )
                    )
                }
            }
        } catch (_: SecurityException) {
            return emptyList()
        }
        return rows
    }

    private fun imageProjection(): Array<String> {
        val columns = arrayListOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME
        )
        if (Build.VERSION.SDK_INT >= 29) columns.add(MediaStore.Images.Media.RELATIVE_PATH)
        return columns.toTypedArray()
    }

    private fun hiddenSelection(): String? {
        val parts = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 29) parts.add("${MediaStore.MediaColumns.IS_PENDING} = 0")
        if (Build.VERSION.SDK_INT >= 30) parts.add("${MediaStore.MediaColumns.IS_TRASHED} = 0")
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" AND ")
    }

    private suspend fun eyesOf(
        detector: com.google.mlkit.vision.face.FaceDetector,
        resolver: ContentResolver,
        uri: Uri
    ): Pair<Int, Double?> {
        val bitmap = eyesBitmap(resolver, uri) ?: return 0 to null
        return try {
            val faces = detect(detector, bitmap)
            summarizeFaces(faces.map { face -> FaceRead(eyeOpen(face.leftEyeOpenProbability, face.rightEyeOpenProbability)) })
        } finally {
            bitmap.recycle()
        }
    }

    private suspend fun detect(
        detector: com.google.mlkit.vision.face.FaceDetector,
        bitmap: Bitmap
    ) = suspendCancellableCoroutine { cont ->
        detector.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { faces -> if (cont.isActive) cont.resume(faces) }
            .addOnFailureListener { if (cont.isActive) cont.resume(emptyList()) }
    }
}

private const val EYE_CAP = 240
private const val LARGE_VIDEO_BYTES = 50L * 1024 * 1024

private fun folderOf(bucket: String?, relative: String?): String =
    listOfNotNull(bucket, relative).filter { it.isNotBlank() }.joinToString(" ")

private data class Thumb(val blur: Double?, val hash: Long?, val exposure: Double?)

private fun thumbSignals(resolver: ContentResolver, uri: Uri): Thumb? {
    val bitmap = thumbBitmap(resolver, uri) ?: return null
    val hash = dHash(bitmap)
    val measured = measure(bitmap)
    bitmap.recycle()
    return Thumb(measured?.first, hash, measured?.second)
}

private fun thumbBitmap(resolver: ContentResolver, uri: Uri): Bitmap? {
    if (Build.VERSION.SDK_INT >= 29) {
        try {
            return resolver.loadThumbnail(uri, android.util.Size(96, 96), null)
        } catch (_: Exception) {
            // Fall through to a decode. A missing thumbnail is not a missing photo.
        }
    }
    return decodeSampled(resolver, uri, 96)
}

private fun eyesBitmap(resolver: ContentResolver, uri: Uri): Bitmap? {
    if (Build.VERSION.SDK_INT >= 29) {
        try {
            return resolver.loadThumbnail(uri, android.util.Size(480, 480), null)
        } catch (_: Exception) {
            // Decode below.
        }
    }
    return decodeSampled(resolver, uri, 480)
}

private fun decodeSampled(resolver: ContentResolver, uri: Uri, target: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    var sample = 1
    while (longest / sample > target * 2) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
}

private fun dHash(bitmap: Bitmap): Long? {
    if (bitmap.width < 2 || bitmap.height < 2) return null
    val small = Bitmap.createScaledBitmap(bitmap, 9, 8, true)
    val gray = IntArray(9 * 8)
    for (y in 0 until 8) {
        for (x in 0 until 9) {
            val pixel = small.getPixel(x, y)
            gray[y * 9 + x] = (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3
        }
    }
    if (small !== bitmap) small.recycle()
    return dHashFromGray(gray, 9)
}

/** Laplacian variance plus mean luminance, one pass. */
private fun measure(bitmap: Bitmap): Pair<Double, Double>? {
    val w = bitmap.width
    val h = bitmap.height
    if (w < 3 || h < 3) return null
    var sum = 0.0
    var sumSq = 0.0
    var light = 0.0
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
            light += center / 255.0
            n++
        }
    }
    if (n == 0) return null
    val mean = sum / n
    return (sumSq / n - mean * mean) to (light / n)
}
