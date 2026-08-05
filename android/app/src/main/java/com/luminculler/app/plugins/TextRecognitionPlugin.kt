package com.luminculler.app.plugins

import android.graphics.Bitmap
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Analiza AI nativa (Faza 5) — recunoastere de text (OCR) cu Google ML Kit
 * (script Latin, acopera romana), bundle-uit direct in APK (ca FaceDetectionPlugin,
 * Faza 1) — offline imediat, fara Play Services.
 *
 * Scop: textul dens/aliniat e un semnal puternic ca o poza e de fapt un
 * document/o captura de ecran, nu o poza reala — exact bug-ul reparat mai
 * devreme in sesiune (documente aprobate automat, pentru ca nici COCO nici
 * ImageNet nu recunosc "document"). `textCoverage` (fractiunea din cadru
 * acoperita de cutii de text) e semnalul derivat gata pentru o faza viitoare
 * de conectare la decidePhotoStatus — NECONECTAT inca, la fel ca restul
 * plugin-urilor native.
 */
@CapacitorPlugin(name = "TextRecognition")
class TextRecognitionPlugin : Plugin() {

    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    @PluginMethod
    fun detectText(call: PluginCall) {
        val base64 = call.getString("imageBase64")
        if (base64.isNullOrEmpty()) {
            call.reject("imageBase64 is required")
            return
        }

        val bitmap: Bitmap = try {
            decodeBase64ToBitmap(base64)
        } catch (e: Exception) {
            call.reject("Failed to decode image: ${e.message}", e)
            return
        }

        val image = InputImage.fromBitmap(bitmap, 0)
        recognizer.process(image)
            .addOnSuccessListener { text ->
                val blocksArray = JSArray()
                val frameArea = (bitmap.width * bitmap.height).toDouble()
                var textArea = 0.0
                for (block in text.textBlocks) {
                    val box = block.boundingBox ?: continue
                    val blockObj = JSObject()
                    blockObj.put("text", block.text)
                    val boxObj = JSObject()
                    boxObj.put("left", box.left)
                    boxObj.put("top", box.top)
                    boxObj.put("width", box.width())
                    boxObj.put("height", box.height())
                    blockObj.put("box", boxObj)
                    blocksArray.put(blockObj)
                    textArea += (box.width() * box.height()).toDouble()
                }
                val result = JSObject()
                result.put("blocks", blocksArray)
                // Aproximare simpla (suma ariilor cutiilor, NU o uniune reala) —
                // suficient de precisa cat timp cutiile de text nu se suprapun
                // semnificativ, ceea ce e cazul tipic la OCR.
                result.put("textCoverage", if (frameArea > 0) (textArea / frameArea).coerceIn(0.0, 1.0) else 0.0)
                call.resolve(result)
            }
            .addOnFailureListener { e -> call.reject("Text recognition failed: ${e.message}", e) }
    }
}
