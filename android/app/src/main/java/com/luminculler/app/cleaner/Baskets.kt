package com.luminculler.app.cleaner

/**
 * Coșurile ecranului nativ. Aceeași idee ca scanarea web: capturi și mesagerie
 * din nume, neclare sub varianța 80, rafalele în aceeași fereastră de timp.
 * Fețele nu intră aici.
 */
data class Shot(
    val uri: String,
    val name: String,
    val bytes: Long,
    val folder: String,
    val taken: Long,
    val blur: Double? = null
)

enum class Basket {
    Duplicates, Bursts, Blurry, Screenshots, Videos, Messengers
}

private const val BLUR_MAX = 80.0
private const val BURST_GAP_MS = 2500L

fun basketOf(shot: Shot): Basket? {
    val blob = "${shot.name} ${shot.folder}"
    if (blob.contains("screenshot", true) || blob.contains("screen shot", true) || blob.contains("captura", true)) {
        return Basket.Screenshots
    }
    if (blob.contains("whatsapp", true) || blob.contains("telegram", true)) return Basket.Messengers
    if (shot.blur != null && shot.blur < BLUR_MAX) return Basket.Blurry
    return null
}

/** Extra-urile unei rafale. Cadrul cu claritatea cea mai mare rămâne afară. */
fun burstExtras(shots: List<Shot>): Set<String> {
    val ordered = shots.filter { it.taken > 0 }.sortedBy { it.taken }
    val extras = HashSet<String>()
    var cluster = ArrayList<Shot>()
    fun flush() {
        if (cluster.size >= 2) {
            val keeper = cluster.maxWith(compareBy<Shot> { it.blur ?: 0.0 }.thenBy { it.bytes })
            cluster.filter { it.uri != keeper.uri }.forEach { extras.add(it.uri) }
        }
        cluster = ArrayList()
    }
    for (shot in ordered) {
        val prev = cluster.lastOrNull()
        if (prev != null && (shot.folder != prev.folder || shot.taken - prev.taken > BURST_GAP_MS)) flush()
        cluster.add(shot)
    }
    flush()
    return extras
}

fun duplicateExtras(shots: List<Shot>): Set<String> {
    val extras = HashSet<String>()
    shots.filter { it.bytes > 0 }
        .groupBy { it.bytes to it.name.lowercase() }
        .values
        .filter { it.size >= 2 }
        .forEach { group ->
            val keeper = group.maxBy { it.taken }
            group.filter { it.uri != keeper.uri }.forEach { extras.add(it.uri) }
        }
    return extras
}

fun assign(shots: List<Shot>, videos: List<Shot> = emptyList()): Map<Basket, List<Shot>> {
    val bursts = burstExtras(shots)
    val dupes = duplicateExtras(shots)
    val out = Basket.entries.associateWith { ArrayList<Shot>() }
    for (shot in shots) {
        when {
            dupes.contains(shot.uri) -> out.getValue(Basket.Duplicates).add(shot)
            bursts.contains(shot.uri) -> out.getValue(Basket.Bursts).add(shot)
            else -> basketOf(shot)?.let { out.getValue(it).add(shot) }
        }
    }
    out.getValue(Basket.Videos).addAll(videos)
    return out
}
