package com.luminculler.app.plugins

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Filmul făcut în aplicație, adus la mp4 (H.264).
 *
 * DE CE. Filmul se înregistrează în WebView (MediaRecorder), iar pe multe
 * telefoane acolo iese doar WebM — pe care Instagram și WhatsApp nu-l iau bine.
 * Media3 Transformer (Google, Apache-2.0) îl recodează pe telefon, cu
 * codorul hardware. Nicio poză sau film nu pleacă de pe telefon.
 */
@CapacitorPlugin(name = "VideoConvert")
class VideoConvertPlugin : Plugin() {

    /** { path } (fișier WebM) → { path } (fișier mp4 în cache). */
    @PluginMethod
    fun toMp4(call: PluginCall) {
        val input = call.getString("path") ?: run { call.reject("Lipsește path"); return }
        val source = File(input.removePrefix("file://"))
        if (!source.exists()) { call.reject("Fișierul nu există"); return }
        val out = File(context.cacheDir, "lumin-film-${System.currentTimeMillis()}.mp4")
        // Transformer cere un fir cu Looper; îl pornim pe cel principal.
        Handler(Looper.getMainLooper()).post {
            try {
                val transformer = Transformer.Builder(context)
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            call.resolve(JSObject().put("path", out.absolutePath))
                        }

                        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                            out.delete()
                            call.reject("Conversia a eșuat: ${exportException.message}")
                        }
                    })
                    .build()
                transformer.start(MediaItem.fromUri(Uri.fromFile(source)), out.absolutePath)
            } catch (e: Exception) {
                call.reject("Conversia nu a pornit: ${e.message}")
            }
        }
    }
}
