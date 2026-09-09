package com.luminculler.app.plugins

import android.os.Build
import android.os.PowerManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Cat de cald e telefonul, dupa parerea sistemului.
 *
 * DE CE EXISTA. Un import de 2000 de poze tine procesorul la maxim vreo opt
 * minute. Pe un flux sustinut, de la treapta "moderata" in sus, sistemul
 * coboara singur frecventele — 30-40% din debit, cu telefonul incalzindu-se in
 * continuare. Pana la auditul de dinaintea lansarii, `PowerManager` nu aparea
 * nicaieri in proiect: aplicatia impingea la fel de tare si la rece, si la
 * fierbinte, iar a doua jumatate a unui import lung se petrecea exact acolo.
 *
 * Ce face aplicatia cu cifra asta e treaba partii de JS (vezi
 * core/thermalStatus.ts si workerPool.ts): la "moderata" sau mai sus, coboara
 * la doua poze in zbor in loc de patru. Nu incetineste analiza — atat trece
 * oricum prin procesorul incetinit — dar nu mai adauga presiune peste un SoC
 * care deja da inapoi, si lasa telefonul sa se raceasca.
 *
 * API 29+ pentru citire (Android 10). Sub el, `supported: false` si partea de
 * JS ramane exact cum era. minSdk-ul proiectului e 26.
 */
@CapacitorPlugin(name = "Thermal")
class ThermalPlugin : Plugin() {

    /** Inregistrat o singura data, la primul `watch()`. */
    private var ascultator: PowerManager.OnThermalStatusChangedListener? = null

    private fun powerManager(): PowerManager? =
        context.getSystemService(android.content.Context.POWER_SERVICE) as? PowerManager

    /** Treapta curenta. `supported: false` inseamna "nu se stie", nu "e rece". */
    @PluginMethod
    fun status(call: PluginCall) {
        val result = JSObject()
        val pm = powerManager()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || pm == null) {
            result.put("supported", false)
            result.put("status", 0)
            call.resolve(result)
            return
        }
        result.put("supported", true)
        result.put("status", pm.currentThermalStatus)
        call.resolve(result)
    }

    /**
     * Anunta partea de JS cand se schimba treapta, in loc s-o puna sa intrebe.
     *
     * Intrebatul ar fi insemnat inca un apel peste punte pentru fiecare poza,
     * pe exact firul unic care e deja gatul sticlei (vezi masuratorile din
     * auditul motoarelor). Ascultatorul costa zero cand nu se schimba nimic.
     */
    @PluginMethod
    fun watch(call: PluginCall) {
        val pm = powerManager()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || pm == null) {
            call.resolve(JSObject().put("supported", false))
            return
        }
        if (ascultator == null) {
            val nou = PowerManager.OnThermalStatusChangedListener { treapta ->
                notifyListeners("thermalChange", JSObject().put("status", treapta))
            }
            runCatching { pm.addThermalStatusListener(nou) }
                .onSuccess { ascultator = nou }
        }
        call.resolve(JSObject().put("supported", true).put("status", pm.currentThermalStatus))
    }

    override fun handleOnDestroy() {
        val pm = powerManager()
        val curent = ascultator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null && curent != null) {
            runCatching { pm.removeThermalStatusListener(curent) }
        }
        ascultator = null
        super.handleOnDestroy()
    }
}
