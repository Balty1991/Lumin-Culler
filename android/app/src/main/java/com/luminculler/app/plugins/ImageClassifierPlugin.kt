package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imageclassifier.ImageClassifier

private const val MODEL_FILE = "efficientnet_lite0.tflite"
private const val MAX_RESULTS = 5
// ImageNet-1000 e o problema mult mai grea (1000 clase specifice, ex. rase de
// caini) decat COCO-80 — un prag mic ca sa nu filtram totul pe poze mai ambigue;
// eticheta cea mai buna oricum vine prima (sortate descrescator mai jos).
private const val SCORE_THRESHOLD = 0.1f

/**
 * Analiza AI nativa (Faza 4) — etichete de scena/animal/peisaj complementare
 * celor din ImageLabelingPlugin.kt (Faza 3, ML Kit Image Labeling, ~400
 * etichete Open Images), cu propriul vocabular ImageNet-1000 (ex. rase
 * specifice de caini, tipuri de peisaj — "seashore", "alp" — pe care Open
 * Images nu le are). Model: EfficientNet-Lite0 (Google AI Edge). Complementar
 * cu ImageLabelingPlugin, NU un inlocuitor: niciunul din cele doua nu da cutii
 * de delimitare, ambele clasifica tot cadrul, doar cu vocabulare diferite.
 *
 * Etichetele raman in engleza (netraduse) — vezi sceneTagLabels.ts: traducerea
 * se face STRICT la afisare, iar acest plugin ramane dormant/dev-only, fara
 * nicio suprafata UI reala inca.
 *
 * La fel ca celelalte plugin-uri (Faza 1-4): dovedeste ca portul functioneaza
 * pe un device real, ramane dormant, accesibil doar din hook-ul de test din DEV.
 */
@CapacitorPlugin(name = "ImageClassifier")
class ImageClassifierPlugin : Plugin() {

    private val imageClassifier: ImageClassifier by lazy {
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = ImageClassifier.ImageClassifierOptions.builder()
            .setBaseOptions(baseOptions)
            .setMaxResults(MAX_RESULTS)
            .setScoreThreshold(SCORE_THRESHOLD)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        ImageClassifier.createFromOptions(context, options)
    }

    @PluginMethod
    fun classifyImage(call: PluginCall) {
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
            call.resolve(classify(bitmap))
        } catch (e: Exception) {
            call.reject("Image classification failed: ${e.message}", e)
        }
    }

    private fun classify(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = imageClassifier.classify(mpImage)
        val labelsArray = JSArray()
        val categories = result?.classificationResult()?.classifications()?.firstOrNull()?.categories()
        categories?.sortedByDescending { it.score() }?.forEach { category ->
            val obj = JSObject()
            obj.put("label", category.categoryName())
            obj.put("score", category.score().toDouble())
            labelsArray.put(obj)
        }

        val out = JSObject()
        out.put("labels", labelsArray)
        return out
    }
}
