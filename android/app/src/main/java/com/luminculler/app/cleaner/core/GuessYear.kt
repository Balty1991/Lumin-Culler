package com.luminculler.app.cleaner.core

import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs
import kotlin.random.Random

/**
 * Jocul „Ghicește anul”: o poză din galerie, fără dată; ghicești anul.
 * Exact = 100 de puncte, cu un an greșeală = 60, doi = 30, trei = 10.
 */
object GuessYear {
    const val ROUNDS = 10
    const val MAX_SCORE = ROUNDS * 100

    fun year(m: Media, zone: ZoneId): Int = Instant.ofEpochMilli(m.taken).atZone(zone).year

    fun points(guess: Int, actual: Int): Int = when (abs(guess - actual)) {
        0 -> 100
        1 -> 60
        2 -> 30
        3 -> 10
        else -> 0
    }

    /** Se poate juca doar dacă galeria acoperă măcar doi ani. */
    fun playable(photos: List<Media>, zone: ZoneId): Boolean =
        photos.asSequence().filter { it.taken > 0 }.map { year(it, zone) }.distinct().take(2).count() == 2

    fun range(photos: List<Media>, zone: ZoneId): IntRange {
        val years = photos.filter { it.taken > 0 }.map { year(it, zone) }
        return if (years.isEmpty()) IntRange.EMPTY else years.min()..years.max()
    }

    /**
     * Pozele rundelor: pe rând din ani diferiți (altfel, la o galerie cu
     * mult din anul curent, răspunsul ar fi mereu același), fără repetări.
     */
    fun pick(photos: List<Media>, zone: ZoneId, rounds: Int = ROUNDS, random: Random = Random.Default): List<Media> {
        val byYear = photos.filter { it.taken > 0 }.groupBy { year(it, zone) }
            .mapValues { it.value.shuffled(random).toMutableList() }
        val out = ArrayList<Media>()
        while (out.size < rounds && byYear.values.any { it.isNotEmpty() }) {
            for (y in byYear.keys.shuffled(random)) {
                val left = byYear.getValue(y)
                if (left.isNotEmpty() && out.size < rounds) out.add(left.removeAt(left.lastIndex))
            }
        }
        return out.shuffled(random)
    }

    /** O etichetă pentru scor, de la 0 la 3. */
    fun rank(score: Int): Int = when {
        score >= 800 -> 3
        score >= 550 -> 2
        score >= 300 -> 1
        else -> 0
    }
}
