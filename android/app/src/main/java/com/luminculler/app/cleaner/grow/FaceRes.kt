package com.luminculler.app.cleaner.grow

import android.content.Context
import android.graphics.Bitmap
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

/**
 * Descriptorul de față FaceRes (din Human.js, licență MIT), convertit în
 * TFLite de scripts/convert_faceres.py. Același model pe care aplicația web
 * îl folosește la recunoașterea persoanelor, deci aceleași praguri.
 *
 * Intrare: fața aliniată, 224×224, RGB cu valori 0..255. Ieșire: 1024 de
 * valori, pe care le normalizăm ca similaritatea să fie un produs scalar.
 * Nu e sigur pe fire multiple: un singur apel o dată (vezi FaceScanner).
 */
class FaceRes(context: Context) {
    private val interpreter: Interpreter
    private val input = ByteBuffer.allocateDirect(4 * SIZE * SIZE * 3).order(ByteOrder.nativeOrder())
    private val output = Array(1) { FloatArray(DIM) }
    private val pixels = IntArray(SIZE * SIZE)

    init {
        val fd = context.assets.openFd(MODEL)
        val buffer = FileInputStream(fd.fileDescriptor).channel.use {
            it.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
        }
        interpreter = Interpreter(buffer, Interpreter.Options().setNumThreads(2))
    }

    fun embed(face224: Bitmap): FloatArray {
        val bmp = if (face224.width == SIZE && face224.height == SIZE) face224 else Bitmap.createScaledBitmap(face224, SIZE, SIZE, true)
        bmp.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
        if (bmp !== face224) bmp.recycle()
        input.rewind()
        for (p in pixels) {
            input.putFloat(((p shr 16) and 0xFF).toFloat())
            input.putFloat(((p shr 8) and 0xFF).toFloat())
            input.putFloat((p and 0xFF).toFloat())
        }
        input.rewind()
        interpreter.run(input, output)
        return output[0].copyOf()
    }

    fun close() = interpreter.close()

    companion object {
        const val MODEL = "faceres.tflite"
        const val SIZE = 224
        const val DIM = 1024
    }
}
