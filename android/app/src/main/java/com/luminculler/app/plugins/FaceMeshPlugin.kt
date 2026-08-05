package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker

private const val MODEL_FILE = "face_landmarker.task"
// Pozele de grup (tinta principala a aplicatiei) au nevoie de mai mult decat 1
// fata — exemplele oficiale Google folosesc 1 (caz de utilizare selfie);
// acelasi ordin de marime ca detector.maxDetected din faceAnalysis.worker.ts (15).
private const val MAX_FACES = 15

/**
 * Semnale fine de fata (zambet autentic/emotie aproximata/contact vizual),
 * port catre MediaPipe Face Landmarker + formulele din FaceMeshMath.kt.
 * Apelat din src/core/nativeAnalysis.ts (orchestratorul pipeline-ului de
 * analiza pe Android), doar cand exista cel putin o fata detectata.
 */
@CapacitorPlugin(name = "FaceMesh")
class FaceMeshPlugin : Plugin() {

    private val faceLandmarker: FaceLandmarker by lazy {
        val baseOptions = BaseOptions.builder().setModelAssetPath(MODEL_FILE).build()
        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setNumFaces(MAX_FACES)
            .setOutputFaceBlendshapes(true)
            .setOutputFacialTransformationMatrixes(true)
            .setRunningMode(RunningMode.IMAGE)
            .build()
        FaceLandmarker.createFromOptions(context, options)
    }

    @PluginMethod
    fun analyzeFaceMesh(call: PluginCall) {
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
            call.resolve(analyze(bitmap))
        } catch (e: Exception) {
            call.reject("Face mesh analysis failed: ${e.message}", e)
        }
    }

    private fun analyze(bitmap: Bitmap): JSObject {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = faceLandmarker.detect(mpImage)
        val facesArray = JSArray()
        if (result == null) {
            val empty = JSObject()
            empty.put("faces", facesArray)
            return empty
        }

        val landmarksPerFace = result.faceLandmarks()
        val blendshapesPerFace = if (result.faceBlendshapes().isPresent) result.faceBlendshapes().get() else emptyList()
        val matricesPerFace = if (result.facialTransformationMatrixes().isPresent) result.facialTransformationMatrixes().get() else emptyList()

        for (i in landmarksPerFace.indices) {
            // Normalizat (0..1) -> pixel, acelasi format ("coordonate PIXEL") ca mesh-ul Human.js din JS.
            val mesh = landmarksPerFace[i].map {
                FaceMeshMath.Point(it.x().toDouble() * bitmap.width, it.y().toDouble() * bitmap.height)
            }

            val blendshapeMap: Map<String, Double> = if (i < blendshapesPerFace.size) {
                blendshapesPerFace[i].associate { it.categoryName() to it.score().toDouble() }
            } else emptyMap()
            val emotion = FaceMeshMath.approximateEmotion(blendshapeMap)

            val leftOpen = FaceMeshMath.eyeOpenness(mesh, FaceMeshMath.LEFT_EYE)
            val rightOpen = FaceMeshMath.eyeOpenness(mesh, FaceMeshMath.RIGHT_EYE)
            val mouthOpen = FaceMeshMath.isMouthOpen(mesh)

            val faceObj = JSObject()
            faceObj.put("smile", emotion.happy)
            faceObj.put("emotionSurprise", emotion.surprise)
            faceObj.put("emotionNegative", emotion.negative)
            val eyesOpenObj = JSObject()
            eyesOpenObj.put("left", leftOpen)
            eyesOpenObj.put("right", rightOpen)
            faceObj.put("eyesOpen", eyesOpenObj)
            faceObj.put("mouthOpen", mouthOpen)
            faceObj.put("genuineSmile", FaceMeshMath.isGenuineSmile(emotion.happy, leftOpen, rightOpen))
            faceObj.put("awkwardExpression", FaceMeshMath.isAwkwardExpression(mouthOpen, emotion.happy, emotion.surprise))
            faceObj.put("engagement", FaceMeshMath.engagementScore(emotion.happy, emotion.surprise, emotion.negative))

            if (i < matricesPerFace.size) {
                val pose = FaceMeshMath.headPoseFromMatrix(matricesPerFace[i])
                faceObj.put("eyeContact", FaceMeshMath.eyeContactScore(pose.yaw, pose.pitch))
            }

            facesArray.put(faceObj)
        }

        val out = JSObject()
        out.put("faces", facesArray)
        return out
    }
}
