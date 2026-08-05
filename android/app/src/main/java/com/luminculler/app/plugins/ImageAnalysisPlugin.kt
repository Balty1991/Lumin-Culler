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
import kotlin.math.max
import kotlin.math.min

private const val SMALL_SIZE = 320
private const val HORIZON_MAX_SIDE = 360

/**
 * Port Kotlin al matematicii de compozitie/claritate/expunere/culoare din
 * faceAnalysis.worker.ts (vezi ImageMath.kt pentru formule). Apelat din
 * src/core/nativeAnalysis.ts (orchestratorul pipeline-ului de analiza pe
 * Android), el insusi apelat din src/core/workerPool.ts (AnalysisPool).
 *
 * Foloseste propriul detector de fete (mod FAST, fara clasificare) doar ca
 * sa obtina cutiile pentru scorul de compozitie/focus-bokeh — nu si
 * probabilitatile de zambet/ochi, care raman treaba FaceDetectionPlugin.
 * ATENTIE: fiind un detector INDEPENDENT (FAST vs ACCURATE in
 * FaceDetectionPlugin), poate rata o fata pe care celalalt o gaseste —
 * `subjectInFocus`/compositionScore ar putea atunci sa nu reflecte un
 * faceCount>0 raportat in AnalysisRecord. Cunoscut, neconsiderat critic
 * momentan (vezi audit-ul din istoricul git) — de rezolvat intr-o faza
 * viitoare trecand cutiile deja gasite de FaceDetectionPlugin catre acest
 * plugin, in loc sa se re-detecteze.
 */
@CapacitorPlugin(name = "ImageAnalysis")
class ImageAnalysisPlugin : Plugin() {

    private val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .build()
        FaceDetection.getClient(options)
    }

    @PluginMethod
    fun analyze(call: PluginCall) {
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

        val image = InputImage.fromBitmap(bitmap, 0)
        detector.process(image)
            .addOnSuccessListener { mlFaces ->
                try {
                    val faceBoxes = mlFaces.map { f ->
                        val box = f.boundingBox
                        ImageMath.FaceBox(
                            x = box.left.toDouble() / bitmap.width,
                            y = box.top.toDouble() / bitmap.height,
                            w = box.width().toDouble() / bitmap.width,
                            h = box.height().toDouble() / bitmap.height
                        )
                    }
                    call.resolve(runAnalysis(bitmap, faceBoxes))
                } catch (e: Exception) {
                    call.reject("Image analysis failed: ${e.message}", e)
                }
            }
            .addOnFailureListener { e -> call.reject("Face detection failed: ${e.message}", e) }
    }

    /**
     * Ordinea de aici oglindeste sectiunea de wiring din analyze() (worker JS):
     * compozitie din fete; clipping/expunere/gray/sobel din bufferul 320x320;
     * linii directoare/simetrie/spatiu negativ/calitatea luminii din gray+sobel;
     * focus/bokeh din gray+fete; culoare din bufferul 320x320; orizont din
     * bufferul separat doar cand nu exista fete; agregarea compozitiei la final.
     */
    private fun runAnalysis(bitmap: Bitmap, faces: List<ImageMath.FaceBox>): JSObject {
        val small = Bitmap.createScaledBitmap(bitmap, SMALL_SIZE, SMALL_SIZE, true)
        val smallPixels = IntArray(SMALL_SIZE * SMALL_SIZE)
        small.getPixels(smallPixels, 0, SMALL_SIZE, 0, 0, SMALL_SIZE, SMALL_SIZE)

        val exposure = ImageMath.exposureScore(smallPixels)
        val clipping = ImageMath.clippingScores(smallPixels)
        val smallGray = ImageMath.toGray(smallPixels)
        val sobel = ImageMath.sobel(smallGray, SMALL_SIZE, SMALL_SIZE)
        val leadingLines = ImageMath.detectLeadingLines(sobel.mag, sobel.angleDeg)
        val symmetry = ImageMath.detectSymmetry(sobel.mag, SMALL_SIZE, SMALL_SIZE)
        val negativeSpace = ImageMath.negativeSpaceScore(smallGray, SMALL_SIZE, SMALL_SIZE)
        val lightQuality = ImageMath.detectLightQuality(smallGray, sobel.mag)
        val focusBokeh = ImageMath.scoreFocusAndBokeh(smallGray, SMALL_SIZE, SMALL_SIZE, faces)
        val sharpness = ImageMath.blendSubjectSharpness(
            focusBokeh.subjectSharpness,
            ImageMath.laplacianSharpness(smallGray, SMALL_SIZE, SMALL_SIZE)
        )
        val color = ImageMath.analyzeColor(smallPixels, exposure)
        val composition = ImageMath.scoreComposition(faces)

        var horizonTiltDeg: Double? = null
        if (faces.isEmpty()) {
            val scale = min(1.0, HORIZON_MAX_SIDE.toDouble() / max(bitmap.width, bitmap.height))
            val hw = max(1, Math.round(bitmap.width * scale).toInt())
            val hh = max(1, Math.round(bitmap.height * scale).toInt())
            val horizonBitmap = Bitmap.createScaledBitmap(bitmap, hw, hh, true)
            val horizonPixels = IntArray(hw * hh)
            horizonBitmap.getPixels(horizonPixels, 0, hw, 0, 0, hw, hh)
            val horizonGray = ImageMath.toGray(horizonPixels)
            horizonTiltDeg = ImageMath.detectHorizonTiltDeg(horizonGray, hw, hh)
        }

        val compositionScore = ImageMath.aggregateComposition(
            ImageMath.AggregateInput(
                ruleOfThirds = composition.ruleOfThirds,
                headroom = composition.headroom,
                hasFaces = faces.isNotEmpty(),
                leadingLines = leadingLines,
                symmetry = symmetry,
                negativeSpace = negativeSpace
            )
        )

        val result = JSObject()
        result.put("sharpness", sharpness)
        result.put("exposure", exposure)
        result.put("highlightClipping", clipping.highlight)
        result.put("shadowClipping", clipping.shadow)
        horizonTiltDeg?.let { result.put("horizonTiltDeg", it) }
        result.put("ruleOfThirds", composition.ruleOfThirds)
        result.put("headroom", composition.headroom)
        result.put("compositionScore", compositionScore)
        result.put("leadingLinesDetected", leadingLines)
        result.put("symmetryDetected", symmetry)
        result.put("negativeSpaceScore", negativeSpace)
        result.put("lightQuality", lightQuality)
        result.put("goldenHourDetected", color.goldenHourDetected)
        focusBokeh.subjectInFocus?.let { result.put("subjectInFocus", it) }
        result.put("bokehQuality", focusBokeh.bokehQuality)
        result.put("colorHarmonyScore", color.colorHarmonyScore)
        val dominantColors = JSArray()
        for (hex in color.dominantColors) dominantColors.put(hex)
        result.put("dominantColors", dominantColors)
        return result
    }
}
