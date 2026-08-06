package com.luminculler.app.plugins

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Export in FOLDERE REALE pe Android, prin Storage Access Framework (SAF).
 *
 * Cerinta directa a utilizatorului ("la export folder, salveaza doar poza, nu
 * si folderul creat"): pana acum, singura cale de livrare pe Android era foaia
 * de partajare nativa (Share), care preda UN SINGUR fisier aplicatiei care il
 * primeste — aceea decide unde ajunge si cum se numeste, deci prefixul de
 * folder ("Ami/IMG_0001.jpg") era pur si simplu aruncat. Gruparea pe persoane/
 * scena supravietuia doar in arhiva .zip a exporturilor cu mai multe poze.
 *
 * Nici Filesystem-ul Capacitor nu ajuta: Directory.Documents/ExternalStorage
 * trec prin Environment.getExternalStoragePublicDirectory, blocat de scoped
 * storage pe Android 10+. SAF (ACTION_OPEN_DOCUMENT_TREE) e singura cale
 * prin care aplicatia poate scrie foldere reale intr-o locatie aleasa de
 * utilizator, fara NICIO permisiune de stocare declarata in manifest —
 * utilizatorul acorda accesul aratand exact folderul, o data per export.
 *
 * Rezultatul: pe Android exportul se comporta ca pe desktop (unde
 * showDirectoryPicker face deja exact asta) — alegi destinatia, iar pozele
 * ajung direct in subfoldere reale, fara foaie de partajare si fara dezarhivare.
 *
 * Deliberat NU foloseste androidx.documentfile (DocumentFile): ar fi o
 * dependinta Maven noua, imposibil de verificat din mediul in care a fost
 * scris acest cod (vezi nota despre maven.google.com din variables.gradle),
 * iar DocumentsContract e in SDK-ul de baza si acopera integral ce ne trebuie.
 */
@CapacitorPlugin(name = "FolderExport")
class FolderExportPlugin : Plugin() {

    /**
     * Deschide selectorul de folder al sistemului. Rezolva mereu (nu respinge)
     * — o anulare e un rezultat normal, nu o eroare: `{ cancelled: true }`.
     */
    @PluginMethod
    fun pickDirectory(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        startActivityForResult(call, intent, "directoryPicked")
    }

    @ActivityCallback
    private fun directoryPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val treeUri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || treeUri == null) {
            call.resolve(JSObject().put("cancelled", true))
            return
        }
        try {
            // Permisiunea persistenta nu e strict necesara pentru exportul curent (o
            // folosim imediat, in aceeasi sesiune), dar o cerem ca o versiune viitoare
            // sa poata reutiliza destinatia fara sa mai intrebe. Unii provideri nu o
            // ofera — nu e motiv sa esueze exportul care oricum urmeaza sa scrie ACUM.
            context.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (_: SecurityException) {
        }
        val rootDocUri = DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        )
        call.resolve(
            JSObject()
                .put("cancelled", false)
                .put("treeUri", treeUri.toString())
                .put("rootDocUri", rootDocUri.toString())
        )
    }

    /**
     * Creeaza (sau regaseste) un subfolder si intoarce URI-ul lui de document.
     * Idempotent: doua exporturi in aceeasi destinatie refolosesc acelasi folder
     * "Ami" in loc sa creeze "Ami (1)", "Ami (2)" — createDocument singur ar
     * dezambiguiza numele la fiecare apel, exact ce NU vrem pentru foldere.
     */
    @PluginMethod
    fun ensureDirectory(call: PluginCall) {
        val treeUri = call.getString("treeUri")?.let(Uri::parse)
        val parentDocUri = call.getString("parentDocUri")?.let(Uri::parse)
        val name = call.getString("name")
        if (treeUri == null || parentDocUri == null || name.isNullOrEmpty()) {
            call.reject("treeUri, parentDocUri and name are required")
            return
        }
        try {
            val existing = findChildDirectory(treeUri, parentDocUri, name)
            val docUri = existing ?: DocumentsContract.createDocument(
                context.contentResolver,
                parentDocUri,
                DocumentsContract.Document.MIME_TYPE_DIR,
                name
            )
            if (docUri == null) {
                call.reject("Could not create folder '$name' in the chosen location")
                return
            }
            call.resolve(JSObject().put("docUri", docUri.toString()))
        } catch (e: Exception) {
            call.reject("Could not create folder '$name': ${e.message}", e)
        }
    }

    /**
     * Scrie un fisier in folderul dat. Coliziunile de nume sunt lasate in seama
     * SAF (createDocument dezambiguizeaza singur, ex. "IMG_0001 (1).jpg") — un
     * export nu trebuie sa suprascrie tacut fisiere preexistente ale utilizatorului.
     */
    @PluginMethod
    fun writeFile(call: PluginCall) {
        val parentDocUri = call.getString("parentDocUri")?.let(Uri::parse)
        val name = call.getString("name")
        val data = call.getString("data")
        val mime = call.getString("mime") ?: "application/octet-stream"
        if (parentDocUri == null || name.isNullOrEmpty() || data == null) {
            call.reject("parentDocUri, name and data are required")
            return
        }
        try {
            val bytes = Base64.decode(data, Base64.DEFAULT)
            val fileUri = DocumentsContract.createDocument(context.contentResolver, parentDocUri, mime, name)
            if (fileUri == null) {
                call.reject("Could not create file '$name' in the chosen location")
                return
            }
            context.contentResolver.openOutputStream(fileUri)?.use { it.write(bytes) }
                ?: run {
                    call.reject("Could not open '$name' for writing")
                    return
                }
            call.resolve(JSObject().put("uri", fileUri.toString()))
        } catch (e: Exception) {
            call.reject("Could not write '$name': ${e.message}", e)
        }
    }

    private fun findChildDirectory(treeUri: Uri, parentDocUri: Uri, name: String): Uri? {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getDocumentId(parentDocUri)
        )
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val displayName = cursor.getString(1)
                val mimeType = cursor.getString(2)
                if (displayName == name && mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0))
                }
            }
        }
        return null
    }
}
