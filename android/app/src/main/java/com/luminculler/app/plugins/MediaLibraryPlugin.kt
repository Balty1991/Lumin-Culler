package com.luminculler.app.plugins

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Selectie de poze care PASTREAZA URI-ul content:// (spre deosebire de
 * <input type="file"> din WebView-ul Capacitor, care preda doar bytes-ii
 * fisierului si arunca URI-ul — vezi discutia din App.tsx/onAddPhotosClick)
 * si mutare ulterioara in Cosul de gunoi prin MediaStore.createTrashRequest()
 * (API 30+), care afiseaza dialogul de confirmare AL SISTEMULUI. Aplicatia nu
 * atinge nimic fara acel acord explicit — nicio permisiune noua declarata in
 * manifest, exact ca la FolderExportPlugin (SAF). Deliberat createTrashRequest(),
 * NU createDeleteRequest() (stergere definitiva) — cerinta directa a
 * utilizatorului: pozele trebuie sa poata fi recuperate din Cosul de gunoi al
 * telefonului daca se razgandeste, nu sterse ireversibil.
 *
 * Limitare cunoscuta, ne-verificata inca pe device real: unii provideri
 * (Photo Picker-ul modern Android, unele aplicatii cloud) pot da URI-uri cu
 * scop limitat, care sa nu fie acceptate direct de createTrashRequest() —
 * de aceea deletePhotos() trateaza orice exceptie ca esec recuperabil
 * (respinge apelul cu un mesaj clar), nu ca un crash.
 *
 * Confirmat pe device real (Xiaomi/HyperOS), prin re-interogarea directa a
 * MediaStore dupa operatie: fisierul CHIAR e marcat corect
 * (IS_TRASHED=true) — dar aplicatia de Galerie proprie a telefonului nu
 * arata in propriul ei ecran "Elemente sterse recent" pozele trecute in cos
 * de o ALTA aplicatie prin acest API standard Android. E o limitare a
 * respectivei aplicatii de Galerie (multe skin-uri de producator au propriul
 * "cos de gunoi", separat de flag-ul oficial Android), nu un bug aici —
 * fisierul ramane recuperabil la nivel de sistem (IS_TRASHED, nu bytes
 * stersi), dar NU garantat vizibil/recuperabil din Galeria implicita a
 * fiecarui telefon. Din acest motiv, textul aratat utilizatorului (vezi
 * batch.deleteRejected.* in i18n) trateaza actiunea ca stergere DEFINITIVA,
 * desi tehnic foloseste API-ul de trash (cel mai sigur disponibil) — mai
 * bine sa promitem mai putin decat sa lasam impresia falsa ca poate fi
 * recuperata sigur dintr-un loc anume.
 */
@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = [
        // Doua aliasuri SEPARATE, nu unul singur cu ambele string-uri — bug real
        // gasit la testare pe device (Xiaomi/HyperOS, Android 13+): READ_EXTERNAL_STORAGE
        // e limitat prin android:maxSdkVersion="32" in manifest, deci sistemul nu-l acorda
        // NICIODATA pe API 33+, indiferent ce alege utilizatorul in dialog. Un singur alias
        // cu ambele string-uri cerea "GRANTED" pe AMBELE ca sa treaca — pe API 33+ ramanea
        // veșnic "not granted" chiar dupa ce utilizatorul aproba READ_MEDIA_IMAGES, pentru ca
        // READ_EXTERNAL_STORAGE nu putea fi acordat niciodata. Vezi photosPermissionAlias mai
        // jos pentru alegerea aliasului corect dupa Build.VERSION.SDK_INT.
        Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES], alias = "photos33"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "photosLegacy")
    ]
)
class MediaLibraryPlugin : Plugin() {
    /** Vezi comentariul de la adnotarea @CapacitorPlugin de mai sus. */
    private val photosPermissionAlias: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "photos33" else "photosLegacy"
    /**
     * createTrashRequest() intoarce un PendingIntent, NU un Intent obisnuit —
     * nu se preteaza la startActivityForResult(call, intent, "callbackName")/
     * @ActivityCallback (mecanismul folosit de restul plugin-urilor din acest
     * fisier de alaturi, ex. FolderExportPlugin). Inregistram in schimb propriul
     * ActivityResultLauncher, cu contractul StartIntentSenderForResult — acelasi
     * bridge.registerForActivityResult() pe care Capacitor insusi il foloseste
     * intern pentru @ActivityCallback (vezi Plugin.initializeActivityLaunchers
     * in capacitor-android). Trebuie inregistrat in load() (rulat in onCreate,
     * inainte ca Activity-ul sa ajunga STARTED) — AndroidX respinge orice
     * inregistrare facuta mai tarziu.
     */
    private lateinit var deleteLauncher: ActivityResultLauncher<IntentSenderRequest>
    private var pendingDeleteCall: PluginCall? = null
    /**
     * URI-urile ORIGINALE (exact cum au fost primite din JS, nu cele convertite
     * intern de MediaStore.getMediaUri) omise la pre-verificarea de citire —
     * vezi deletePhotos. Returnate ca atare (nu doar un numar) ca partea JS
     * (state/store.ts:deleteRejectedPhotos) sa poata potrivi exact CARE poze
     * n-au fost sterse si sa NU le scoata din biblioteca aplicatiei, desi tot
     * lotul le-a cerut initial.
     */
    private var pendingDeleteSkippedUris: List<String> = emptyList()

    override fun load() {
        deleteLauncher = bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            val call = pendingDeleteCall
            val skippedUris = pendingDeleteSkippedUris
            pendingDeleteCall = null
            pendingDeleteSkippedUris = emptyList()
            val skippedArray = JSArray()
            for (u in skippedUris) skippedArray.put(u)
            call?.resolve(
                JSObject()
                    .put("cancelled", result.resultCode != Activity.RESULT_OK)
                    .put("skippedUris", skippedArray)
            )
        }
    }

    /**
     * Deschide selectorul de documente al sistemului (nu Photo Picker-ul
     * "modern", care da URI-uri cu scop limitat) — ACTION_OPEN_DOCUMENT cere
     * explicit persistarea permisiunii mai jos, ca URI-urile sa ramana
     * valide si dupa ce activitatea de selectie se inchide.
     */
    @PluginMethod
    fun pickPhotos(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(call, intent, "photosPicked")
    }

    @ActivityCallback
    private fun photosPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("cancelled", true).put("photos", JSArray()))
            return
        }
        val data = result.data
        val uris = mutableListOf<Uri>()
        val clipData = data?.clipData
        if (clipData != null) {
            for (i in 0 until clipData.itemCount) uris.add(clipData.getItemAt(i).uri)
        } else {
            data?.data?.let { uris.add(it) }
        }

        val photos = JSArray()
        for (uri in uris) {
            try {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
                // Unii provideri (documente virtuale, unele surse cloud) nu ofera
                // permisiune persistenta — URI-ul ramane valid doar in sesiunea
                // curenta, suficient pentru importul de acum.
            }
            photos.put(JSObject().put("uri", uri.toString()).put("name", queryDisplayName(uri) ?: uri.lastPathSegment))
        }
        call.resolve(JSObject().put("cancelled", false).put("photos", photos))
    }

    private fun queryDisplayName(uri: Uri): String? {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && cursor.moveToFirst()) return cursor.getString(nameIndex)
        }
        return null
    }

    /** true daca aplicatia poate CITI efectiv acest URI chiar acum — vezi comentariul din deletePhotos pentru bug-ul real pe care il evita. */
    private fun canRead(uri: Uri): Boolean {
        return try {
            context.contentResolver.query(uri, arrayOf(MediaStore.Images.Media._ID), null, null, null)
                ?.use { it.moveToFirst() } ?: false
        } catch (_: SecurityException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Muta pozele in Cosul de gunoi al sistemului (MediaStore.createTrashRequest,
     * NU createDeleteRequest) prin dialogul de confirmare al sistemului — cerinta
     * directa a utilizatorului: nu stergere definitiva, ca sa poata fi recuperate
     * daca se razgandeste (fereastra tipica de retentie ~30-60 zile, gestionata
     * de sistem/Galerie, nu de aceasta aplicatie). Rezolva mereu cu `cancelled`
     * (true/false dupa alegerea utilizatorului in acel dialog), nu respinge doar
     * pentru ca utilizatorul a ales "Nu" — o respingere reala inseamna ca cererea
     * nici n-a putut fi pornita.
     */
    @PluginMethod
    fun deletePhotos(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.reject("Mutarea in Cosul de gunoi prin dialogul sistemului necesita Android 11 (API 30) sau mai nou")
            return
        }
        val uriStrings = call.getArray("uris")?.toList<String>() ?: emptyList()
        if (uriStrings.isEmpty()) {
            call.resolve(JSObject().put("cancelled", true).put("skippedUris", JSArray()))
            return
        }
        try {
            // Confirmat pe device real: MediaStore respinge cu "All requested
            // items must be referenced by specific ID" cand primeste URI-uri SAF
            // de document (content://com.android.providers.media.documents/
            // document/image:123, exact ce intoarce ACTION_OPEN_DOCUMENT/
            // pickPhotos() de mai sus) — are nevoie de URI-uri MediaStore
            // propriu-zise (content://media/external/images/media/123).
            // MediaStore.getMediaUri() e conversia oficiala pentru exact acest
            // caz (document MediaProvider -> MediaStore); daca un URI nu vine de
            // la MediaProvider (alt furnizor SAF), intoarce null si pastram
            // URI-ul original ca ultima incercare.
            //
            // Bug real raportat de utilizator: UN SINGUR URI neaccesibil (ex.
            // permisiunea "Acces la fotografii selectate" pe Android 14+, sau
            // orice alta schimbare de permisiune intre import si stergere) facea
            // MediaStore.createTrashRequest() sa arunce pentru INTREG lotul —
            // 0 din 29 poze respinse se stergeau, din cauza uneia singure. Acum
            // verificam citirea fiecarui URI in parte INAINTE de cerere si il
            // omitem pe cele inaccesibile — dar pastram URI-ul ORIGINAL (nu cel
            // convertit) pentru fiecare omis, ca partea JS sa stie exact care
            // poza n-a fost stearsa (si sa n-o scoata din biblioteca aplicatiei).
            data class Candidate(val original: String, val resolved: Uri)
            val candidates = uriStrings.map { s -> Candidate(s, MediaStore.getMediaUri(context, Uri.parse(s)) ?: Uri.parse(s)) }
            val (readableCandidates, skippedCandidates) = candidates.partition { canRead(it.resolved) }
            val skippedOriginals = skippedCandidates.map { it.original }
            if (readableCandidates.isEmpty()) {
                call.reject("Niciuna dintre pozele de sters nu mai e accesibila (permisiunea de galerie s-a schimbat intre timp)")
                return
            }
            val pendingIntent = MediaStore.createTrashRequest(context.contentResolver, readableCandidates.map { it.resolved }, true)
            pendingDeleteCall = call
            pendingDeleteSkippedUris = skippedOriginals
            deleteLauncher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
        } catch (e: Exception) {
            pendingDeleteCall = null
            pendingDeleteSkippedUris = emptyList()
            call.reject("Nu am putut porni cererea de stergere: ${e.message}", e)
        }
    }

    /**
     * "Cate poze ai in galerie" (Acasa, plan modernizare — cerinta directa a
     * utilizatorului) — DOAR un numar (COUNT pe MediaStore), nu citeste bytes-ii
     * niciunei poze si nu aduce nimic in aplicatie. Import-ul efectiv ramane strict
     * prin pickPhotos() (selectorul explicit de mai sus) — asta e doar vizibilitate,
     * nu un import automat al intregii galerii.
     *
     * NEVALIDAT inca pe device real (nu poate fi testat din sesiunea de dezvoltare,
     * fara acces la un telefon Android fizic) — la fel ca celelalte module native
     * marcate explicit ne-verificate in acest proiect (ex. core/nativeTextRecognition.ts).
     * Verifica manual dupa instalare: permisiunea trebuie sa apara ca dialog nativ
     * o singura data, iar numarul intors trebuie sa corespunda cu ce arata Galeria.
     */
    @PluginMethod
    fun galleryOverview(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) != PermissionState.GRANTED) {
            requestPermissionForAlias(photosPermissionAlias, call, "galleryOverviewPermissionCallback")
            return
        }
        resolveGalleryOverview(call)
    }

    @PermissionCallback
    private fun galleryOverviewPermissionCallback(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) == PermissionState.GRANTED) {
            resolveGalleryOverview(call)
        } else {
            // Refuz explicit al utilizatorului — nu e o eroare, doar "nu stim numarul"
            call.resolve(JSObject().put("granted", false).put("totalCount", 0))
        }
    }

    private fun resolveGalleryOverview(call: PluginCall) {
        try {
            val projection = arrayOf(MediaStore.Images.Media._ID)
            val count = context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null, null
            )?.use { it.count } ?: 0
            call.resolve(JSObject().put("granted", true).put("totalCount", count))
        } catch (e: Exception) {
            call.reject("Nu am putut citi galeria: ${e.message}", e)
        }
    }

    /**
     * "Supervizorul galeriei" (cerinta directa a utilizatorului: import pe
     * perioade cronologice, cele mai vechi intai, cu recomandarea urmatoarei
     * perioade) — vezi state/gallerySupervisor.ts. Cea mai veche/cea mai noua
     * data efectiva din toata galeria, punctul de plecare pentru segmentarea
     * pe perioade. NEVALIDAT inca pe device real (ca galleryOverview() mai
     * sus) — de verificat manual dupa instalare ca earliestMs/latestMs
     * corespund cu cele mai vechi/noi poze reale din Galerie.
     *
     * Interogari simple (o coloana, sortata, primul rand), NU functii de
     * agregare SQL (MIN/MAX) in proiectie — MediaProvider (stocare cu scop
     * limitat, Android 10+) valideaza/restrictioneaza proiectiile pe unii
     * producatori, iar o expresie de agregare nu e garantat acceptata pe toti;
     * ORDER BY + primul rand e sintaxa standard de interogare, sigur suportata.
     */
    @PluginMethod
    fun galleryDateRange(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) != PermissionState.GRANTED) {
            requestPermissionForAlias(photosPermissionAlias, call, "galleryDateRangePermissionCallback")
            return
        }
        resolveGalleryDateRange(call)
    }

    @PermissionCallback
    private fun galleryDateRangePermissionCallback(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) == PermissionState.GRANTED) {
            resolveGalleryDateRange(call)
        } else {
            call.resolve(JSObject().put("granted", false))
        }
    }

    /** O singura data (prima dupa sortare) dintr-o coloana — null daca galeria e goala sau coloana lipseste peste tot. */
    private fun singleDate(column: String, ascending: Boolean): Long? {
        val projection = arrayOf(column)
        val selection = "$column IS NOT NULL AND $column > 0"
        val sortOrder = "$column ${if (ascending) "ASC" else "DESC"}"
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, selection, null, sortOrder
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(column)
                if (idx >= 0) return cursor.getLong(idx)
            }
        }
        return null
    }

    private fun resolveGalleryDateRange(call: PluginCall) {
        try {
            // DATE_TAKEN e in milisecunde; DATE_ADDED e in SECUNDE (particularitate
            // MediaStore) — pentru poze fara DATE_TAKEN (frecvent la capturi de
            // ecran/poze descarcate), DATE_ADDED*1000 e o aproximare rezonabila.
            val takenEarliest = singleDate(MediaStore.Images.Media.DATE_TAKEN, true)
            val takenLatest = singleDate(MediaStore.Images.Media.DATE_TAKEN, false)
            val addedEarliest = singleDate(MediaStore.Images.Media.DATE_ADDED, true)?.times(1000)
            val addedLatest = singleDate(MediaStore.Images.Media.DATE_ADDED, false)?.times(1000)
            val earliest = listOfNotNull(takenEarliest, addedEarliest).minOrNull()
            val latest = listOfNotNull(takenLatest, addedLatest).maxOrNull()
            val result = JSObject().put("granted", true)
            if (earliest != null) result.put("earliestMs", earliest)
            if (latest != null) result.put("latestMs", latest)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Nu am putut citi intervalul de date al galeriei: ${e.message}", e)
        }
    }

    /**
     * Pozele din galerie cu data efectiva (DATE_TAKEN, fallback DATE_ADDED)
     * in intervalul [startMs, endMs) — "Supervizorul galeriei" aduce direct
     * aceasta perioada, fara sa mai treaca prin selectorul manual pickPhotos()
     * de mai sus (ar insemna sa cauti manual aceleasi poze dupa data, exact
     * ce aceasta functie automatizeaza). Foloseste ACEEASI permisiune ca
     * galleryOverview/galleryDateRange (READ_MEDIA_IMAGES/READ_EXTERNAL_STORAGE),
     * deja acordata daca oricare din ele a rulat inainte. NEVALIDAT inca pe
     * device real.
     */
    @PluginMethod
    fun photosInRange(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) != PermissionState.GRANTED) {
            requestPermissionForAlias(photosPermissionAlias, call, "photosInRangePermissionCallback")
            return
        }
        resolvePhotosInRange(call)
    }

    @PermissionCallback
    private fun photosInRangePermissionCallback(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) == PermissionState.GRANTED) {
            resolvePhotosInRange(call)
        } else {
            call.resolve(JSObject().put("granted", false).put("photos", JSArray()))
        }
    }

    /** Coloanele comune (id/nume/data) citite ca JSArray de {uri,name,capturedAt} — reutilizat de photosInRange si photosInFolder, aceeasi forma de rezultat pentru ambele cai. */
    private fun queryPhotosAsJson(selection: String?, args: Array<String>?): JSArray {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED
        )
        val photos = JSArray()
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, selection, args,
            "${MediaStore.Images.Media.DATE_TAKEN} ASC"
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val takenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString())
                val taken = cursor.getLong(takenCol)
                val added = cursor.getLong(addedCol)
                val capturedAt = if (taken > 0) taken else added * 1000
                photos.put(
                    JSObject()
                        .put("uri", uri.toString())
                        .put("name", cursor.getString(nameCol) ?: "photo_$id.jpg")
                        .put("capturedAt", capturedAt)
                )
            }
        }
        return photos
    }

    private fun resolvePhotosInRange(call: PluginCall) {
        // Transmise ca text (nu numar) dinspre JS: milisecundele de la epoca depasesc
        // domeniul unui Int pe 32 de biti (folosit de unele metode PluginCall.getInt),
        // iar un string+toLongOrNull() e cea mai sigura conversie fara ambiguitate de tip.
        val startMs = call.getString("startMs")?.toLongOrNull()
        val endMs = call.getString("endMs")?.toLongOrNull()
        if (startMs == null || endMs == null) {
            call.reject("startMs/endMs lipsesc sau sunt invalide")
            return
        }
        try {
            val selection = "(${MediaStore.Images.Media.DATE_TAKEN} BETWEEN ? AND ?) OR " +
                "(${MediaStore.Images.Media.DATE_TAKEN} IS NULL AND ${MediaStore.Images.Media.DATE_ADDED} BETWEEN ? AND ?) OR " +
                "(${MediaStore.Images.Media.DATE_TAKEN} = 0 AND ${MediaStore.Images.Media.DATE_ADDED} BETWEEN ? AND ?)"
            val addedStartSec = (startMs / 1000).toString()
            val addedEndSec = (endMs / 1000).toString()
            val args = arrayOf(
                startMs.toString(), endMs.toString(),
                addedStartSec, addedEndSec,
                addedStartSec, addedEndSec
            )
            call.resolve(JSObject().put("granted", true).put("photos", queryPhotosAsJson(selection, args)))
        } catch (e: Exception) {
            call.reject("Nu am putut citi pozele din acest interval: ${e.message}", e)
        }
    }

    /**
     * Foldere (bucket-uri MediaStore, ex. "Camera", "WhatsApp Images",
     * "Screenshots") — cerinta directa a utilizatorului: alternativa la
     * segmentarea cronologica, sortare pe sursa. O singura trecere prin
     * cursor (fara GROUP BY — vezi comentariul de la galleryDateRange despre
     * functii de agregare SQL nesigure pe MediaProvider), numarand manual per
     * bucket. NEVALIDAT inca pe device real.
     */
    @PluginMethod
    fun galleryFolders(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) != PermissionState.GRANTED) {
            requestPermissionForAlias(photosPermissionAlias, call, "galleryFoldersPermissionCallback")
            return
        }
        resolveGalleryFolders(call)
    }

    @PermissionCallback
    private fun galleryFoldersPermissionCallback(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) == PermissionState.GRANTED) {
            resolveGalleryFolders(call)
        } else {
            call.resolve(JSObject().put("granted", false).put("folders", JSArray()))
        }
    }

    private fun resolveGalleryFolders(call: PluginCall) {
        try {
            val projection = arrayOf(MediaStore.Images.Media.BUCKET_ID, MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            // LinkedHashMap - pastreaza ordinea primei aparitii, rezonabil pentru o
            // lista stabila intre apeluri fara sa mai sortam separat dupa nume.
            val counts = LinkedHashMap<String, Pair<String, Int>>()
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null, null
            )?.use { cursor ->
                val idCol = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_ID)
                val nameCol = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                if (idCol >= 0 && nameCol >= 0) {
                    while (cursor.moveToNext()) {
                        val id = cursor.getString(idCol) ?: continue
                        val name = cursor.getString(nameCol) ?: continue
                        val existing = counts[id]
                        counts[id] = name to ((existing?.second ?: 0) + 1)
                    }
                }
            }
            val folders = JSArray()
            for ((id, pair) in counts) {
                folders.put(JSObject().put("id", id).put("name", pair.first).put("count", pair.second))
            }
            call.resolve(JSObject().put("granted", true).put("folders", folders))
        } catch (e: Exception) {
            call.reject("Nu am putut citi folderele galeriei: ${e.message}", e)
        }
    }

    /** Pozele dintr-un singur folder (bucket) — vezi galleryFolders() de mai sus. NEVALIDAT inca pe device real. */
    @PluginMethod
    fun photosInFolder(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) != PermissionState.GRANTED) {
            requestPermissionForAlias(photosPermissionAlias, call, "photosInFolderPermissionCallback")
            return
        }
        resolvePhotosInFolder(call)
    }

    @PermissionCallback
    private fun photosInFolderPermissionCallback(call: PluginCall) {
        if (getPermissionState(photosPermissionAlias) == PermissionState.GRANTED) {
            resolvePhotosInFolder(call)
        } else {
            call.resolve(JSObject().put("granted", false).put("photos", JSArray()))
        }
    }

    private fun resolvePhotosInFolder(call: PluginCall) {
        val bucketId = call.getString("bucketId")
        if (bucketId.isNullOrEmpty()) {
            call.reject("bucketId lipseste")
            return
        }
        try {
            val selection = "${MediaStore.Images.Media.BUCKET_ID} = ?"
            val args = arrayOf(bucketId)
            call.resolve(JSObject().put("granted", true).put("photos", queryPhotosAsJson(selection, args)))
        } catch (e: Exception) {
            call.reject("Nu am putut citi pozele din acest folder: ${e.message}", e)
        }
    }
}
