package com.luminculler.app.cleaner.core

import kotlin.math.exp
import kotlin.math.roundToInt

/**
 * „Pe cine seamănă?”: cât de aproape sunt trăsăturile unui copil de ale
 * fiecărei rude alese, din descriptorii FaceRes ai pozelor din galerie.
 *
 * Descriptorul e făcut să deosebească oameni, dar rudele ies sistematic mai
 * aproape decât străinii, deci comparația spune ceva real — prea puțin cât să
 * fie test de paternitate, destul cât să fie un joc de familie. Ecranul o spune.
 */
object Resemblance {
    /** Câte perechi bune contează: media celor mai bune K, nu doar cea mai bună (care poate fi noroc). */
    const val TOP = 5
    /** Câte fețe folosim de fiecare om (cele mai mari, deci cele mai clare). */
    const val SAMPLE = 60
    /** „Temperatura” cu care diferențele mici de similaritate devin procente. */
    const val SOFTNESS = 0.04f
    /** Nimeni nu seamănă 100% cu un singur părinte; capetele scalei rămân deschise. */
    const val MIN_PERCENT = 12

    class Match(val child: FaceHit, val relative: FaceHit, val similarity: Float)

    class Result(
        /** Similaritatea fiecărei rude, în ordinea primită. */
        val scores: List<Float>,
        /** Aceleași rude, în procente care adună 100. */
        val percents: List<Int>,
        /** Pentru fiecare rudă: cele două poze în care seamănă cel mai mult. */
        val best: List<Match?>
    ) {
        /** Indicele rudei cu care seamănă cel mai mult. */
        val winner: Int get() = percents.indices.maxBy { percents[it] }
    }

    private fun sample(faces: List<FaceHit>): List<FaceHit> =
        if (faces.size <= SAMPLE) faces else faces.sortedByDescending { it.width }.take(SAMPLE)

    /** Cât seamănă [child] cu [relative]: media celor mai bune [TOP] potriviri ale fețelor copilului. */
    fun score(child: List<FaceHit>, relative: List<FaceHit>): Float {
        val a = sample(child)
        val b = sample(relative)
        if (a.isEmpty() || b.isEmpty()) return 0f
        val bestPerChild = a.map { c -> b.maxOf { r -> Grow.dot(c.embedding, r.embedding) } }
        val top = bestPerChild.sortedDescending().take(TOP)
        return top.average().toFloat()
    }

    fun bestMatch(child: List<FaceHit>, relative: List<FaceHit>): Match? {
        var best: Match? = null
        for (c in sample(child)) for (r in sample(relative)) {
            if (r.mediaId == c.mediaId) continue
            val s = Grow.dot(c.embedding, r.embedding)
            if (best == null || s > best.similarity) best = Match(c, r, s)
        }
        return best
    }

    /** Procente care adună 100, cu niciunul sub [MIN_PERCENT] când sunt cel puțin două rude. */
    fun percents(scores: List<Float>): List<Int> {
        if (scores.isEmpty()) return emptyList()
        if (scores.size == 1) return listOf(100)
        val top = scores.max()
        val weights = scores.map { exp(((it - top) / SOFTNESS).toDouble()) }
        val sum = weights.sum()
        val floor = MIN_PERCENT.toDouble()
        val spare = 100.0 - floor * scores.size
        val raw = weights.map { floor + spare * it / sum }
        val rounded = raw.map { it.roundToInt() }.toMutableList()
        // Rotunjirea poate da 99 sau 101; diferența merge la cel mai mare.
        val fix = 100 - rounded.sum()
        val i = rounded.indices.maxBy { rounded[it] }
        rounded[i] += fix
        return rounded
    }

    fun compare(child: List<FaceHit>, relatives: List<List<FaceHit>>): Result {
        val scores = relatives.map { score(child, it) }
        return Result(scores, percents(scores), relatives.map { bestMatch(child, it) })
    }
}
