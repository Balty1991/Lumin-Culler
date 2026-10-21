package com.luminculler.app.cleaner.core

/**
 * Coșurile de curățat. Fiecare poză ajunge în cel mult un coș, în ordinea în
 * care sunt declarate aici: o copie identică e „duplicat” înainte să fie
 * „neclară”.
 */
enum class Kind { Duplicates, Similar, Blurry, Screenshots, Chats, Videos }

/**
 * Un grup de propus la ștergere.
 *
 * `keeper` e poza care RĂMÂNE (la duplicate și rafale), arătată lângă
 * celelalte ca omul să vadă ce păstrează. Coșurile fără pereche (neclare,
 * capturi, chat, video) au un singur grup, fără keeper.
 */
data class Group(val kind: Kind, val keeper: Media?, val extras: List<Media>) {
    val bytes: Long get() = extras.sumOf { it.bytes }
}

data class Basket(val kind: Kind, val groups: List<Group>) {
    val extras: List<Media> get() = groups.flatMap { it.extras }
    val count: Int get() = groups.sumOf { it.extras.size }
    val bytes: Long get() = groups.sumOf { it.bytes }
}

object Grouping {
    /** Copii practic identice (re-salvări, descărcări duble): amprentă aproape egală, oricât de departe în timp. */
    const val DUPLICATE_DISTANCE = 3
    /** Cadre din aceeași scenă: apropiate în timp și cu amprentă asemănătoare. */
    const val SIMILAR_DISTANCE = 12
    /** Sub atât, cadrele sunt rafală oricum ar arăta. */
    const val BURST_GAP_MS = 3_000L
    /** Până la atât, cadrele apropiate ca amprentă sunt aceeași scenă. */
    const val SCENE_GAP_MS = 60_000L
    /** Sub varianța asta (pe ~96 px), cadrul e propus ca neclar. Prudent: omul confirmă. */
    const val BLUR_MAX = 55f
    const val VIDEO_MIN_BYTES = 30L * 1024 * 1024

    private val screenshotWords = listOf("screenshot", "screen shot", "screen_shot", "captur", "bildschirm", "screenrecord")
    private val chatWords = listOf("whatsapp", "telegram", "messenger", "viber", "signal")

    fun isScreenshot(m: Media): Boolean = containsAny("${m.name} ${m.folder}", screenshotWords)
    fun isChat(m: Media): Boolean = containsAny(m.folder, chatWords) || m.name.startsWith("IMG-") && m.name.contains("-WA")

    private fun containsAny(text: String, words: List<String>): Boolean {
        val lower = text.lowercase()
        return words.any { lower.contains(it) }
    }

    /**
     * @param kept poze pe care omul le-a păstrat explicit: nu le mai propunem
     *   la ștergere, dar pot rămâne „keeper” într-un grup.
     */
    fun build(
        photos: List<Media>,
        signals: Map<Long, Signals>,
        videos: List<Media> = emptyList(),
        kept: Set<Long> = emptySet()
    ): Map<Kind, Basket> {
        val used = HashSet<Long>()
        val duplicates = duplicateGroups(photos, signals, kept)
        duplicates.forEach { g -> g.extras.forEach { used.add(it.id) }; g.keeper?.let { used.add(it.id) } }
        val similar = similarGroups(photos.filter { it.id !in used }, signals, kept)
        similar.forEach { g -> g.extras.forEach { used.add(it.id) } }

        val screenshots = ArrayList<Media>()
        val chats = ArrayList<Media>()
        val blurry = ArrayList<Media>()
        for (m in photos) {
            if (m.id in used || m.id in kept) continue
            when {
                isScreenshot(m) -> screenshots.add(m)
                isChat(m) -> chats.add(m)
                else -> {
                    val s = signals[m.id]
                    if (s != null && !s.flat && s.blur < BLUR_MAX) blurry.add(m)
                }
            }
        }
        val bigVideos = videos.filter { it.bytes >= VIDEO_MIN_BYTES && it.id !in kept }.sortedByDescending { it.bytes }

        fun single(kind: Kind, list: List<Media>) =
            Basket(kind, if (list.isEmpty()) emptyList() else listOf(Group(kind, null, list)))

        return linkedMapOf(
            Kind.Duplicates to Basket(Kind.Duplicates, duplicates),
            Kind.Similar to Basket(Kind.Similar, similar),
            Kind.Blurry to single(Kind.Blurry, blurry.sortedBy { signals[it.id]?.blur ?: 0f }),
            Kind.Screenshots to single(Kind.Screenshots, screenshots.sortedBy { it.taken }),
            Kind.Chats to single(Kind.Chats, chats.sortedByDescending { it.bytes }),
            Kind.Videos to single(Kind.Videos, bigVideos)
        )
    }

    /** Cel mai clar cadru; la egalitate, cel mai vechi (originalul, nu copia). */
    private fun pickKeeper(members: List<Media>, signals: Map<Long, Signals>): Media =
        members.maxWith(
            compareBy<Media> { signals[it.id]?.blur ?: 0f }
                .thenByDescending { if (it.taken > 0) it.taken else Long.MAX_VALUE }
                .thenBy { it.bytes }
        )

    private fun duplicateGroups(photos: List<Media>, signals: Map<Long, Signals>, kept: Set<Long>): List<Group> {
        val index = photos.withIndex().associate { it.value.id to it.index }
        val uf = UnionFind(photos.size)

        // Aceeași mărime și același nume: copie exactă, fără să ne uităm la pixeli.
        photos.withIndex()
            .filter { it.value.bytes > 0 }
            .groupBy { it.value.bytes to it.value.name.lowercase() }
            .values.filter { it.size > 1 }
            .forEach { list -> list.drop(1).forEach { uf.union(list[0].index, it.index) } }

        // Amprente aproape egale. Cu distanța ≤ 3 din 64 de biți, cel puțin una
        // din cele 4 felii de 16 biți e identică: căutăm doar în felia comună,
        // nu fiecare cu fiecare (20 000 de poze ar fi 200 de milioane de perechi).
        val hashed = photos.filter { signals[it.id]?.let { s -> !s.flat } == true }
        for (slice in 0 until 4) {
            val buckets = HashMap<Int, MutableList<Media>>()
            for (m in hashed) {
                val key = ((signals.getValue(m.id).hash ushr (slice * 16)) and 0xFFFF).toInt()
                buckets.getOrPut(key) { ArrayList() }.add(m)
            }
            for (bucket in buckets.values) {
                if (bucket.size < 2 || bucket.size > 400) continue // o felie banală (ex. 0) nu e dovadă
                for (i in bucket.indices) {
                    val a = signals.getValue(bucket[i].id).hash
                    for (j in i + 1 until bucket.size) {
                        if (ImageMath.hamming(a, signals.getValue(bucket[j].id).hash) <= DUPLICATE_DISTANCE) {
                            uf.union(index.getValue(bucket[i].id), index.getValue(bucket[j].id))
                        }
                    }
                }
            }
        }

        return photos.indices.groupBy { uf.find(it) }.values
            .filter { it.size > 1 }
            .mapNotNull { members ->
                val list = members.map { photos[it] }
                val keeper = pickKeeper(list, signals)
                val extras = list.filter { it.id != keeper.id && it.id !in kept }
                if (extras.isEmpty()) null else Group(Kind.Duplicates, keeper, extras)
            }
            .sortedByDescending { it.bytes }
    }

    private fun similarGroups(photos: List<Media>, signals: Map<Long, Signals>, kept: Set<Long>): List<Group> {
        val ordered = photos.filter { it.taken > 0 }.sortedBy { it.taken }
        val groups = ArrayList<Group>()
        var cluster = ArrayList<Media>()
        fun flush() {
            if (cluster.size > 1) {
                val keeper = pickKeeper(cluster, signals)
                val extras = cluster.filter { it.id != keeper.id && it.id !in kept }
                if (extras.isNotEmpty()) groups.add(Group(Kind.Similar, keeper, extras))
            }
            cluster = ArrayList()
        }
        for (m in ordered) {
            val prev = cluster.lastOrNull()
            if (prev != null && !sameScene(prev, m, signals)) flush()
            cluster.add(m)
        }
        flush()
        return groups.sortedByDescending { it.extras.size }
    }

    private fun sameScene(a: Media, b: Media, signals: Map<Long, Signals>): Boolean {
        if (a.folder != b.folder) return false
        val gap = b.taken - a.taken
        if (gap <= BURST_GAP_MS) return true
        if (gap > SCENE_GAP_MS) return false
        val sa = signals[a.id] ?: return false
        val sb = signals[b.id] ?: return false
        if (sa.flat || sb.flat) return false
        return ImageMath.hamming(sa.hash, sb.hash) <= SIMILAR_DISTANCE
    }

    private class UnionFind(n: Int) {
        private val parent = IntArray(n) { it }
        fun find(x: Int): Int {
            var c = x
            while (parent[c] != c) {
                parent[c] = parent[parent[c]]
                c = parent[c]
            }
            return c
        }
        fun union(a: Int, b: Int) {
            val ra = find(a)
            val rb = find(b)
            if (ra != rb) parent[ra] = rb
        }
    }
}
