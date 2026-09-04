package com.luminculler.app.plugins

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import com.getcapacitor.PluginCall
import java.util.Collections
import java.util.WeakHashMap

/**
 * Partajat intre plugin-urile native de analiza (FaceDetection, ImageAnalysis,
 * ImageLabeling, FaceMesh, ImageEmbedder, PoseDetection, TextRecognition).
 *
 * DOUA cai de intrare pentru aceeasi imagine:
 *
 * 1. `imageUri` (preferata) — un content:// din galerie. Imaginea NU mai trece
 *    prin punte: o citim direct din MediaStore, o decodam o SINGURA data si o
 *    tinem intr-un cache mic, ca urmatoarele apeluri pentru aceeasi poza (o
 *    poza trece prin 4-7 modele) sa refoloseasca acelasi bitmap.
 *
 * 2. `imageBase64` (fallback, neschimbata) — pentru poze care nu vin din
 *    galerie (selector de fisiere, RAW decodat in JS) si pentru orice apelant
 *    mai vechi.
 *
 * De ce conteaza: pe calea base64, fiecare model primea poza codata JPEG in JS,
 * apoi in base64, apoi serializata ca JSON peste puntea Capacitor, apoi
 * decodata inapoi aici — de 4-7 ori per poza, cateva MB de fiecare data, din
 * care nimic nu era inferenta. Pe calea cu URI, costul acela dispare complet,
 * si dispare si decodarea repetata a aceleiasi imagini.
 */

/** Latura maxima implicita a bitmap-ului decodat din URI — vezi NATIVE_ANALYZE_MAX_SIDE (src/core/nativeAnalysis.ts), tinut deliberat aceeasi valoare. */
private const val DEFAULT_MAX_SIDE = 1280

/**
 * Cate poze decodate tinem simultan. Trebuie sa fie >= concurenta de analiza
 * din JS (nativeAnalysisConcurrency(), plafonata la 4): altfel doua poze in
 * zbor s-ar evacua reciproc din cache si am decoda de mai multe ori aceeasi
 * imagine, exact ce incearca acest cache sa evite.
 *
 * "4 poze" chiar inseamna 4 poze de cand se pastreaza DOAR latura implicita
 * (vezi sePastreazaInCache): inainte, aceeasi poza putea ocupa pana la trei
 * intrari — 320 px la pre-scanare, 1280 px la analiza, 2560 px la OCR — deci
 * cele patru locuri se umpleau cu doua poze, si a treia le arunca pe primele
 * afara chiar in timp ce erau analizate.
 *
 * Bitmap-urile evacuate NU se recicleaza explicit: un model poate inca sa
 * tina o referinta la unul (MediaPipe/ML Kit lucreaza asincron), iar
 * recycle() pe un bitmap inca folosit inseamna crash. Din Android 8 memoria de
 * bitmap sta pe heap-ul normal, deci le colecteaza GC-ul cand chiar nu mai e
 * nimeni pe ele.
 */
private const val CACHE_ENTRIES = 4

private val bitmapCache = object : LinkedHashMap<String, Bitmap>(CACHE_ENTRIES, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>): Boolean = size > CACHE_ENTRIES
}

/**
 * TOT ce a iesit vreodata din cache, tinut cu referinte SLABE — nu doar ce e
 * in cache CHIAR ACUM.
 *
 * A doua jumatate a bug-ului descris la recycleIfOwned, si cea care omora
 * aplicatia in timpul analizei chiar dupa prima reparatie.
 *
 * Cele trei apeluri din prima etapa a analizei (detectie de fete, analiza de
 * imagine, etichetare) pornesc SIMULTAN pe aceeasi poza, deci primesc ACELASI
 * obiect Bitmap din cache. ImageAnalysis se termina primul si intreaba "e al
 * cache-ului?" ca sa decida daca are voie sa-l recicleze. Intrebarea era pusa
 * cache-ului de ATUNCI — iar intre timp intrarea putea sa fie deja evacuata
 * (cache-ul tine 4 poze, analiza merge pe pana la 4 deodata, si OCR-ul mai
 * cere o intrare in plus pentru aceeasi poza la alta rezolutie). Evacuata
 * inseamna doar "nu se mai refoloseste", nu "nu mai e nimeni pe ea": ML Kit
 * inca citea pixelii pentru etichetare. Raspunsul "nu e al cache-ului" era
 * deci fals, bitmap-ul se recicla sub un model care rula, si procesul murea
 * pe loc — fara exceptie, fara mesaj, exact simptomul raportat.
 *
 * Setul de mai jos raspunde la intrebarea CORECTA: "l-a produs cache-ul?",
 * care nu se schimba niciodata dupa evacuare. Referintele sunt slabe, deci
 * intrarea dispare singura cand chiar nu mai are nimeni bitmap-ul — moment in
 * care nu mai e nimeni sa intrebe. Cheile sunt Bitmap-uri, care nu suprascriu
 * equals/hashCode, deci potrivirea e pe IDENTITATE, cum trebuie.
 */
private val bitmapuriProduseDeCache: MutableSet<Bitmap> =
    Collections.newSetFromMap(WeakHashMap<Bitmap, Boolean>())

fun decodeBase64ToBitmap(base64: String): Bitmap {
    val commaIdx = base64.indexOf(",")
    val cleaned = if (base64.startsWith("data:") && commaIdx >= 0) base64.substring(commaIdx + 1) else base64
    val bytes = Base64.decode(cleaned, Base64.DEFAULT)
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("BitmapFactory returned null bitmap — invalid image data")
}

/**
 * Orientarea reala a pozei, din EXIF.
 *
 * OBLIGATORIU: pe calea base64, imaginea venea din createImageBitmap() (JS),
 * care aplica deja orientarea EXIF — ajungea aici mereu "in picioare".
 * BitmapFactory NU face asta, deci fara rotatia de mai jos o poza facuta pe
 * verticala ar ajunge la modele culcata: fetele nu s-ar mai detecta, iar
 * cutiile si latimea/inaltimea raportate inapoi in JS ar fi pe alta axa decat
 * canvas-ul din care se decupeaza fetele pentru recunoastere.
 */
private fun exifRotationDegrees(context: Context, uri: Uri): Int {
    return try {
        context.contentResolver.openInputStream(uri).use { stream ->
            if (stream == null) return 0
            when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }
    } catch (e: Exception) {
        // EXIF ilizibil/absent (PNG, poza fara metadate) — o tratam ca fiind deja dreapta
        0
    }
}

private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (rotated != bitmap) bitmap.recycle() // sursa tocmai decodata, inca nu a vazut-o niciun model
    return rotated
}

private fun decodeUri(context: Context, uri: Uri, maxSide: Int): Bitmap {
    // Pas 1: doar dimensiunile, fara sa alocam pixelii.
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) throw IllegalArgumentException("Could not read image bounds from uri")

    // Pas 2: decodare subesantionata. inSampleSize e mereu o putere a lui 2,
    // deci rezultatul poate ramane pana la ~2x peste tinta — de aceea urmeaza
    // si o scalare exacta mai jos, ca sa nu tinem in cache bitmap-uri de 4 ori
    // mai mari decat avem nevoie.
    var sample = 1
    while (longest / (sample * 2) >= maxSide) sample *= 2
    val opts = BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
        ?: throw IllegalArgumentException("BitmapFactory returned null bitmap for uri")

    val decodedLongest = maxOf(decoded.width, decoded.height)
    val scaled = if (decodedLongest > maxSide) {
        val ratio = maxSide.toFloat() / decodedLongest
        val exact = Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * ratio).toInt().coerceAtLeast(1),
            (decoded.height * ratio).toInt().coerceAtLeast(1),
            true
        )
        if (exact != decoded) decoded.recycle()
        exact
    } else decoded

    val rotation = exifRotationDegrees(context, uri)
    return if (rotation == 0) scaled else rotate(scaled, rotation)
}

/**
 * Cate un lacat per poza, ca doua apeluri simultane pentru ACEEASI imagine sa
 * nu o decodeze amandoua.
 *
 * Cat timp modelele rulau strict unul dupa altul, cursa asta era rara si doar
 * risipitoare. De cand analyzeNative() porneste in paralel apelurile
 * independente (detectie de fete + analiza de imagine + etichete pentru aceeasi
 * poza), ea devine SISTEMATICA: toate trei rateaza cache-ul in aceeasi
 * milisecunda si decodeaza aceeasi imagine de trei ori — adica exact costul pe
 * care cache-ul exista ca sa-l elimine, transformand paralelizarea intr-o
 * inrautatire.
 *
 * Plafonat ca si cache-ul (obiecte minuscule, dar o galerie de 10.000 de poze
 * n-are voie sa lase in urma 10.000 de lacate). Un lacat evacuat cat timp cineva
 * il tine inseamna doar ca se revine la vechea cursa risipitoare — nu un blocaj
 * si nu un crash — iar cu limita de mai jos mult peste concurenta reala nu se
 * intampla in practica.
 */
private const val DECODE_LOCKS = 32

private val decodeLocks = object : LinkedHashMap<String, Any>(DECODE_LOCKS, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Any>): Boolean = size > DECODE_LOCKS
}

private fun lockFor(key: String): Any = synchronized(decodeLocks) { decodeLocks.getOrPut(key) { Any() } }

private fun cachedBitmap(key: String): Bitmap? = synchronized(bitmapCache) {
    bitmapCache[key]?.takeIf { !it.isRecycled }
}

/**
 * NU se pune in cache orice, si asta nu e o optimizare — e ce tine cache-ul
 * destul de mare pentru poza in lucru.
 *
 * Singurul apel cu alta latura decat cea implicita e OCR-ul (2560 px, vezi
 * NATIVE_OCR_MAX_SIDE in core/nativeAnalysis.ts). El ruleaza o singura data
 * per poza, la un singur model, si nimeni nu-i mai cere niciodata acel bitmap
 * a doua oara — deci cache-ul nu-l refoloseste NICIODATA. In schimb ii ocupa
 * o intrare din patru, si e cea mai mare alocare din aplicatie (~20 MB fata de
 * ~5 MB la 1280 px): o poza cu text evacua din cache o alta poza aflata chiar
 * atunci in analiza, ca sa tina o imagine pe care n-avea s-o mai foloseasca.
 *
 * Asa, bitmap-ul mare apartine apelantului, care il elibereaza imediat ce a
 * terminat (vezi recycleIfOwned in TextRecognitionPlugin) in loc sa zaca intr-o
 * intrare de cache pana il impinge altcineva afara.
 */
private fun sePastreazaInCache(maxSide: Int): Boolean = maxSide == DEFAULT_MAX_SIDE

private fun decodeUriCached(context: Context, uriString: String, maxSide: Int): Bitmap {
    if (!sePastreazaInCache(maxSide)) return decodeUri(context, Uri.parse(uriString), maxSide)
    val key = "$uriString|$maxSide"
    cachedBitmap(key)?.let { return it }
    synchronized(lockFor(key)) {
        // A doua verificare, sub lacat: cat am asteptat, alt fir poate sa fi
        // terminat exact decodarea pe care eram pe cale s-o repetam.
        cachedBitmap(key)?.let { return it }
        val bitmap = decodeUri(context, Uri.parse(uriString), maxSide)
        synchronized(bitmapCache) {
            bitmapCache[key] = bitmap
            // Marcat ca "al cache-ului" pe viata bitmap-ului, nu doar cat sta
            // in cache — vezi bitmapuriProduseDeCache.
            bitmapuriProduseDeCache.add(bitmap)
        }
        return bitmap
    }
}

/**
 * Recicleaza bitmap-ul DOAR daca nu apartine cache-ului comun.
 *
 * BUG REAL, care inchidea aplicatia in timpul analizei: resolveInputBitmap
 * intoarce, pentru calea cu `imageUri`, un bitmap din bitmapCache — ACELASI
 * obiect pentru toate plugin-urile care primesc aceeasi poza. Asa si trebuie:
 * se decodeaza o data si se folosesc toate.
 *
 * Cand am adaugat reciclarea (cerinta Play pe memoria bitmap), am reciclat si
 * bitmap-ul acela. Lantul: FaceDetection ia poza din cache, ImageAnalysis ia
 * ACEEASI poza si o recicleaza la final, iar FaceMesh/Pose/Segmentation o
 * primesc mai departe din cache, dar goala. Codul nativ atinge pixeli care nu
 * mai exista, si aplicatia moare — nu cu o exceptie prinsa, ci pe loc.
 *
 * Cache-ul isi elibereaza singur intrarile la evacuare (vezi removeEldestEntry);
 * cine imprumuta de acolo nu are ce elibera.
 */
fun recycleIfOwned(bitmap: Bitmap) {
    // Intrebarea e "l-a produs cache-ul?", nu "mai e in cache acum?" — vezi
    // bitmapuriProduseDeCache pentru ce a costat diferenta.
    val esteAlCacheului = synchronized(bitmapCache) { bitmapuriProduseDeCache.contains(bitmap) }
    if (!esteAlCacheului) bitmap.recycle()
}

/**
 * Renunta la pozele decodate din cache.
 *
 * Chemat din onTrimMemory (vezi MainActivity): asta e calea CORECTA de a
 * respecta pragul Play pe memoria bitmap — cache-ul stie ce detine, spre
 * deosebire de un plugin care doar imprumuta.
 *
 * Se da DRUMUL la referinte, nu se recicleaza: exact motivul scris mai sus, la
 * CACHE_ENTRIES. Un model poate inca sa tina unul (MediaPipe si ML Kit
 * lucreaza asincron), iar recycle() pe un bitmap inca folosit inseamna crash,
 * nu o exceptie. Din Android 8 memoria de bitmap sta pe heap-ul normal, deci
 * GC-ul o ia cand chiar nu mai e nimeni pe ea — si asta e destul de repede
 * pentru masuratoarea Play, care se face la scurt timp dupa schimbarea de
 * stare, nu instantaneu.
 */
fun releaseBitmapCache() {
    synchronized(bitmapCache) { bitmapCache.clear() }
}

/**
 * Bitmap-ul pe care trebuie sa ruleze acest apel, sau null daca apelul a fost
 * DEJA respins (apelantul trebuie doar sa iasa: `?: return`).
 */
fun resolveInputBitmap(context: Context, call: PluginCall): Bitmap? {
    val uri = call.getString("imageUri")
    if (!uri.isNullOrEmpty()) {
        // Decodarea e primul lucru care atinge poza, si cel mai probabil loc de
        // ramas fara memorie. Vezi CrashLog: daca ultima linie din jurnal e
        // ">Decodare", acolo a murit procesul.
        CrashLog.pas(">Decodare")
        return try {
            decodeUriCached(context, uri, call.getInt("maxSide") ?: DEFAULT_MAX_SIDE)
                .also { CrashLog.pas("<Decodare") }
        } catch (e: Exception) {
            CrashLog.pas("<Decodare")
            call.reject("Failed to read image from uri: ${e.message}", e)
            null
        }
    }

    val base64 = call.getString("imageBase64")
    if (base64.isNullOrEmpty()) {
        call.reject("imageBase64 or imageUri is required")
        return null
    }
    CrashLog.pas(">Decodare-base64")
    return try {
        decodeBase64ToBitmap(base64).also { CrashLog.pas("<Decodare-base64") }
    } catch (e: Exception) {
        CrashLog.pas("<Decodare-base64")
        call.reject("Failed to decode image: ${e.message}", e)
        null
    }
}
