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
import com.google.mediapipe.tasks.vision.imageembedder.ImageEmbedder

private const val MODEL_FILE = "mobilenet_v3_small.tflite"

/**
 * Analiza AI nativa (Faza 6) — embedding general de similaritate vizuala
 * (continut, NU identitate/biometrie), port catre MediaPipe Image Embedder +
 * MobileNetV3-small (antrenat pe ImageNet, aceeasi proveniența oficiala clara
 * ca celelalte modele MediaPipe deja folosite).
 *
 * De ce util: hashCompare.worker.ts (partea JS) foloseste deja un al doilea
 * semnal (similaritate cosinus a embedding-urilor de fata) ca sa rafineze
 * grupurile de rafale/duplicate gasite prin dHash — dar DOAR cand exista fete.
 * Rafale fara oameni (peisaje, animale) cad azi pe un semnal mult mai slab
 * (doar compozitie+armonie culori). Acest embedding general ar da acelasi tip
 * de "a doua opinie" si pentru poze fara fete — NECONECTAT inca, doar dovedit
 * ca functioneaza (la fel ca restul plugin-urilor native).
 */
@CapacitorPlugin(name = "ImageEmbedder")
class ImageEmbedderPlugin : Plugin() {

    private val imageEmbedder: ImageEmbedder by lazy {
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = ImageEmbedder.ImageEmbedderOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        ImageEmbedder.createFromOptions(context, options)
    }

    @PluginMethod
    fun embedImage(call: PluginCall) {
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
            call.resolve(embed(bitmap))
        } catch (e: Exception) {
            call.reject("Image embedding failed: ${e.message}", e)
        }
    }

    private fun embed(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val embedding = imageEmbedder.embed(mpImage).embeddingResult().embeddings().first()

        val embeddingArray = JSArray()
        for (value in embedding.floatEmbedding()) embeddingArray.put(value.toDouble())

        val out = JSObject()
        out.put("embedding", embeddingArray)
        return out
    }
}
