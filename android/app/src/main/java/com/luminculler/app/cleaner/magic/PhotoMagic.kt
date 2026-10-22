package com.luminculler.app.cleaner.magic

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import com.luminculler.app.cleaner.core.Enhance
import java.io.File

/**
 * Efectele AI care merg pe telefon, gratuit și fără internet:
 * îmbunătățirea automată și portretul cu fundal neclar.
 */
class PhotoMagic(private val context: Context) {

    private val segmenter: ImageSegmenter by lazy {
        ImageSegmenter.createFromOptions(
            context,
            ImageSegmenter.ImageSegmenterOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("selfie_segmenter.tflite").build())
                // Masca de încredere: canalul 0 e probabilitatea să fie persoană (vezi SegmentationPlugin).
                .setOutputCategoryMask(false)
                .setOutputConfidenceMasks(true)
                .setRunningMode(RunningMode.IMAGE)
                .build()
        )
    }

    /** Niveluri pe fiecare canal, gamma spre o luminozitate echilibrată, culoare puțin mai vie. */
    fun enhance(src: Bitmap): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        val hr = IntArray(256); val hg = IntArray(256); val hb = IntArray(256)
        val step = maxOf(1, px.size / 300_000)
        var i = 0
        while (i < px.size) {
            val p = px[i]
            hr[(p shr 16) and 0xFF]++; hg[(p shr 8) and 0xFF]++; hb[p and 0xFF]++
            i += step
        }
        val (rl, rh) = Enhance.levels(hr)
        val (gl, gh) = Enhance.levels(hg)
        val (bl, bh) = Enhance.levels(hb)
        // Luminozitatea medie după niveluri, ca să alegem gamma.
        var sum = 0.0
        var n = 0
        i = 0
        while (i < px.size) {
            val p = px[i]
            val r = (((p shr 16) and 0xFF) - rl).toFloat() / (rh - rl)
            val g = (((p shr 8) and 0xFF) - gl).toFloat() / (gh - gl)
            val b = ((p and 0xFF) - bl).toFloat() / (bh - bl)
            sum += (0.299f * r + 0.587f * g + 0.114f * b).coerceIn(0f, 1f)
            n++
            i += step
        }
        val gamma = Enhance.gamma((sum / n.coerceAtLeast(1)).toFloat())
        val lr = Enhance.lut(rl, rh, gamma); val lg = Enhance.lut(gl, gh, gamma); val lb = Enhance.lut(bl, bh, gamma)
        for (k in px.indices) {
            val p = px[k]
            px[k] = (p and -0x1000000) or (lr[(p shr 16) and 0xFF] shl 16) or (lg[(p shr 8) and 0xFF] shl 8) or lb[p and 0xFF]
        }
        val leveled = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(leveled, 0f, 0f, Paint().apply {
            colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(Enhance.SATURATION) })
        })
        leveled.recycle()
        return out
    }

    /**
     * Portret: persoana rămâne clară, fundalul se estompează, cu tranziție
     * moale pe contur. Întoarce null dacă modelul nu vede nicio persoană.
     */
    fun portrait(src: Bitmap): Bitmap? {
        val mask = personMask(src) ?: return null
        val blurred = blur(src)
        val out = blurred.copy(Bitmap.Config.ARGB_8888, true)
        blurred.recycle()
        // Persoana clară peste fundalul estompat, prin masca de transparență.
        val personLayer = cutout(src, mask)
        Canvas(out).drawBitmap(personLayer, 0f, 0f, null)
        personLayer.recycle()
        mask.recycle()
        return out
    }

    /**
     * Masca persoanei, la dimensiunea pozei: alfa = probabilitatea să fie om.
     * Null dacă modelul nu vede pe nimeni (sub 2% din cadru).
     */
    fun personMask(src: Bitmap): Bitmap? {
        // MediaPipe primește doar ARGB_8888; pozele HDR vin ca RGBA_F16 și îl făceau să arunce.
        // Modelul lucrează oricum la 256 px, deci o copie mică ajunge.
        val scale = minOf(1f, 1024f / maxOf(src.width, src.height))
        val input = Bitmap.createBitmap(maxOf(1, (src.width * scale).toInt()), maxOf(1, (src.height * scale).toInt()), Bitmap.Config.ARGB_8888)
        Canvas(input).drawBitmap(src, null, android.graphics.Rect(0, 0, input.width, input.height), Paint(Paint.FILTER_BITMAP_FLAG))
        val maskPx: IntArray
        val mw: Int
        val mh: Int
        var person = 0
        // Un singur apel odată: o atingere nouă nu oprește calculul pornit, iar segmenterul nu suportă apeluri paralele.
        synchronized(this) {
            val result = segmenter.segment(BitmapImageBuilder(input).build())
            val masks = result.confidenceMasks()
            if (!masks.isPresent || masks.get().isEmpty()) { input.recycle(); return null }
            val maskImage = masks.get()[0]
            mw = maskImage.width
            mh = maskImage.height
            val buf = ByteBufferExtractor.extract(maskImage).asFloatBuffer()
            maskPx = IntArray(mw * mh)
            for (k in maskPx.indices) {
                val v = buf.get(k).coerceIn(0f, 1f)
                if (v > 0.5f) person++
                maskPx[k] = ((v * 255).toInt() shl 24)
            }
        }
        input.recycle()
        if (person < maskPx.size * 0.02f) return null
        val maskSmall = Bitmap.createBitmap(maskPx, mw, mh, Bitmap.Config.ARGB_8888)
        val mask = Bitmap.createScaledBitmap(maskSmall, src.width, src.height, true)
        maskSmall.recycle()
        return mask
    }

    /** Doar persoana, pe transparent. */
    fun cutout(src: Bitmap, mask: Bitmap): Bitmap {
        val layer = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        Canvas(layer).apply {
            drawBitmap(mask, 0f, 0f, null)
            drawBitmap(src, 0f, 0f, Paint().apply { xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN) })
        }
        return layer
    }

    /** Fundalul fără persoană: locul ei acoperit cu o versiune foarte estompată, ca mișcarea 3D să nu lase „fantome”. */
    fun background(src: Bitmap, mask: Bitmap): Bitmap {
        val soft = blur(src)
        val out = src.copy(Bitmap.Config.ARGB_8888, true)
        val c = Canvas(out)
        // Masca puțin lățită, ca marginea persoanei să nu rămână în fundal.
        val wide = Bitmap.createScaledBitmap(mask, (mask.width * 1.04f).toInt(), (mask.height * 1.04f).toInt(), true)
        val fill = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        Canvas(fill).apply {
            drawBitmap(wide, -(wide.width - mask.width) / 2f, -(wide.height - mask.height) / 2f, null)
            drawBitmap(soft, 0f, 0f, Paint().apply { xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN) })
        }
        c.drawBitmap(fill, 0f, 0f, null)
        wide.recycle(); fill.recycle(); soft.recycle()
        return out
    }

    /** Stil clasic (gratuit), pe pixeli. */
    fun filter(src: Bitmap, style: com.luminculler.app.cleaner.core.Style): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        val out = com.luminculler.app.cleaner.core.Styles.apply(style, px, w, h)
        return Bitmap.createBitmap(out, w, h, Bitmap.Config.ARGB_8888)
    }

    /** Estompare rapidă: micșorare de 12 ori, două treceri de box blur, mărire lină. */
    private fun blur(src: Bitmap): Bitmap {
        val sw = maxOf(8, src.width / 12)
        val sh = maxOf(8, src.height / 12)
        val small = Bitmap.createScaledBitmap(src, sw, sh, true)
        val px = IntArray(sw * sh)
        small.getPixels(px, 0, sw, 0, 0, sw, sh)
        repeat(2) { boxBlur(px, sw, sh, 2) }
        small.setPixels(px, 0, sw, 0, 0, sw, sh)
        val out = Bitmap.createScaledBitmap(small, src.width, src.height, true)
        small.recycle()
        return out
    }

    private fun boxBlur(px: IntArray, w: Int, h: Int, r: Int) {
        val tmp = IntArray(px.size)
        for (pass in 0..1) {
            val from = if (pass == 0) px else tmp
            val to = if (pass == 0) tmp else px
            for (y in 0 until h) for (x in 0 until w) {
                var a = 0; var rr = 0; var g = 0; var b = 0; var n = 0
                for (d in -r..r) {
                    val xx = if (pass == 0) (x + d).coerceIn(0, w - 1) else x
                    val yy = if (pass == 0) y else (y + d).coerceIn(0, h - 1)
                    val p = from[yy * w + xx]
                    a += (p ushr 24); rr += (p shr 16) and 0xFF; g += (p shr 8) and 0xFF; b += p and 0xFF; n++
                }
                to[y * w + x] = ((a / n) shl 24) or ((rr / n) shl 16) or ((g / n) shl 8) or (b / n)
            }
        }
    }

    fun close() = synchronized(this) {
        try { segmenter.close() } catch (_: Throwable) { }
    }

    companion object {
        /** Salvează ca poză NOUĂ în Pictures/Lumin; originalul rămâne neatins. */
        fun saveImage(context: Context, bmp: Bitmap): Uri? = try {
            val name = "Lumin_${System.currentTimeMillis()}.jpg"
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Lumin")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.JPEG, 94, it) }
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                uri
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Lumin").apply { mkdirs() }
                val target = File(dir, name)
                target.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 94, it) }
                MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf("image/jpeg"), null)
                Uri.fromFile(target)
            }
        } catch (_: Throwable) {
            null
        }
    }
}
