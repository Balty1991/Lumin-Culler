package com.luminculler.app.cleaner

import android.content.Context

object AllowanceStore {
    private const val PREFS = "lumin_allowance"
    private const val KEY = "state"

    fun read(context: Context, now: Long = System.currentTimeMillis()): AllowanceState {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        return parseAllowance(raw, now)
    }

    fun write(context: Context, state: AllowanceState) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, serializeAllowance(state))
            .apply()
    }
}

object ReviewStore {
    private const val PREFS = "lumin_review"

    fun deletes(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("deletes", 0)

    fun asked(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("asked", false)

    fun save(context: Context, deletes: Int, asked: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt("deletes", deletes)
            .putBoolean("asked", asked)
            .apply()
    }
}
