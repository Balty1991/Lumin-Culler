package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import kotlin.math.max
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

    override fun handleOnDestroy() {
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
        val preview = jpegBase64(oriented, PREVIEW_MAX, 80)
        val thumb = jpegBase64(oriented, THUMB_MAX, 75)
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
            put("previewBase64", preview)
            put("thumbBase64", thumb)
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
        private const val PREVIEW_MAX = 1280
        private const val THUMB_MAX = 512
    }
}
