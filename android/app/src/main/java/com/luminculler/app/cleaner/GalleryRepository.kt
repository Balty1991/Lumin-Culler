package com.luminculler.app.cleaner

import android.content.ContentResolver
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/**
 * Citire MediaStore pentru ecranul nativ. Nu înlocuiește încă
 * CleanScanPlugin: acela rămâne calea web. Următorul pas e o singură
 * funcție folosită de amândouă, inclusiv amprenta SHA pe coliziuni de mărime.
 */
class GalleryRepository(private val context: Context) {
    fun load(): Map<Basket, List<Shot>> {
        val images = readImages()
        val videos = readVideos()
        return assign(images, videos)
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
                val blur = if (rows.size < 80 && !folder.contains("screenshot", true)) laplacian(context.contentResolver, Uri.parse(uri)) else null
                rows.add(Shot(uri, name, cursor.getLong(sizeCol), folder, if (taken > 0) taken else added * 1000, blur))
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

    fun trash(uris: List<String>): android.app.PendingIntent? {
        if (Build.VERSION.SDK_INT < 30 || uris.isEmpty()) return null
        val parsed = uris.map { Uri.parse(it) }
        return MediaStore.createTrashRequest(context.contentResolver, parsed, true)
    }
}

private fun laplacian(resolver: ContentResolver, uri: Uri): Double? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val sample = 48
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    var sampleSize = 1
    while (longest / sampleSize > sample * 2) sampleSize *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
    val w = bitmap.width
    val h = bitmap.height
    if (w < 3 || h < 3) {
        bitmap.recycle()
        return null
    }
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
    bitmap.recycle()
    if (n == 0) return null
    val mean = sum / n
    return sumSq / n - mean * mean
}
