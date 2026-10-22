package com.luminculler.app.cleaner.magic

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Radiera magică: ce acoperă masca dispare, iar AI-ul reface fundalul.
 *
 * Modelul e MI-GAN (Picsart AI Research, licență MIT), varianta „pipeline”:
 * primește poza întreagă și masca la orice mărime, decupează singur zona din
 * jurul petei, o reface la 512 px și o lipește înapoi. Merge pe telefon, fără
 * internet. Modelul (28 MB) e adus în pachet de CI — vezi workflow-urile.
 */
class Eraser(private val context: Context) {

    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
    private val sessionLazy = lazy {
        val bytes = context.assets.open(MODEL).use { it.readBytes() }
        env.createSession(bytes, OrtSession.SessionOptions())
    }
    private val session: OrtSession by sessionLazy

    /**
     * [mask]: ARGB de aceeași mărime cu [src]; unde alfa > 0, se șterge.
     * Întoarce o poză nouă; [src] rămâne neatinsă.
     */
    fun erase(src: Bitmap, mask: Bitmap): Bitmap = synchronized(this) {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        val mpx = IntArray(w * h)
        mask.getPixels(mpx, 0, w, 0, 0, w, h)

        // Modelul vrea uint8 pe planuri (CHW) și masca cu 0 = de refăcut, 255 = de păstrat.
        val plane = w * h
        val image = ByteBuffer.allocateDirect(3 * plane).order(ByteOrder.nativeOrder())
        for (k in 0 until plane) image.put(k, ((px[k] shr 16) and 0xFF).toByte())
        for (k in 0 until plane) image.put(plane + k, ((px[k] shr 8) and 0xFF).toByte())
        for (k in 0 until plane) image.put(2 * plane + k, (px[k] and 0xFF).toByte())
        val holes = ByteBuffer.allocateDirect(plane).order(ByteOrder.nativeOrder())
        for (k in 0 until plane) holes.put(k, if ((mpx[k] ushr 24) > 0) 0 else 255.toByte())

        val shape = longArrayOf(1, 3, h.toLong(), w.toLong())
        val maskShape = longArrayOf(1, 1, h.toLong(), w.toLong())
        OnnxTensor.createTensor(env, image, shape, OnnxJavaType.UINT8).use { imageT ->
            OnnxTensor.createTensor(env, holes, maskShape, OnnxJavaType.UINT8).use { maskT ->
                session.run(mapOf("image" to imageT, "mask" to maskT)).use { result ->
                    val out = (result.get(0) as OnnxTensor).byteBuffer
                    val res = IntArray(plane)
                    for (k in 0 until plane) {
                        val r = out.get(k).toInt() and 0xFF
                        val g = out.get(plane + k).toInt() and 0xFF
                        val b = out.get(2 * plane + k).toInt() and 0xFF
                        res[k] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                    }
                    Bitmap.createBitmap(res, w, h, Bitmap.Config.ARGB_8888)
                }
            }
        }
    }

    fun close() {
        synchronized(this) {
            // Sesiunea există doar dacă radiera a fost folosită.
            if (sessionLazy.isInitialized()) try { session.close() } catch (_: Throwable) { }
        }
    }

    companion object {
        const val MODEL = "migan_pipeline_v2.onnx"
    }
}
