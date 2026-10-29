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
import com.google.mediapipe.tasks.core.Delegate
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
    /**
     * Firul propriu al acestui plugin. Vezi PluginWork.kt: toate apelurile de
     * plugin treceau printr-un singur fir al Capacitor, si de acolo venea
     * paralelismul efectiv de 1,4 din 4 masurat pe telefon.
     */
    private val executor = pluginExecutor("ImageEmbedder")

    override fun handleOnDestroy() {
        executor.shutdown()
        super.handleOnDestroy()
    }


    /** Vezi ModelRegistry: `by lazy` nu se poate reseta, iar modelul asta
     *  tinea greutatile in memorie nativa si cat timp aplicatia statea in
     *  fundal — exact ce masoara Play ca Anonymous RSS. */
    private fun createEmbedder(delegate: Delegate): ImageEmbedder {
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).setDelegate(delegate).build()
        val options = ImageEmbedder.ImageEmbedderOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        return ImageEmbedder.createFromOptions(context, options)
    }

    /**
     * Placa video întâi: amprenta vizuală se calculează pentru fiecare poză din
     * galerie, deci aici câștigul de viteză contează cel mai mult. Fără delegat
     * GPU, crearea aruncă și rămâne procesorul. Diferențele de calcul între cele
     * două sunt de ordinul miimilor — căutarea după asemănare nu le simte.
     */
    private val imageEmbedderHolder = ReleasableModel<ImageEmbedder>({
        try { createEmbedder(Delegate.GPU) } catch (_: Exception) { createEmbedder(Delegate.CPU) }
    }, { it.close() })

    @PluginMethod
    fun embedImage(call: PluginCall) {
        // Vezi PluginWork.kt — decodarea si inferenta, pe firul plugin-ului.
        executor.ruleaza(call, "Image embedding failed") {
            val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return@ruleaza
            // Decupajul nu se reciclează aici: MediaPipe poate ține bitmapul
            // după embed(), iar recycle() pe un bitmap încă folosit omoară procesul.
            call.resolve(embed(cropNormalized(bitmap, call)))
        }
    }

    /**
     * Decupaj normalizat 0..1 (cropX/Y/W/H). Fără el, embeddingul e pe tot
     * cadrul — similaritatea de scenă de până acum. Cu el, doar animalul.
     * Bitmapul din cache nu se reciclează.
     */
    private fun cropNormalized(bitmap: Bitmap, call: PluginCall): Bitmap {
        val x = call.getDouble("cropX") ?: return bitmap
        val y = call.getDouble("cropY") ?: return bitmap
        val w = call.getDouble("cropW") ?: return bitmap
        val h = call.getDouble("cropH") ?: return bitmap
        if (!x.isFinite() || !y.isFinite() || !w.isFinite() || !h.isFinite()) return bitmap
        if (w <= 0.0 || h <= 0.0) return bitmap
        val left = (x * bitmap.width).toInt().coerceIn(0, (bitmap.width - 1).coerceAtLeast(0))
        val top = (y * bitmap.height).toInt().coerceIn(0, (bitmap.height - 1).coerceAtLeast(0))
        val width = (w * bitmap.width).toInt().coerceAtLeast(1).coerceAtMost(bitmap.width - left)
        val height = (h * bitmap.height).toInt().coerceAtLeast(1).coerceAtMost(bitmap.height - top)
        if (left == 0 && top == 0 && width == bitmap.width && height == bitmap.height) return bitmap
        return Bitmap.createBitmap(bitmap, left, top, width, height)
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
