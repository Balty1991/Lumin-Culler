package com.luminculler.app

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Modelele native, tinute minte ca sa poata fi si ELIBERATE.
 *
 * De ce exista: fiecare plugin isi tinea detectorul intr-un `by lazy` — creat
 * la prima folosire si pastrat pana la oprirea procesului. Noua astea:
 * FaceLandmarker, PoseLandmarker, ImageSegmenter, ImageEmbedder si patru
 * detectoare ML Kit. Fiecare tine greutatile modelului in memorie NATIVA, si
 * le tinea si cat timp aplicatia statea in fundal, cu ecranul stins, ore
 * intregi.
 *
 * Exact aceea e memoria pe care Google Play o masoara de acum ca "Anonymous RSS
 * + Swap": alocari care nu pot fi scoase din RAM. Din februarie 2027, peste
 * prag inseamna vizibilitate redusa in magazin. Iar textul cerintei spune
 * raspicat ca esantionarea se face LA SCURT TIMP dupa o schimbare de stare, si
 * ca se asteapta ca aplicatia sa raspunda la `onTrimMemory` eliberand memoria.
 *
 * Modelele se recreeaza singure la urmatoarea folosire (`get()`), deci
 * eliberarea nu strica nimic — costa o singura reincarcare, o data, dupa ce
 * omul se intoarce in aplicatie.
 */
object ModelRegistry {
    private val models = ConcurrentHashMap.newKeySet<ReleasableModel<*>>()

    fun register(model: ReleasableModel<*>) {
        models.add(model)
    }

    /**
     * Elibereaza tot ce nu e in uz chiar acum.
     *
     * Intoarce cate modele au ramas ocupate — folositor doar pentru log; nu se
     * reincearca, fiindca urmatorul `onTrimMemory` vine oricum, iar o bucla de
     * asteptare pe firul principal ar fi mai rea decat memoria pe care o tine.
     */
    fun releaseAll(): Int {
        var ocupate = 0
        for (m in models) if (!m.release()) ocupate++
        return ocupate
    }
}

/**
 * Un model creat lenes, dar care poate fi si inchis.
 *
 * Inlocuieste `by lazy`, care nu se poate reseta niciodata.
 *
 * Contorul de folosire nu e paranoia: `release()` inchide o resursa NATIVA, iar
 * inchiderea unui detector in timp ce ruleaza o inferenta pe alt fir e un crash,
 * nu o exceptie prinsa. De-aia lucrul sincron se face prin `use { }`, iar cel
 * asincron (ML Kit intoarce un Task, GenAI un ListenableFuture) prin perechea
 * `beginUse()` / `endUse()`, cu `endUse()` in listener-ul de finalizare.
 */
class ReleasableModel<T : Any>(
    private val create: () -> T,
    private val close: (T) -> Unit
) {
    @Volatile private var value: T? = null
    private val inUse = AtomicInteger(0)

    /**
     * CURSA care a scos releaseAll() din onTrimMemory, si de ce nu mai exista.
     *
     * Varianta de dinainte facea "verifica, apoi actioneaza" pe doua lacate
     * diferite: `release()` citea contorul in afara oricarui lacat, iar
     * `beginUse()` isi crestea contorul in afara lui si abia apoi lua modelul.
     * Intre cele doua momente ale lui release() incapea un `beginUse()`
     * intreg — contorul crestea DUPA ce fusese citit pe zero, si modelul se
     * inchidea sub un fir care tocmai il primise. Inchiderea unei resurse
     * native folosite pe alt fir nu e o exceptie de prins, e procesul omorat
     * in tacere; semnatura se potrivea exact cu ce se vedea (analiza pornea si
     * aplicatia disparea fara mesaj), asa ca eliberarea a fost pur si simplu
     * scoasa din MainActivity.
     *
     * Acum ACHIZITIA (creste contorul + ia modelul) si VERIFICAREA din
     * release() se fac sub ACELASI lacat, deci sunt indivizibile una fata de
     * cealalta: cine a apucat sa-si creasca contorul e vazut de release(), si
     * cine a trecut de verificarea din release() nu mai poate fi ajuns din
     * urma. `close()` ramane in afara lacatului, pe obiectul deja scos —
     * oricine cere modelul dupa aceea creeaza altul, ceea ce e corect.
     *
     * Costul e un lacat luat la fiecare inferenta. Fata de o inferenta ML Kit
     * sau MediaPipe, e zgomot de fond.
     *
     * ATENTIE: asta face `release()` sigur, dar NU reactiveaza nimic —
     * MainActivity.onTrimMemory tot nu cheama ModelRegistry.releaseAll(). Un
     * primitiv corect nu e acelasi lucru cu o schimbare de comportament
     * verificata pe telefon, iar a doua ramane de facut.
     */
    private fun getLaLacat(): T = value ?: create().also {
        value = it
        ModelRegistry.register(this)
    }

    fun get(): T = synchronized(this) { getLaLacat() }

    /** Folosire SINCRONA: modelul nu poate fi inchis cat timp blocul ruleaza. */
    fun <R> use(block: (T) -> R): R {
        val model = beginUse()
        try {
            return block(model)
        } finally {
            endUse()
        }
    }

    /** Folosire ASINCRONA: cheama `endUse()` cand chiar s-a terminat treaba. */
    fun beginUse(): T = synchronized(this) {
        val model = getLaLacat()
        // Crescut SUB lacat, si dupa ce modelul e in mana: vezi comentariul de
        // mai sus pentru ce se intampla cand cele doua se pot despica.
        inUse.incrementAndGet()
        model
    }

    fun endUse() {
        inUse.decrementAndGet()
    }

    /** `false` daca modelul e in uz si n-a fost inchis. */
    fun release(): Boolean {
        val current = synchronized(this) {
            if (inUse.get() > 0) return false
            val v = value
            value = null
            v
        } ?: return true
        runCatching { close(current) }
        return true
    }
}
