package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.luminculler.app.ReleasableModel
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions

// Prag de pornire (nu inca ajustat pe evidenta de pe device real, spre
// deosebire de vechiul MIN_CONFIDENCE 0.75 din ObjectDetectionPlugin.kt —
// acel istoric de tuning era specific comportamentului modelului TFLite
// inlocuit aici si nu se transfera direct la acest model nou/diferit
// structural). 0.6 e valoarea recomandata uzual pentru modelul de baza
// Image Labeling — de revizuit dupa primul val de feedback real, la fel cum
// s-a intamplat si cu modelul vechi.
private const val MIN_CONFIDENCE = 0.6f
private const val MAX_RETURNED = 8 // aceeasi valoare ca object.maxDetected din faceAnalysis.worker.ts

/**
 * Analiza AI nativa (Faza 3, rescrisa) — etichete de scena/obiect, acum cu
 * Google ML Kit Image Labeling in loc de vechiul model TFLite
 * coco_ssd_mobilenet_v1_1.0_quant_2018_06_29 (2018).
 *
 * De ce schimbarea: acel model avea un vocabular FIX de 80 clase COCO, fara
 * nicio clasa de rezerva ("necunoscut"/"altceva") — orice subiect din afara
 * lor era fortat in cea mai apropiata clasa cunoscuta, chiar la incredere
 * joasa. Confirmat pe device real de 3 ori, cu 2 subiecte diferite: o lacusta
 * (complet in afara COCO) a primit "Elefant", apoi "Hidrant" in doua rulari
 * separate ale aceleiasi poze, iar mai tarziu o poza fara nicio bata de
 * baseball a primit eticheta "Bata De Baseball". Ridicarea repetata a
 * pragului de incredere (0.5 -> 0.65 -> 0.75) atenua simptomul, dar nu
 * rezolva cauza — un vocabular de doar 80 clase tot nu are unde sa puna un
 * subiect din afara lui.
 *
 * Image Labeling foloseste modelul de baza bundle-uit in APK (peste 400 de
 * etichete generice — taxonomie Open Images: "Insect", "Plant", "Vehicle"
 * etc.), tot OFFLINE, fara Play Services, ca fostul model si ca celelalte
 * module ML Kit (FaceDetection, TextRecognition) din acest proiect.
 *
 * Doua diferente fata de vechiul plugin, ambele verificate ca nu pierd
 * functionalitate reala:
 * - Etichetele NU se mai potrivesc garantat cu cheile din SCENE_TAG_LABELS_RO
 *   (core/sceneTagLabels.ts, calibrat pe cele 80 clase COCO folosite si de
 *   web/faceAnalysis.worker.ts) — translateSceneTag() are deja un fallback
 *   sigur (eticheta engleza neschimbata) pentru orice cheie negasita, deci
 *   nu blocheaza nimic; extinderea hartii de traduceri ramane un pas separat.
 * - API-ul nu mai intoarce casete de delimitare (box) — clasifica
 *   imaginea/regiunea, nu localizeaza obiecte individual. Verificat direct in
 *   core/nativeAnalysis.ts: vechiul box nu era consumat nicaieri in pipeline-ul
 *   real, doar `.label` intra in AnalysisRecord.sceneTags — nicio pierdere.
 */
@CapacitorPlugin(name = "ImageLabeling")
class ImageLabelingPlugin : Plugin() {

    /** Vezi ModelRegistry. Detectoarele ML Kit sunt ASINCRONE, deci
     *  eliberarea se leaga de terminarea inferentei (addOnCompleteListener),
     *  nu de intoarcerea functiei: inchiderea unui detector in timp ce
     *  ruleaza pe alt fir e un crash, nu o exceptie prinsa. */
    private val labelerHolder = ReleasableModel({
        ImageLabeling.getClient(
            ImageLabelerOptions.Builder().setConfidenceThreshold(MIN_CONFIDENCE).build()
        )
    }, { it.close() })

    @PluginMethod
    fun labelImage(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        val image = InputImage.fromBitmap(bitmap, 0)
        labelerHolder.beginUse().process(image)
            .addOnCompleteListener { labelerHolder.endUse() }
            .addOnSuccessListener { labels ->
                val labelsArray = JSArray()
                labels
                    .sortedByDescending { it.confidence }
                    .take(MAX_RETURNED)
                    .forEach { label ->
                        val obj = JSObject()
                        obj.put("label", label.text)
                        obj.put("score", label.confidence.toDouble())
                        labelsArray.put(obj)
                    }
                val result = JSObject()
                result.put("labels", labelsArray)
                call.resolve(result)
            }
            .addOnFailureListener { e -> call.reject("Image labeling failed: ${e.message}", e) }
    }
}
