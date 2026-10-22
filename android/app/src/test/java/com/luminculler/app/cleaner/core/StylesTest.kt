package com.luminculler.app.cleaner.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StylesTest {
    private val w = 64
    private val h = 48
    /** O „poză” de test: degrade colorat cu un pătrat întunecat în mijloc. */
    private val img = IntArray(w * h) { i ->
        val x = i % w; val y = i / w
        val inside = x in 20..44 && y in 14..34
        val r = if (inside) 40 else 120 + x
        val g = if (inside) 30 else 80 + y * 2
        val b = if (inside) 50 else 200 - x
        (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    @Test
    fun everyStyleKeepsTheSizeAndIsDeterministic() {
        for (s in Style.entries) {
            val a = Styles.apply(s, img, w, h)
            assertEquals(img.size, a.size)
            assertArrayEquals("$s nu e determinist", a, Styles.apply(s, img, w, h))
            assertTrue("$s a lăsat poza neschimbată", !a.contentEquals(img))
        }
    }

    @Test
    fun sketchAndNoirAreGrayAndSketchIsMostlyPaper() {
        val sk = Styles.sketch(img, w, h)
        assertTrue(sk.all { Styles.chroma(it) == 0 })
        val bright = sk.count { (it and 0xFF) > 200 }
        assertTrue("o schiță e mai ales hârtie albă", bright > sk.size / 2)
        assertTrue(Styles.noir(img, w, h, 1).all { Styles.chroma(it) == 0 })
    }

    @Test
    fun popIsMoreColorfulAndVintageLess() {
        val before = img.sumOf { Styles.chroma(it) }
        assertTrue(Styles.pop(img).sumOf { Styles.chroma(it) } > before)
        assertTrue(Styles.vintage(img, w, h, 1).sumOf { Styles.chroma(it) } < before)
    }

    @Test
    fun blurOfAConstantIsTheConstant() {
        val c = IntArray(w * h) { 77 }
        assertTrue(Styles.blurChannel(c, w, h, 5).all { it == 77 })
    }
}
