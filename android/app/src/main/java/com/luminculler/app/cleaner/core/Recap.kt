package com.luminculler.app.cleaner.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Partea zilei în care omul face cele mai multe poze — „personalitatea” lui foto. */
enum class DayPart { Morning, Afternoon, Evening, Night }

/**
 * „Anul tău în poze”, ca „Wrapped”: câteva cifre care spun o poveste despre
 * an, din galerie, fără să trimită nimic nicăieri.
 */
class Recap(
    val year: Int,
    val photos: Int,
    val videos: Int,
    val videoMinutes: Int,
    /** În câte zile diferite a făcut poze. */
    val days: Int,
    /** Câte poze pe fiecare lună (index 0 = ianuarie). */
    val months: IntArray,
    val busiestMonth: Int,
    val busiestDay: LocalDate?,
    val busiestDayPhotos: List<Media>,
    /** Cele mai multe zile la rând cu măcar o poză. */
    val longestStreak: Int,
    val dayPart: DayPart,
    /** Cât la sută din poze sunt în [dayPart]. */
    val dayPartShare: Int,
    val favoriteWeekday: DayOfWeek,
    val previousYearPhotos: Int,
    /** Oamenii anului, cu câte poze au în anul acesta. */
    val people: List<Pair<Person, Int>>,
    /** Câte o poză bună din fiecare lună cu poze, pentru final. */
    val highlights: List<Media>
) {
    /** Diferența față de anul trecut, în procente; null dacă anul trecut n-a avut poze. */
    val growth: Int? get() = if (previousYearPhotos == 0) null else ((photos - previousYearPhotos) * 100 / previousYearPhotos)
}

object Recaps {
    /** Un an are rezumat doar dacă are destule poze cât să spună ceva. */
    const val MIN_PHOTOS = 30

    private fun date(ms: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()

    /** Anii cu rezumat, de la cel mai recent. */
    fun years(photos: List<Media>, zone: ZoneId): List<Int> =
        photos.filter { it.taken > 0 }.groupingBy { date(it.taken, zone).year }.eachCount()
            .filter { it.value >= MIN_PHOTOS }.keys.sortedDescending()

    fun dayPart(hour: Int): DayPart = when (hour) {
        in 5..11 -> DayPart.Morning
        in 12..16 -> DayPart.Afternoon
        in 17..21 -> DayPart.Evening
        else -> DayPart.Night
    }

    fun longestStreak(days: Collection<LocalDate>): Int {
        val sorted = days.toSortedSet()
        var best = 0
        var run = 0
        var prev: LocalDate? = null
        for (d in sorted) {
            run = if (prev != null && prev.plusDays(1) == d) run + 1 else 1
            if (run > best) best = run
            prev = d
        }
        return best
    }

    fun build(
        year: Int,
        zone: ZoneId,
        photos: List<Media>,
        videos: List<Media>,
        signals: Map<Long, Signals>,
        people: List<Person>
    ): Recap? {
        val inYear = photos.filter { it.taken > 0 && date(it.taken, zone).year == year }
        if (inYear.size < MIN_PHOTOS) return null
        val vids = videos.filter { it.taken > 0 && date(it.taken, zone).year == year }
        val byDay = inYear.groupBy { date(it.taken, zone) }
        val months = IntArray(12)
        val parts = IntArray(DayPart.entries.size)
        val weekdays = IntArray(7)
        for (m in inYear) {
            val t = Instant.ofEpochMilli(m.taken).atZone(zone)
            months[t.monthValue - 1]++
            parts[dayPart(t.hour).ordinal]++
            weekdays[t.dayOfWeek.value - 1]++
        }
        val busiest = byDay.maxByOrNull { it.value.size }
        val part = parts.indices.maxBy { parts[it] }
        val previous = photos.count { it.taken > 0 && date(it.taken, zone).year == year - 1 }

        val ids = inYear.mapTo(HashSet()) { it.id }
        val folks = people.map { p -> p to p.faces.filter { it.mediaId in ids }.distinctBy { it.mediaId }.size }
            .filter { it.second >= 3 }.sortedByDescending { it.second }.take(3)

        // Cea mai clară poză din fiecare lună: un final care trece prin tot anul.
        val highlights = inYear.groupBy { date(it.taken, zone).monthValue }.toSortedMap().values
            .map { month -> month.maxBy { signals[it.id]?.blur ?: 0f } }

        return Recap(
            year = year,
            photos = inYear.size,
            videos = vids.size,
            videoMinutes = (vids.sumOf { it.durationMs } / 60_000).toInt(),
            days = byDay.size,
            months = months,
            busiestMonth = months.indices.maxBy { months[it] } + 1,
            busiestDay = busiest?.key,
            busiestDayPhotos = busiest?.value?.let { Moments.best(it, signals, 6) } ?: emptyList(),
            longestStreak = longestStreak(byDay.keys),
            dayPart = DayPart.entries[part],
            dayPartShare = parts[part] * 100 / inYear.size,
            favoriteWeekday = DayOfWeek.of(weekdays.indices.maxBy { weekdays[it] } + 1),
            previousYearPhotos = previous,
            people = folks,
            highlights = highlights
        )
    }
}
