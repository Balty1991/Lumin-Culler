package com.luminculler.app.cleaner

/**
 * The home screen. Each file sits in one pile so the gigabytes are not
 * counted twice. Piles are ordered by gigabytes per second of the person's
 * time, using only the items we suggest. Unique chat photos are visible and
 * unchecked: deleting the only copy of a meme they saved is how cleaners
 * lose trust.
 */
enum class PileId { Videos, Messengers, Duplicates, Screenshots, Bursts, Blurry }

enum class ReasonCode {
    LargeVideo, ChatVideo, Status, Sticker, Gif, Voice, ChatCopy, ChatOnly,
    Duplicate, Burst, ScreenshotOld, ScreenshotRecent, Blurry
}

data class Candidate(
    val shot: Shot,
    val suggested: Boolean,
    val reason: ReasonCode,
    val edges: List<KeepEdge> = emptyList(),
    val keepName: String? = null
)

data class Pile(
    val id: PileId,
    val items: List<Candidate>,
    val suggestedBytes: Long,
    val suggestedCount: Int,
    val effortSeconds: Double,
    val gbPerSecond: Double
)

data class RescuePlan(val piles: List<Pile>, val suggestedBytes: Long)

const val SCREENSHOT_RECENT_MS = 7L * 24 * 60 * 60 * 1000

fun rescuePlan(shots: List<Shot>, videos: List<Shot>, now: Long): RescuePlan {
    val burstKeeper = HashMap<String, Shot>()
    val burstExtra = HashSet<String>()
    for (group in burstGroups(shots)) {
        val keeper = keeperOf(group)
        for (shot in group) {
            if (shot.uri == keeper.uri) continue
            burstExtra.add(shot.uri)
            burstKeeper[shot.uri] = keeper
        }
    }
    val similarKeeper = HashMap<String, Shot>()
    val similarExtra = HashSet<String>()
    for (group in similarityGroups(shots)) {
        val keeper = keeperOf(group)
        for (shot in group) {
            if (shot.uri == keeper.uri) continue
            similarExtra.add(shot.uri)
            similarKeeper[shot.uri] = keeper
        }
    }

    val messengers = ArrayList<Candidate>()
    val duplicates = ArrayList<Candidate>()
    val bursts = ArrayList<Candidate>()
    val screenshots = ArrayList<Candidate>()
    val blurry = ArrayList<Candidate>()

    for (shot in shots) {
        val kind = shot.messenger ?: classifyMessenger(shot.name, shot.folder)
        if (kind != null) {
            messengers.add(messengerCandidate(shot, kind, similarKeeper[shot.uri]))
            continue
        }
        val burst = burstKeeper[shot.uri]
        if (shot.uri in burstExtra && burst != null) {
            bursts.add(Candidate(shot, true, ReasonCode.Burst, keepEdges(burst, shot), burst.name))
            continue
        }
        val copy = similarKeeper[shot.uri]
        if (shot.uri in similarExtra && copy != null) {
            duplicates.add(Candidate(shot, true, ReasonCode.Duplicate, keepEdges(copy, shot), copy.name))
            continue
        }
        if (isScreenshot(shot.name, shot.folder)) {
            val recent = shot.taken > 0 && now - shot.taken < SCREENSHOT_RECENT_MS
            screenshots.add(
                Candidate(
                    shot,
                    suggested = !recent,
                    reason = if (recent) ReasonCode.ScreenshotRecent else ReasonCode.ScreenshotOld
                )
            )
            continue
        }
        if (shot.blur != null && shot.blur < BLUR_MAX) {
            blurry.add(Candidate(shot, true, ReasonCode.Blurry))
        }
    }

    val videoItems = videos.map { video ->
        val fromChat = video.messenger != null || classifyMessenger(video.name, video.folder) != null
        Candidate(video, true, if (fromChat) ReasonCode.ChatVideo else ReasonCode.LargeVideo)
    }

    val piles = listOfNotNull(
        pile(PileId.Videos, videoItems),
        pile(PileId.Messengers, messengers),
        pile(PileId.Duplicates, duplicates),
        pile(PileId.Screenshots, screenshots),
        pile(PileId.Bursts, bursts),
        pile(PileId.Blurry, blurry)
    ).sortedWith(compareByDescending<Pile> { it.gbPerSecond }.thenBy { pileRank(it.id) })
    return RescuePlan(piles, piles.sumOf { it.suggestedBytes })
}

private fun messengerCandidate(shot: Shot, kind: MessengerKind, copyKeeper: Shot?): Candidate {
    return when (kind) {
        MessengerKind.Status -> Candidate(shot, true, ReasonCode.Status)
        MessengerKind.Sticker -> Candidate(shot, true, ReasonCode.Sticker)
        MessengerKind.Gif -> Candidate(shot, true, ReasonCode.Gif)
        MessengerKind.Voice -> Candidate(shot, true, ReasonCode.Voice)
        MessengerKind.Video -> Candidate(shot, true, ReasonCode.ChatVideo)
        MessengerKind.Chat -> if (copyKeeper != null) {
            Candidate(shot, true, ReasonCode.ChatCopy, keepEdges(copyKeeper, shot), copyKeeper.name)
        } else {
            Candidate(shot, false, ReasonCode.ChatOnly)
        }
    }
}

private fun pile(id: PileId, items: List<Candidate>): Pile? {
    if (items.isEmpty()) return null
    val ordered = items.sortedWith(
        compareByDescending<Candidate> { it.suggested }.thenByDescending { it.shot.bytes }
    )
    val suggested = ordered.filter { it.suggested }
    val bytes = suggested.sumOf { it.shot.bytes.coerceAtLeast(0) }
    val count = suggested.size
    val effort = if (count == 0) 0.0 else effortSeconds(id, count)
    val gbPerSecond = if (count == 0 || effort <= 0.0) 0.0 else (bytes / 1_000_000_000.0) / effort
    return Pile(id, ordered, bytes, count, effort, gbPerSecond)
}

/** Seconds the suggested set should take. One confirm, not one swipe per file. */
fun effortSeconds(id: PileId, suggestedCount: Int): Double {
    val (base, each) = when (id) {
        PileId.Videos -> 3.0 to 1.2
        PileId.Messengers -> 6.0 to 0.12
        PileId.Duplicates -> 5.0 to 0.08
        PileId.Screenshots -> 5.0 to 0.08
        PileId.Bursts -> 7.0 to 0.25
        PileId.Blurry -> 4.0 to 1.1
    }
    return base + suggestedCount.coerceAtLeast(0) * each
}

private fun pileRank(id: PileId): Int = when (id) {
    PileId.Videos -> 0
    PileId.Messengers -> 1
    PileId.Duplicates -> 2
    PileId.Screenshots -> 3
    PileId.Bursts -> 4
    PileId.Blurry -> 5
}

/** Largest files first, so a partial free day frees the most space. */
fun selectForClean(items: List<Shot>, decision: AllowanceDecision): List<Shot> {
    val ranked = items.sortedByDescending { it.bytes }
    return when (decision) {
        is AllowanceDecision.All -> ranked
        is AllowanceDecision.Partial -> ranked.take(decision.take)
        AllowanceDecision.Blocked -> emptyList()
    }
}
