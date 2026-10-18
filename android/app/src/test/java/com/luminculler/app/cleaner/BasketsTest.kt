package com.luminculler.app.cleaner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BasketsTest {
    @Test
    fun screenshotsAndBlurryStayOutOfBursts() {
        val shots = listOf(
            Shot("a", "soft.jpg", 100, "Camera", 1_000, blur = 10.0),
            Shot("b", "Screenshot_1.png", 80, "Screenshots", 2_000, blur = 200.0),
            Shot("c", "IMG_1.jpg", 90, "Camera", 5_000, blur = 90.0),
            Shot("d", "IMG_2.jpg", 90, "Camera", 6_000, blur = 40.0)
        )
        val assigned = assign(shots)
        assertEquals(listOf("a"), assigned.getValue(Basket.Blurry).map { it.uri })
        assertEquals(listOf("b"), assigned.getValue(Basket.Screenshots).map { it.uri })
        assertEquals(listOf("d"), assigned.getValue(Basket.Bursts).map { it.uri })
        assertTrue(assigned.getValue(Basket.Duplicates).isEmpty())
    }

    @Test
    fun sameNameAndSizeIsADuplicate() {
        val shots = listOf(
            Shot("old", "IMG.jpg", 50, "Camera", 1, blur = 100.0),
            Shot("new", "img.jpg", 50, "Camera", 9, blur = 100.0)
        )
        assertEquals(setOf("old"), duplicateExtras(shots))
    }
}
