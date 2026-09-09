package com.luminculler.app.plugins

import com.getcapacitor.PluginCall
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Un fir propriu pentru fiecare plugin, in loc de firul unic al Capacitor.
 *
 * DE CE. Toate apelurile de plugin ale unei aplicatii Capacitor trec printr-un
 * SINGUR fir — `HandlerThread("CapacitorPlugins")`, Bridge.java. Aplicatia asta
 * cere pe fiecare poza patru modele diferite, fiecare in propriul plugin, si
 * pana la auditul de dinaintea lansarii toate se asezau la coada pe firul ala.
 * De acolo venea paralelismul EFECTIV de 1,4 masurat din 4: partea de JS chiar
 * pornea patru poze deodata, dar partea nativa le executa aproape una cate una.
 * Nu procesorul era saturat — coada era.
 *
 * Un fir per plugin, nu un pool comun, si asta e alegerea importanta:
 *
 *  - modelele MediaPipe si ML Kit NU sunt sigure la apeluri concurente pe
 *    ACEEASI instanta (vezi si ReleasableModel.use, care serializeaza
 *    inferenta). Un fir per plugin da exact garantia de care au nevoie, fara
 *    lacate in plus si fara sa fie nevoie de cate o instanta per fir;
 *  - modele DIFERITE ruleaza acum chiar in paralel, ceea ce era tot rostul;
 *  - numarul de fire ramane marginit si previzibil (cate plugin-uri, atat),
 *    nu creste cu numarul de poze in zbor. Presiunea pe memorie si pe GPU —
 *    cauza confirmata a crash-urilor native de acum cateva runde — ramane
 *    plafonata de `nativeAnalysisConcurrency()` in partea de JS, exact ca
 *    inainte.
 *
 * Firele sunt "daemon": nu tin procesul viu daca aplicatia se inchide cu o
 * inferenta in curs.
 */
fun pluginExecutor(nume: String): ExecutorService =
    Executors.newSingleThreadExecutor { r ->
        Thread(r, "Lumin-$nume").apply { isDaemon = true }
    }

/**
 * Ruleaza treaba unui `@PluginMethod` pe firul plugin-ului, nu pe cel al puntii.
 *
 * Orice exceptie devine un `call.reject` — pe un executor, o exceptie scapata
 * n-ar avea unde sa fie prinsa si ar lasa apelul din JS agatat pentru
 * totdeauna, in loc sa esueze. Capacitor accepta `resolve`/`reject` de pe orice
 * fir, deci nu e nevoie de nicio intoarcere pe firul puntii.
 */
fun ExecutorService.ruleaza(call: PluginCall, mesajEroare: String, treaba: () -> Unit) {
    execute {
        try {
            treaba()
        } catch (e: Exception) {
            call.reject("$mesajEroare: ${e.message}", e)
        }
    }
}
