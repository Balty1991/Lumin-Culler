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
    fun framesKeepOnePerDayAndSpreadOverTime() {
        val day = 86_400_000L
        val sameDay = (0 until 10).map { face(it.toLong(), 3 * day + it, 1f) }
        assertEquals(1, Grow.frames(sameDay).size)
        // 400 de zile la rând în primul an, apoi câte o poză pe lună încă 3 ani.
        val dense = (0 until 400).map { face(100L + it, (10 + it) * day, 1f) }
        val sparse = (0 until 36).map { face(1000L + it, (500 + it * 30) * day, 1f) }
        val picked = Grow.frames(dense + sparse)
        assertEquals(Grow.MAX_FRAMES, picked.size)
        // Distribuite în timp: anii rari primesc și ei loc, nu doar anul plin de poze.
        assertTrue(picked.count { it.mediaId >= 1000L } >= 15)
        assertEquals(2.0f, Grow.secondsPerPhoto(5), 0.001f)
        assertEquals(0.9f, Grow.secondsPerPhoto(1000), 0.001f)
    }
}

class PeopleTest {
    private fun face(id: Long, width: Float, vararg v: Float) =
        FaceHit(id, id * 1000, 0.4f, 0.4f, 0.6f, 0.4f, width, 0f, Grow.normalize(v))

    @Test
    fun eachPersonOnceSortedByPhotos() {
        val a = (1L..5L).map { face(it, 0.2f + it * 0.01f, 1f, 0.05f * it, 0f) }
        val b = (10L..12L).map { face(it, 0.3f, 0f, 1f, 0.05f * it) }
        val lone = face(99, 0.5f, 0f, 0f, 1f)
        val people = People.cluster(a + b + lone)
        assertEquals(2, people.size)
        assertEquals(5, people[0].photos)
        assertEquals(3, people[1].photos)
        assertEquals(5L, people[0].cover.mediaId)
    }
}
