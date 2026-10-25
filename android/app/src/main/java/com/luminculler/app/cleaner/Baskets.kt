package com.luminculler.app.cleaner

/**
 * What the cleaner knows about one file. Faces and eyes are filled only for
 * burst and near-duplicate clusters, after the cheap pass, so a 10k gallery
 * is not waiting on ML Kit before the first number appears.
 */
data class Shot(
    val uri: String,
    val name: String,
    val bytes: Long,
    val folder: String,
    val taken: Long,
    val blur: Double? = null,
    val hash: Long? = null,
    val exposure: Double? = null,
    val faces: Int? = null,
    val eyesOpen: Double? = null,
    val messenger: MessengerKind? = null
)

enum class Basket {
    Duplicates, Bursts, Blurry, Screenshots, Videos, Messengers
}

/** Chat clutter. Voice notes are recognized by name, but audio is not queried. */
enum class MessengerKind { Chat, Status, Sticker, Gif, Video, Voice }

enum class KeepEdge { Sharper, EyesOpen, Exposure, HasFace, Original }

const val BLUR_MAX = 80.0
private const val BURST_GAP_MS = 2500L
private const val BANDS = 8
private const val MAX_BUCKET = 48

fun classifyMessenger(name: String, folder: String): MessengerKind? {
    val blob = "$name $folder".lowercase()
    val whatsAppFile = Regex("(?i)(IMG|VID|STK|PTT|AUD)-\\d{6,8}-WA\\d+").containsMatchIn(name)
    val app = blob.contains("whatsapp") || blob.contains("telegram") || blob.contains("org.telegram") ||
        blob.contains("messenger") || blob.contains("com.facebook.orca") || blob.contains("fb_img") ||
        whatsAppFile
    if (!app && !blob.contains("stk-") && !blob.contains("ptt-")) return null
    if (blob.contains(".status") || blob.contains("statuses") || blob.contains("/status")) return MessengerKind.Status
    if (blob.contains("sticker") || blob.contains("stk-")) return MessengerKind.Sticker
    if (blob.contains("voice") || blob.contains("ptt-") || blob.contains("aud-") || name.endsWith(".opus", true)) {
        return MessengerKind.Voice
    }
    if (blob.contains(".gif") || blob.contains("animated gif")) return MessengerKind.Gif
    if (blob.contains("video") || name.startsWith("VID-", true) || name.endsWith(".mp4", true)) return MessengerKind.Video
    return MessengerKind.Chat
}

fun isScreenshot(name: String, folder: String): Boolean {
    if (classifyMessenger(name, folder) == MessengerKind.Status) return false
    val blob = "$name $folder".lowercase()
    return blob.contains("screenshot") || blob.contains("screen shot") || blob.contains("screen_shot") ||
        blob.contains("captura") || blob.contains("bildschirm")
}

/** 0..1. Null exposure is neutral so a photo we have not measured yet is not punished. */
fun exposureFit(mean: Double?): Double {
    if (mean == null) return 0.5
    val delta = kotlin.math.abs(mean.coerceIn(0.0, 1.0) - 0.46)
    return (1.0 - delta / 0.46).coerceIn(0.0, 1.0)
}

/**
 * Higher is the frame we keep. Sharpness leads. Open eyes break a tie a
 * sharpness-only cleaner would get wrong. A camera original beats the copy
 * that arrived in a chat.
 */
fun qualityScore(shot: Shot): Double {
    val sharp = ((shot.blur ?: 0.0) / 400.0).coerceIn(0.0, 1.0)
    val eyes = (shot.eyesOpen ?: 0.55).coerceIn(0.0, 1.0)
    val face = if ((shot.faces ?: 0) > 0) 0.08 else 0.0
    val original = if (shot.messenger == null) 0.04 else 0.0
    return sharp * 0.55 + eyes * 0.25 + exposureFit(shot.exposure) * 0.12 + face + original
}

fun keeperOf(group: List<Shot>): Shot =
    group.maxWith(compareBy<Shot> { qualityScore(it) }.thenBy { it.taken }.thenBy { it.bytes })

fun keepEdges(keeper: Shot, other: Shot): List<KeepEdge> {
    val edges = ArrayList<KeepEdge>()
    if ((keeper.blur ?: 0.0) > (other.blur ?: 0.0) + 12.0) edges.add(KeepEdge.Sharper)
    val keeperEyes = keeper.eyesOpen
    val otherEyes = other.eyesOpen
    if (keeperEyes != null && otherEyes != null && keeperEyes > otherEyes + 0.2) edges.add(KeepEdge.EyesOpen)
    if (keeper.exposure != null && other.exposure != null &&
        exposureFit(keeper.exposure) > exposureFit(other.exposure) + 0.15
    ) {
        edges.add(KeepEdge.Exposure)
    }
    if ((keeper.faces ?: 0) > 0 && (other.faces ?: 0) == 0) edges.add(KeepEdge.HasFace)
    if (keeper.messenger == null && other.messenger != null) edges.add(KeepEdge.Original)
    if (edges.isEmpty() && (keeper.blur ?: 0.0) >= (other.blur ?: 0.0)) edges.add(KeepEdge.Sharper)
    return edges
}

fun eyeOpen(left: Float?, right: Float?): Double? {
    val values = listOfNotNull(left?.toDouble(), right?.toDouble())
    if (values.isEmpty()) return null
    return values.min()
}

data class FaceRead(val eyes: Double?)

/** Worst open eye in the frame. One blinking person is enough to drop the frame. */
fun summarizeFaces(faces: List<FaceRead>): Pair<Int, Double?> {
    if (faces.isEmpty()) return 0 to null
    val eyes = faces.mapNotNull { it.eyes }
    return faces.size to if (eyes.isEmpty()) null else eyes.min()
}

fun basketOf(shot: Shot): Basket? {
    if (isScreenshot(shot.name, shot.folder)) return Basket.Screenshots
    if (shot.messenger != null || classifyMessenger(shot.name, shot.folder) != null) return Basket.Messengers
    if (shot.blur != null && shot.blur < BLUR_MAX) return Basket.Blurry
    return null
}

fun burstGroups(shots: List<Shot>): List<List<Shot>> {
    val ordered = shots.filter { it.taken > 0 }.sortedBy { it.taken }
    val groups = ArrayList<List<Shot>>()
    var cluster = ArrayList<Shot>()
    fun flush() {
        if (cluster.size >= 2) groups.add(cluster.toList())
        cluster = ArrayList()
    }
    for (shot in ordered) {
        val prev = cluster.lastOrNull()
        if (prev != null && (shot.folder != prev.folder || shot.taken - prev.taken > BURST_GAP_MS)) flush()
        cluster.add(shot)
    }
    flush()
    return groups
}

fun burstExtras(shots: List<Shot>): Set<String> = extrasOf(burstGroups(shots))

/**
 * Near-duplicates. Exact same name and size, plus dHash within
 * [HASH_DISTANCE]. Compared inside 8-bit bands so 10k photos are not an
 * all-pairs loop. A distance of 6 cannot dirty every 8-bit band, so a real
 * match still shares a bucket.
 */
fun similarityGroups(shots: List<Shot>): List<List<Shot>> {
    if (shots.size < 2) return emptyList()
    val parent = IntArray(shots.size) { it }
    fun find(index: Int): Int {
        var cursor = index
        while (parent[cursor] != cursor) {
            parent[cursor] = parent[parent[cursor]]
            cursor = parent[cursor]
        }
        return cursor
    }
    fun union(a: Int, b: Int) {
        val left = find(a)
        val right = find(b)
        if (left != right) parent[left] = right
    }
    val byName = HashMap<Pair<Long, String>, Int>()
    for (index in shots.indices) {
        val shot = shots[index]
        if (shot.bytes <= 0 || shot.name.isBlank()) continue
        val key = shot.bytes to shot.name.lowercase()
        val previous = byName[key]
        if (previous == null) byName[key] = index else union(previous, index)
    }
    val byHash = HashMap<Long, Int>()
    val buckets = HashMap<Int, ArrayList<Int>>()
    for (index in shots.indices) {
        val hash = shots[index].hash ?: continue
        val previous = byHash[hash]
        if (previous == null) byHash[hash] = index else union(previous, index)
        for (band in 0 until BANDS) {
            val value = ((hash ushr (band * 8)) and 0xFF).toInt()
            val key = (band shl 8) or value
            buckets.getOrPut(key) { ArrayList() }.add(index)
        }
    }
    val seen = HashSet<Long>()
    fun consider(a: Int, b: Int) {
        if (a == b) return
        val left = minOf(a, b)
        val right = maxOf(a, b)
        val key = (left.toLong() shl 32) or (right.toLong() and 0xffffffffL)
        if (!seen.add(key)) return
        val first = shots[left].hash ?: return
        val second = shots[right].hash ?: return
        if (hamming(first, second) <= HASH_DISTANCE) union(left, right)
    }
    for (members in buckets.values) {
        if (members.size <= MAX_BUCKET) {
            for (i in members.indices) {
                for (j in i + 1 until members.size) consider(members[i], members[j])
            }
        } else {
            val sorted = members.sortedBy { shots[it].taken }
            for (i in sorted.indices) {
                val end = minOf(sorted.size, i + 17)
                for (j in i + 1 until end) consider(sorted[i], sorted[j])
            }
        }
    }
    return shots.indices.groupBy { find(it) }.values
        .filter { it.size >= 2 }
        .map { indexes -> indexes.map { shots[it] } }
}

fun duplicateExtras(shots: List<Shot>): Set<String> = extrasOf(similarityGroups(shots))

private fun extrasOf(groups: List<List<Shot>>): Set<String> {
    val extras = HashSet<String>()
    for (group in groups) {
        val keeper = keeperOf(group)
        for (shot in group) if (shot.uri != keeper.uri) extras.add(shot.uri)
    }
    return extras
}

/** Name of the frame we would keep from the strongest burst. */
fun bestShotName(shots: List<Shot>): String? {
    var best: Shot? = null
    for (group in burstGroups(shots)) {
        val keeper = keeperOf(group)
        if (best == null || qualityScore(keeper) > qualityScore(best)) best = keeper
    }
    return best?.name
}

/** Newest members of bursts, then of near-duplicate groups. Capped by the caller. */
fun faceCheckOrder(shots: List<Shot>, limit: Int): List<String> {
    if (limit <= 0) return emptyList()
    val burstMembers = burstGroups(shots).flatten()
    val similarMembers = similarityGroups(shots).flatten()
    return (burstMembers + similarMembers)
        .distinctBy { it.uri }
        .sortedByDescending { it.taken }
        .take(limit)
        .map { it.uri }
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
