package com.luminculler.app.plugins

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebView
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

    /**
     * Piesa care lipsea, si fara de care serviciul de prim-plan nu era de ajuns.
     *
     * Raportat de utilizator, cu o captura: cu ecranul stins analiza mergea, dar
     * cu aplicatia minimizata si el lucrand in ALTE aplicatii, bara ramanea la
     * 83 din 87. Iar la reintrarea in aplicatie "a reluat" — deci nimic nu
     * murise si nimic nu crapase: procesul de randare fusese INGHETAT, si a
     * pornit inapoi din locul in care ramasese.
     *
     * DE CE. Serviciul de prim-plan tine in afara cache-ului procesul
     * APLICATIEI. Dar WebView-ul isi ruleaza randarea intr-un proces separat,
     * izolat, iar importanta ACELUIA e legata implicit de cat se vede WebView-ul
     * pe ecran: politica implicita e (RENDERER_PRIORITY_IMPORTANT, waived =
     * true), unde `waived` inseamna "cand nu se vede, cade la cea mai mica
     * prioritate". Cu ecranul stins si telefonul nefacand nimic altceva, un
     * proces de prioritate mica tot apuca sa ruleze, si de-aia testul acela
     * trecea. Cu alte aplicatii cerand procesor si memorie, nu mai apuca — si
     * analiza statea, fara nicio eroare nicaieri.
     *
     * Se pune DOAR pe durata importului si se scoate la sfarsit. Prioritatea asta
     * e ceruta de la sistem in dauna celorlalte aplicatii; o aplicatie de poze
     * care si-ar tine randarea "importanta" non-stop, stand degeaba in fundal, ar
     * lua ceva ce nu-i trebuie.
     */
    private fun tinePrioritateaRandarii(tine: Boolean) {
        val webView = bridge?.webView ?: return
        activity?.runOnUiThread {
            // Al doilea parametru e `waivedWhenNotVisible`: cat timp lucram, NU
            // vrem sa fie cedata. minSdk 26, iar metoda exista de la 26.
            runCatching { webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !tine) }
        }
    }

    private fun trimite(actiune: String, done: Int, total: Int, text: String?, determinat: Boolean) {
        val intent = Intent(context, BackgroundAnalysisService::class.java).apply {
            action = actiune
            putExtra(BackgroundAnalysisService.EXTRA_DONE, done)
            putExtra(BackgroundAnalysisService.EXTRA_TOTAL, total)
            putExtra(BackgroundAnalysisService.EXTRA_DETERMINAT, determinat)
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
                call.getString("text"),
                call.getBoolean("determinate", true) ?: true
            )
            tinePrioritateaRandarii(true)
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
                call.getString("text"),
                call.getBoolean("determinate", true) ?: true
            )
        }
        call.resolve()
    }

    /**
     * E aplicatia scutita de optimizarea bateriei?
     *
     * Raportat cu o captura: 82 din 87, oprit de SAPTE minute, cat omul a stat in
     * alta aplicatie. Prioritatea randarii (vezi mai sus) a facut din blocaje de
     * minute blocaje de secunde, dar peste ea mai sta managerul de baterie al
     * producatorului, care poate opri de tot lucrul in fundal — si el nu se lasa
     * convins din cod.
     *
     * `isIgnoringBatteryOptimizations` NU cere nicio permisiune, deci intrebarea
     * e gratuita. RASPUNSUL insa nu e o garantie: pe multe telefoane exista pe
     * deasupra si restrictii proprii ale producatorului (pornire automata,
     * "economisire" per aplicatie) despre care Android nu stie nimic, si care pot
     * opri analiza chiar si cu raspunsul "scutita". Textul din aplicatie nu are
     * voie sa promita mai mult decat atat.
     */
    @PluginMethod
    fun batteryUnrestricted(call: PluginCall) {
        val rezultat = JSObject()
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm == null) {
            rezultat.put("available", false)
            rezultat.put("unrestricted", false)
        } else {
            rezultat.put("available", true)
            rezultat.put(
                "unrestricted",
                runCatching { pm.isIgnoringBatteryOptimizations(context.packageName) }.getOrDefault(false)
            )
        }
        call.resolve(rezultat)
    }

    /**
     * Duce omul la ecranul de unde poate scoate restrictia. NU o cere singura.
     *
     * DELIBERAT, si merita spus de ce: exista si un dialog care cere scutirea pe
     * loc (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS), dar el are nevoie de
     * permisiunea REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, iar Google Play o accepta
     * doar pentru cateva categorii de aplicatii — alarme, apeluri, automatizari.
     * O aplicatie de triat poze nu e printre ele, si declararea ei e un motiv de
     * respingere. Ecranul de setari se deschide fara nicio permisiune.
     *
     * Rezerva e pagina aplicatiei din Setari: pe telefoanele cu interfata proprie,
     * acolo sta oricum si comutatorul producatorului, cel care chiar decide.
     */
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val incercari = listOf(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        )
        for (intent in incercari) {
            val pornit = runCatching {
                context.startActivity(intent.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
                true
            }.getOrDefault(false)
            if (pornit) { call.resolve(); return }
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        tinePrioritateaRandarii(false)
        runCatching {
            context.startService(
                Intent(context, BackgroundAnalysisService::class.java)
                    .apply { action = BackgroundAnalysisService.ACTION_STOP }
            )
        }
        call.resolve()
    }
}
