package com.luminculler.app.plugins

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Puntea catre BackgroundAnalysisService: partea de JS spune cand incepe si
 * cand se termina un import, si cat s-a facut.
 *
 * Deliberat SUBTIRE. Serviciul nu decide nimic despre import — nu stie ce e o
 * poza si nu tine nicio stare a lui. Analiza ramane unde e scrisa (WebView),
 * iar asta ii tine doar procesul viu.
 *
 * `start` e idempotent: un al doilea apel doar actualizeaza notificarea. Iar
 * `stop` merge chiar daca serviciul nu ruleaza — asa poate fi chemat
 * neconditionat dintr-un `finally`, ceea ce e si singurul loc corect.
 */
@CapacitorPlugin(name = "BackgroundAnalysis")
class BackgroundAnalysisPlugin : Plugin() {

    private fun trimite(actiune: String, done: Int, total: Int, text: String?) {
        val intent = Intent(context, BackgroundAnalysisService::class.java).apply {
            action = actiune
            putExtra(BackgroundAnalysisService.EXTRA_DONE, done)
            putExtra(BackgroundAnalysisService.EXTRA_TOTAL, total)
            if (text != null) putExtra(BackgroundAnalysisService.EXTRA_TEXT, text)
        }
        // startForegroundService, nu startService: serviciul e obligat sa cheme
        // startForeground() in cateva secunde, si chiar asta face, in prima linie
        // din onStartCommand. minSdk 26, deci nu e nevoie de ramura veche.
        context.startForegroundService(intent)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val rezultat = JSObject()
        try {
            trimite(
                BackgroundAnalysisService.ACTION_START,
                call.getInt("done") ?: 0,
                call.getInt("total") ?: 0,
                call.getString("text")
            )
            rezultat.put("started", true)
        } catch (e: Exception) {
            // Un serviciu de prim-plan poate fi refuzat de sistem (restrictii de
            // pornire din fundal, Android 12+). Nu e o eroare a importului:
            // acesta merge mai departe exact ca inainte, doar ca se opreste daca
            // omul incuie telefonul. De-aia se raspunde cu `started: false`, nu
            // cu `reject`.
            rezultat.put("started", false)
            rezultat.put("reason", e.message ?: e.javaClass.simpleName)
        }
        call.resolve(rezultat)
    }

    @PluginMethod
    fun update(call: PluginCall) {
        runCatching {
            trimite(
                BackgroundAnalysisService.ACTION_UPDATE,
                call.getInt("done") ?: 0,
                call.getInt("total") ?: 0,
                call.getString("text")
            )
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        runCatching {
            context.startService(
                Intent(context, BackgroundAnalysisService::class.java)
                    .apply { action = BackgroundAnalysisService.ACTION_STOP }
            )
        }
        call.resolve()
    }
}
