package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

class GroupingTest {
    private fun photo(id: Long, taken: Long, bytes: Long = 1000L + id, name: String = "IMG_$id.jpg", folder: String = "Camera") =
        Media(id, "content://media/$id", name, bytes, folder, taken)

    private fun sig(blur: Float, hash: Long, flat: Boolean = false, fine: LongArray = longArrayOf(hash, hash, hash, hash)) =
        Signals(blur, hash, flat, fine)

    @Test
    fun burstKeepsTheSharpestFrame() {
        val photos = listOf(photo(1, 10_000), photo(2, 11_000), photo(3, 12_000))
        val signals = mapOf(1L to sig(100f, 0x0FL), 2L to sig(400f, 0xF0L), 3L to sig(50f, 0xFF00L))
        val similar = Grouping.build(photos, signals).getValue(Kind.Similar)
        assertEquals(1, similar.groups.size)
        assertEquals(2L, similar.groups[0].keeper?.id)
        assertEquals(setOf(1L, 3L), similar.extras.map { it.id }.toSet())
    }

    @Test
    fun framesFarApartInTimeAreNotABurstUnlessTheyLookAlike() {
        val photos = listOf(photo(1, 0L + 1), photo(2, 30_000L), photo(3, 200_000L))
        val alike = 0x00FF_00FF_00FF_00FFL
        val signals = mapOf(1L to sig(200f, alike), 2L to sig(150f, alike xor 0xFFL), 3L to sig(150f, alike.inv()))
        val similar = Grouping.build(photos, signals).getValue(Kind.Similar)
        // 1 și 2: 30 s distanță, 8 biți diferență (nu duplicat, dar aceeași scenă). 3 e la 170 s → separat.
        assertEquals(listOf(2L), similar.extras.map { it.id })
    }

    @Test
    fun duplicatesFarApartInTimeAreFoundAndTheOriginalStays() {
        val h = 0x1234_5678_9ABC_DEF0L
        val photos = listOf(photo(1, 1_000), photo(2, 900_000_000), photo(3, 500_000))
        val signals = mapOf(1L to sig(200f, h), 2L to sig(200f, h xor 0b11), 3L to sig(200f, h.inv()))
        val dup = Grouping.build(photos, signals).getValue(Kind.Duplicates)
        assertEquals(1, dup.groups.size)
        assertEquals(1L, dup.groups[0].keeper?.id)
        assertEquals(listOf(2L), dup.extras.map { it.id })
    }

    @Test
    fun screenshotsOfTheSameAppAreNotDuplicates() {
        val h = 0x0F0F_0F0F_0F0F_0F0FL
        val photos = listOf(
            photo(1, 1_000, name = "Screenshot_1.png", folder = "Screenshots"),
            photo(2, 900_000, name = "Screenshot_2.png", folder = "Screenshots"),
            photo(3, 1_500, name = "Screenshot_3.png", folder = "Screenshots")
        )
        val signals = photos.associate { it.id to sig(300f, h) }
        val b = Grouping.build(photos, signals)
        assertEquals(0, b.getValue(Kind.Duplicates).count)
        assertEquals(0, b.getValue(Kind.Similar).count)
        assertEquals(3, b.getValue(Kind.Screenshots).count)
    }

    @Test
    fun sameCoarseHashButDifferentDetailIsNotADuplicate() {
        val h = 0x1234_5678_9ABC_DEF0L
        val photos = listOf(photo(1, 1_000), photo(2, 900_000_000))
        val signals = mapOf(
            1L to sig(200f, h, fine = longArrayOf(0L, 0L, 0L, 0L)),
            2L to sig(200f, h, fine = longArrayOf(0xFFFFL, 0L, 0L, 0L))
        )
        assertEquals(0, Grouping.build(photos, signals).getValue(Kind.Duplicates).count)
    }

    @Test
    fun sameSizeAndNameIsADuplicateWithoutSignals() {
        val photos = listOf(photo(1, 1_000, bytes = 5000, name = "a.jpg", folder = "Download"), photo(2, 9_000_000, bytes = 5000, name = "A.JPG", folder = "Camera"))
        val dup = Grouping.build(photos, emptyMap()).getValue(Kind.Duplicates)
        assertEquals(1, dup.count)
    }

    @Test
    fun flatFramesAreNeitherBlurryNorDuplicates() {
        val photos = listOf(photo(1, 1_000), photo(2, 900_000_000))
        val signals = mapOf(1L to sig(1f, 0L, flat = true), 2L to sig(1f, 0L, flat = true))
        val baskets = Grouping.build(photos, signals)
        assertEquals(0, baskets.getValue(Kind.Duplicates).count)
        assertEquals(0, baskets.getValue(Kind.Blurry).count)
    }

    @Test
    fun keptPhotosAreNeverProposedAgain() {
        val photos = listOf(photo(1, 10_000), photo(2, 11_000), photo(5, 99_000_000, name = "Screenshot_1.png"))
        val signals = mapOf(1L to sig(100f, 1L), 2L to sig(400f, 2L))
        val baskets = Grouping.build(photos, signals, kept = setOf(1L, 5L))
        assertEquals(0, baskets.getValue(Kind.Similar).count)
        assertEquals(0, baskets.getValue(Kind.Screenshots).count)
    }

    @Test
    fun screenshotsChatsBlurryAndVideosGoToTheirBaskets() {
        val photos = listOf(
            photo(1, 1_000_000, name = "Screenshot_20240101.png", folder = "Screenshots"),
            photo(2, 5_000_000, folder = "WhatsApp Images"),
            photo(3, 9_000_000)
        )
        val signals = mapOf(3L to sig(10f, 0x5555L))
        val videos = listOf(
            Media(10, "v10", "big.mp4", 80L * 1024 * 1024, "Camera", 0, isVideo = true),
            Media(11, "v11", "small.mp4", 2L * 1024 * 1024, "Camera", 0, isVideo = true)
        )
        val b = Grouping.build(photos, signals, videos)
        assertEquals(listOf(1L), b.getValue(Kind.Screenshots).extras.map { it.id })
        assertEquals(listOf(2L), b.getValue(Kind.Chats).extras.map { it.id })
        assertEquals(listOf(3L), b.getValue(Kind.Blurry).extras.map { it.id })
        assertEquals(listOf(10L), b.getValue(Kind.Videos).extras.map { it.id })
        assertNull(b.getValue(Kind.Videos).groups[0].keeper)
    }

    @Test
    fun manyPhotosGroupInReasonableTime() {
        val photos = (1L..20_000L).map { photo(it, it * 120_000) }
        val rnd = java.util.Random(7)
        val signals = photos.associate { it.id to sig(300f, rnd.nextLong()) }
        val start = System.nanoTime()
        Grouping.build(photos, signals)
        val ms = (System.nanoTime() - start) / 1_000_000
        assertTrue("grupare prea lentă: $ms ms", ms < 3_000)
    }
}

class ImageMathTest {
    @Test
    fun sharpEdgesScoreHigherThanASmoothGradient() {
        val w = 32
        val h = 32
        val checker = IntArray(w * h) { i -> if (((i % w) / 4 + (i / w) / 4) % 2 == 0) 0 else 255 }
        val gradient = IntArray(w * h) { i -> (i % w) * 8 }
        assertTrue(ImageMath.laplacianVariance(checker, w, h) > ImageMath.laplacianVariance(gradient, w, h))
        assertFalse(ImageMath.signals(checker, w, h).flat)
        assertTrue(ImageMath.signals(IntArray(w * h) { 128 }, w, h).flat)
    }

    @Test
    fun sameImageSameHashAndInvertedImageFarAway() {
        val w = 36
        val h = 32
        val img = IntArray(w * h) { i -> ((i % w) * 7 + (i / w) * 3) % 256 }
        val inv = IntArray(w * h) { 255 - img[it] }
        val a = ImageMath.signals(img, w, h).hash
        assertEquals(a, ImageMath.signals(img.copyOf(), w, h).hash)
        assertTrue(ImageMath.hamming(a, ImageMath.signals(inv, w, h).hash) > 40)
    }
}

class DailyStackTest {
    private val zone: ZoneId = ZoneOffset.UTC
    private val today: LocalDate = LocalDate.of(2026, 10, 21)
    private fun at(date: LocalDate, id: Long) =
        Media(id, "u$id", "IMG_$id.jpg", 1000, "Camera", date.atStartOfDay(zone).toInstant().toEpochMilli() + id)

    @Test
    fun memoriesComeFirstThenSuggestionsThenRecent() {
        val photos = listOf(
            at(today.minusYears(3), 1),
            at(today.minusYears(1), 2),
            at(today.minusDays(2), 3),
            at(today.minusDays(400), 4),
            at(today.minusDays(5), 5)
        )
        val blurry = Basket(Kind.Blurry, listOf(Group(Kind.Blurry, null, listOf(photos[4]))))
        val stack = DailyStack.build(today, zone, photos, mapOf(Kind.Blurry to blurry), emptySet(), size = 4)
        assertEquals(listOf(1L, 2L, 5L, 3L), stack.map { it.media.id })
        assertEquals(3, stack[0].yearsAgo)
        assertEquals(Reason.Suggested, stack[2].reason)
        assertEquals(Kind.Blurry, stack[2].kind)
    }

    @Test
    fun reviewedPhotosAreSkippedAndTheStackIsStableForTheDay() {
        val photos = (1L..100L).map { at(today.minusDays(100 + it), it) }
        val a = DailyStack.build(today, zone, photos, emptyMap(), setOf(1L, 2L), size = 10)
        val b = DailyStack.build(today, zone, photos, emptyMap(), setOf(1L, 2L), size = 10)
        assertEquals(a.map { it.media.id }, b.map { it.media.id })
        assertEquals(10, a.size)
        assertTrue(a.none { it.media.id == 1L || it.media.id == 2L })
        val tomorrow = DailyStack.build(today.plusDays(1), zone, photos, emptyMap(), setOf(1L, 2L), size = 10)
        assertTrue(tomorrow.map { it.media.id } != a.map { it.media.id })
    }
}

class PlanTest {
    @Test
    fun freeGetsOneStackAndOneBulkClean() {
        assertTrue(Plan.canStartAnotherStack(premium = false, stacksToday = 0))
        assertFalse(Plan.canStartAnotherStack(premium = false, stacksToday = 1))
        assertTrue(Plan.canStartAnotherStack(premium = true, stacksToday = 5))
        assertTrue(Plan.canBulkClean(premium = false, freeBulkUsed = false))
        assertFalse(Plan.canBulkClean(premium = false, freeBulkUsed = true))
        assertTrue(Plan.SUBSCRIPTION_IDS.none { it.contains("week") })
    }

    @Test
    fun streakCountsBackFromTodayOrYesterday() {
        val t = LocalDate.of(2026, 10, 21)
        val days = setOf("2026-10-20", "2026-10-19", "2026-10-17")
        assertEquals(2, Streak.current(days, t))
        assertEquals(3, Streak.current(days + "2026-10-21", t))
        assertEquals(0, Streak.current(setOf("2026-10-18"), t))
    }

    @Test
    fun bytesFormatFollowsLocale() {
        assertEquals("2,4 GB", Bytes.format((2.4 * 1024 * 1024 * 1024).toLong(), Locale.forLanguageTag("ro")))
        assertEquals("2.4 GB", Bytes.format((2.4 * 1024 * 1024 * 1024).toLong(), Locale.US))
        assertEquals("512 MB", Bytes.format(512L * 1024 * 1024, Locale.US))
    }
}
