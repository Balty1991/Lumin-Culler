package com.luminculler.app.cleaner.core

/**
 * Câte efecte AI pe server are omul. Fiecare costă bani reali (fal.ai), deci
 * nici Premium nu e nelimitat — vezi docs/PLAN_AI_SERVER.md.
 *
 * Gratuit: un singur clip „Prinde viață” de probă, pe viață, și 3 stiluri pe lună.
 * Premium: 20 de clipuri și 100 de stiluri pe lună.
 */
object AiCredits {
    enum class Kind { Alive, Style }

    const val FREE_ALIVE_TRIAL = 1
    const val FREE_STYLE_MONTH = 3
    const val PREMIUM_ALIVE_MONTH = 20
    const val PREMIUM_STYLE_MONTH = 100

    fun remaining(kind: Kind, premium: Boolean, usedThisMonth: Int, aliveTrialUsed: Int): Int = when {
        kind == Kind.Alive && premium -> PREMIUM_ALIVE_MONTH - usedThisMonth
        kind == Kind.Alive -> FREE_ALIVE_TRIAL - aliveTrialUsed
        premium -> PREMIUM_STYLE_MONTH - usedThisMonth
        else -> FREE_STYLE_MONTH - usedThisMonth
    }.coerceAtLeast(0)

    /** Luna (AAAA-LL) pentru contoare. */
    fun month(year: Int, month: Int): String = "%04d-%02d".format(year, month)
}
