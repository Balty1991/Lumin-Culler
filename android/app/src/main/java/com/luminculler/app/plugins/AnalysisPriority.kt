package com.luminculler.app.plugins

import android.os.Process
import java.io.File

/**
 * Prioritatea firelor de analiză, după cine se uită.
 *
 * Firele modelelor rulează cu prioritate de fundal, ca desenarea să rămână fluidă cât omul
 * folosește aplicația. Cu ecranul stins sau cu aplicația în spate nu mai e nimic de desenat,
 * iar prioritatea mică doar frâna: raportat 13 nov., ~0,5 s/poză pe ecran, ~2,6 s/poză în fundal.
 *
 * „Plină” = aplicația nu e pe ecran SAU omul a deschis ecranul de lucru (prima privire,
 * „Lucrez la galeria ta”). Atunci firele de fundal ale procesului (inclusiv cele create de
 * modele, XNNPACK/MediaPipe, care moșteniseră prioritatea mică) trec pe prioritatea normală și
 * se întorc la loc când omul revine în aplicație.
 */
object AnalysisPriority {
    @Volatile private var ascunsa = false
    @Volatile private var focus = false
    private val ridicate = mutableSetOf<Int>()

    /** Firele noi create cât e „plină” nu mai coboară singure. */
    val plina: Boolean get() = ascunsa || focus

    fun aplicatiaAscunsa(on: Boolean) { ascunsa = on; aplica() }
    fun ecranDeLucru(on: Boolean) { focus = on; aplica() }

    @Synchronized private fun aplica() {
        if (plina) {
            val tids = File("/proc/self/task").list() ?: return
            val main = Process.myPid()
            for (nume in tids) {
                val tid = nume.toIntOrNull() ?: continue
                if (tid == main) continue
                runCatching {
                    val p = Process.getThreadPriority(tid)
                    if (p >= Process.THREAD_PRIORITY_BACKGROUND && p < Process.THREAD_PRIORITY_LOWEST) {
                        Process.setThreadPriority(tid, Process.THREAD_PRIORITY_DEFAULT)
                        ridicate += tid
                    }
                }
            }
        } else {
            for (tid in ridicate) runCatching { Process.setThreadPriority(tid, Process.THREAD_PRIORITY_BACKGROUND) }
            ridicate.clear()
            // Firele noastre pornite cât era „plină” (numele „Lumin-…”, tăiat la 15 caractere) coboară și ele.
            val tids = File("/proc/self/task").list() ?: return
            for (nume in tids) {
                val tid = nume.toIntOrNull() ?: continue
                runCatching {
                    if (File("/proc/self/task/$tid/comm").readText().startsWith("Lumin-")) {
                        Process.setThreadPriority(tid, Process.THREAD_PRIORITY_BACKGROUND)
                    }
                }
            }
        }
    }
}
