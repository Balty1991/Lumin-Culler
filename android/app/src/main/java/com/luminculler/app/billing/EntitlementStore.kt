package com.luminculler.app.billing

import android.content.Context

/** Last answer Play gave us. A failed refresh does not wipe a purchase. */
object EntitlementStore {
    private const val PREFS = "lumin_entitlement"

    fun isPremium(context: Context): Boolean = prefs(context).getBoolean("premium", false)

    fun setPremium(context: Context, premium: Boolean) {
        prefs(context).edit().putBoolean("premium", premium).apply()
    }

    fun isPurchasable(context: Context): Boolean = prefs(context).getBoolean("purchasable", false)

    fun setPurchasable(context: Context, purchasable: Boolean) {
        prefs(context).edit().putBoolean("purchasable", purchasable).apply()
    }

    fun hasAnswered(context: Context): Boolean = prefs(context).getBoolean("answered", false)

    fun setAnswered(context: Context, answered: Boolean) {
        prefs(context).edit().putBoolean("answered", answered).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
