package com.luminculler.app.cleaner.core

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Îmbunătățirea automată, partea de calcul: niveluri (negru și alb reale ale
 * pozei), luminozitate adusă spre mijloc printr-o gamma, apoi culoare puțin
 * mai vie. Fără „efect”: poza trebuie să arate ca ea, doar mai bine.
 */
object Enhance {
    /** Cât din histogramă se taie la fiecare capăt (zgomot, pixeli arși). */
    const val CLIP = 0.005f
    const val SATURATION = 1.12f

    /** Capetele reale ale unei histograme de 256 de valori, ignorând [clip] din pixeli la fiecare capăt. */
    fun levels(hist: IntArray, clip: Float = CLIP): Pair<Int, Int> {
        val total = hist.sum().coerceAtLeast(1)
        val cut = (total * clip).toLong()
        var acc = 0L
        var lo = 0
        while (lo < 255 && acc + hist[lo] <= cut) { acc += hist[lo]; lo++ }
        acc = 0L
        var hi = 255
        while (hi > 0 && acc + hist[hi] <= cut) { acc += hist[hi]; hi-- }
        // O poză aproape uniformă nu se întinde: ar ieși zgomot.
        if (hi - lo < 32) return 0 to 255
        // Nu întindem mai mult de dublu: o poză voit întunecată rămâne seară, nu zi.
        val minRange = 128
        if (hi - lo < minRange) {
            val start = ((hi + lo) / 2 - minRange / 2).coerceIn(0, 255 - minRange)
            return start to start + minRange
        }
        return lo to hi
    }

    /** Gamma care aduce luminozitatea medie (0..1, după niveluri) spre 0.48, cu măsură. */
    fun gamma(meanAfterLevels: Float): Float {
        val m = meanAfterLevels.coerceIn(0.05f, 0.95f)
        val g = (ln(0.48) / ln(m.toDouble())).toFloat()
        // Doar jumătate din drum: o corecție completă aplatizează atmosfera.
        return (1f + (g - 1f) * 0.5f).coerceIn(0.75f, 1.35f)
    }

    /** Tabelul final pe un canal: niveluri, apoi gamma. */
    fun lut(lo: Int, hi: Int, gamma: Float): IntArray = IntArray(256) { v ->
        val x = ((v - lo).toFloat() / (hi - lo).coerceAtLeast(1)).coerceIn(0f, 1f)
        (x.toDouble().pow(gamma.toDouble()) * 255).roundToInt().coerceIn(0, 255)
    }
}
