package com.luminculler.app.cleaner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RescueTest {
    private val now = 1_700_000_000_000L

    @Test
    fun videosOutrankABlurryPileOfTheSameSize() {
        val videos = listOf(Shot("v", "clip.mp4", 2_000_000_000, "Camera", 1))
        val blurry = List(400) { index ->
            Shot("b$index", "soft.jpg", 5_000_000, "Camera", 1, blur = 10.0)
        }
        val plan = rescuePlan(blurry, videos, now)
        assertEquals(PileId.Videos, plan.piles.first { it.suggestedCount > 0 }.id)
    }

    @Test
    fun uniqueChatPhotoIsVisibleButNotSuggested() {
        val chat = Shot("w", "IMG-20200101-WA0001.jpg", 500, "WhatsApp Images", 1, messenger = MessengerKind.Chat)
        val plan = rescuePlan(listOf(chat), emptyList(), now)
        val pile = plan.piles.single { it.id == PileId.Messengers }
        assertFalse(pile.items.single().suggested)
        assertEquals(ReasonCode.ChatOnly, pile.items.single().reason)
        assertEquals(0L, plan.suggestedBytes)
    }

    @Test
    fun statusAndReceivedCopyAreSuggested() {
        val camera = Shot("c", "IMG_1.jpg", 80, "Camera", 1, hash = 7L)
        val copy = Shot("w", "IMG-20200101-WA0002.jpg", 80, "WhatsApp Images", 2, hash = 7L, messenger = MessengerKind.Chat)
        val status = Shot("s", "status.jpg", 40, ".Statuses", 3, messenger = MessengerKind.Status)
        val plan = rescuePlan(listOf(camera, copy, status), emptyList(), now)
        val pile = plan.piles.single { it.id == PileId.Messengers }
        val byUri = pile.items.associateBy { it.shot.uri }
        assertTrue(byUri.getValue("w").suggested)
        assertEquals(ReasonCode.ChatCopy, byUri.getValue("w").reason)
        assertEquals("IMG_1.jpg", byUri.getValue("w").keepName)
        assertTrue(byUri.getValue("s").suggested)
        assertEquals(120L, plan.suggestedBytes)
    }

    @Test
    fun recentScreenshotsStayUnchecked() {
        val recent = Shot("r", "Screenshot_now.png", 10, "Screenshots", now - 60_000)
        val old = Shot("o", "Screenshot_old.png", 25, "Screenshots", now - 8L * 24 * 60 * 60 * 1000)
        val plan = rescuePlan(listOf(recent, old), emptyList(), now)
        val pile = plan.piles.single { it.id == PileId.Screenshots }
        val byUri = pile.items.associateBy { it.shot.uri }
        assertFalse(byUri.getValue("r").suggested)
        assertTrue(byUri.getValue("o").suggested)
        assertEquals(25L, plan.suggestedBytes)
    }

    @Test
    fun partialCleanKeepsTheLargestFiles() {
        val small = Shot("s", "a.jpg", 10, "Camera", 1)
        val big = Shot("b", "b.jpg", 90, "Camera", 2)
        val chosen = selectForClean(listOf(small, big), AllowanceDecision.Partial(take = 1, consumesDaily = 1))
        assertEquals(listOf("b"), chosen.map { it.uri })
    }

    @Test
    fun openEyesBeatASlightlySharperBlink() {
        val closed = Shot("c", "closed.jpg", 100, "Camera", 5_000, blur = 100.0, faces = 1, eyesOpen = 0.1)
        val open = Shot("o", "open.jpg", 100, "Camera", 6_000, blur = 90.0, faces = 1, eyesOpen = 0.95)
        assertEquals("open.jpg", bestShotName(listOf(closed, open)))
        val plan = rescuePlan(listOf(closed, open), emptyList(), now)
        val extra = plan.piles.single { it.id == PileId.Bursts }.items.single()
        assertEquals("c", extra.shot.uri)
        assertTrue(extra.edges.contains(KeepEdge.EyesOpen))
    }
}

class AllowanceLogicTest {
    private val now = 1_700_000_000_000L
    private val fresh = AllowanceState(0, localDay(now), 0)

    @Test
    fun firstPileIsFreeHoweverLarge() {
        val decision = decideAllowance(400, premium = false, enforced = true, fresh, now)
        assertEquals(AllowanceDecision.All(consumesFull = true, consumesDaily = 0), decision)
    }

    @Test
    fun afterTheFirstPileTheDayIsCappedAtFifty() {
        val used = AllowanceState(1, localDay(now), 0)
        assertEquals(
            AllowanceDecision.All(consumesFull = false, consumesDaily = 40),
            decideAllowance(40, premium = false, enforced = true, used, now)
        )
        assertEquals(
            AllowanceDecision.Partial(take = FREE_CLEAN_PER_DAY, consumesDaily = FREE_CLEAN_PER_DAY),
            decideAllowance(80, premium = false, enforced = true, used, now)
        )
    }

    @Test
    fun aFullDayBlocksUntilTomorrow() {
        val used = AllowanceState(1, localDay(now), FREE_CLEAN_PER_DAY)
        assertTrue(decideAllowance(1, premium = false, enforced = true, used, now) is AllowanceDecision.Blocked)
        val nextDay = now + 36L * 60 * 60 * 1000
        assertEquals(
            AllowanceDecision.All(consumesFull = false, consumesDaily = 50),
            decideAllowance(50, premium = false, enforced = true, used, nextDay)
        )
    }

    @Test
    fun premiumAndNoWayToPayDoNotConsumeTheCap() {
        val used = AllowanceState(1, localDay(now), FREE_CLEAN_PER_DAY)
        val premium = decideAllowance(10, premium = true, enforced = true, used, now)
        assertEquals(AllowanceDecision.All(consumesFull = false, consumesDaily = 0), premium)
        assertTrue(decideAllowance(10, premium = false, enforced = false, used, now) is AllowanceDecision.All)
    }

    @Test
    fun commitAndRoundTrip() {
        val after = commitAllowance(fresh, AllowanceDecision.All(consumesFull = true, consumesDaily = 0), now)
        assertEquals(1, after.fullPilesUsed)
        val parsed = parseAllowance(serializeAllowance(after), now)
        assertEquals(1, parsed.fullPilesUsed)
        val launched = decisionForLaunched(AllowanceDecision.Partial(take = 50, consumesDaily = 50), 12)
        assertEquals(AllowanceDecision.Partial(take = 12, consumesDaily = 12), launched)
    }
}

class AccessAndReviewTest {
    @Test
    fun android14PartialAccessIsNotADenial() {
        assertEquals(PhotoAccess.Limited, photoAccess(34, images = false, legacyStorage = false, partial = true))
        assertEquals(PhotoAccess.Full, photoAccess(34, images = true, legacyStorage = false, partial = false))
        assertEquals(PhotoAccess.Denied, photoAccess(33, images = false, legacyStorage = true, partial = true))
        assertEquals(PhotoAccess.Full, photoAccess(28, images = false, legacyStorage = true, partial = false))
        assertTrue(videosReadable(34, videos = false, photos = PhotoAccess.Limited))
        assertFalse(videosReadable(33, videos = false, photos = PhotoAccess.Full))
    }

    @Test
    fun aBadUriDoesNotDiscardTheRestOfTheBatch() {
        val accepted = acceptedBatch(listOf("a", "bad", "b")) { batch -> batch.none { it == "bad" } }
        assertEquals(listOf("a", "b"), accepted)
        val capped = acceptedBatch(listOf(1, 2, 3, 4)) { it.size <= 2 }
        assertEquals(listOf(1, 2), capped)
    }

    @Test
    fun reviewIsAskedOnceAfterThreeDeletes() {
        assertFalse(shouldAskForReview(0, 1, alreadyAsked = false))
        assertTrue(shouldAskForReview(2, 1, alreadyAsked = false))
        assertFalse(shouldAskForReview(2, 1, alreadyAsked = true))
        assertFalse(shouldAskForReview(3, 5, alreadyAsked = false))
    }

    @Test
    fun nearHashesAcrossBandsStillMatchAndDistanceSevenDoesNot() {
        val near = (0 until 6).fold(0L) { acc, band -> acc or (1L shl (band * 8)) }
        assertEquals(6, hamming(0L, near))
        val shots = listOf(
            Shot("a", "one.jpg", 10, "Camera", 1, hash = 0L),
            Shot("b", "two.jpg", 99, "Downloads", 9_000_000_000, hash = near)
        )
        assertEquals(setOf("a"), duplicateExtras(shots))
        val far = (0 until 7).fold(0L) { acc, band -> acc or (1L shl (band * 8)) }
        val apart = listOf(
            Shot("a", "one.jpg", 10, "Camera", 1, hash = 0L),
            Shot("b", "two.jpg", 99, "Downloads", 2, hash = far)
        )
        assertTrue(duplicateExtras(apart).isEmpty())
    }
}
