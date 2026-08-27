package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream

/**
 * Decodeaza HEIC/HEIF si il da inapoi ca JPEG.
 *
 * DE CE EXISTA. Chromium din WebView nu decodeaza HEIC in <canvas>. Pana acum,
 * o poza HEIC intra in import, pica la `createImageBitmap` cu
 * "source image could not be decoded", si utilizatorul ramanea cu o poza
 * lipsa si un motiv tehnic. HEIC e formatul implicit pe iPhone si pe multe
 * telefoane Android moderne — inclusiv cazul in care telefonul salveaza HEIC
 * dar il eticheteaza .jpg / "image/jpeg" (vezi sniffRealFormat in
 * core/importPipeline.ts), deci nici filtrul de format nu-l putea opri.
 *
 * DE CE NATIV SI NU WebAssembly. Varianta din tutoriale e libheif compilat in
 * wasm: ~1,2 MB in pachet, si duplica ceva ce telefonul are deja. Android
 * decodeaza HEIF nativ prin BitmapFactory incepand cu API 28, prin acelasi
 * `resolveInputBitmap` folosit de toate celelalte plugin-uri de aici. Zero
 * kilobytes in plus, si decodarea se face pe codecul hardware al telefonului.
 *
 * PE API 24-27 nu merge, si nu are cum: platforma nu stie HEIF. Metoda
 * `isSupported` spune asta cinstit, ca partea de JS sa poata da un mesaj
 * adevarat in loc sa incerce si sa esueze.
 *
 * Iesirea e JPEG, nu PNG, dinadins: intra imediat in analiza, unde oricum se
 * lucreaza pe o previzualizare redimensionata, iar un PNG de aceeasi latura ar
 * fi de cateva ori mai mare peste punte fara sa aduca nimic.
 */
private const val JPEG_QUALITY = 92

@CapacitorPlugin(name = "HeicDecoder")
class HeicDecoderPlugin : Plugin() {

    @PluginMethod
    fun isSupported(call: PluginCall) {
        val result = JSObject()
        // Build.VERSION_CODES.P = 28, prima versiune cu HEIF in BitmapFactory.
        result.put("supported", android.os.Build.VERSION.SDK_INT >= 28)
        call.resolve(result)
    }

    @PluginMethod
    fun decodeToJpeg(call: PluginCall) {
        if (android.os.Build.VERSION.SDK_INT < 28) {
            call.reject("HEIF decoding needs Android 9 or newer")
            return
        }

        // Acelasi drum ca la restul plugin-urilor: `imageUri` cand poza vine din
        // galerie (nimic peste punte), `imageBase64` altfel. resolveInputBitmap
        // respinge apelul cu un motiv, deci aici doar iesim.
        val bitmap: Bitmap = resolveInputBitmap(context, call) ?: return

        try {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            val result = JSObject()
            result.put("jpegBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            result.put("width", bitmap.width)
            result.put("height", bitmap.height)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to re-encode as JPEG: ${e.message}", e)
        } finally {
            recycleIfOwned(bitmap)
        }
    }
}
