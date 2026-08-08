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
 * si stergere ulterioara prin MediaStore.createDeleteRequest() (API 30+),
 * care afiseaza dialogul de confirmare AL SISTEMULUI. Aplicatia nu sterge
 * nimic fara acel acord explicit — nicio permisiune noua declarata in
 * manifest, exact ca la FolderExportPlugin (SAF).
 *
 * Limitare cunoscuta, ne-verificata inca pe device real: unii provideri
 * (Photo Picker-ul modern Android, unele aplicatii cloud) pot da URI-uri cu
 * scop limitat, care sa nu fie acceptate direct de createDeleteRequest() —
 * de aceea deletePhotos() trateaza orice exceptie ca esec recuperabil
 * (respinge apelul cu un mesaj clar), nu ca un crash.
 */
@CapacitorPlugin(name = "MediaLibrary")
class MediaLibraryPlugin : Plugin() {
    /**
     * createDeleteRequest() intoarce un PendingIntent, NU un Intent obisnuit —
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
     * Cere stergerea (efectiv, din stocare — nu doar din aplicatie) prin
     * dialogul de confirmare al sistemului. Rezolva mereu cu `cancelled`
     * (true/false dupa alegerea utilizatorului in acel dialog), nu respinge
     * doar pentru ca utilizatorul a ales "Nu" — o respingere reala inseamna
     * ca cererea nici n-a putut fi pornita.
     */
    @PluginMethod
    fun deletePhotos(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.reject("Stergerea prin dialogul sistemului necesita Android 11 (API 30) sau mai nou")
            return
        }
        val uriStrings = call.getArray("uris")?.toList<String>() ?: emptyList()
        if (uriStrings.isEmpty()) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        try {
            val uris = uriStrings.map(Uri::parse)
            val pendingIntent = MediaStore.createDeleteRequest(context.contentResolver, uris)
            pendingDeleteCall = call
            deleteLauncher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
        } catch (e: Exception) {
            pendingDeleteCall = null
            call.reject("Nu am putut porni cererea de stergere: ${e.message}", e)
        }
    }
}
