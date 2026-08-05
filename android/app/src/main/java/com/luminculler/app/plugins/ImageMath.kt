package com.luminculler.app.plugins

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Port Kotlin 1:1 al matematicii pure de compozitie/claritate/expunere/culoare
 * din src/workers/faceAnalysis.worker.ts (Faza 2, vezi planul native — nu
 * inca legat de fluxul real de analiza, doar de ImageAnalysisPlugin.kt).
 *
 * Fara dependinte Android/ML Kit — usor de comparat linie cu linie cu sursa
 * JS. Paritatea numerica EXACTA cu JS nu e scopul (downscale-ul Bitmap
 * foloseste alt algoritm de reesantionare decat Canvas 2D) — formulele,
 * pragurile si ponderile sunt copiate identic, doar pixelii de intrare difera usor.
 *
 * pixels: IntArray de pixeli ARGB (un Int per pixel, ca la Bitmap.getPixels),
 * NU octeti RGBA separati ca in JS — stride-urile de esantionare (4/2 pixeli
 * mai jos) sunt echivalentul exact al step=16/8 octeti din JS.
 */
object ImageMath {

    private fun luminance(pixel: Int): Double {
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        return 0.299 * r + 0.587 * g + 0.114 * b
    }

    /** Rotunjire "half up" ca Math.round din JS (kotlin.math.round e half-to-even). */
    private fun jsRound(x: Double): Double = Math.round(x).toDouble()

    // ── Claritate (sharpness) ───────────────────────────────────────────────

    fun varianceToSharpnessScore(variance: Double): Int {
        return min(100.0, jsRound(sqrt(max(0.0, variance)) * 2.2)).toInt()
    }

    /** Laplacian variance sharpness pe un buffer gray complet — 0..100. */
    fun laplacianSharpness(gray: FloatArray, w: Int, h: Int): Int {
        var sum = 0.0
        var sumSq = 0.0
        var n = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
                sum += lap
                sumSq += lap.toDouble() * lap
                n++
            }
        }
        if (n == 0) return 0
        val mean = sum / n
        val variance = sumSq / n - mean * mean
        return varianceToSharpnessScore(variance)
    }

    fun blendSubjectSharpness(subjectScore: Int?, globalScore: Int): Int {
        if (subjectScore == null) return globalScore
        return jsRound(0.7 * subjectScore + 0.3 * globalScore).toInt()
    }

    // ── Expunere & clipping ─────────────────────────────────────────────────

    private const val CLIP_HIGH_LUM = 250.0
    private const val CLIP_LOW_LUM = 5.0

    /** Esantioneaza 1 din 4 pixeli — echivalent cu step=16 octeti (RGBA) in JS. */
    fun exposureScore(pixels: IntArray): Int {
        var lum = 0.0
        var count = 0
        var i = 0
        while (i < pixels.size) {
            lum += luminance(pixels[i])
            count++
            i += 4
        }
        if (count == 0) return 0
        return jsRound((lum / count) / 255.0 * 100.0).toInt()
    }

    data class ClippingScores(val highlight: Double, val shadow: Double)

    /** Acelasi esantionaj (1 din 4 pixeli) ca exposureScore, pentru viteza. */
    fun clippingScores(pixels: IntArray): ClippingScores {
        var high = 0
        var low = 0
        var count = 0
        var i = 0
        while (i < pixels.size) {
            val lum = luminance(pixels[i])
            if (lum >= CLIP_HIGH_LUM) high++
            else if (lum <= CLIP_LOW_LUM) low++
            count++
            i += 4
        }
        return if (count > 0) ClippingScores(high.toDouble() / count, low.toDouble() / count) else ClippingScores(0.0, 0.0)
    }

    // ── Gray + Sobel (partajate) ─────────────────────────────────────────────

    fun toGray(pixels: IntArray): FloatArray {
        val gray = FloatArray(pixels.size)
        for (i in pixels.indices) gray[i] = luminance(pixels[i]).toFloat()
        return gray
    }

    /**
     * Catchlight ("lumina in ochi", Faza 4 — vezi FaceMeshPlugin.kt pentru
     * decupajul per-ochi care alimenteaza aici): un varf de luminanta
     * LOCALIZAT (nu tot ochiul luminos, care ar insemna doar o poza
     * supraexpusa) — cea mai luminoasa pata din decupaj comparata cu media
     * restului (fara o mica vecinatate in jurul ei). Praguri empirice (200
     * luminanta absoluta, +60 fata de rest), ca restul detectorilor din acest
     * fisier.
     */
    fun detectCatchlight(pixels: IntArray, w: Int, h: Int): Boolean {
        val gray = toGray(pixels)
        var maxLum = 0f
        var maxIdx = -1
        for (i in gray.indices) {
            if (gray[i] > maxLum) { maxLum = gray[i]; maxIdx = i }
        }
        if (maxLum < 200f || maxIdx < 0) return false
        val mx = maxIdx % w
        val my = maxIdx / w
        val excludeRadius = max(1, Math.round(min(w, h) * 0.15f))
        var sum = 0.0
        var n = 0
        for (y in 0 until h) {
            for (x in 0 until w) {
                if (hypot((x - mx).toDouble(), (y - my).toDouble()) <= excludeRadius) continue
                sum += gray[y * w + x]
                n++
            }
        }
        if (n == 0) return false
        return maxLum - sum / n >= 60
    }

    data class SobelMaps(val mag: FloatArray, val angleDeg: FloatArray)

    /** Gradient Sobel: magnitudine + unghiul muchiei (nu al gradientului), normalizat la (-90,90]. */
    fun sobel(gray: FloatArray, w: Int, h: Int): SobelMaps {
        val mag = FloatArray(w * h)
        val angleDeg = FloatArray(w * h)
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) -
                    (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1])
                val gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) -
                    (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1])
                mag[i] = hypot(gx.toDouble(), gy.toDouble()).toFloat()
                var edgeDeg = (atan2(gy.toDouble(), gx.toDouble()) * 180 / Math.PI) + 90
                edgeDeg = ((edgeDeg + 90) % 180 + 180) % 180 - 90
                angleDeg[i] = edgeDeg.toFloat()
            }
        }
        return SobelMaps(mag, angleDeg)
    }

    // ── Inclinare orizont ────────────────────────────────────────────────────

    private const val HORIZON_MAX_CONSIDER_DEG = 45.0
    private const val HORIZON_MIN_GRADIENT = 18.0
    private const val HORIZON_MIN_EDGE_PIXELS_FACTOR = 0.5

    /** Doar pentru poze fara fete — vezi ImageAnalysisPlugin (foloseste un buffer separat, cu raport de aspect pastrat). */
    fun detectHorizonTiltDeg(gray: FloatArray, w: Int, h: Int): Double? {
        var sumCos = 0.0
        var sumSin = 0.0
        var edgeCount = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) -
                    (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1])
                val gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) -
                    (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1])
                val mag = hypot(gx.toDouble(), gy.toDouble())
                if (mag < HORIZON_MIN_GRADIENT) continue
                var edgeDeg = (atan2(gy.toDouble(), gx.toDouble()) * 180 / Math.PI) + 90
                edgeDeg = ((edgeDeg + 90) % 180 + 180) % 180 - 90
                if (abs(edgeDeg) > HORIZON_MAX_CONSIDER_DEG) continue
                val rad2 = (edgeDeg * 2 * Math.PI) / 180
                sumCos += mag * cos(rad2)
                sumSin += mag * sin(rad2)
                edgeCount++
            }
        }
        if (edgeCount < w * HORIZON_MIN_EDGE_PIXELS_FACTOR) return null
        val meanDeg = (atan2(sumSin, sumCos) * 180 / Math.PI) / 2
        return jsRound(meanDeg * 10) / 10
    }

    // ── Compozitie (treimi / headroom) ──────────────────────────────────────

    /** [x, y, latime, inaltime], normalizat 0..1 fata de cadrul intreg — acelasi format ca FaceInsight.box din JS. */
    data class FaceBox(val x: Double, val y: Double, val w: Double, val h: Double)

    private val THIRDS_POINTS = arrayOf(
        1.0 / 3 to 1.0 / 3, 2.0 / 3 to 1.0 / 3, 1.0 / 3 to 2.0 / 3, 2.0 / 3 to 2.0 / 3
    )
    private val THIRDS_MAX_DIST = hypot(0.5 - 1.0 / 3, 0.5 - 1.0 / 3)

    /** Cat de aproape e centrul subiectului de o intersectie de treimi — 1 = pe linie, 0 = centrat sau mai rau. */
    fun ruleOfThirdsScore(cx: Double, cy: Double): Double {
        val d = THIRDS_POINTS.minOf { (tx, ty) -> hypot(cx - tx, cy - ty) }
        return max(0.0, min(1.0, 1 - d / THIRDS_MAX_DIST))
    }

    private const val HEADROOM_IDEAL_MIN = 0.04
    private const val HEADROOM_IDEAL_MAX = 0.22

    /** topY = distanta normalizata de la marginea de sus a cadrului la varful cutiei fetei. */
    fun headroomScore(topY: Double): Double {
        if (topY < HEADROOM_IDEAL_MIN) return topY / HEADROOM_IDEAL_MIN
        if (topY > HEADROOM_IDEAL_MAX) return max(0.0, 1 - (topY - HEADROOM_IDEAL_MAX) / (0.5 - HEADROOM_IDEAL_MAX))
        return 1.0
    }

    data class CompositionScore(val ruleOfThirds: Double, val headroom: Double)

    fun scoreComposition(faces: List<FaceBox>): CompositionScore {
        if (faces.isEmpty()) return CompositionScore(0.5, 0.5)
        val main = faces.maxBy { it.w * it.h }
        val cx = main.x + main.w / 2
        val cy = main.y + main.h / 2
        return CompositionScore(ruleOfThirdsScore(cx, cy), headroomScore(main.y))
    }

    // ── Linii directoare / simetrie / spatiu negativ / calitatea luminii ────

    private const val EDGE_SIGNIFICANT = 18.0 // acelasi prag ca HORIZON_MIN_GRADIENT

    fun detectLeadingLines(mag: FloatArray, angleDeg: FloatArray): Boolean {
        val bins = DoubleArray(18) // bin-uri de 10 grade, (-90,90]
        var total = 0.0
        for (i in mag.indices) {
            val m = mag[i].toDouble()
            if (m < EDGE_SIGNIFICANT) continue
            val bin = min(17, max(0, floor((angleDeg[i] + 90) / 10).toInt()))
            bins[bin] += m
            total += m
        }
        if (total < 1) return false
        val peak = bins.max()
        return peak / total > 0.22 // un singur bin de 10° concentreaza >22% din energia muchiilor
    }

    fun detectSymmetry(mag: FloatArray, w: Int, h: Int): Boolean {
        val grid = 16
        val halfW = w / 2
        val bw = max(1, halfW / grid)
        val bh = max(1, h / grid)
        var num = 0.0
        var denomA = 0.0
        var denomB = 0.0
        for (by in 0 until grid) {
            for (bx in 0 until grid) {
                var a = 0.0
                var b = 0.0
                for (y in by * bh until min(h, (by + 1) * bh)) {
                    for (x in bx * bw until min(halfW, (bx + 1) * bw)) {
                        val rightX = w - 1 - x
                        if (rightX < halfW) continue
                        a += mag[y * w + x]
                        b += mag[y * w + rightX]
                    }
                }
                num += a * b
                denomA += a * a
                denomB += b * b
            }
        }
        if (denomA < 1 || denomB < 1) return false
        return num / sqrt(denomA * denomB) > 0.6
    }

    fun negativeSpaceScore(gray: FloatArray, w: Int, h: Int): Double {
        val grid = 10
        val bw = max(1, w / grid)
        val bh = max(1, h / grid)
        var emptyBlocks = 0
        var totalBlocks = 0
        for (by in 0 until grid) {
            for (bx in 0 until grid) {
                var sum = 0.0
                var sumSq = 0.0
                var n = 0
                for (y in by * bh until min(h, (by + 1) * bh)) {
                    for (x in bx * bw until min(w, (bx + 1) * bw)) {
                        val v = gray[y * w + x].toDouble()
                        sum += v
                        sumSq += v * v
                        n++
                    }
                }
                if (n == 0) continue
                totalBlocks++
                val mean = sum / n
                val variance = sumSq / n - mean * mean
                if (variance < 60) emptyBlocks++ // prag empiric ~sub 8 nivele de gri deviatie standard
            }
        }
        return if (totalBlocks > 0) emptyBlocks.toDouble() / totalBlocks else 0.0
    }

    fun detectLightQuality(gray: FloatArray, mag: FloatArray): String {
        var sum = 0.0
        var sumSq = 0.0
        for (v in gray) {
            val d = v.toDouble()
            sum += d
            sumSq += d * d
        }
        val n = gray.size
        val mean = sum / n
        val lumStd = sqrt(max(0.0, sumSq / n - mean * mean))
        var edgeCount = 0
        var highEdge = 0
        for (m in mag) {
            if (m > 4) {
                edgeCount++
                if (m > 90) highEdge++
            }
        }
        if (edgeCount < n * 0.01) return "unknown" // cadru prea uniform pentru a estima duritatea luminii
        val hardEdgeFraction = highEdge.toDouble() / edgeCount
        if (hardEdgeFraction > 0.1 && lumStd > 55) return "hard"
        if (hardEdgeFraction < 0.04 && lumStd < 42) return "soft"
        return "mixed"
    }

    // ── Claritate subiect vs. fundal (focus/bokeh) ───────────────────────────

    fun boxesToMask(w: Int, h: Int, boxes: List<FaceBox>): ByteArray {
        val mask = ByteArray(w * h)
        for (box in boxes) {
            val x0 = max(0, jsRound(box.x * w).toInt())
            val y0 = max(0, jsRound(box.y * h).toInt())
            val x1 = min(w, jsRound((box.x + box.w) * w).toInt())
            val y1 = min(h, jsRound((box.y + box.h) * h).toInt())
            for (y in y0 until y1) for (x in x0 until x1) mask[y * w + x] = 1
        }
        return mask
    }

    fun regionLaplacianVariance(gray: FloatArray, w: Int, h: Int, mask: ByteArray, inside: Boolean): Double {
        var sum = 0.0
        var sumSq = 0.0
        var n = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                if ((mask[i].toInt() == 1) != inside) continue
                val lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
                sum += lap
                sumSq += lap.toDouble() * lap
                n++
            }
        }
        if (n < 20) return -1.0
        val mean = sum / n
        return sumSq / n - mean * mean
    }

    data class FocusBokehResult(val subjectInFocus: Boolean?, val bokehQuality: String, val subjectSharpness: Int?)

    /**
     * Doar pentru subiect = fete (vezi FaceDetectionPlugin) — varianta cu obiect
     * principal (mainObjectBox, pentru poze fara oameni) ramane pentru o faza
     * viitoare, cand exista detectie nativa de obiecte.
     */
    fun scoreFocusAndBokeh(gray: FloatArray, w: Int, h: Int, faces: List<FaceBox>): FocusBokehResult {
        if (faces.isEmpty()) return FocusBokehResult(null, "n/a", null)
        val mask = boxesToMask(w, h, faces)
        val subjectVar = regionLaplacianVariance(gray, w, h, mask, true)
        val bgVar = regionLaplacianVariance(gray, w, h, mask, false)
        if (subjectVar < 0 || bgVar < 0) return FocusBokehResult(null, "n/a", null)
        val subjectInFocus = subjectVar > 40 && subjectVar >= bgVar * 0.5
        val ratio = bgVar / max(subjectVar, 1.0)
        val bokehQuality = when {
            subjectVar < 40 -> "n/a" // subiectul insusi e neclar -> nu putem judeca bokeh-ul fundalului
            ratio < 0.35 -> "good"
            ratio < 0.65 -> "average"
            else -> "poor"
        }
        return FocusBokehResult(subjectInFocus, bokehQuality, varianceToSharpnessScore(subjectVar))
    }

    // ── Culoare ──────────────────────────────────────────────────────────────

    /** hue (grade, 0..360), saturatie (0..1), valoare (0..1). */
    fun rgbToHsv(r: Int, g: Int, b: Int): Triple<Double, Double, Double> {
        val rf = r / 255.0
        val gf = g / 255.0
        val bf = b / 255.0
        val maxV = max(rf, max(gf, bf))
        val minV = min(rf, min(gf, bf))
        val d = maxV - minV
        var hue = 0.0
        if (d != 0.0) {
            hue = when (maxV) {
                rf -> ((gf - bf) / d) % 6
                gf -> (bf - rf) / d + 2
                else -> (rf - gf) / d + 4
            }
            hue *= 60
            if (hue < 0) hue += 360
        }
        val sat = if (maxV == 0.0) 0.0 else d / maxV
        return Triple(hue, sat, maxV)
    }

    fun hexFromRgb(r: Double, g: Double, b: Double): String {
        fun c(v: Double): String {
            val clamped = max(0.0, min(255.0, jsRound(v))).toInt()
            return clamped.toString(16).padStart(2, '0')
        }
        return "#${c(r)}${c(g)}${c(b)}"
    }

    private const val HUE_BINS = 12 // 30 grade fiecare

    data class ColorAnalysis(val colorHarmonyScore: Double, val dominantColors: List<String>, val goldenHourDetected: Boolean)

    /** Esantioneaza 1 din 2 pixeli — echivalent cu step=8 octeti (RGBA) in JS. */
    fun analyzeColor(pixels: IntArray, exposure: Int): ColorAnalysis {
        val binWeight = DoubleArray(HUE_BINS)
        val binR = DoubleArray(HUE_BINS)
        val binG = DoubleArray(HUE_BINS)
        val binB = DoubleArray(HUE_BINS)
        var satSum = 0.0
        var totalWeight = 0.0
        var count = 0
        var i = 0
        while (i < pixels.size) {
            val p = pixels[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            val (hue, sat, value) = rgbToHsv(r, g, b)
            val weight = sat * value
            val bin = min(HUE_BINS - 1, floor(hue / (360.0 / HUE_BINS)).toInt())
            binWeight[bin] += weight
            binR[bin] += r * weight
            binG[bin] += g * weight
            binB[bin] += b * weight
            satSum += sat
            totalWeight += weight
            count++
            i += 2
        }
        val avgSat = if (count > 0) satSum / count else 0.0

        val order = (0 until HUE_BINS).sortedByDescending { binWeight[it] }
        val dominantColors = order.take(3)
            .filter { binWeight[it] > 0 }
            .map { hexFromRgb(binR[it] / binWeight[it], binG[it] / binWeight[it], binB[it] / binWeight[it]) }

        val colorHarmonyScore = when {
            avgSat < 0.12 -> 0.85 // aproape monocrom/gri — citit ca armonios prin conventie
            totalWeight > 0 -> {
                val top3 = binWeight[order[0]] +
                    (if (order.size > 1) binWeight[order[1]] else 0.0) +
                    (if (order.size > 2) binWeight[order[2]] else 0.0)
                max(0.0, min(1.0, top3 / totalWeight))
            }
            else -> 0.5
        }

        // bin-urile 0 si 1 acopera 0-60° (rosu-portocaliu-auriu) — cast cald tipic de ora de aur
        val warmWeight = binWeight[0] + binWeight[1]
        val goldenHourDetected = totalWeight > 0 && (warmWeight / totalWeight) > 0.3 && avgSat > 0.25 && exposure > 25 && exposure < 85

        return ColorAnalysis(jsRound(colorHarmonyScore * 100) / 100, dominantColors, goldenHourDetected)
    }

    private const val SKIN_HUE_MAX = 50.0
    private const val SKIN_MIN_SATURATION = 0.08

    /**
     * Nu e inca folosit de ImageAnalysisPlugin (AnalysisRecord.groupSkinToneNaturalRatio
     * e o medie pe toate fetele "cunoscute" — logica de agregare vine intr-o faza
     * viitoare, odata cu recunoasterea nativa). Portat acum ca sa fie gata.
     */
    fun hasNaturalSkinTone(pixels: IntArray, w: Int, h: Int, box: FaceBox): Boolean? {
        val x0 = max(0, jsRound(box.x * w).toInt())
        val y0 = max(0, jsRound(box.y * h).toInt())
        val x1 = min(w, jsRound((box.x + box.w) * w).toInt())
        val y1 = min(h, jsRound((box.y + box.h) * h).toInt())
        var sumWeight = 0.0
        var sumSin = 0.0
        var sumCos = 0.0
        for (y in y0 until y1) {
            for (x in x0 until x1) {
                val p = pixels[y * w + x]
                val r = (p shr 16) and 0xFF
                val g = (p shr 8) and 0xFF
                val b = p and 0xFF
                val (hue, sat, value) = rgbToHsv(r, g, b)
                if (sat < SKIN_MIN_SATURATION) continue
                val weight = sat * value
                val rad = hue * Math.PI / 180
                sumSin += weight * sin(rad)
                sumCos += weight * cos(rad)
                sumWeight += weight
            }
        }
        if (sumWeight < 1) return null
        var meanHue = atan2(sumSin, sumCos) * 180 / Math.PI
        if (meanHue < 0) meanHue += 360
        return meanHue <= SKIN_HUE_MAX || meanHue >= 350
    }

    // ── Agregare compozitie ──────────────────────────────────────────────────

    data class AggregateInput(
        val ruleOfThirds: Double,
        val headroom: Double,
        val hasFaces: Boolean,
        val leadingLines: Boolean,
        val symmetry: Boolean,
        val negativeSpace: Double
    )

    fun aggregateComposition(p: AggregateInput): Double {
        if (p.hasFaces) return jsRound((0.6 * p.ruleOfThirds + 0.4 * p.headroom) * 100) / 100
        // scena fara subiect uman: scor maxim la ~30% spatiu negativ (nici gol, nici aglomerat)
        val negativeSpaceBalance = max(0.0, 1 - abs(p.negativeSpace - 0.3) / 0.7)
        val score = 0.4 * (if (p.leadingLines) 1.0 else 0.0) +
            0.3 * (if (p.symmetry) 1.0 else 0.0) +
            0.3 * negativeSpaceBalance
        return jsRound(max(0.0, min(1.0, score)) * 100) / 100
    }
}
