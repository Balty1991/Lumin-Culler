package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSObject
import com.luminculler.app.ReleasableModel
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
 * Peste atata incredere pixelul se considera persoana. Pragul conteaza doar
 * pentru `personCoverage` (procentul raportat inapoi); masca propriu-zisa
 * pastreaza valoarea continua, ca sa aiba contur moale.
 */
private const val PERSON_CONFIDENCE = 0.5f

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

    /** Vezi ModelRegistry: `by lazy` nu se poate reseta, iar modelul asta
     *  tinea greutatile in memorie nativa si cat timp aplicatia statea in
     *  fundal — exact ce masoara Play ca Anonymous RSS. */
    private val imageSegmenterHolder = ReleasableModel<ImageSegmenter>({
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = ImageSegmenter.ImageSegmenterOptions.builder()
            .setBaseOptions(baseOptions)
            // Masca de INCREDERE, nu cea de categorii.
            //
            // Aici a fost bug-ul care estompa persoana in loc de fundal:
            // SelfieSegmenter are UN SINGUR canal de iesire, iar MediaPipe il
            // trateaza ca increderea pentru categoria 0. Adica persoana iese cu
            // indexul 0, iar un test "clasa != 0" selecteaza exact fundalul.
            // Semantica indexilor depinde de cate canale are modelul si nu e
            // scrisa nicaieri raspicat — pe cand masca de incredere e fara
            // echivoc: canalul 0 e probabilitatea sa fie persoana.
            //
            // Bonus, nu efect secundar: valoarea continua devine direct ALPHA,
            // deci conturul iese moale de la sine. Inainte se taia dur si se
            // inmuia dupa aceea cu un blur peste masca — o carpeala pe langa
            // ce da modelul gratis.
            .setOutputCategoryMask(false)
            .setOutputConfidenceMasks(true)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        ImageSegmenter.createFromOptions(context, options)
    }, { it.close() })

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

    /**
     * Primul (si singurul) canal de incredere: probabilitatea sa fie persoana.
     * `null` cand modelul n-a intors nimic — apelantul decide ce spune.
     */
    private fun firstConfidenceMask(result: com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult?): com.google.mediapipe.framework.image.MPImage? {
        val masks = result?.confidenceMasks() ?: return null
        if (!masks.isPresent || masks.get().isEmpty()) return null
        return masks.get()[0]
    }

    private fun segment(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = imageSegmenterHolder.use { it.segment(mpImage) }
        val out = JSObject()

        val maskImage = firstConfidenceMask(result)
        if (maskImage == null) {
            out.put("personCoverage", 0.0)
            out.put("maskWidth", 0)
            out.put("maskHeight", 0)
            return out
        }

        val buffer = ByteBufferExtractor.extract(maskImage).asFloatBuffer()
        var personPixels = 0
        var total = 0
        while (buffer.hasRemaining()) {
            if (buffer.get() >= PERSON_CONFIDENCE) personPixels++
            total++
        }

        out.put("personCoverage", if (total > 0) personPixels.toDouble() / total else 0.0)
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
     * Formatul: PNG cu ALPHA — persoana opaca, fundalul complet transparent.
     * Pe partea de JS masca intra intr-un
     * `globalCompositeOperation = 'destination-out'`, care sterge dupa ALPHA,
     * nu dupa culoare: de-aia fundalul trebuie sa fie transparent, nu negru.
     * PNG, nu JPEG — si fiindca JPEG n-are canal alpha, si fiindca o masca
     * comprimata cu pierderi capata halouri exact pe contur.
     */
    @PluginMethod
    fun segmentMask(call: PluginCall) {
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return
        try {
            val mpImage = BitmapImageBuilder(bitmap).build()
            CrashLog.pas(">Segmentation")
            val result = try { imageSegmenterHolder.use { it.segment(mpImage) } } finally { CrashLog.pas("<Segmentation") }
            val maskImage = firstConfidenceMask(result)
            if (maskImage == null) {
                call.reject("No mask returned for this image")
                return
            }

            val buffer = ByteBufferExtractor.extract(maskImage).asFloatBuffer()
            val w = maskImage.width
            val h = maskImage.height
            val pixels = IntArray(w * h)
            var personPixels = 0
            var i = 0
            while (buffer.hasRemaining() && i < pixels.size) {
                val incredere = buffer.get()
                if (incredere >= PERSON_CONFIDENCE) personPixels++
                // ALB peste tot, iar increderea devine ALPHA.
                //
                // Doua bug-uri au trecut prin locul asta, si merita amandoua
                // scrise: intai fundalul era negru OPAC, iar `destination-out`
                // sterge dupa alpha, nu dupa culoare — deci stergea tot cadrul.
                // Apoi masca a iesit inversata, fiindca semantica indexilor de
                // categorie depinde de cate canale are modelul.
                //
                // Increderea continua rezolva si a doua problema, si mai da si
                // conturul moale pe gratis: la marginea persoanei valoarea scade
                // lin, deci si stergerea e partiala acolo.
                val alpha = (incredere.coerceIn(0f, 1f) * 255f).toInt()
                pixels[i++] = (alpha shl 24) or 0x00FFFFFF
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
            recycleIfOwned(bitmap)
        }
    }
}
