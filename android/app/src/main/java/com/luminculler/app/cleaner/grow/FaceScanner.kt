package com.luminculler.app.cleaner.grow

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imageembedder.ImageEmbedder
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.luminculler.app.cleaner.core.Align
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.core.Grow
import com.luminculler.app.cleaner.core.Media
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import kotlin.math.abs

/**
 * Caută fețele din galerie, pentru „Cum a crescut”.
 *
 * Pentru fiecare poză: detecție ML Kit (cu ochii), doar fețe destul de mari și
 * aproape frontale; fiecare față e aliniată după ochi într-un pătrat de 224 px
 * și trecută prin MobileNet (ImageEmbedder), care dă vectorul de comparat.
 * Rezultatul stă pe disc, deci a doua oară scanarea e instantanee, iar
 * decupajul feței se salvează mic, pentru grila de alegere.
 *
 * Limita, spusă pe față: MobileNet nu e un model de recunoaștere facială, ci
 * unul general. Pe fețe aliniate deosebește destul de bine oamenii, dar nu
 * perfect, de aceea omul confirmă pozele înainte de video.
 */
class FaceScanner(private val context: Context) {
    private val cacheFile = File(context.filesDir, "lumin-faces.bin")
    val cropDir = File(context.cacheDir, "faces").apply { mkdirs() }
    private val scanned = HashSet<Long>()
    private val faces = ArrayList<FaceHit>()
    private var loaded = false
    private val embedLock = Mutex()

    private val detector: FaceDetector by lazy {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                .setMinFaceSize(0.12f)
                .build()
        )
    }

    private val embedder: ImageEmbedder by lazy {
        ImageEmbedder.createFromOptions(
            context,
            ImageEmbedder.ImageEmbedderOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("mobilenet_v3_small.tflite").build())
                .setRunningMode(RunningMode.IMAGE)
                .build()
        )
    }

    fun snapshot(): List<FaceHit> = synchronized(faces) { ArrayList(faces) }

    fun cropFile(face: FaceHit, index: Int): File = File(cropDir, "${face.mediaId}_$index.jpg")

    /** Indicele feței în poza ei (pentru numele decupajului). */
    fun indexInPhoto(face: FaceHit): Int = synchronized(faces) {
        faces.filter { it.mediaId == face.mediaId }.indexOf(face).coerceAtLeast(0)
    }

    suspend fun scan(photos: List<Media>, onProgress: (done: Int, total: Int) -> Unit) = withContext(Dispatchers.IO) {
        load()
        val todo = photos.filter { it.id !in scanned }.sortedByDescending { it.taken }
        val total = todo.size
        var done = 0
        for (batch in todo.chunked(24)) {
            ensureActive()
            val found = coroutineScope {
                batch.map { m -> async { m to detect(m) } }.awaitAll()
            }
            synchronized(faces) {
                for ((m, hits) in found) {
                    scanned.add(m.id)
                    faces.addAll(hits)
                }
            }
            done += batch.size
            if (done % 240 == 0 || done == total) save()
            onProgress(done, total)
        }
        save()
    }

    private suspend fun detect(m: Media): List<FaceHit> {
        val uri = Uri.parse(m.uri)
        val bitmap = decodeOriented(context, uri, 640) ?: return emptyList()
        try {
            val result = try {
                Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)))
            } catch (_: Throwable) {
                return emptyList()
            }
            val out = ArrayList<FaceHit>()
            for ((i, f) in result.withIndex()) {
                if (abs(f.headEulerAngleY) > 22f || abs(f.headEulerAngleZ) > 28f) continue
                val l = f.getLandmark(FaceLandmark.LEFT_EYE)?.position ?: continue
                val r = f.getLandmark(FaceLandmark.RIGHT_EYE)?.position ?: continue
                val (a, b) = if (l.x <= r.x) l to r else r to l
                val crop = alignedCrop(bitmap, a.x, a.y, b.x, b.y, 224)
                val vector = embedLock.withLock {
                    try {
                        embedder.embed(BitmapImageBuilder(crop).build()).embeddingResult().embeddings().first().floatEmbedding()
                    } catch (_: Throwable) {
                        null
                    }
                }
                if (vector == null) {
                    crop.recycle()
                    continue
                }
                val hit = FaceHit(
                    mediaId = m.id,
                    taken = m.taken,
                    ax = a.x / bitmap.width, ay = a.y / bitmap.height,
                    bx = b.x / bitmap.width, by = b.y / bitmap.height,
                    width = f.boundingBox.width().toFloat() / bitmap.width,
                    yaw = f.headEulerAngleY,
                    embedding = Grow.normalize(vector)
                )
                val small = Bitmap.createScaledBitmap(crop, 160, 160, true)
                File(cropDir, "${m.id}_${out.size}.jpg").outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, 82, it) }
                if (small !== crop) small.recycle()
                crop.recycle()
                out.add(hit)
                if (i > 6) break
            }
            return out
        } finally {
            bitmap.recycle()
        }
    }

    private fun alignedCrop(src: Bitmap, ax: Float, ay: Float, bx: Float, by: Float, size: Int): Bitmap {
        val s = size.toFloat()
        val m = Align.matrix(ax, ay, bx, by, s * 0.34f, s * 0.40f, s * 0.66f, s * 0.40f)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(src, Matrix().apply { setValues(m) }, Paint(Paint.FILTER_BITMAP_FLAG))
        return out
    }

    private fun load() {
        if (loaded) return
        loaded = true
        if (!cacheFile.exists()) return
        try {
            DataInputStream(cacheFile.inputStream().buffered()).use { input ->
                if (input.readInt() != VERSION) return
                repeat(input.readInt()) { scanned.add(input.readLong()) }
                repeat(input.readInt()) {
                    val id = input.readLong()
                    val taken = input.readLong()
                    val ax = input.readFloat(); val ay = input.readFloat()
                    val bx = input.readFloat(); val by = input.readFloat()
                    val w = input.readFloat(); val yaw = input.readFloat()
                    val n = input.readInt()
                    val v = FloatArray(n) { input.readFloat() }
                    faces.add(FaceHit(id, taken, ax, ay, bx, by, w, yaw, v))
                }
            }
        } catch (_: Throwable) {
            scanned.clear()
            faces.clear()
        }
    }

    private fun save() {
        val tmp = File(cacheFile.parentFile, cacheFile.name + ".tmp")
        try {
            val (ids, list) = synchronized(faces) { HashSet(scanned) to ArrayList(faces) }
            DataOutputStream(tmp.outputStream().buffered()).use { out ->
                out.writeInt(VERSION)
                out.writeInt(ids.size)
                ids.forEach { out.writeLong(it) }
                out.writeInt(list.size)
                for (f in list) {
                    out.writeLong(f.mediaId); out.writeLong(f.taken)
                    out.writeFloat(f.ax); out.writeFloat(f.ay); out.writeFloat(f.bx); out.writeFloat(f.by)
                    out.writeFloat(f.width); out.writeFloat(f.yaw)
                    out.writeInt(f.embedding.size)
                    f.embedding.forEach { out.writeFloat(it) }
                }
            }
            tmp.renameTo(cacheFile)
        } catch (_: Throwable) {
            tmp.delete()
        }
    }

    fun close() {
        try { detector.close() } catch (_: Throwable) { }
        try { embedder.close() } catch (_: Throwable) { }
    }

    companion object {
        private const val VERSION = 1
    }
}
