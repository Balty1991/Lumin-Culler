package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Size
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * O poză clară, la mărimea de care are nevoie ecranul, scrisă o dată în cache.
 *
 * DE CE. Raportat: miniaturile din galerie erau neclare, iar poza mare se vedea
 * neagră. Miniatura salvată la import are 256 px (StageOnePlugin, gândită
 * pentru analiză), iar galeria o arăta pe ~550 px reali. Pentru ecranul plin,
 * WebView-ul primea originalul (12–50 MP) direct prin URI și, pe unele
 * telefoane, nu-l putea decoda deloc — de aici negrul.
 *
 * Aici Android face decodarea, deja la mărimea cerută (ImageDecoder citește
 * doar cât trebuie și aplică orientarea EXIF), iar WebView-ul primește un JPEG
 * mic, din cache. A doua oară, fișierul e deja acolo.
 */
@CapacitorPlugin(name = "SharpImage")
class SharpImagePlugin : Plugin() {
    private val executor = pluginExecutor("SharpImage")

    override fun handleOnDestroy() {
        executor.shutdown()
        super.handleOnDestroy()
    }

    private fun key(uri: String, size: Int): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(uri.toByteArray())
        return digest.joinToString("") { "%02x".format(it) } + "_" + size
    }

    private fun decode(uri: Uri, size: Int): Bitmap? {
        val resolver = context.contentResolver
        // Miniaturile mici le are deja sistemul în cache (aceleași ca în Galerie).
        if (size <= 640 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { resolver.loadThumbnail(uri, Size(size, size), null) }.getOrNull()?.let { return it }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return runCatching {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                    val w = info.size.width
                    val h = info.size.height
                    val scale = min(1f, size.toFloat() / max(w, h))
                    decoder.setTargetSize(max(1, (w * scale).roundToInt()), max(1, (h * scale).roundToInt()))
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
            }.getOrNull()
        }
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size) sample *= 2
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        }.getOrNull()
    }

    /** { uri, size } → { path } — calea unui JPEG cu latura cea mare ≤ size. */
    @PluginMethod
    fun render(call: PluginCall) {
        executor.ruleaza(call, "Poza clară n-a putut fi făcută") {
            val uri = call.getString("uri") ?: run { call.reject("Lipsește uri"); return@ruleaza }
            val size = (call.getInt("size") ?: 1080).coerceIn(128, 4096)
            val dir = File(context.cacheDir, "sharp").apply { mkdirs() }
            val file = File(dir, key(uri, size) + ".jpg")
            if (!file.exists() || file.length() == 0L) {
                val bitmap = decode(Uri.parse(uri), size) ?: run { call.reject("Poza nu s-a putut citi"); return@ruleaza }
                try {
                    val tmp = File(dir, file.name + ".tmp")
                    FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
                    tmp.renameTo(file)
                } finally {
                    bitmap.recycle()
                }
            }
            call.resolve(JSObject().put("path", file.absolutePath))
        }
    }
}
