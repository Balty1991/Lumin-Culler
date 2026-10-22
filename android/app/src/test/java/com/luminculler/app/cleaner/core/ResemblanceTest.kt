package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ResemblanceTest {
    private val rnd = Random(7)

    private fun unit(n: Int = 32) = Grow.normalize(FloatArray(n) { rnd.nextFloat() * 2 - 1 })

    /** Un vector la „distanța” [mix] de [base]: 0 = identic, 1 = cu totul altul. */
    private fun near(base: FloatArray, mix: Float): FloatArray {
        val other = unit(base.size)
        return Grow.normalize(FloatArray(base.size) { base[it] * (1 - mix) + other[it] * mix })
    }

    private var nextId = 1L
    private fun faces(center: FloatArray, mix: Float, n: Int) = List(n) {
        FaceHit(nextId++, 0L, 0.4f, 0.4f, 0.6f, 0.4f, 0.2f + it * 0.001f, 0f, near(center, mix))
    }

    @Test
    fun childCloserToMotherGetsTheBiggerShare() {
        val mom = unit(); val dad = unit()
        val childCenter = Grow.normalize(FloatArray(mom.size) { mom[it] * 0.7f + dad[it] * 0.3f })
        val r = Resemblance.compare(faces(childCenter, 0.2f, 10), listOf(faces(mom, 0.2f, 10), faces(dad, 0.2f, 10)))
        assertEquals(0, r.winner)
        assertTrue(r.percents[0] > r.percents[1])
        assertEquals(100, r.percents.sum())
        assertTrue(r.best.all { it != null })
    }

    @Test
    fun percentsStayInsideTheOpenScale() {
        val p = Resemblance.percents(listOf(0.9f, 0.1f))
        assertEquals(100, p.sum())
        assertTrue(p[1] >= Resemblance.MIN_PERCENT)
        assertEquals(listOf(50, 50), Resemblance.percents(listOf(0.4f, 0.4f)))
        assertEquals(listOf(100), Resemblance.percents(listOf(0.3f)))
        assertEquals(100, Resemblance.percents(listOf(0.31f, 0.33f, 0.2f)).sum())
    }

    @Test
    fun emptyRelativeScoresZero() {
        assertEquals(0f, Resemblance.score(faces(unit(), 0.1f, 3), emptyList()), 0f)
    }
}
