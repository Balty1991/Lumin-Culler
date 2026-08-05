package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions

/**
 * Analiza AI nativa (Faza 1) — detectie de fete cu Google ML Kit (rulare 100%
 * pe device, model impachetat direct in APK, fara Play Services necesar la
 * runtime pentru descarcarea modelului). Scop: doar sa dovedeasca lantul de
 * unelte (Kotlin + plugin Capacitor + ML Kit) functioneaza pe un device real,
 * NU inca inlocuirea reala a pipeline-ului de analiza (vezi
 * src/core/workerPool.ts / faceAnalysis.worker.ts pe partea JS — acelea raman
 * neschimbate pana la o faza urmatoare).
 *
 * "detectFaces" primeste o imagine base64 (bridge-ul Capacitor duce doar JSON,
 * un Blob nu poate trece direct) — pentru poze la rezolutie completa, o faza
 * viitoare ar trebui sa treaca la un handoff prin fisier temporar
 * (@capacitor/filesystem, deja dependinta a proiectului) ca sa evite costul
 * de serializare al unui payload de cativa MB prin bridge.
 */
@CapacitorPlugin(name = "FaceDetection")
class FaceDetectionPlugin : Plugin() {

    private val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            // necesar ca sa primim smilingProbability / eyeOpenProbability — fara asta,
            // ML Kit intoarce doar cutii de incadrare, fara nicio clasificare.
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(options)
    }

    @PluginMethod
    fun detectFaces(call: PluginCall) {
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

        val image = InputImage.fromBitmap(bitmap, /* rotationDegrees = */ 0)
        detector.process(image)
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
            }
            .addOnFailureListener { e -> call.reject("Face detection failed: ${e.message}", e) }
    }
}
