package com.luminculler.app.plugins

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

private const val MODEL_FILE = "face_sface_int8.onnx"
private const val SIZE = 112
/** Cât de mare decodăm poza ca să tăiem fețele din ea: destul pentru 112 px pe față. */
private const val DECODE_MAX_SIDE = 1600

/**
 * Amprenta unei fețe (128 de numere), ca să știm că două fețe sunt același om.
 *
 * Modelul: SFace (OpenCV Zoo), licență Apache-2.0 — folosire comercială permisă,
 * spre deosebire de modelul de identitate folosit înainte (faceres), oprit pe
 * telefon tocmai din cauza licenței. Rulează cu ONNX Runtime (MIT), pe telefon:
 * nicio poză nu pleacă nicăieri.
 *
 * Fața se decupează din cutia găsită la analiză (coordonate 0..1), pătrată, cu
 * puțin spațiu în jur, apoi 112×112, RGB 0..255 — intrarea SFace.
 */
@CapacitorPlugin(name = "FaceEmbed")
class FaceEmbedPlugin : Plugin() {
    private val executor = pluginExecutor("FaceEmbed")
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null

    override fun handleOnDestroy() {
        executor.shutdown()
        runCatching { session?.close() }
        session = null
        super.handleOnDestroy()
    }

    private fun session(): OrtSession {
        session?.let { return it }
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val bytes = context.assets.open(MODEL_FILE).use { it.readBytes() }
        val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
        return e.createSession(bytes, opts).also { session = it }
    }

    private fun decode(uri: Uri): Bitmap? {
        val resolver = context.contentResolver
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                    val w = info.size.width
                    val h = info.size.height
                    val scale = min(1f, DECODE_MAX_SIDE.toFloat() / max(w, h))
                    decoder.setTargetSize(max(1, (w * scale).roundToInt()), max(1, (h * scale).roundToInt()))
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
            }.getOrNull()
        } else {
            runCatching {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                var sample = 1
                while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= DECODE_MAX_SIDE) sample *= 2
                val opts = BitmapFactory.Options().apply { inSampleSize = sample }
                resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            }.getOrNull()
        }
    }

    private fun embed(photo: Bitmap, box: DoubleArray): FloatArray? {
        val w = photo.width.toDouble()
        val h = photo.height.toDouble()
        val cx = (box[0] + box[2] / 2) * w
        val cy = (box[1] + box[3] / 2) * h
        val side = max(box[2] * w, box[3] * h) * 1.15
        if (side < 24) return null // prea mică pentru o amprentă de încredere
        val left = (cx - side / 2).coerceIn(0.0, w - 1)
        val top = (cy - side / 2).coerceIn(0.0, h - 1)
        val cw = min(side, w - left).roundToInt().coerceAtLeast(1)
        val ch = min(side, h - top).roundToInt().coerceAtLeast(1)
        val crop = Bitmap.createBitmap(photo, left.roundToInt(), top.roundToInt(), cw, ch)
        val face = Bitmap.createScaledBitmap(crop, SIZE, SIZE, true)
        if (crop !== photo && crop !== face) crop.recycle()

        val pixels = IntArray(SIZE * SIZE)
        face.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
        face.recycle()
        val input = FloatBuffer.allocate(3 * SIZE * SIZE)
        val plane = SIZE * SIZE
        for (i in 0 until plane) {
            val p = pixels[i]
            input.put(i, ((p shr 16) and 0xFF).toFloat())
            input.put(plane + i, ((p shr 8) and 0xFF).toFloat())
            input.put(2 * plane + i, (p and 0xFF).toFloat())
        }
        val s = session()
        val e = env ?: return null
        OnnxTensor.createTensor(e, input, longArrayOf(1, 3, SIZE.toLong(), SIZE.toLong())).use { tensor ->
            s.run(mapOf(s.inputNames.first() to tensor)).use { out ->
                @Suppress("UNCHECKED_CAST")
                val raw = (out[0].value as Array<FloatArray>)[0]
                var norm = 0.0
                for (v in raw) norm += v * v
                val n = sqrt(norm).toFloat().takeIf { it > 0f } ?: return null
                return FloatArray(raw.size) { raw[it] / n }
            }
        }
    }

    /** { uri, boxes: [[x,y,w,h], …] } → { embeddings: [[…128], …] } (listă goală pentru o față ratată). */
    @PluginMethod
    fun embedFaces(call: PluginCall) {
        executor.ruleaza(call, "Amprenta fețelor a eșuat") {
            val uri = call.getString("uri") ?: run { call.reject("Lipsește uri"); return@ruleaza }
            val boxes = call.getArray("boxes") ?: JSArray()
            val photo = decode(Uri.parse(uri)) ?: run { call.reject("Poza nu s-a putut citi"); return@ruleaza }
            val result = JSArray()
            try {
                for (i in 0 until boxes.length()) {
                    val b = boxes.getJSONArray(i)
                    val box = DoubleArray(4) { b.getDouble(it) }
                    val vec = runCatching { embed(photo, box) }.getOrNull()
                    val arr = JSArray()
                    vec?.forEach { arr.put(it.toDouble()) }
                    result.put(arr)
                }
            } finally {
                photo.recycle()
            }
            call.resolve(JSObject().put("embeddings", result))
        }
    }
}
