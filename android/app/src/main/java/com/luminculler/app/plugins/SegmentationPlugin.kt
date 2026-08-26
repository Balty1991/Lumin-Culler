package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter

private const val MODEL_FILE = "selfie_multiclass.tflite"
// Ordinea claselor modelului selfie_multiclass (verificat din model card-ul
// oficial): 0=background, 1=hair, 2=body, 3=face, 4=clothes, 5=others.
private val PERSON_CLASSES = setOf(1, 2, 3, 4)

/**
 * Analiza AI nativa (Faza 5) — separare subiect/fundal (masca per-pixel,
 * persoana vs. restul cadrului), port catre MediaPipe Image Segmenter
 * (model selfie_multiclass — scopul e persoana, NU un subiect general ca un
 * produs sau un animal).
 *
 * De ce util: ImageMath.kt (Faza 2) aproximeaza azi "subiectul" ca o cutie
 * dreptunghiulara de fata (boxesToMask/scoreFocusAndBokeh) — o masca reala pe
 * pixel ar imbunatati real precizia comparatiei claritate subiect-vs-fundal.
 * Aceasta faza doar dovedeste ca detectia functioneaza si intoarce un
 * `personCoverage` derivat (fractiunea din cadru clasificata drept persoana) —
 * inlocuirea efectiva a mastii dreptunghiulare din ImageMath.kt ramane un pas
 * de integrare ulterior, dupa validare, nu parte din acest commit.
 */
@CapacitorPlugin(name = "Segmentation")
class SegmentationPlugin : Plugin() {

    private val imageSegmenter: ImageSegmenter by lazy {
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = ImageSegmenter.ImageSegmenterOptions.builder()
            .setBaseOptions(baseOptions)
            .setOutputCategoryMask(true)
            .setOutputConfidenceMasks(false)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        ImageSegmenter.createFromOptions(context, options)
    }

    @PluginMethod
    fun segmentSubject(call: PluginCall) {
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
            call.resolve(segment(bitmap))
        } catch (e: Exception) {
            call.reject("Segmentation failed: ${e.message}", e)
        }
    }

    private fun segment(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = imageSegmenter.segment(mpImage)
        val out = JSObject()

        val categoryMask = result?.categoryMask()
        if (categoryMask == null || !categoryMask.isPresent) {
            out.put("personCoverage", 0.0)
            out.put("maskWidth", 0)
            out.put("maskHeight", 0)
            return out
        }

        val maskImage = categoryMask.get()
        val buffer = ByteBufferExtractor.extract(maskImage)
        var personBytes = 0
        var total = 0
        while (buffer.hasRemaining()) {
            val classIndex = buffer.get().toInt() and 0xFF
            if (classIndex in PERSON_CLASSES) personBytes++
            total++
        }

        out.put("personCoverage", if (total > 0) personBytes.toDouble() / total else 0.0)
        out.put("maskWidth", maskImage.width)
        out.put("maskHeight", maskImage.height)
        return out
    }

    /**
     * Aceeasi segmentare, dar intoarce MASCA, nu doar procentul.
     *
     * De ce a fost nevoie: bokeh-ul din editor lucra pe casetele fetelor si un
     * gradient radial — adica pe o aproximare rotunda a unui om. Utilizatorul a
     * cerut sa "detecteze persoana, sa o separe de fundal". Modelul care face
     * exact asta era DEJA in APK (descarcat de CI de luni de zile) si deja
     * incarcat de plugin-ul asta; ii lipsea doar o metoda care sa dea afara
     * pixelii.
     *
     * Formatul: PNG alb-negru, ALB acolo unde e persoana. Alegerea nu e
     * arbitrara — pe partea de JS masca intra direct intr-un
     * `globalCompositeOperation = 'destination-out'`, unde albul opac sterge.
     * Deci nu mai trebuie nicio prelucrare pe pixeli in JS: se deseneaza si
     * atat. PNG, nu JPEG, fiindca o masca comprimata cu pierderi capata halouri
     * exact pe contur, adica fix acolo unde conteaza.
     */
    @PluginMethod
    fun segmentMask(call: PluginCall) {
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return
        try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result = imageSegmenter.segment(mpImage)
            val categoryMask = result?.categoryMask()
            if (categoryMask == null || !categoryMask.isPresent) {
                call.reject("No mask returned for this image")
                return
            }

            val maskImage = categoryMask.get()
            val buffer = ByteBufferExtractor.extract(maskImage)
            val w = maskImage.width
            val h = maskImage.height
            val pixels = IntArray(w * h)
            var personPixels = 0
            var i = 0
            while (buffer.hasRemaining() && i < pixels.size) {
                val isPerson = (buffer.get().toInt() and 0xFF) in PERSON_CLASSES
                if (isPerson) personPixels++
                pixels[i++] = if (isPerson) -0x1 else -0x1000000  // alb opac / negru opac
            }

            val mask = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
            val out = java.io.ByteArrayOutputStream()
            mask.compress(Bitmap.CompressFormat.PNG, 100, out)
            mask.recycle()

            val response = JSObject()
            response.put("maskBase64", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP))
            response.put("maskWidth", w)
            response.put("maskHeight", h)
            response.put("personCoverage", if (pixels.isNotEmpty()) personPixels.toDouble() / pixels.size else 0.0)
            call.resolve(response)
        } catch (e: Exception) {
            call.reject("Segmentation failed: ${e.message}", e)
        } finally {
            bitmap.recycle()
        }
    }
}
