package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

class RecapTest {
    private val zone = ZoneOffset.UTC
    private var id = 1L

    private fun at(t: LocalDateTime) = Media(id++, "u$id", "p.jpg", 1000, "DCIM", t.toInstant(zone).toEpochMilli())

    @Test
    fun countsTheYearAndFindsItsHighlights() {
        val photos = ArrayList<Media>()
        // 3 zile la rând în martie, seara; o zi plină în iulie.
        for (d in 10..12) repeat(5) { photos += at(LocalDateTime.of(2025, 3, d, 19, it)) }
        repeat(20) { photos += at(LocalDateTime.of(2025, 7, 4, 13, it)) }
        repeat(10) { photos += at(LocalDateTime.of(2024, 5, 1, 9, it)) }
        val r = Recaps.build(2025, zone, photos, emptyList(), emptyMap(), emptyList())!!
        assertEquals(35, r.photos)
        assertEquals(4, r.days)
        assertEquals(7, r.busiestMonth)
        assertEquals(LocalDate.of(2025, 7, 4), r.busiestDay)
        assertEquals(3, r.longestStreak)
        assertEquals(DayPart.Afternoon, r.dayPart)
        assertEquals(10, r.previousYearPhotos)
        assertEquals(250, r.growth)
        assertEquals(2, r.highlights.size)
        assertEquals(listOf(2025), Recaps.years(photos, zone))
    }

    @Test
    fun tooFewPhotosMeansNoRecap() {
        val photos = List(5) { at(LocalDateTime.of(2025, 1, 1, 10, it)) }
        assertNull(Recaps.build(2025, zone, photos, emptyList(), emptyMap(), emptyList()))
    }

    @Test
    fun dayPartsCoverTheClock() {
        assertEquals(DayPart.Night, Recaps.dayPart(2))
        assertEquals(DayPart.Morning, Recaps.dayPart(7))
        assertEquals(DayPart.Evening, Recaps.dayPart(20))
        assertEquals(DayPart.Night, Recaps.dayPart(23))
    }
}
