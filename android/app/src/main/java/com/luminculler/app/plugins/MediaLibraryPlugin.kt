package com.luminculler.app.plugins

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
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
 * de aceea deletePhotos() trateaza orice IllegalArgumentException/
 * SecurityException ca esec recuperabil (respinge apelul cu un mesaj clar),
 * nu ca un crash.
 */
@CapacitorPlugin(name = "MediaLibrary")
class MediaLibraryPlugin : Plugin() {
    private var pendingDeleteCallbackId: String? = null

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
            call.setKeepAlive(true)
            pendingDeleteCallbackId = bridge.saveCall(call)
            activity.startIntentSenderForResult(pendingIntent.intentSender, DELETE_REQUEST_CODE, null, 0, 0, 0)
        } catch (e: Exception) {
            call.reject("Nu am putut porni cererea de stergere: ${e.message}", e)
        }
    }

    /**
     * MediaStore.createDeleteRequest() intoarce un PendingIntent, lansat mai
     * sus prin startIntentSenderForResult (NU prin startActivityForResult, ca
     * la restul plugin-urilor din acest fisier de alaturi) — rezultatul
     * ajunge tot in onActivityResult-ul Activitatii, deci Bridge-ul Capacitor
     * il livreaza aici, la fel ca la orice alt cod de cerere pe care nu l-a
     * generat el insusi prin startActivityForResult(call, intent, ...).
     */
    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        if (requestCode != DELETE_REQUEST_CODE) return
        val callbackId = pendingDeleteCallbackId ?: return
        pendingDeleteCallbackId = null
        val call = bridge.getSavedCall(callbackId) ?: return
        call.resolve(JSObject().put("cancelled", resultCode != Activity.RESULT_OK))
        bridge.releaseCall(call)
    }

    companion object {
        private const val DELETE_REQUEST_CODE = 9001
    }
}
