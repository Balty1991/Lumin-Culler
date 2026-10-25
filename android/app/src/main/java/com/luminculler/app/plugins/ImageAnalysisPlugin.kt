package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
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
 * Nu mai are detector propriu. Cutiile vin de la Face Landmarker
 * (parametrul `faceBoxes`, normalizate 0..1). Fără ele, compoziția se
 * calculează ca pe un cadru fără subiect uman — nu se mai încarcă ML Kit Face.
 */
@CapacitorPlugin(name = "ImageAnalysis")
class ImageAnalysisPlugin : Plugin() {
    /**
     * Firul propriu al acestui plugin. Vezi PluginWork.kt: toate apelurile de
     * plugin treceau printr-un singur fir al Capacitor, si de acolo venea
     * paralelismul efectiv de 1,4 din 4 masurat pe telefon.
     */
    private val executor = pluginExecutor("ImageAnalysis")

    override fun handleOnDestroy() {
        executor.shutdown()
        super.handleOnDestroy()
    }


    @PluginMethod
    fun analyze(call: PluginCall) {
        // Vezi PluginWork.kt: decodarea imaginii si trimiterea catre model pleaca
        // de pe firul unic al puntii. Ascultatorii Task-ului primesc si ei
        // `executor` mai jos — fara el ruleaza pe firul PRINCIPAL, adica exact
        // peste WebView.
        executor.ruleaza(call, "Image analysis failed") { analyzeLaFir(call) }
    }

    /** Corpul lui `analyze`, pe firul plugin-ului. */
    private fun analyzeLaFir(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return
        try {
            call.resolve(runAnalysis(bitmap, faceBoxesFrom(call)))
        } catch (e: Exception) {
            call.reject("Image analysis failed: ${e.message}", e)
        } finally {
            recycleIfOwned(bitmap)
        }
    }

    private fun faceBoxesFrom(call: PluginCall): List<ImageMath.FaceBox> {
        val raw = call.getString("faceBoxes") ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val box = arr.getJSONObject(i)
                    add(ImageMath.FaceBox(box.getDouble("x"), box.getDouble("y"), box.getDouble("w"), box.getDouble("h")))
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Ordinea de aici oglindeste sectiunea de wiring din analyze() (worker JS):
     * compozitie din fete; clipping/expunere/gray/sobel din bufferul 320x320;
     * linii directoare/simetrie/spatiu negativ/calitatea luminii din gray+sobel;
     * focus/bokeh din gray+fete; culoare din bufferul 320x320; orizont din
     * bufferul separat doar cand nu exista un subiect uman prominent; agregarea
     * compozitiei la final.
     */
    private fun runAnalysis(bitmap: Bitmap, allFaces: List<ImageMath.FaceBox>): JSObject {
        // Compozitia, focusul si orizontul se decid dupa subiectii REALI ai
        // cadrului, nu dupa orice fata detectata — un trecator la 30 de metri
        // dintr-un peisaj nu face fotografia sa fie despre el. Oglinda fixului
        // din faceAnalysis.worker.ts; vezi src/core/subjectProminence.ts.
        val faces = ImageMath.prominentFaces(allFaces)
        val small = Bitmap.createScaledBitmap(bitmap, SMALL_SIZE, SMALL_SIZE, true)
        val smallPixels = IntArray(SMALL_SIZE * SMALL_SIZE)
        small.getPixels(smallPixels, 0, SMALL_SIZE, 0, 0, SMALL_SIZE, SMALL_SIZE)
        // Pixelii sunt deja copiati in `smallPixels`; bitmap-ul nu mai e nevoie.
        // Garda `!=` nu e formalitate: createScaledBitmap intoarce ACELASI obiect
        // cand dimensiunile se potrivesc deja, iar atunci am recicla chiar poza
        // de intrare, care mai e folosita mai jos.
        if (small != bitmap) small.recycle()

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
            if (horizonBitmap != bitmap) horizonBitmap.recycle()
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
        val dominantColors = JSONArray()
        for (hex in color.dominantColors) dominantColors.put(hex)
        result.put("dominantColors", dominantColors)
        return result
    }
}
