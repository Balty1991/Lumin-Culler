package com.luminculler.app.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64

/**
 * Partajat intre plugin-urile native (FaceDetectionPlugin, ImageAnalysisPlugin) —
 * bridge-ul Capacitor duce doar JSON, deci imaginea ajunge mereu ca base64,
 * niciodata ca Blob nativ.
 */
fun decodeBase64ToBitmap(base64: String): Bitmap {
    val commaIdx = base64.indexOf(",")
    val cleaned = if (base64.startsWith("data:") && commaIdx >= 0) base64.substring(commaIdx + 1) else base64
    val bytes = Base64.decode(cleaned, Base64.DEFAULT)
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("BitmapFactory returned null bitmap — invalid image data")
}
