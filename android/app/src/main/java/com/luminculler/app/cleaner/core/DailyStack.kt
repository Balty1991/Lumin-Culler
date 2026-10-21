package com.luminculler.app.cleaner.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** De ce a intrat o poză în teancul de azi — se vede pe card. */
enum class Reason { Memory, Suggested, Recent, Older }

data class StackItem(val media: Media, val reason: Reason, val yearsAgo: Int = 0, val kind: Kind? = null)

/**
 * Teancul zilnic: puține poze, alese ca să merite deschis în fiecare zi.
 *
 * Ordinea contează: o amintire „acum N ani” deschide teancul (motivul să
 * revii), urmează propunerile AI (unde se eliberează spațiu), apoi pozele noi
 * ne-revizuite, apoi pozele vechi. Aceeași zi dă același teanc, ca să nu se
 * schimbe sub degetele omului; stratul Android îl și salvează.
 */
object DailyStack {
    const val FREE_SIZE = 30
    const val MAX_MEMORIES = 5

    fun dayKey(day: LocalDate): String = day.toString()

    fun build(
        today: LocalDate,
        zone: ZoneId,
        photos: List<Media>,
        baskets: Map<Kind, Basket>,
        reviewed: Set<Long>,
        size: Int = FREE_SIZE,
        exclude: Set<Long> = emptySet()
    ): List<StackItem> {
        val out = ArrayList<StackItem>(size)
        val taken = HashSet<Long>()
        fun add(item: StackItem): Boolean {
            if (out.size >= size) return false
            if (item.media.id in taken || item.media.id in reviewed || item.media.id in exclude) return true
            taken.add(item.media.id)
            out.add(item)
            return true
        }

        val suggestedKind = HashMap<Long, Kind>()
        for ((kind, basket) in baskets) {
            if (kind == Kind.Videos) continue
            for (m in basket.extras) suggestedKind.putIfAbsent(m.id, kind)
        }

        val memories = photos.asSequence()
            .filter { it.taken > 0 && it.id !in suggestedKind }
            .mapNotNull { m ->
                val date = Instant.ofEpochMilli(m.taken).atZone(zone).toLocalDate()
                val years = today.year - date.year
                if (years >= 1 && date.monthValue == today.monthValue && date.dayOfMonth == today.dayOfMonth) {
                    StackItem(m, Reason.Memory, yearsAgo = years)
                } else null
            }
            .filter { it.media.id !in reviewed && it.media.id !in exclude }
            .sortedWith(compareByDescending<StackItem> { it.yearsAgo }.thenBy { it.media.taken })
            .toList()
        // Câte o amintire pe an, cât să nu acopere teancul cu o singură zi bogată.
        memories.distinctBy { it.yearsAgo }.take(MAX_MEMORIES).forEach { add(it) }

        val suggestions = baskets.filterKeys { it != Kind.Videos }
            .flatMap { (kind, basket) -> basket.extras.map { StackItem(it, Reason.Suggested, kind = kind) } }
            .sortedByDescending { it.media.bytes }
        // Jumătate din teanc, cel mult: restul e despre amintiri, nu despre gunoi.
        val suggestionCap = out.size + maxOf(1, size / 2)
        for (s in suggestions) {
            if (out.size >= suggestionCap) break
            add(s)
        }

        val since = today.minusDays(30).atStartOfDay(zone).toInstant().toEpochMilli()
        for (m in photos.filter { it.taken >= since }.sortedByDescending { it.taken }) {
            if (!add(StackItem(m, Reason.Recent))) break
        }

        if (out.size < size) {
            // Pozele vechi, amestecate determinist pe zi: fiecare zi scoate altele la suprafață.
            val seed = today.toEpochDay()
            for (m in photos.filter { it.id !in taken }.sortedBy { mix(it.id, seed) }) {
                if (!add(StackItem(m, Reason.Older))) break
            }
        }
        return out
    }

    private fun mix(id: Long, seed: Long): Long {
        var x = id * -0x61c8864680b583ebL + seed
        x = (x xor (x ushr 30)) * -0x40a7b892e31b1a47L
        x = (x xor (x ushr 27)) * -0x6b2fb644ecceee15L
        return x xor (x ushr 31)
    }
}
