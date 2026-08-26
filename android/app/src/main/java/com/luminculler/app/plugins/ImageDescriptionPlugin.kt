package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.genai.common.DownloadCallback
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.imagedescription.ImageDescriber
import com.google.mlkit.genai.imagedescription.ImageDescriberOptions
import com.google.mlkit.genai.imagedescription.ImageDescription
import com.google.mlkit.genai.imagedescription.ImageDescriptionRequest

/**
 * Descriere scrisa a unei poze, generata pe telefon de Gemini Nano prin
 * ML Kit GenAI (AICore). Nimic nu pleaca de pe dispozitiv.
 *
 * TREI LUCRURI PE CARE TREBUIE SA LE STIE CINE CITESTE ASTA:
 *
 * 1. Poate sa nu existe. Functia depinde de AICore si de modelul Gemini Nano,
 *    care nu sunt pe toate telefoanele — a pornit pe seria Pixel 10 si se
 *    extinde treptat. De aceea `status()` e o metoda separata si prima:
 *    partea de JS trebuie sa poata ASCUNDE actiunea, nu s-o ofere si sa esueze.
 *
 * 2. Modelul se descarca. `checkFeatureStatus` intoarce DOWNLOADABLE cand
 *    telefonul poate, dar inca n-are modelul. NU descarcam singuri, niciodata:
 *    e trafic si spatiu pe care le hotaraste omul, nu noi. `download()` e o
 *    metoda separata, chemata doar dupa ce cineva a apasat ceva.
 *
 * 3. Scrie in engleza. API-ul suporta deocamdata doar engleza. Intr-o
 *    aplicatie in romana asta conteaza si nu se poate ascunde — partea de JS o
 *    spune pe fata inainte sa se descarce ceva.
 *
 * Dependinta e in beta (1.0.0-beta1), singura instabila din proiect. Tot ce e
 * aici e scris ca sa poata lipsi, nu ca sa fie de la sine inteles.
 */
@CapacitorPlugin(name = "ImageDescription")
class ImageDescriptionPlugin : Plugin() {

    private val describer: ImageDescriber by lazy {
        ImageDescription.getClient(ImageDescriberOptions.builder(context).build())
    }

    /** "unavailable" | "downloadable" | "downloading" | "available" — sau "unsupported" daca nici clasa nu se poate crea. */
    @PluginMethod
    fun status(call: PluginCall) {
        try {
            describer.checkFeatureStatus()
                .addOnSuccessListener { featureStatus ->
                    val result = JSObject()
                    result.put("status", when (featureStatus) {
                        FeatureStatus.AVAILABLE -> "available"
                        FeatureStatus.DOWNLOADABLE -> "downloadable"
                        FeatureStatus.DOWNLOADING -> "downloading"
                        else -> "unavailable"
                    })
                    call.resolve(result)
                }
                .addOnFailureListener {
                    // Un esec la INTREBARE nu e o eroare de raportat omului — e
                    // un raspuns: pe telefonul asta functia nu exista.
                    val result = JSObject()
                    result.put("status", "unavailable")
                    call.resolve(result)
                }
        } catch (e: Throwable) {
            // Inclusiv NoClassDefFoundError, daca dependinta beta dispare de sub noi.
            val result = JSObject()
            result.put("status", "unsupported")
            call.resolve(result)
        }
    }

    /** Descarca modelul. Chemat DOAR dupa o apasare — vezi nota 2 din capul fisierului. */
    @PluginMethod
    fun download(call: PluginCall) {
        try {
            describer.downloadFeature(object : DownloadCallback {
                override fun onDownloadStarted(bytesToDownload: Long) {}
                override fun onDownloadProgress(totalBytesDownloaded: Long) {}
                override fun onDownloadCompleted() {
                    val result = JSObject()
                    result.put("downloaded", true)
                    call.resolve(result)
                }
                override fun onDownloadFailed(e: GenAiException) {
                    call.reject("Model download failed: ${e.message}", e)
                }
            })
        } catch (e: Throwable) {
            call.reject("Image description is not available on this device", e as? Exception)
        }
    }

    @PluginMethod
    fun describe(call: PluginCall) {
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return
        try {
            val request = ImageDescriptionRequest.builder(bitmap).build()
            describer.runInference(request)
                .addOnSuccessListener { inference ->
                    val result = JSObject()
                    result.put("description", inference.description)
                    call.resolve(result)
                    bitmap.recycle()
                }
                .addOnFailureListener { e ->
                    call.reject("Image description failed: ${e.message}", e as? Exception)
                    bitmap.recycle()
                }
        } catch (e: Throwable) {
            call.reject("Image description is not available on this device", e as? Exception)
            bitmap.recycle()
        }
    }
}
