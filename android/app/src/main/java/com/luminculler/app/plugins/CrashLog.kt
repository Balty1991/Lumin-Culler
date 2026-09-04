package com.luminculler.app.plugins

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Jurnal de pasi care SUPRAVIETUIESTE unei inchideri fortate.
 *
 * De ce exista: aplicatia se inchide in timpul analizei, si nici Play Console
 * nici testele nu ne-au dat pana acum o urma. Cand procesul e omorat de o
 * eroare NATIVA (SIGSEGV in MediaPipe sau ML Kit), nu exista exceptie de prins
 * in Java — procesul dispare, si cu el orice log tinut in memorie.
 *
 * Singurul lucru care ramane e ce s-a apucat sa ajunga pe DISC inainte. De
 * aceea fiecare pas se scrie imediat, cu flush, chiar daca asta costa: nu
 * masuram performanta aici, cautam ultima linie scrisa inainte de tacere.
 *
 * Cum se citeste: fiecare apel nativ scrie ">NUME" la intrare si "<NUME" la
 * iesire. Daca ultima linie din rularea precedenta incepe cu ">", ACOLO a
 * murit — s-a intrat in acel model si nu s-a mai iesit din el.
 *
 * La fiecare pornire, jurnalul rularii precedente e mutat deoparte si cel
 * curent o ia de la zero, ca sa nu creasca la nesfarsit.
 */
object CrashLog {
    private const val CURENT = "lumin-pasi.log"
    private const val PRECEDENT = "lumin-pasi-precedent.log"
    /** Peste atatea linii, jurnalul curent o ia de la capat: ne intereseaza sfarsitul, nu istoria. */
    private const val MAX_LINII = 400

    @Volatile private var fisier: File? = null
    private var linii = 0
    /**
     * Lacatul, si de ce a devenit obligatoriu.
     *
     * Jurnalul asta e SINGURUL lucru care ramane dupa o cadere nativa — nu
     * exista exceptie de prins, procesul dispare. Ce se citeste din el e o
     * singura informatie: ultima linie scrisa. Daca incepe cu ">", acolo s-a
     * murit.
     *
     * De cand analyzeNative() porneste trei apeluri native SIMULTAN pe aceeasi
     * poza (vezi core/nativeAnalysis.ts), `pas()` e chemat din mai multe fire
     * in acelasi timp. Fara lacat, doua lucruri se stricau exact cand jurnalul
     * trebuia sa fie de incredere: `linii++` se pierdea intre fire, iar
     * taierea de la MAX_LINII (`writeText("")`) putea sa cada intre deschiderea
     * si scrierea unui `appendText` de pe alt fir — adica sa stearga tocmai
     * ultima linie, cea pentru care exista tot fisierul.
     *
     * Costul e o scriere serializata pe disc. Il platim bucurosi: aici nu
     * masuram viteza, cautam ultimul cuvant dinainte de tacere.
     */
    private val lacat = Any()

    /**
     * Se cheama o singura data, din MainActivity.onCreate, INAINTE de orice
     * altceva: muta jurnalul rularii precedente deoparte, deschide unul nou,
     * si prinde exceptiile Java necapturate (pe cele native nu le poate prinde
     * nimeni, dar pentru ele avem pasii).
     */
    fun porneste(context: Context) {
        val curent = File(context.filesDir, CURENT)
        val precedent = File(context.filesDir, PRECEDENT)
        runCatching {
            if (curent.exists()) {
                precedent.delete()
                curent.renameTo(precedent)
            }
        }
        synchronized(lacat) {
            fisier = curent
            linii = 0
        }
        pas("PORNIRE")

        val anterior = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            val urma = StringWriter()
            e.printStackTrace(PrintWriter(urma))
            pas("EXCEPTIE pe firul ${thread.name}")
            scrieBrut(urma.toString())
            anterior?.uncaughtException(thread, e)
        }
    }

    /** Un pas. Se scrie IMEDIAT pe disc — vezi comentariul de sus. */
    fun pas(eticheta: String) {
        synchronized(lacat) {
            val f = fisier ?: return
            if (linii >= MAX_LINII) {
                runCatching { f.writeText("") }
                linii = 0
            }
            linii++
            scrieBrutLaLacat(eticheta)
        }
    }

    private fun scrieBrut(text: String) {
        synchronized(lacat) { scrieBrutLaLacat(text) }
    }

    /** Doar de sub `lacat` — vezi comentariul lui. */
    private fun scrieBrutLaLacat(text: String) {
        val f = fisier ?: return
        runCatching { f.appendText(text + "\n") }
    }

    /**
     * Pasii rularii PRECEDENTE, pentru partea de JS. Intoarce lista goala daca
     * nu exista (prima pornire, sau raportul a fost deja citit si sters).
     */
    fun pasiiRulariiPrecedente(context: Context): List<String> {
        val precedent = File(context.filesDir, PRECEDENT)
        if (!precedent.exists()) return emptyList()
        return runCatching { precedent.readLines() }.getOrDefault(emptyList())
    }

    fun uitaRulareaPrecedenta(context: Context) {
        runCatching { File(context.filesDir, PRECEDENT).delete() }
    }
}
