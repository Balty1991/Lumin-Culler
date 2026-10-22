package com.luminculler.app.cleaner.core

import org.junit.Assert.assertEquals
import org.junit.Test

class AiCreditsTest {
    @Test
    fun freeGetsOneAliveTrialAndThreeStylesAMonth() {
        assertEquals(1, AiCredits.remaining(AiCredits.Kind.Alive, false, 0, 0))
        assertEquals(0, AiCredits.remaining(AiCredits.Kind.Alive, false, 0, 1))
        assertEquals(3, AiCredits.remaining(AiCredits.Kind.Style, false, 0, 0))
        assertEquals(0, AiCredits.remaining(AiCredits.Kind.Style, false, 5, 0))
    }

    @Test
    fun premiumHasMonthlyAllowances() {
        assertEquals(20, AiCredits.remaining(AiCredits.Kind.Alive, true, 0, 1))
        assertEquals(85, AiCredits.remaining(AiCredits.Kind.Style, true, 15, 0))
        assertEquals("2026-03", AiCredits.month(2026, 3))
    }

    @Test
    fun eraserIsFiveAMonthFreeAndUnlimitedForPremium() {
        assertEquals(5, AiCredits.remaining(AiCredits.Kind.Erase, false, 0, 0))
        assertEquals(0, AiCredits.remaining(AiCredits.Kind.Erase, false, 7, 0))
        assertEquals(AiCredits.UNLIMITED, AiCredits.remaining(AiCredits.Kind.Erase, true, 500, 0))
    }
}
