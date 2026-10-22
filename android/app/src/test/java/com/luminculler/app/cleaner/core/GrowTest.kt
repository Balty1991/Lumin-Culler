package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GrowTest {
    private val year = 365L * 24 * 3600 * 1000

    private fun face(id: Long, taken: Long, vararg v: Float) =
        FaceHit(id, taken, 0.4f, 0.4f, 0.6f, 0.4f, 0.3f, 0f, Grow.normalize(v))

    @Test
    fun alignMapsBothEyesExactly() {
        val m = Align.matrix(100f, 220f, 180f, 200f, 300f, 500f, 420f, 500f)
        val (x1, y1) = Align.apply(m, 100f, 220f)
        val (x2, y2) = Align.apply(m, 180f, 200f)
        assertEquals(300f, x1, 0.01f); assertEquals(500f, y1, 0.01f)
        assertEquals(420f, x2, 0.01f); assertEquals(500f, y2, 0.01f)
    }

    @Test
    fun growthFollowsAPersonThatChangesSlowly() {
        // Persoana se „mișcă” lent în spațiul vectorilor, an după an; străinul e în altă parte.
        val seed = face(1, 6 * year, 1f, 0f, 0f)
        val faces = listOf(
            seed,
            face(2, 5 * year, 0.95f, 0.31f, 0f),
            face(3, 4 * year, 0.81f, 0.59f, 0f),
            face(4, 3 * year, 0.59f, 0.81f, 0f),
            face(5, 6 * year, 0f, 0f, 1f) // străin
        )
        val c = Grow.candidates(seed, faces)
        assertEquals(listOf(4L, 3L, 2L, 1L), c.accepted.map { it.mediaId })
        assertTrue(c.maybe.none { it.mediaId == 5L })
    }

    @Test
    fun onlyOneFacePerPhotoAndFarPeriodsDoNotChain() {
        val seed = face(1, 10 * year, 1f, 0f)
        val faces = listOf(
            seed,
            face(1, 10 * year, 0.99f, 0.14f), // altă față din aceeași poză
            face(2, 10 * year, 0.98f, 0.2f),
            face(3, 1 * year, 1f, 0f) // identică, dar cu 9 ani înainte și fără punte între
        )
        val c = Grow.candidates(seed, faces)
        assertEquals(listOf(1L, 2L), c.accepted.map { it.mediaId })
    }

    @Test
    fun framesKeepTwoPerDayAndCapTheTotal() {
        val day = 86_400_000L
        val many = (0 until 10).map { face(it.toLong(), 3 * day + it, 1f) } + (0 until 500).map { face(100L + it, (10 + it) * day, 1f) }
        assertEquals(2, Grow.frames(many.take(10)).size)
        assertEquals(240, Grow.frames(many).size)
        assertEquals(0.7f, Grow.secondsPerPhoto(5), 0.001f)
        assertEquals(0.12f, Grow.secondsPerPhoto(1000), 0.001f)
    }
}
