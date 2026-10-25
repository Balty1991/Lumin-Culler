package com.luminculler.app.billing

/**
 * The only Play product ids. Same strings as src/core/suggestedPrices.ts
 * and as the products the owner creates in Play Console. There is no weekly plan.
 */
object PremiumIds {
    const val MONTHLY = "lumin_premium_monthly"
    const val YEARLY = "lumin_premium_yearly"
    const val LIFETIME = "lumin_premium_lifetime"

    val subscriptions = listOf(MONTHLY, YEARLY)
    val all = listOf(MONTHLY, YEARLY, LIFETIME)
}
