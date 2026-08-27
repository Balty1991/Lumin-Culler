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
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker

private const val MODEL_FILE = "pose_landmarker_lite.task"
private const val MAX_POSES = 8 // poze de grup — acelasi ordin de marime ca MAX_FACES din FaceMeshPlugin.kt

/**
 * Analiza AI nativa (Faza 5) — pozitia corpului (33 de puncte, topologie
 * standard BlazePose), port catre MediaPipe Pose Landmarker.
 *
 * Spre deosebire de celelalte plugin-uri (Faza 1-4), NU exista logica JS
 * echivalenta de portat aici — aplicatia nu are inca nicio scorare bazata pe
 * pozitie. Acest plugin doar dovedeste ca detectia functioneaza pe un device
 * real (numar de persoane + puncte de reper brute); orice formula noua de
 * scor bazata pe cadrare/postura ramane o decizie de produs separata, pentru
 * o discutie explicita — nu ceva de adaugat tacit aici.
 */
@CapacitorPlugin(name = "PoseDetection")
class PoseDetectionPlugin : Plugin() {

    /** Vezi ModelRegistry: `by lazy` nu se poate reseta, iar modelul asta
     *  tinea greutatile in memorie nativa si cat timp aplicatia statea in
     *  fundal — exact ce masoara Play ca Anonymous RSS. */
    private val poseLandmarkerHolder = ReleasableModel<PoseLandmarker>({
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setNumPoses(MAX_POSES)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        PoseLandmarker.createFromOptions(context, options)
    }, { it.close() })

    @PluginMethod
    fun detectPose(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        try {
            call.resolve(detect(bitmap))
        } catch (e: Exception) {
            call.reject("Pose detection failed: ${e.message}", e)
        }
    }

    private fun detect(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = poseLandmarkerHolder.use { it.detect(mpImage) }
        val peopleArray = JSArray()

        result?.landmarks()?.forEach { personLandmarks ->
            val landmarksArray = JSArray()
            for (lm in personLandmarks) {
                val point = JSObject()
                point.put("x", lm.x().toDouble())
                point.put("y", lm.y().toDouble())
                point.put("z", lm.z().toDouble())
                point.putOpt("visibility", if (lm.visibility().isPresent) lm.visibility().get().toDouble() else null)
                landmarksArray.put(point)
            }
            val personObj = JSObject()
            personObj.put("landmarks", landmarksArray)
            peopleArray.put(personObj)
        }

        val out = JSObject()
        out.put("people", peopleArray)
        return out
    }
}
