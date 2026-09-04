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
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions

/**
 * Detectie de fete cu Google ML Kit (rulare 100% pe device, model impachetat
 * direct in APK, fara Play Services necesar la runtime pentru descarcarea
 * modelului). Apelat din src/core/nativeAnalysis.ts (orchestratorul
 * pipeline-ului de analiza pe Android), el insusi apelat din
 * src/core/workerPool.ts (AnalysisPool) — inlocuieste efectiv
 * faceAnalysis.worker.ts pe aceasta platforma.
 *
 * "detectFaces" primeste o imagine base64 (bridge-ul Capacitor duce doar JSON,
 * un Blob nu poate trece direct) — pentru poze la rezolutie completa, o faza
 * viitoare ar trebui sa treaca la un handoff prin fisier temporar
 * (@capacitor/filesystem, deja dependinta a proiectului) ca sa evite costul
 * de serializare al unui payload de cativa MB prin bridge.
 */
@CapacitorPlugin(name = "FaceDetection")
class FaceDetectionPlugin : Plugin() {

    /** Vezi ModelRegistry. Detectoarele ML Kit sunt ASINCRONE, deci
     *  eliberarea se leaga de terminarea inferentei (addOnCompleteListener),
     *  nu de intoarcerea functiei: inchiderea unui detector in timp ce
     *  ruleaza pe alt fir e un crash, nu o exceptie prinsa. */
    private val detectorHolder = ReleasableModel({
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            // necesar ca sa primim smilingProbability / eyeOpenProbability — fara asta,
            // ML Kit intoarce doar cutii de incadrare, fara nicio clasificare.
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(options)
    }, { it.close() })

    @PluginMethod
    fun detectFaces(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        val image = InputImage.fromBitmap(bitmap, /* rotationDegrees = */ 0)
        CrashLog.pas(">FaceDetection")
        detectorHolder.beginUse().process(image)
            .addOnCompleteListener { detectorHolder.endUse(); CrashLog.pas("<FaceDetection") }
            .addOnSuccessListener { faces ->
                val result = JSObject()
                val facesArray = JSArray()
                for (face in faces) {
                    val faceObj = JSObject()
                    val box = face.boundingBox
                    val boxObj = JSObject()
                    boxObj.put("left", box.left)
                    boxObj.put("top", box.top)
                    boxObj.put("width", box.width())
                    boxObj.put("height", box.height())
                    faceObj.put("boundingBox", boxObj)
                    // putOpt (nu put) — cele trei probabilitati sunt Float? nullabile in
                    // Kotlin (API-ul Java poate intoarce null daca clasificarea a esuat
                    // pentru acea fata); putOpt omite pur si simplu cheia daca valoarea
                    // e null, in loc sa rite un comportament neclar din put().
                    faceObj.putOpt("smilingProbability", face.smilingProbability?.toDouble())
                    faceObj.putOpt("leftEyeOpenProbability", face.leftEyeOpenProbability?.toDouble())
                    faceObj.putOpt("rightEyeOpenProbability", face.rightEyeOpenProbability?.toDouble())
                    facesArray.put(faceObj)
                }
                result.put("faces", facesArray)
                result.put("imageWidth", bitmap.width)
                result.put("imageHeight", bitmap.height)
                call.resolve(result)
                // Dupa citirea latimii/inaltimii de mai sus. Pe calea normala de
                // analiza bitmap-ul vine din cache si e imprumutat de alte trei
                // modele in acelasi timp, deci recycleIfOwned nu-l atinge (vezi
                // BitmapUtils.kt). Conteaza pentru PRE-SCANARE, care cere poza la
                // 320 px (vezi FACE_PRESCAN_SIZE in core/importPipeline.ts): acolo
                // bitmap-ul e numai al acestui apel, se cere o singura data, si
                // pana acum ramanea in seama colectorului pentru fiecare poza din
                // lot, inainte ca importul propriu-zis sa fi inceput.
                recycleIfOwned(bitmap)
            }
            .addOnFailureListener { e ->
                recycleIfOwned(bitmap)
                call.reject("Face detection failed: ${e.message}", e)
            }
    }
}
