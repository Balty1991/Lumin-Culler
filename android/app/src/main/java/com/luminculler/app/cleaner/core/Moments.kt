package com.luminculler.app.cleaner.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

enum class MomentKind { YearsAgo, Trip, Person }

/**
 * O amintire gata de privit: un titlu (compus în interfață, în limba omului,
 * din tip + date), o copertă și cele mai bune poze, în ordinea timpului.
 */
class Moment(
    val id: String,
    val kind: MomentKind,
    val photos: List<Media>,
    val cover: Media,
    val start: Long,
    val end: Long,
    val total: Int,
    val yearsAgo: Int = 0,
    val person: Person? = null
)

/**
 * Momentele din galerie, ca „Amintiri” din Google Foto: totul calculat pe
 * telefon, din datele pozelor, claritatea lor și fețele recunoscute.
 */
object Moments {
    /** Câte poze intră într-o poveste. */
    const val STORY = 20
    /** O pauză mai mare de atât între poze închide un eveniment. */
    const val EVENT_GAP_MS = 18L * 3600 * 1000
    const val EVENT_MIN = 15
    const val YEARS_MIN = 4

    /** Poze bune de arătat: nu capturi, nu chat, nu copii sau rafale, nu neclare sau goale. */
    fun usable(photos: List<Media>, signals: Map<Long, Signals>, baskets: Map<Kind, Basket>): List<Media> {
        val skip = HashSet<Long>()
        for ((kind, b) in baskets) if (kind != Kind.Videos) b.extras.forEach { skip.add(it.id) }
        return photos.filter { m ->
            m.id !in skip && !Grouping.isScreenshot(m) && !Grouping.isChat(m) &&
                signals[m.id]?.let { !it.flat && it.blur >= Grouping.BLUR_MAX } ?: true
        }
    }

    /** Cele mai bune [n]: împarte timpul în [n] felii egale și ia cea mai clară din fiecare. */
    fun best(photos: List<Media>, signals: Map<Long, Signals>, n: Int = STORY): List<Media> {
        val sorted = photos.sortedBy { it.taken }
        if (sorted.size <= n) return sorted
        return List(n) { i ->
            val from = i * sorted.size / n
            val to = maxOf(from + 1, (i + 1) * sorted.size / n)
            sorted.subList(from, to).maxBy { signals[it.id]?.blur ?: 0f }
        }
    }

    private fun cover(photos: List<Media>, signals: Map<Long, Signals>): Media =
        photos.maxBy { (signals[it.id]?.blur ?: 0f).coerceAtMost(2000f) }

    fun build(
        today: LocalDate,
        zone: ZoneId,
        usable: List<Media>,
        signals: Map<Long, Signals>,
        people: List<Person> = emptyList()
    ): List<Moment> {
        val out = ArrayList<Moment>()

        // Acum X ani: săptămâna de azi (±3 zile), în fiecare an trecut.
        val byYear = usable.filter { it.taken > 0 }.groupBy { m ->
            val d = Instant.ofEpochMilli(m.taken).atZone(zone).toLocalDate()
            val years = today.year - d.year
            if (years < 1) -1 else {
                val sameDay = try { today.minusYears(years.toLong()) } catch (_: Exception) { null }
                if (sameDay != null && kotlin.math.abs(ChronoUnit.DAYS.between(sameDay, d)) <= 3) years else -1
            }
        }
        for ((years, list) in byYear.toSortedMap()) {
            if (years < 1 || list.size < YEARS_MIN) continue
            val story = best(list, signals)
            out.add(Moment("y$years", MomentKind.YearsAgo, story, cover(story, signals), list.minOf { it.taken }, list.maxOf { it.taken }, list.size, yearsAgo = years))
        }

        // Excursii și evenimente: poze făcute la rând, fără pauză mai mare de 18 h.
        val events = ArrayList<List<Media>>()
        var current = ArrayList<Media>()
        for (m in usable.filter { it.taken > 0 }.sortedBy { it.taken }) {
            if (current.isNotEmpty() && m.taken - current.last().taken > EVENT_GAP_MS) {
                if (current.size >= EVENT_MIN) events.add(current)
                current = ArrayList()
            }
            current.add(m)
        }
        if (current.size >= EVENT_MIN) events.add(current)
        for (e in events.sortedByDescending { it.last().taken }.take(12)) {
            val story = best(e, signals)
            out.add(Moment("t${e.first().id}", MomentKind.Trip, story, cover(story, signals), e.first().taken, e.last().taken, e.size))
        }

        // Momente cu o persoană.
        val byId = usable.associateBy { it.id }
        for ((i, p) in people.withIndex()) {
            val photos = p.faces.map { it.mediaId }.distinct().mapNotNull { byId[it] }
            if (photos.size < 6) continue
            val story = best(photos, signals)
            val coverPhoto = byId[p.cover.mediaId] ?: cover(story, signals)
            out.add(Moment("p$i", MomentKind.Person, story, coverPhoto, photos.minOf { it.taken }, photos.maxOf { it.taken }, photos.size, person = p))
            if (i >= 8) break
        }

        // Amintirile „acum X ani” primele (sunt despre azi), apoi restul, cele mai noi primele.
        return out.sortedWith(compareBy<Moment> { if (it.kind == MomentKind.YearsAgo) 0 else 1 }.thenByDescending { it.end })
    }
}
