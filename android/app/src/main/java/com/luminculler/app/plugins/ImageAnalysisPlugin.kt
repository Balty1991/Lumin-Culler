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
 * Cutiile de fete VIN DE LA APELANT (parametrul `faces`), deja gasite de
 * FaceDetection pe aceeasi poza. Din ele ies compozitia, focus/bokeh si
 * orizontul.
 *
 * Pana acum plugin-ul isi pornea propriul detector, in mod FAST, si comentariul
 * de aici spunea ca "de rezolvat intr-o faza viitoare trecand cutiile deja
 * gasite de FaceDetectionPlugin". Faza aia e asta. Erau doua detectii ML Kit pe
 * fiecare poza cu oameni, iar cele doua puteau sa nu fie de acord: FAST rata
 * fete pe care ACCURATE le gasea, si atunci `subjectInFocus`/compositionScore
 * nu reflectau faceCount-ul raportat in AnalysisRecord.
 *
 * Detectorul de mai jos ramane, dar ca REZERVA: pentru apelantii care nu trimit
 * `faces` (calea cu imageBase64, butonul de test din meniu). Nu mai e calea
 * normala.
 */
@CapacitorPlugin(name = "ImageAnalysis")
class ImageAnalysisPlugin : Plugin() {

    /** Vezi ModelRegistry. Detectoarele ML Kit sunt ASINCRONE, deci
     *  eliberarea se leaga de terminarea inferentei (addOnCompleteListener),
     *  nu de intoarcerea functiei: inchiderea unui detector in timp ce
     *  ruleaza pe alt fir e un crash, nu o exceptie prinsa. */
    private val detectorHolder = ReleasableModel({
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .build()
        FaceDetection.getClient(options)
    }, { it.close() })

    /**
     * Cutiile venite de la apelant, deja normalizate 0..1 — sau null daca n-a
     * trimis niciuna.
     *
     * O lista GOALA nu e acelasi lucru cu absenta: inseamna "s-a cautat si nu e
     * nimeni in cadru", si atunci nu mai cautam a doua oara. Doar cheia lipsa
     * porneste detectorul propriu.
     */
    private fun cutiiPrimite(call: PluginCall): List<ImageMath.FaceBox>? {
        val array = call.getArray("faces") ?: return null
        return try {
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                ImageMath.FaceBox(
                    x = o.getDouble("x"), y = o.getDouble("y"),
                    w = o.getDouble("w"), h = o.getDouble("h")
                )
            }
        } catch (e: org.json.JSONException) {
            // Cutii malformate: mai bine cautam singuri decat sa cadem. Nu se
            // poate intampla de la apelantul din nativeAnalysis.ts, dar plugin-ul
            // e o interfata publica, nu o functie privata a acelui fisier.
            CrashLog.pas("!ImageAnalysis-cutii:${e.message}")
            null
        }
    }

    @PluginMethod
    fun analyze(call: PluginCall) {
        // Preferam `imageUri` (fara nicio imagine peste punte); `imageBase64`
        // ramane pentru pozele care nu vin din galerie. Vezi BitmapUtils.kt.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        // Calea normala de analiza: fetele vin de la FaceDetection, care a rulat
        // deja pe ACEEASI poza. Pana acum se detecta din nou aici, in mod FAST —
        // a doua detectie ML Kit pe acelasi cadru, ale carei cutii intrau in
        // compozitie, focus si orizont. Doua detectoare care puteau sa nu fie de
        // acord, si costul unei detectii intregi pe fiecare poza cu oameni.
        val primite = cutiiPrimite(call)
        if (primite != null) {
            try {
                call.resolve(runAnalysis(bitmap, primite))
            } catch (e: Exception) {
                call.reject("Image analysis failed: ${e.message}", e)
            } finally {
                recycleIfOwned(bitmap)
            }
            return
        }

        val image = InputImage.fromBitmap(bitmap, 0)
        CrashLog.pas(">ImageAnalysis-fete")
        detectorHolder.beginUse().process(image)
            .addOnCompleteListener { detectorHolder.endUse(); CrashLog.pas("<ImageAnalysis-fete") }
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
                } finally {
                    // Poza de intrare se elibereaza pe AMBELE cai, si aici si in
                    // esec. Un import de 500 de cadre inseamna 500 de bitmap-uri
                    // la dimensiune intreaga lasate in seama colectorului; Google
                    // masoara de acum exact asta (pragul de memorie bitmap din
                    // cerintele Play), iar pe telefoanele cu putina memorie nu e
                    // doar o cifra — e diferenta dintre a merge si a fi inchis.
                    recycleIfOwned(bitmap)
                }
            }
            .addOnFailureListener { e ->
                recycleIfOwned(bitmap)
                call.reject("Face detection failed: ${e.message}", e)
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
        val dominantColors = JSArray()
        for (hex in color.dominantColors) dominantColors.put(hex)
        result.put("dominantColors", dominantColors)
        return result
    }
}
