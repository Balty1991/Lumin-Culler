package com.luminculler.app.plugins

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * Fereastra oficiala de recenzie a Google Play, direct in aplicatie.
 *
 * DE CE. Aplicatia a iesit in productie cu zero note, iar o aplicatie fara
 * nicio nota practic nu apare in cautarile din Play — organicul nu porneste
 * fara ele. Cine vrea sa lase o nota trebuia pana acum sa iasa din aplicatie,
 * sa caute fisa si sa deruleze pana la stele; aproape nimeni nu face asta.
 *
 * CE NU FACE, si e deliberat:
 *  - nu intreaba nimic INAINTE ("Iti place aplicatia?"). O intrebare care ii
 *    trimite doar pe cei multumiti la recenzie e exact ce interzice politica
 *    Play, si ar strica increderea in notele pe care le primesti;
 *  - nu ofera nimic in schimb;
 *  - nu decide CAND — asta e treaba lui state/reviewPrompt.ts.
 *
 * Google isi pastreaza dreptul sa NU arate fereastra (o cota proprie per
 * utilizator), iar API-ul, intentionat, nu spune daca a aparut sau nu.
 * `launched` inseamna doar ca cererea a ajuns la Play, nu ca omul a vazut
 * ceva. Pe un APK instalat din afara magazinului (build-urile de test) nu
 * apare niciodata — fluxul se incheie in tacere, si asta e comportamentul
 * documentat, nu un defect.
 */
@CapacitorPlugin(name = "InAppReview")
class InAppReviewPlugin : Plugin() {

    @PluginMethod
    fun request(call: PluginCall) {
        val act = activity
        if (act == null) {
            call.resolve(JSObject().put("launched", false))
            return
        }
        val manager = runCatching { ReviewManagerFactory.create(context) }.getOrNull()
        if (manager == null) {
            call.resolve(JSObject().put("launched", false))
            return
        }
        manager.requestReviewFlow().addOnCompleteListener { cerere ->
            if (!cerere.isSuccessful) {
                // Fara Play Store, fara cont, fara retea: nimic de aratat, si nicio
                // eroare de pus in fata omului pentru o fereastra pe care n-a cerut-o.
                call.resolve(JSObject().put("launched", false))
                return@addOnCompleteListener
            }
            manager.launchReviewFlow(act, cerere.result).addOnCompleteListener {
                call.resolve(JSObject().put("launched", true))
            }
        }
    }
}
