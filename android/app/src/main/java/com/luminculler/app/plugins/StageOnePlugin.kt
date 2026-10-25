package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Etapa 1 a scanării: decodare redusă + dHash, din content://.
 *
 * Fișierul original nu trece puntea Capacitor. BitmapFactory subeșantionează
 * la citire (inSampleSize), deci un cadru de 12 MP nu e decodat la rezoluție
 * plină doar ca să i se calculeze o amprentă de 9×8.
 *
 * dHash-ul trebuie să coincidă cu src/core/dhash.ts: 9×8, luma 0.299/0.587/0.114,
 * bitul e 1 când pixelul din stânga e mai luminos decât cel din dreapta.
 */
@CapacitorPlugin(name = "StageOne")
class StageOnePlugin : Plugin() {
    private val executor = pluginExecutor("StageOne")
    private val pool = Executors.newFixedThreadPool(4) { runnable ->
        Thread(runnable, "Lumin-StageOne-batch").apply { isDaemon = true }
    }

    override fun handleOnDestroy() {
        pool.shutdown()
        executor.shutdown()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun fingerprint(call: PluginCall) {
        val raw = call.getString("imageUri")
        if (raw.isNullOrBlank()) {
            call.reject("imageUri lipsește")
            return
        }
        executor.ruleaza(call, "Stage one failed") {
            call.resolve(fingerprintUri(Uri.parse(raw)))
        }
    }

    @PluginMethod
    fun fingerprintBatch(call: PluginCall) {
        val arr = call.getArray("imageUris")
        if (arr == null) {
            call.reject("imageUris lipsește")
            return
        }
        val uris = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val value = arr.optString(i)
            if (value.isNotBlank()) uris.add(value)
        }
        executor.ruleaza(call, "Stage one batch failed") {
            val tasks = uris.map { raw -> pool.submit<JSObject> { fingerprintUri(Uri.parse(raw)) } }
            val items = JSArray()
            for (task in tasks) items.put(task.get())
            call.resolve(JSObject().apply { put("items", items) })
        }
    }

    private fun fingerprintUri(uri: Uri): JSObject {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val srcW = bounds.outWidth
        val srcH = bounds.outHeight
        if (srcW <= 0 || srcH <= 0) throw IllegalArgumentException("Imaginea nu a putut fi citită")

        val rotation = exifDegrees(uri)
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(srcW, srcH, PREVIEW_MAX) }
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalArgumentException("Decodarea a eșuat")
        val oriented = rotate(decoded, rotation)
        if (oriented !== decoded) decoded.recycle()

        val hash = dHash(oriented)
        val metrics = thumbMetrics(oriented)
        val paper = paperScore(oriented)
        val preview = jpegBase64(oriented, PREVIEW_MAX, 75)
        val thumb = jpegBase64(oriented, THUMB_MAX, 70)
        val lqip = jpegBase64(oriented, LQIP_MAX, 50)
        oriented.recycle()

        var fullW = srcW
        var fullH = srcH
        if (rotation == 90 || rotation == 270) {
            fullW = srcH
            fullH = srcW
        }
        return JSObject().apply {
            put("dHash", hash.bits)
            put("width", fullW)
            put("height", fullH)
            put("sharpness", metrics.sharpness)
            put("exposure", metrics.exposure)
            put("paperScore", paper)
            put("previewBase64", preview)
            put("thumbBase64", thumb)
            put("lqipBase64", lqip)
        }
    }

    private fun exifDegrees(uri: Uri): Int {
        return try {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            } ?: 0
        } catch (_: Exception) {
            0
        }
    }

    private fun rotate(src: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return src
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
    }

    private fun sampleSize(width: Int, height: Int, maxSide: Int): Int {
        var size = 1
        val longest = max(width, height)
        while (longest / (size * 2) >= maxSide) size *= 2
        return size
    }

    private class Hash(val bits: String)

    private fun dHash(src: Bitmap): Hash {
        val small = Bitmap.createScaledBitmap(src, 9, 8, true)
        val sb = StringBuilder(64)
        for (y in 0 until 8) {
            for (x in 0 until 8) {
                val a = luma(small.getPixel(x, y))
                val b = luma(small.getPixel(x + 1, y))
                sb.append(if (a > b) '1' else '0')
            }
        }
        small.recycle()
        return Hash(sb.toString())
    }

    private class Metrics(val exposure: Double, val sharpness: Double)

    /** Aceeași formulă ca thumbMetrics din src/core/dhash.ts, pe grila 9×8. */
    private fun thumbMetrics(src: Bitmap): Metrics {
        val small = Bitmap.createScaledBitmap(src, 9, 8, true)
        val gray = DoubleArray(9 * 8)
        var sum = 0.0
        for (y in 0 until 8) {
            for (x in 0 until 9) {
                val v = luma(small.getPixel(x, y))
                gray[y * 9 + x] = v
                sum += v
            }
        }
        small.recycle()
        var acc = 0.0
        var n = 0
        for (y in 1 until 7) {
            for (x in 1 until 8) {
                val c = gray[y * 9 + x]
                val lap = gray[y * 9 + x - 1] + gray[y * 9 + x + 1] + gray[(y - 1) * 9 + x] + gray[(y + 1) * 9 + x] - 4 * c
                acc += lap * lap
                n++
            }
        }
        val exposure = (sum / gray.size / 255.0 * 100.0).coerceIn(0.0, 100.0)
        val sharpness = (sqrt(if (n > 0) acc / n else 0.0) / 2.0).coerceIn(0.0, 100.0)
        return Metrics(exposure, sharpness)
    }

    /** Aceeași formulă ca paperScoreFromRgba: lumină, paloare, muchii, pe 48×48. */
    private fun paperScore(src: Bitmap): Double {
        val side = PAPER_SIDE
        val small = Bitmap.createScaledBitmap(src, side, side, true)
        val gray = DoubleArray(side * side)
        var lumaSum = 0.0
        var satSum = 0.0
        for (y in 0 until side) {
            for (x in 0 until side) {
                val color = small.getPixel(x, y)
                val r = Color.red(color).toDouble()
                val g = Color.green(color).toDouble()
                val b = Color.blue(color).toDouble()
                val yv = luma(color)
                gray[y * side + x] = yv
                lumaSum += yv
                val maxC = max(r, max(g, b))
                val minC = min(r, min(g, b))
                satSum += if (maxC == 0.0) 0.0 else (maxC - minC) / maxC
            }
        }
        small.recycle()
        var acc = 0.0
        var n = 0
        for (y in 1 until side - 1) {
            for (x in 1 until side - 1) {
                val c = gray[y * side + x]
                val lap = gray[y * side + x - 1] + gray[y * side + x + 1] + gray[(y - 1) * side + x] + gray[(y + 1) * side + x] - 4 * c
                acc += lap * lap
                n++
            }
        }
        val count = side * side
        val lumaMean = lumaSum / count / 255.0
        val sat = satSum / count
        val edge = min(1.0, sqrt(if (n > 0) acc / n else 0.0) / 28.0)
        val bright = min(1.0, max(0.0, (lumaMean - 0.55) / 0.3))
        val pale = min(1.0, max(0.0, (0.22 - sat) / 0.22))
        return bright * 0.45 + pale * 0.3 + edge * 0.25
    }

    private fun luma(color: Int): Double {
        return 0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)
    }

    private fun jpegBase64(src: Bitmap, maxSide: Int, quality: Int): String {
        val longest = max(src.width, src.height)
        val scaled = if (longest <= maxSide) src else {
            val scale = maxSide.toFloat() / longest
            Bitmap.createScaledBitmap(src, max(1, (src.width * scale).roundToInt()), max(1, (src.height * scale).roundToInt()), true)
        }
        val stream = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        if (scaled !== src) scaled.recycle()
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    companion object {
        private const val PREVIEW_MAX = 480
        private const val THUMB_MAX = 256
        private const val LQIP_MAX = 24
        private const val PAPER_SIDE = 48
    }
}
