package com.luminculler.app.plugins

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Comprimare video locală, cu Media3 Transformer.
 *
 * Scrie un fișier nou în Movies/Lumin. Nu șterge originalul: partea de JS o
 * face, doar dacă omul a debifat „păstrează originalul”, și tot prin dialogul
 * de confirmare al sistemului. Originalul nu dispare în tăcere.
 *
 * Premium se decide în TypeScript, cu aceeași regulă ca restul funcțiilor
 * plătite (există o cale de plată și omul nu e abonat). Plugin-ul nu citește
 * localStorage-ul WebView-ului.
 */
@UnstableApi
@CapacitorPlugin(name = "VideoCompress")
class VideoCompressPlugin : Plugin() {

    @PluginMethod
    fun compress(call: PluginCall) {
        val raw = call.getString("uri")
        if (raw.isNullOrBlank()) {
            call.reject("uri lipsește")
            return
        }
        val source = Uri.parse(raw)
        val originalBytes = call.getString("bytes")?.toLongOrNull() ?: 0L
        val displayName = (call.getString("name") ?: "video")
            .substringBeforeLast('.')
            .take(40)
            .ifBlank { "video" } + "-lumin.mp4"
        val output = File(context.cacheDir, "lumin-compress-${System.currentTimeMillis()}.mp4")
        val edited = EditedMediaItem.Builder(MediaItem.fromUri(source))
            .setEffects(
                Effects(
                    emptyList(),
                    listOf(Presentation.createForHeight(720))
                )
            )
            .build()
        call.setKeepAlive(true)
        activity.runOnUiThread {
            val transformer = Transformer.Builder(context)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(
                    DefaultEncoderFactory.Builder(context)
                        .setRequestedVideoEncoderSettings(
                            VideoEncoderSettings.Builder().setBitrate(2_500_000).build()
                        )
                        .build()
                )
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        try {
                            val published = publish(output, displayName)
                            val newBytes = output.length()
                            output.delete()
                            val saved = (originalBytes - newBytes).coerceAtLeast(0)
                            call.resolve(
                                JSObject()
                                    .put("uri", published.toString())
                                    .put("originalBytes", originalBytes)
                                    .put("newBytes", newBytes)
                                    .put("savedBytes", saved)
                            )
                        } catch (e: Exception) {
                            output.delete()
                            call.reject("Nu am putut salva videoclipul comprimat: ${e.message}", e)
                        }
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        output.delete()
                        call.reject("Comprimarea a eșuat: ${exportException.message}", exportException)
                    }
                })
                .build()
            try {
                transformer.start(edited, output.absolutePath)
            } catch (e: Exception) {
                output.delete()
                call.reject("Nu am putut porni comprimarea: ${e.message}", e)
            }
        }
    }

    private fun publish(file: File, displayName: String): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Lumin")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val dest = context.contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("MediaStore a refuzat fișierul nou")
        context.contentResolver.openOutputStream(dest)?.use { out ->
            file.inputStream().use { it.copyTo(out) }
        } ?: throw IllegalStateException("nu am putut scrie videoclipul")
        if (Build.VERSION.SDK_INT >= 29) {
            val done = ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }
            context.contentResolver.update(dest, done, null, null)
        }
        return dest
    }
}
