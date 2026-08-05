package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

private const val MODEL_FILE = "detect.tflite"
private const val LABELMAP_FILE = "labelmap.txt"
private const val INPUT_SIZE = 300
// Fix, dictat de operatia TFLite_Detection_PostProcess impachetata in acest model
// (vezi ObjectDetectionPlugin — comentariul de mai jos despre coco_ssd_mobilenet_v1).
private const val MODEL_MAX_DETECTIONS = 10
private const val MIN_CONFIDENCE = 0.5f // aceeasi filozofie ca object.minConfidence din faceAnalysis.worker.ts
private const val MAX_RETURNED = 8       // aceeasi valoare ca object.maxDetected din faceAnalysis.worker.ts

/**
 * Analiza AI nativa (Faza 3) — etichete de scena/obiect, port catre un model
 * TFLite (nu ML Kit: ML Kit Object Detection are doar 5 categorii foarte largi,
 * nu cele 80 COCO deja folosite de sceneTags in tot restul aplicatiei).
 *
 * Model: coco_ssd_mobilenet_v1_1.0_quant_2018_06_29 (Google, Apache 2.0,
 * download.tensorflow.org) — descarcat de CI in assets/ (vezi
 * android-debug-build.yml / release-android.yml, "Bundle native
 * object-detection model"), NU committed in git. Etichetele lui (labelmap.txt,
 * acelasi fisier, incarcat ca atare) au fost verificate identice cu cheile din
 * src/core/sceneTagLabels.ts — nicio traducere/adaptare suplimentara.
 *
 * La fel ca FaceDetectionPlugin/ImageAnalysisPlugin: ramane dormant, accesibil
 * doar din hook-ul de test din DEV, NU legat de fluxul real de analiza.
 */
@CapacitorPlugin(name = "ObjectDetection")
class ObjectDetectionPlugin : Plugin() {

    private val labels: List<String> by lazy {
        context.assets.open(LABELMAP_FILE).bufferedReader().readLines()
    }

    private val interpreter: Interpreter by lazy { Interpreter(loadModelFile()) }

    private fun loadModelFile(): MappedByteBuffer {
        val afd = context.assets.openFd(MODEL_FILE)
        FileInputStream(afd.fileDescriptor).use { input ->
            return input.channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
        }
    }

    @PluginMethod
    fun detectObjects(call: PluginCall) {
        val base64 = call.getString("imageBase64")
        if (base64.isNullOrEmpty()) {
            call.reject("imageBase64 is required")
            return
        }

        val bitmap: Bitmap = try {
            decodeBase64ToBitmap(base64)
        } catch (e: Exception) {
            call.reject("Failed to decode image: ${e.message}", e)
            return
        }

        try {
            call.resolve(runDetection(bitmap))
        } catch (e: Exception) {
            call.reject("Object detection failed: ${e.message}", e)
        }
    }

    private fun runDetection(bitmap: Bitmap): JSObject {
        val scaled = Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)
        val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
        scaled.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

        // Model CUANTIZAT (uint8, 0..255 direct) — spre deosebire de ImageMath.kt
        // (matematica pura, Double/Float), fara nicio normalizare in [0,1].
        val inputBuffer = ByteBuffer.allocateDirect(INPUT_SIZE * INPUT_SIZE * 3)
        inputBuffer.order(ByteOrder.nativeOrder())
        for (p in pixels) {
            inputBuffer.put(((p shr 16) and 0xFF).toByte())
            inputBuffer.put(((p shr 8) and 0xFF).toByte())
            inputBuffer.put((p and 0xFF).toByte())
        }
        inputBuffer.rewind()

        // Cele 4 iesiri numite ale TFLite_Detection_PostProcess (verificat direct
        // in binarul modelului): locations, classes, scores, numDetections.
        val outputLocations = Array(1) { Array(MODEL_MAX_DETECTIONS) { FloatArray(4) } }
        val outputClasses = Array(1) { FloatArray(MODEL_MAX_DETECTIONS) }
        val outputScores = Array(1) { FloatArray(MODEL_MAX_DETECTIONS) }
        val numDetections = FloatArray(1)
        val outputMap: MutableMap<Int, Any> = HashMap()
        outputMap[0] = outputLocations
        outputMap[1] = outputClasses
        outputMap[2] = outputScores
        outputMap[3] = numDetections

        interpreter.runForMultipleInputsOutputs(arrayOf<Any>(inputBuffer), outputMap)

        val n = numDetections[0].toInt().coerceIn(0, MODEL_MAX_DETECTIONS)
        val objectsArray = JSArray()
        (0 until n)
            .map { i ->
                val score = outputScores[0][i]
                // +1: iesirea modelului nu prezice clasa de fundal — indexul 0 din
                // labelmap.txt ("???") nu are corespondent in outputClasses.
                val label = labels.getOrNull(outputClasses[0][i].toInt() + 1)
                Triple(label, score, outputLocations[0][i])
            }
            .filter { (label, score, _) -> label != null && label != "???" && score >= MIN_CONFIDENCE }
            .sortedByDescending { it.second }
            .take(MAX_RETURNED)
            .forEach { (label, score, box) ->
                // Ordinea TFLite_Detection_PostProcess: [top, left, bottom, right], normalizat 0..1.
                val (top, left, bottom, right) = listOf(box[0], box[1], box[2], box[3])
                val boxObj = JSObject()
                boxObj.put("x", left.toDouble())
                boxObj.put("y", top.toDouble())
                boxObj.put("width", (right - left).toDouble())
                boxObj.put("height", (bottom - top).toDouble())

                val obj = JSObject()
                obj.put("label", label)
                obj.put("score", score.toDouble())
                obj.put("box", boxObj)
                objectsArray.put(obj)
            }

        val result = JSObject()
        result.put("objects", objectsArray)
        return result
    }
}
