package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.luminculler.app.ReleasableModel
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

    /** Vezi ModelRegistry: `by lazy` nu se poate reseta, iar modelul asta
     *  tinea greutatile in memorie nativa si cat timp aplicatia statea in
     *  fundal — exact ce masoara Play ca Anonymous RSS. */
    private val imageEmbedderHolder = ReleasableModel<ImageEmbedder>({
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = ImageEmbedder.ImageEmbedderOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        ImageEmbedder.createFromOptions(context, options)
    }, { it.close() })

    @PluginMethod
    fun embedImage(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        try {
            call.resolve(embed(bitmap))
        } catch (e: Exception) {
            call.reject("Image embedding failed: ${e.message}", e)
        }
    }

    private fun embed(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        CrashLog.pas(">ImageEmbedder")
        val embedding = try { imageEmbedderHolder.use { it.embed(mpImage) } } finally { CrashLog.pas("<ImageEmbedder") }
            .embeddingResult().embeddings().first()

        val embeddingArray = JSArray()
        for (value in embedding.floatEmbedding()) embeddingArray.put(value.toDouble())

        val out = JSObject()
        out.put("embedding", embeddingArray)
        return out
    }
}
