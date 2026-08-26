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

private const val MODEL_FILE = "selfie_segmenter.tflite"

/**
 * Modelul e SelfieSegmenter general (249 KB), nu selfie_multiclass (16,4 MB).
 * Multiclass imparte omul in par/corp/fata/haine — o distinctie de care nimic
 * din aplicatie n-are nevoie. Aici ne trebuie o singura granita: om sau fundal.
 *
 * Masca de categorii da indexul clasei pe octet. Pentru modelul cu doua clase,
 * 0 e fundalul si persoana e restul. Testul e "diferit de zero", nu "egal cu 1",
 * fiindca unele versiuni MediaPipe scot 255 in loc de 1 pentru clasa activa —
 * ambele trec, si tot ce nu e fundal ramane persoana.
 */
private fun isPersonClass(classIndex: Int): Boolean = classIndex != 0

/**
 * Separare persoana/fundal, masca per-pixel — port catre MediaPipe Image
 * Segmenter (SelfieSegmenter: omul, NU un subiect general ca un produs sau un
 * animal).
 *
 * Cine il foloseste, azi, pe bune: bokeh-ul din editor (segmentMask mai jos →
 * core/nativeSegmentation.ts → applyBokeh in core/imageAdjust.ts). Nu mai e un
 * port de proba — plugin-ul asta e singurul lucru care stie unde se termina
 * omul si incepe fundalul, iar fara el bokeh-ul cade pe o elipsa in jurul
 * fetei, ceea ce utilizatorul a si reclamat.
 *
 * Ce ramane nefolosit: `personCoverage` NU e legat de scoreFocusAndBokeh din
 * ImageMath.kt (Faza 2), care aproximeaza in continuare subiectul cu o cutie
 * dreptunghiulara de fata. Ar fi o imbunatatire reala de precizie, dar
 * schimba scoruri pe toata biblioteca, inclusiv pe poze deja decise — deci e
 * o decizie separata, nu un efect secundar al bokeh-ului.
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
            if (isPersonClass(classIndex)) personBytes++
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
                val isPerson = isPersonClass(buffer.get().toInt() and 0xFF)
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
