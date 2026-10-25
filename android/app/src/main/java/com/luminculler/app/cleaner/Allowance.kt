package com.luminculler.app.cleaner

/**
 * How much of a one-tap clean stays free.
 *
 * Seeing the gigabytes is always free. The first pile the person actually
 * sends to Trash is free no matter how large it is — that is the moment they
 * learn the app works. After that, 50 items a day. Swipe-one-by-one does not
 * come through here.
 *
 * When there is no real way to pay (Play has not answered, or it answered
 * that the products do not exist), nothing is blocked. A cap with no door
 * is not a price.
 */
const val FREE_CLEAN_PILES = 1
const val FREE_CLEAN_PER_DAY = 50

data class AllowanceState(
    val fullPilesUsed: Int,
    val day: String,
    val usedToday: Int
)

sealed class AllowanceDecision {
    data class All(val consumesFull: Boolean, val consumesDaily: Int) : AllowanceDecision()
    data class Partial(val take: Int, val consumesDaily: Int) : AllowanceDecision()
    data object Blocked : AllowanceDecision()
}

fun localDay(now: Long): String {
    val calendar = java.util.Calendar.getInstance()
    calendar.timeInMillis = now
    val year = calendar.get(java.util.Calendar.YEAR)
    val month = calendar.get(java.util.Calendar.MONTH) + 1
    val day = calendar.get(java.util.Calendar.DAY_OF_MONTH)
    return "%04d-%02d-%02d".format(year, month, day)
}

fun decideAllowance(
    count: Int,
    premium: Boolean,
    enforced: Boolean,
    state: AllowanceState,
    now: Long
): AllowanceDecision {
    val safe = count.coerceAtLeast(0)
    if (safe == 0) return AllowanceDecision.All(consumesFull = false, consumesDaily = 0)
    if (premium || !enforced) return AllowanceDecision.All(consumesFull = false, consumesDaily = 0)
    if (state.fullPilesUsed < FREE_CLEAN_PILES) {
        return AllowanceDecision.All(consumesFull = true, consumesDaily = 0)
    }
    val used = if (state.day == localDay(now)) state.usedToday else 0
    val remaining = (FREE_CLEAN_PER_DAY - used).coerceAtLeast(0)
    if (remaining <= 0) return AllowanceDecision.Blocked
    if (safe <= remaining) return AllowanceDecision.All(consumesFull = false, consumesDaily = safe)
    return AllowanceDecision.Partial(take = remaining, consumesDaily = remaining)
}

/** Only call this after Trash actually succeeded. A cancelled dialog consumes nothing. */
fun commitAllowance(state: AllowanceState, decision: AllowanceDecision, now: Long): AllowanceState {
    val day = localDay(now)
    val usedToday = if (state.day == day) state.usedToday else 0
    val consumesDaily = when (decision) {
        is AllowanceDecision.All -> decision.consumesDaily
        is AllowanceDecision.Partial -> decision.consumesDaily
        AllowanceDecision.Blocked -> 0
    }
    val consumesFull = decision is AllowanceDecision.All && decision.consumesFull
    return AllowanceState(
        fullPilesUsed = state.fullPilesUsed + if (consumesFull) 1 else 0,
        day = day,
        usedToday = usedToday + consumesDaily
    )
}

fun serializeAllowance(state: AllowanceState): String =
    "${if (state.fullPilesUsed > 0) 1 else 0}|${state.day}|${state.usedToday.coerceAtLeast(0)}"

fun parseAllowance(raw: String?, now: Long): AllowanceState {
    val today = localDay(now)
    if (raw.isNullOrBlank()) return AllowanceState(0, today, 0)
    val parts = raw.split('|')
    if (parts.size != 3) return AllowanceState(0, today, 0)
    val full = if (parts[0] == "1") 1 else 0
    val day = parts[1]
    val used = parts[2].toIntOrNull()?.coerceAtLeast(0) ?: 0
    val usedToday = if (day == today && used > 0) used else 0
    return AllowanceState(full, if (usedToday > 0) day else today, usedToday)
}

fun billingEnforced(answered: Boolean, purchasable: Boolean, premium: Boolean): Boolean =
    answered && purchasable && !premium

/** MediaStore sometimes accepts fewer uris than we asked for. Don't burn a full day for a file it refused. */
fun decisionForLaunched(decision: AllowanceDecision, launched: Int): AllowanceDecision {
    if (launched <= 0) return AllowanceDecision.Blocked
    return when (decision) {
        is AllowanceDecision.All -> decision.copy(consumesDaily = minOf(decision.consumesDaily, launched))
        is AllowanceDecision.Partial -> AllowanceDecision.Partial(
            take = minOf(decision.take, launched),
            consumesDaily = minOf(decision.consumesDaily, launched)
        )
        AllowanceDecision.Blocked -> AllowanceDecision.Blocked
    }
}
