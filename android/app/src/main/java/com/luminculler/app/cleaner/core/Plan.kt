package com.luminculler.app.cleaner.core

import java.time.LocalDate
import java.util.Locale

/**
 * Ce e gratuit și ce e Premium. Un singur loc, ca ecranul, fișa din magazin
 * și paywall-ul să spună același lucru.
 *
 * Gratuit: teancul zilnic de 30 de poze, oricâte ștergeri din el; toate
 * coșurile vizibile, cu câți GB ocupă; PRIMA curățare completă a unui coș.
 * Premium: teancuri în plus în aceeași zi și curățarea coșurilor oricând.
 *
 * Prima curățare gratuită e deliberată: e momentul în care omul vede GB-ii
 * eliberați. Paywall-ul vine după rezultat, nu înaintea lui.
 */
object Plan {
    const val MONTHLY_ID = "lumin_premium_monthly"
    const val YEARLY_ID = "lumin_premium_yearly"
    const val LIFETIME_ID = "lumin_premium_lifetime"
    val SUBSCRIPTION_IDS = listOf(MONTHLY_ID, YEARLY_ID)

    fun canStartAnotherStack(premium: Boolean, stacksToday: Int): Boolean = premium || stacksToday == 0

    fun canBulkClean(premium: Boolean, freeBulkUsed: Boolean): Boolean = premium || !freeBulkUsed
}

/**
 * Seria de zile: câte zile la rând a terminat omul teancul. Azi neterminat nu
 * rupe seria (mai are timp până diseară); ieri neterminat da.
 */
object Streak {
    fun current(completedDays: Set<String>, today: LocalDate): Int {
        var day = if (today.toString() in completedDays) today else today.minusDays(1)
        var count = 0
        while (day.toString() in completedDays) {
            count++
            day = day.minusDays(1)
        }
        return count
    }
}

object Bytes {
    /** „2,4 GB” în română, „2.4 GB” în engleză. */
    fun format(bytes: Long, locale: Locale = Locale.getDefault()): String {
        if (bytes < 1024) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unit = -1
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit++
        }
        val pattern = if (value >= 100 || unit < 2) "%.0f %s" else "%.1f %s"
        return String.format(locale, pattern, value, units[unit])
    }
}
