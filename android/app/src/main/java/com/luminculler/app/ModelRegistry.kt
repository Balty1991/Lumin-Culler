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

    fun get(): T {
        value?.let { return it }
        return synchronized(this) {
            value ?: create().also {
                value = it
                ModelRegistry.register(this)
            }
        }
    }

    /** Folosire SINCRONA: modelul nu poate fi inchis cat timp blocul ruleaza. */
    fun <R> use(block: (T) -> R): R {
        inUse.incrementAndGet()
        try {
            return block(get())
        } finally {
            inUse.decrementAndGet()
        }
    }

    /** Folosire ASINCRONA: cheama `endUse()` cand chiar s-a terminat treaba. */
    fun beginUse(): T {
        inUse.incrementAndGet()
        return get()
    }

    fun endUse() {
        inUse.decrementAndGet()
    }

    /** `false` daca modelul e in uz si n-a fost inchis. */
    fun release(): Boolean {
        if (inUse.get() > 0) return false
        val current = synchronized(this) {
            val v = value
            value = null
            v
        } ?: return true
        runCatching { close(current) }
        return true
    }
}
