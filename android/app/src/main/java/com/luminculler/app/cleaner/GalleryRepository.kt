package com.luminculler.app.cleaner

import android.content.ContentResolver
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/**
 * Citire MediaStore pentru ecranul nativ. Fiecare poză primește claritate
 * și un dHash, nu doar primele 80. CleanScanPlugin rămâne calea web.
 */
data class GalleryLoad(val baskets: Map<Basket, List<Shot>>, val bestShot: String?)

class GalleryRepository(private val context: Context) {
    fun load(): GalleryLoad {
        val images = readImages()
        return GalleryLoad(assign(images, readVideos()), bestShotName(images))
    }

    private fun readImages(): List<Shot> {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME
        )
        val rows = ArrayList<Shot>()
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
            val takenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val folderCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            while (cursor.moveToNext() && rows.size < 800) {
                val id = cursor.getLong(idCol)
                val taken = cursor.getLong(takenCol)
                val added = cursor.getLong(addedCol)
                val name = cursor.getString(nameCol) ?: "photo_$id.jpg"
                val folder = cursor.getString(folderCol) ?: ""
                val uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString()).toString()
                val signals = signals(context.contentResolver, Uri.parse(uri))
                rows.add(Shot(uri, name, cursor.getLong(sizeCol), folder, if (taken > 0) taken else added * 1000, signals.blur, signals.hash))
            }
        }
        return rows
    }

    private fun readVideos(): List<Shot> {
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE
        )
        val rows = ArrayList<Shot>()
        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Video.Media.SIZE} > ?",
            arrayOf((50L * 1024 * 1024).toString()),
            "${MediaStore.Video.Media.SIZE} DESC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
            while (cursor.moveToNext() && rows.size < 40) {
                val id = cursor.getLong(idCol)
                rows.add(
                    Shot(
                        uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString()).toString(),
                        name = cursor.getString(nameCol) ?: "video_$id.mp4",
                        bytes = cursor.getLong(sizeCol),
                        folder = "",
                        taken = 0
                    )
                )
            }
        }
        return rows
    }

    fun trash(uris: List<String>): android.app.PendingIntent? = trashRequest(uris, true)

    fun untrash(uris: List<String>): android.app.PendingIntent? = trashRequest(uris, false)

    private fun trashRequest(uris: List<String>, trashing: Boolean): android.app.PendingIntent? {
        if (Build.VERSION.SDK_INT < 30 || uris.isEmpty()) return null
        val parsed = uris.map { Uri.parse(it) }
        return MediaStore.createTrashRequest(context.contentResolver, parsed, trashing)
    }
}

private data class Signals(val blur: Double?, val hash: Long?)

private fun signals(resolver: ContentResolver, uri: Uri): Signals {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val sample = 48
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return Signals(null, null)
    var sampleSize = 1
    while (longest / sampleSize > sample * 2) sampleSize *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return Signals(null, null)
    val hash = dHash(bitmap)
    val blur = laplacian(bitmap)
    bitmap.recycle()
    return Signals(blur, hash)
}

private fun dHash(bitmap: android.graphics.Bitmap): Long? {
    if (bitmap.width < 2 || bitmap.height < 2) return null
    val small = android.graphics.Bitmap.createScaledBitmap(bitmap, 9, 8, true)
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

private fun laplacian(bitmap: android.graphics.Bitmap): Double? {
    val w = bitmap.width
    val h = bitmap.height
    if (w < 3 || h < 3) return null
    var sum = 0.0
    var sumSq = 0.0
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
            n++
        }
    }
    if (n == 0) return null
    val mean = sum / n
    return sumSq / n - mean * mean
}
