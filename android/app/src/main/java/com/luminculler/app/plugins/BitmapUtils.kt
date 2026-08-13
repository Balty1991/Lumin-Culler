package com.luminculler.app.plugins

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import com.getcapacitor.PluginCall

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

private fun decodeUriCached(context: Context, uriString: String, maxSide: Int): Bitmap {
    val key = "$uriString|$maxSide"
    synchronized(bitmapCache) {
        val cached = bitmapCache[key]
        if (cached != null && !cached.isRecycled) return cached
    }
    val bitmap = decodeUri(context, Uri.parse(uriString), maxSide)
    synchronized(bitmapCache) { bitmapCache[key] = bitmap }
    return bitmap
}

/**
 * Bitmap-ul pe care trebuie sa ruleze acest apel, sau null daca apelul a fost
 * DEJA respins (apelantul trebuie doar sa iasa: `?: return`).
 */
fun resolveInputBitmap(context: Context, call: PluginCall): Bitmap? {
    val uri = call.getString("imageUri")
    if (!uri.isNullOrEmpty()) {
        return try {
            decodeUriCached(context, uri, call.getInt("maxSide") ?: DEFAULT_MAX_SIDE)
        } catch (e: Exception) {
            call.reject("Failed to read image from uri: ${e.message}", e)
            null
        }
    }

    val base64 = call.getString("imageBase64")
    if (base64.isNullOrEmpty()) {
        call.reject("imageBase64 or imageUri is required")
        return null
    }
    return try {
        decodeBase64ToBitmap(base64)
    } catch (e: Exception) {
        call.reject("Failed to decode image: ${e.message}", e)
        null
    }
}
