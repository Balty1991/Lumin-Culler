package com.luminculler.app.cleaner

import android.content.Context
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

/**
 * Tot ce ține minte aplicația între deschideri. Totul local: SharedPreferences
 * pentru numere, un fișier pentru lista de poze păstrate (poate avea mii de id-uri).
 */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("lumin_native", Context.MODE_PRIVATE)
    private val keptFile = File(context.filesDir, "lumin-kept.bin")

    /** Poze pe care omul a ales să le păstreze: nu i le mai propunem. */
    val kept: MutableSet<Long> = loadKept()

    var freedBytes: Long
        get() = prefs.getLong("freedBytes", 0L)
        set(v) = prefs.edit().putLong("freedBytes", v).apply()

    var freedCount: Int
        get() = prefs.getInt("freedCount", 0)
        set(v) = prefs.edit().putInt("freedCount", v).apply()

    var completedDays: Set<String>
        get() = prefs.getStringSet("completedDays", emptySet()).orEmpty().toSet()
        set(v) = prefs.edit().putStringSet("completedDays", v.sorted().takeLast(400).toSet()).apply()

    /** Teancul zilei: ziua, id-urile în ordine, cât s-a parcurs, al câtelea teanc azi. */
    var stackDay: String
        get() = prefs.getString("stackDay", "") ?: ""
        set(v) = prefs.edit().putString("stackDay", v).apply()

    var stackIds: List<Long>
        get() = prefs.getString("stackIds", "").orEmpty().split(',').mapNotNull { it.toLongOrNull() }
        set(v) = prefs.edit().putString("stackIds", v.joinToString(",")).apply()

    var stackPosition: Int
        get() = prefs.getInt("stackPosition", 0)
        set(v) = prefs.edit().putInt("stackPosition", v).apply()

    var stacksToday: Int
        get() = prefs.getInt("stacksToday", 0)
        set(v) = prefs.edit().putInt("stacksToday", v).apply()

    /** Pozele marcate pentru ștergere și încă neconfirmate de sistem. */
    var pendingDelete: List<Long>
        get() = prefs.getString("pendingDelete", "").orEmpty().split(',').mapNotNull { it.toLongOrNull() }
        set(v) = prefs.edit().putString("pendingDelete", v.joinToString(",")).apply()

    var freeBulkUsed: Boolean
        get() = prefs.getBoolean("freeBulkUsed", false)
        set(v) = prefs.edit().putBoolean("freeBulkUsed", v).apply()

    var onboarded: Boolean
        get() = prefs.getBoolean("onboarded", false)
        set(v) = prefs.edit().putBoolean("onboarded", v).apply()

    var dailyReminder: Boolean
        get() = prefs.getBoolean("dailyReminder", false)
        set(v) = prefs.edit().putBoolean("dailyReminder", v).apply()

    var reviewAsked: Boolean
        get() = prefs.getBoolean("reviewAsked", false)
        set(v) = prefs.edit().putBoolean("reviewAsked", v).apply()

    /**
     * Numele date oamenilor, legate de o poză în care apare persoana (id
     * MediaStore). Grupurile se recalculează la fiecare scanare, dar pozele
     * rămân: un nume se regăsește în grupul care conține poza lui.
     */
    var names: Map<Long, String>
        get() = try {
            val o = org.json.JSONObject(prefs.getString("names", "{}") ?: "{}")
            o.keys().asSequence().mapNotNull { k -> k.toLongOrNull()?.let { it to o.getString(k) } }.toMap()
        } catch (_: Throwable) {
            emptyMap()
        }
        set(v) {
            val o = org.json.JSONObject()
            v.forEach { (k, name) -> o.put(k.toString(), name) }
            prefs.edit().putString("names", o.toString()).apply()
        }

    fun keep(ids: Collection<Long>) {
        if (kept.addAll(ids)) saveKept()
    }

    fun unkeep(id: Long) {
        if (kept.remove(id)) saveKept()
    }

    private fun loadKept(): MutableSet<Long> {
        val out = HashSet<Long>()
        if (!keptFile.exists()) return out
        try {
            DataInputStream(keptFile.inputStream().buffered()).use { input ->
                val n = input.readInt()
                repeat(n) { out.add(input.readLong()) }
            }
        } catch (_: Throwable) {
            // fișier stricat: în cel mai rău caz îi mai propunem o dată o poză păstrată
        }
        return out
    }

    private fun saveKept() {
        val tmp = File(keptFile.parentFile, keptFile.name + ".tmp")
        try {
            DataOutputStream(tmp.outputStream().buffered()).use { out ->
                out.writeInt(kept.size)
                for (id in kept) out.writeLong(id)
            }
            tmp.renameTo(keptFile)
        } catch (_: Throwable) {
            tmp.delete()
        }
    }
}
