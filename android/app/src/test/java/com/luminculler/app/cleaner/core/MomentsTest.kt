package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class MomentsTest {
    private val zone = ZoneOffset.UTC
    private val today = LocalDate.of(2026, 10, 22)
    private fun at(d: LocalDate, id: Long, hour: Int = 12, name: String = "IMG_$id.jpg", folder: String = "Camera") =
        Media(id, "u$id", name, 1000, folder, d.atStartOfDay(zone).toInstant().toEpochMilli() + hour * 3_600_000L + id)

    @Test
    fun yearsAgoUsesThisWeekInPastYears() {
        val photos = (1L..5L).map { at(today.minusYears(2).plusDays(it % 3), it) } +
            (10L..12L).map { at(today.minusYears(1), it) } + // prea puține
            (20L..30L).map { at(today.minusYears(3).minusDays(20), it) } // altă săptămână
        val m = Moments.build(today, zone, photos, emptyMap())
        val years = m.filter { it.kind == MomentKind.YearsAgo }
        assertEquals(listOf(2), years.map { it.yearsAgo })
        assertEquals(5, years[0].total)
    }

    @Test
    fun tripsAreRunsOfPhotosWithoutLongBreaks() {
        val trip = (0L until 30L).map { at(LocalDate.of(2026, 7, 10).plusDays(it / 10), 100 + it, hour = 8 + (it % 10).toInt()) }
        val lone = (0L until 5L).map { at(LocalDate.of(2026, 3, 1).plusDays(it * 5), 500 + it) }
        val m = Moments.build(today, zone, trip + lone, emptyMap()).filter { it.kind == MomentKind.Trip }
        assertEquals(1, m.size)
        assertEquals(30, m[0].total)
        assertEquals(Moments.STORY, m[0].photos.size)
    }

    @Test
    fun usableSkipsScreenshotsChatsBlurryAndExtras() {
        val ok = at(today, 1)
        val shot = at(today, 2, name = "Screenshot_1.png", folder = "Screenshots")
        val chat = at(today, 3, folder = "WhatsApp Images")
        val blurry = at(today, 4)
        val extra = at(today, 5)
        val signals = mapOf(4L to Signals(5f, 1L, false))
        val baskets = mapOf(Kind.Similar to Basket(Kind.Similar, listOf(Group(Kind.Similar, ok, listOf(extra)))))
        assertEquals(listOf(1L), Moments.usable(listOf(ok, shot, chat, blurry, extra), signals, baskets).map { it.id })
    }

    @Test
    fun bestSpreadsOverTimeAndPrefersSharp() {
        val photos = (1L..40L).map { at(today.minusDays(40 - it), it) }
        val signals = photos.associate { it.id to Signals(if (it.id % 2 == 0L) 500f else 100f, it.id, false) }
        val best = Moments.best(photos, signals, 10)
        assertEquals(10, best.size)
        assertTrue(best.all { it.id % 2 == 0L })
        assertEquals(best.sortedBy { it.taken }, best)
    }
}
