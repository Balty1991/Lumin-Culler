package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlin.random.Random

class GuessYearTest {
    private val zone = ZoneOffset.UTC
    private var id = 1L
    private fun at(y: Int) = Media(id++, "u$id", "p.jpg", 1, "DCIM", LocalDateTime.of(y, 6, 1, 12, 0).toInstant(zone).toEpochMilli())

    @Test
    fun pointsDropWithDistance() {
        assertEquals(100, GuessYear.points(2020, 2020))
        assertEquals(60, GuessYear.points(2019, 2020))
        assertEquals(10, GuessYear.points(2023, 2020))
        assertEquals(0, GuessYear.points(2010, 2020))
    }

    @Test
    fun roundsSpreadAcrossYears() {
        // 90 de poze din 2025 și câte 3 din 2019, 2021, 2023: rundele nu trebuie să fie toate 2025.
        val photos = List(90) { at(2025) } + List(3) { at(2019) } + List(3) { at(2021) } + List(3) { at(2023) }
        val picked = GuessYear.pick(photos, zone, random = Random(1))
        assertEquals(10, picked.size)
        assertEquals(10, picked.distinctBy { it.id }.size)
        assertEquals(4, picked.map { GuessYear.year(it, zone) }.distinct().size)
        assertEquals(2019..2025, GuessYear.range(photos, zone))
    }

    @Test
    fun needsTwoYears() {
        assertFalse(GuessYear.playable(List(20) { at(2024) }, zone))
        assertTrue(GuessYear.playable(listOf(at(2024), at(2022)), zone))
    }
}
