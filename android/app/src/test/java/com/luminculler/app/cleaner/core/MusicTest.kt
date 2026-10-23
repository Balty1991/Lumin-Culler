package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sqrt

class MusicTest {
    private fun rms(s: ShortArray, from: Int, to: Int): Double {
        var sum = 0.0
        for (i in from until to) sum += s[i].toDouble() * s[i]
        return sqrt(sum / (to - from))
    }

    @Test
    fun everyMoodIsAudibleWithoutClippingAndFades() {
        for (mood in Mood.entries) {
            val pcm = Music.render(mood, 12f, seed = 3, sampleRate = 22_050)
            assertEquals(12 * 22_050 * 2, pcm.size)
            assertTrue(pcm.all { abs(it.toInt()) <= 32767 })
            val mid = rms(pcm, pcm.size / 2 - 22_050, pcm.size / 2 + 22_050)
            assertTrue("$mood prea încet: $mid", mid > 1500)
            // Începe și se termină în liniște (intrare și ieșire lină).
            assertTrue(abs(pcm[0].toInt()) < 200)
            assertTrue(rms(pcm, pcm.size - 400, pcm.size) < mid / 10)
        }
    }

    @Test
    fun sameSeedSameMusicOtherSeedOther() {
        val a = Music.render(Mood.Calm, 5f, seed = 7, sampleRate = 22_050)
        val b = Music.render(Mood.Calm, 5f, seed = 7, sampleRate = 22_050)
        val c = Music.render(Mood.Calm, 5f, seed = 8, sampleRate = 22_050)
        assertTrue(a.contentEquals(b))
        assertFalse(a.contentEquals(c))
    }

    @Test
    fun moodFollowsTheMoment() {
        assertEquals(Mood.Happy, Music.moodFor(MomentKind.Trip))
        assertEquals(Mood.Tender, Music.moodFor(MomentKind.YearsAgo))
    }
}
