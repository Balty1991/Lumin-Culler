package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import com.luminculler.app.ReleasableModel

private const val MAX_RETURNED = 8

/**
 * Cutii pentru decupajul unui animal. Image Labeling spune „dog” fără să
 * spună unde. Clasificatorul implicit al acestui detector e grosier (nu
 * cunoaște rase); partea de JS folosește cutia etichetată ca animal când
 * există, altfel cutia cea mai mare, altfel centrul cadrului.
 *
 * Modelul e în dependența Gradle, offline, ca Image Labeling. Nu e un fișier
 * separat de descărcat în CI.
 */
@CapacitorPlugin(name = "ObjectDetection")
class ObjectDetectionPlugin : Plugin() {
    private val executor = pluginExecutor("ObjectDetection")

    override fun handleOnDestroy() {
        executor.shutdown()
        super.handleOnDestroy()
    }

    private val detectorHolder = ReleasableModel({
        val options = ObjectDetectorOptions.Builder()
            .setDetectorMode(ObjectDetectorOptions.SINGLE_IMAGE_MODE)
            .enableMultipleObjects()
            .enableClassification()
            .build()
        ObjectDetection.getClient(options)
    }, { it.close() })

    @PluginMethod
    fun detectObjects(call: PluginCall) {
        executor.ruleaza(call, "Object detection failed") { detectLaFir(call) }
    }

    private fun detectLaFir(call: PluginCall) {
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return
        val image = InputImage.fromBitmap(bitmap, 0)
        CrashLog.pas(">ObjectDetection")
        detectorHolder.beginUse().process(image)
            .addOnCompleteListener(executor) { detectorHolder.endUse(); CrashLog.pas("<ObjectDetection") }
            .addOnSuccessListener(executor) { detected ->
                val objects = JSArray()
                detected.take(MAX_RETURNED).forEach { item ->
                    val box = item.boundingBox
                    val width = bitmap.width.coerceAtLeast(1).toDouble()
                    val height = bitmap.height.coerceAtLeast(1).toDouble()
                    val obj = JSObject()
                    obj.put("x", box.left / width)
                    obj.put("y", box.top / height)
                    obj.put("w", box.width() / width)
                    obj.put("h", box.height() / height)
                    val label = item.labels.maxByOrNull { it.confidence }
                    if (label != null) {
                        obj.put("label", label.text)
                        obj.put("score", label.confidence.toDouble())
                    }
                    objects.put(obj)
                }
                val result = JSObject()
                result.put("objects", objects)
                call.resolve(result)
            }
            .addOnFailureListener(executor) { e -> call.reject("Object detection failed: ${e.message}", e) }
    }
}
