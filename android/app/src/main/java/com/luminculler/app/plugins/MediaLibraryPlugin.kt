package com.luminculler.app.plugins

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
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

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
 * fisierul ramane recuperabil la nivel de sistem chiar daca nu apare vizibil
 * in Galeria implicita a fiecarui telefon.
 */
@CapacitorPlugin(name = "MediaLibrary")
class MediaLibraryPlugin : Plugin() {
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

    override fun load() {
        deleteLauncher = bridge.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            val call = pendingDeleteCall
            pendingDeleteCall = null
            call?.resolve(JSObject().put("cancelled", result.resultCode != Activity.RESULT_OK))
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
            call.resolve(JSObject().put("cancelled", true))
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
            val uris = uriStrings.map { s ->
                val uri = Uri.parse(s)
                MediaStore.getMediaUri(context, uri) ?: uri
            }
            val pendingIntent = MediaStore.createTrashRequest(context.contentResolver, uris, true)
            pendingDeleteCall = call
            deleteLauncher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
        } catch (e: Exception) {
            pendingDeleteCall = null
            call.reject("Nu am putut porni cererea de stergere: ${e.message}", e)
        }
    }
}
