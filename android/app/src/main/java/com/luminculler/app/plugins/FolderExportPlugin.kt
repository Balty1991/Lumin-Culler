package com.luminculler.app.plugins

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import java.io.File
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

    /**
     * Copiază poze în Pictures/Cherrypic/<album>. Sursa (content:// din galerie)
     * nu se șterge și nu se redenumește. Un eșec la o poză nu oprește restul.
     */
    @PluginMethod
    fun copyIntoLuminAlbum(call: PluginCall) {
        val album = sanitizeAlbum(call.getString("album"))
        val uris = call.getArray("uris")?.toList<String>() ?: emptyList()
        val names = call.getArray("names")?.toList<String>() ?: emptyList()
        if (uris.isEmpty()) {
            call.resolve(JSObject().put("copied", 0).put("skipped", 0))
            return
        }
        Thread {
            var copied = 0
            var skipped = 0
            val used = HashSet<String>()
            for (i in uris.indices) {
                val raw = uris[i]
                val name = uniqueName(sanitizeFileName(names.getOrNull(i) ?: "poza.jpg"), used)
                val source = try {
                    Uri.parse(raw)
                } catch (_: Exception) {
                    null
                }
                if (source == null || !copyOne(source, album, name)) skipped++ else copied++
            }
            call.resolve(JSObject().put("copied", copied).put("skipped", skipped))
        }.start()
    }

    private fun copyOne(source: Uri, album: String, displayName: String): Boolean {
        val resolver = context.contentResolver
        val mime = resolver.getType(source) ?: "image/jpeg"
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Images.Media.MIME_TYPE, mime)
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Cherrypic/$album")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val dest = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
            return try {
                val input = resolver.openInputStream(source) ?: throw IllegalStateException("sursa")
                val output = resolver.openOutputStream(dest) ?: throw IllegalStateException("copia")
                input.use { inn -> output.use { out -> inn.copyTo(out) } }
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(dest, values, null, null)
                true
            } catch (_: Exception) {
                resolver.delete(dest, null, null)
                false
            }
        }
        return try {
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Cherrypic/$album")
            if (!dir.exists() && !dir.mkdirs()) return false
            val out = File(dir, displayName)
            resolver.openInputStream(source)?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            } ?: return false
            MediaScannerConnection.scanFile(context, arrayOf(out.absolutePath), arrayOf(mime), null)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun sanitizeAlbum(raw: String?): String {
        val cleaned = (raw ?: "").replace(Regex("""[\\/:*?"<>|]"""), " ").replace(Regex("\\s+"), " ").trim()
        return if (cleaned.isEmpty()) "Album" else cleaned.take(40)
    }

    private fun sanitizeFileName(raw: String): String {
        val cleaned = raw.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("""[\\/:*?"<>|]"""), "_").trim()
        return if (cleaned.isEmpty()) "poza.jpg" else cleaned.take(80)
    }

    private fun uniqueName(name: String, used: MutableSet<String>): String {
        if (used.add(name)) return name
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var n = 2
        while (true) {
            val next = "$stem ($n)$ext"
            if (used.add(next)) return next
            n++
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
