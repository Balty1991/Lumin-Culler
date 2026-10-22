package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EnhanceTest {
    @Test
    fun levelsFindTheRealEndsAndIgnoreOutliers() {
        val hist = IntArray(256)
        for (v in 40..200) hist[v] = 100
        hist[0] = 5; hist[255] = 5 // câțiva pixeli extremi
        val (lo, hi) = Enhance.levels(hist)
        assertTrue(lo in 40..45)
        assertTrue(hi in 195..200)
    }

    @Test
    fun nearlyFlatOrNarrowImagesAreNotOverstretched() {
        val flat = IntArray(256).also { for (v in 120..130) it[v] = 100 }
        assertEquals(0 to 255, Enhance.levels(flat))
        val narrow = IntArray(256).also { for (v in 20..80) it[v] = 100 }
        val (lo, hi) = Enhance.levels(narrow)
        assertTrue(hi - lo >= 128)
    }

    @Test
    fun gammaBrightensDarkAndCalmsBrightButOnlyHalfway() {
        assertTrue(Enhance.gamma(0.25f) < 1f)
        assertTrue(Enhance.gamma(0.75f) > 1f)
        assertEquals(1f, Enhance.gamma(0.48f), 0.01f)
        val lut = Enhance.lut(40, 200, 1f)
        assertEquals(0, lut[40]); assertEquals(255, lut[200]); assertEquals(0, lut[10]); assertEquals(255, lut[230])
    }
}
