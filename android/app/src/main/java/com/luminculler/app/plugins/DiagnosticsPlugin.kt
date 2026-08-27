package com.luminculler.app.plugins

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Puntea catre CrashLog: partea de JS intreaba, la pornire, cum s-a terminat
 * rularea precedenta. Vezi src/core/nativeDiagnostics.ts.
 */
@CapacitorPlugin(name = "Diagnostics")
class DiagnosticsPlugin : Plugin() {

    /**
     * Pasii rularii precedente, plus "unde a murit" gata calculat: ultima
     * linie care incepe cu ">" si nu si-a primit perechea "<".
     */
    @PluginMethod
    fun lastRun(call: PluginCall) {
        val pasi = CrashLog.pasiiRulariiPrecedente(context)
        val result = JSObject()
        result.put("steps", JSArray(pasi))
        result.put("crashedAt", ultimulPasNeinchis(pasi) ?: JSObject.NULL)
        // O rulare care s-a terminat cum trebuie NU lasa un pas deschis.
        result.put("crashed", ultimulPasNeinchis(pasi) != null)
        call.resolve(result)
    }

    @PluginMethod
    fun clearLastRun(call: PluginCall) {
        CrashLog.uitaRulareaPrecedenta(context)
        call.resolve()
    }

    /**
     * Parcurge pasii ca pe niste paranteze: ">X" deschide, "<X" inchide. Ce
     * ramane deschis la sfarsit e locul in care procesul a fost omorat.
     */
    private fun ultimulPasNeinchis(pasi: List<String>): String? {
        val deschise = ArrayDeque<String>()
        for (linie in pasi) {
            when {
                linie.startsWith(">") -> deschise.addLast(linie.substring(1))
                linie.startsWith("<") -> {
                    val nume = linie.substring(1)
                    // Se inchide ULTIMA aparitie a aceluiasi nume; apelurile
                    // paralele pe modele diferite se intercaleaza, deci o stiva
                    // stricta ar da raspunsuri gresite.
                    val idx = deschise.indexOfLast { it == nume }
                    if (idx >= 0) deschise.removeAt(idx)
                }
            }
        }
        return deschise.lastOrNull()
    }
}
