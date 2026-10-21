package com.luminculler.app.cleaner.core

import kotlin.math.sqrt

/**
 * Măsurătorile din care ies semnalele, pe un tablou de gri (0..255), rând
 * după rând. Stratul Android micșorează poza și o transformă în gri; restul e
 * aici, ca să poată fi testat fără telefon.
 */
object ImageMath {

    /** Sub această abatere standard a luminozității, cadrul e „plat”. */
    const val FLAT_STD = 10.0

    /**
     * dHash pe o grilă 9×8: bitul e 1 când pixelul din stânga e mai luminos
     * decât vecinul din dreapta. Primește deja grila redusă la 9×8.
     */
    fun dHash(gray9x8: IntArray): Long {
        require(gray9x8.size >= 72) { "dHash cere 9×8 valori" }
        var hash = 0L
        var bit = 0
        for (y in 0 until 8) {
            for (x in 0 until 8) {
                if (gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1]) hash = hash or (1L shl bit)
                bit++
            }
        }
        return hash
    }

    /** Reduce un tablou de gri w×h la 9×8 prin medie pe zone. */
    fun downscaleTo9x8(gray: IntArray, w: Int, h: Int): IntArray {
        val out = IntArray(72)
        for (y in 0 until 8) {
            val y0 = y * h / 8
            val y1 = maxOf(y0 + 1, (y + 1) * h / 8)
            for (x in 0 until 9) {
                val x0 = x * w / 9
                val x1 = maxOf(x0 + 1, (x + 1) * w / 9)
                var sum = 0L
                var n = 0
                for (yy in y0 until minOf(y1, h)) {
                    for (xx in x0 until minOf(x1, w)) {
                        sum += gray[yy * w + xx]
                        n++
                    }
                }
                out[y * 9 + x] = if (n == 0) 0 else (sum / n).toInt()
            }
        }
        return out
    }

    /** Varianța laplacianului 4-vecini. */
    fun laplacianVariance(gray: IntArray, w: Int, h: Int): Double {
        if (w < 3 || h < 3) return 0.0
        var sum = 0.0
        var sumSq = 0.0
        var n = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val c = gray[y * w + x]
                val lap = gray[(y - 1) * w + x] + gray[(y + 1) * w + x] +
                    gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * c
                sum += lap
                sumSq += lap.toDouble() * lap
                n++
            }
        }
        if (n == 0) return 0.0
        val mean = sum / n
        return sumSq / n - mean * mean
    }

    fun std(gray: IntArray): Double {
        if (gray.isEmpty()) return 0.0
        var sum = 0.0
        var sumSq = 0.0
        for (v in gray) {
            sum += v
            sumSq += v.toDouble() * v
        }
        val mean = sum / gray.size
        return sqrt(maxOf(0.0, sumSq / gray.size - mean * mean))
    }

    fun signals(gray: IntArray, w: Int, h: Int): Signals {
        val flat = std(gray) < FLAT_STD
        return Signals(
            blur = laplacianVariance(gray, w, h).toFloat(),
            hash = dHash(downscaleTo9x8(gray, w, h)),
            flat = flat
        )
    }

    fun hamming(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)
}
