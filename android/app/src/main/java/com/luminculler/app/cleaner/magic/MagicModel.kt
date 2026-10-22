package com.luminculler.app.cleaner.magic

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.luminculler.app.R
import com.luminculler.app.cleaner.Store
import com.luminculler.app.cleaner.core.AiCredits
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Style
import com.luminculler.app.cleaner.grow.Renderer
import com.luminculler.app.cleaner.grow.decodeOriented
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDate

/**
 * Starea ecranului „Magie AI” pentru o poză.
 *
 * Două feluri de efecte: gratuite, pe telefon (îmbunătățire, portret, filtre,
 * Foto 3D) și „super”, pe server (stiluri AI, restaurare, editare cu text,
 * prinde viață), cu credite. Un efect super înlocuiește poza de lucru, iar
 * cele gratuite se pot pune și peste el.
 */
class MagicModel(
    private val context: Context,
    private val scope: CoroutineScope,
    private val store: Store,
    private val isPremium: () -> Boolean,
    private val onNeedPremium: () -> Unit
) {
    private val magic = PhotoMagic(context)
    private val photo3d = Photo3D(context, magic)
    val ai = AiClient()
    private var media: Media? = null
    /** Poza peste care se aplică efectele gratuite: originalul, sau ultimul rezultat AI. */
    private var base: Bitmap? = null
    private var job: Job? = null

    var shown by mutableStateOf<Bitmap?>(null)
    var before by mutableStateOf<Bitmap?>(null)
    var enhance by mutableStateOf(false)
    var portrait by mutableStateOf(false)
    var filter by mutableStateOf<Style?>(null)
    var working by mutableStateOf(false)
    /** Câte secunde așteptăm serverul (0 = nu așteptăm). */
    var waiting by mutableIntStateOf(0)
    var progress by mutableStateOf(0f)
    var video by mutableStateOf<File?>(null)
    var aiJobId by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)

    fun open(m: Media) {
        if (media?.id == m.id && base != null) return
        media = m
        reset()
        working = true
        job?.cancel()
        job = scope.launch {
            val bmp = withContext(Dispatchers.IO) { decodeOriented(context, Uri.parse(m.uri), 2048)?.let(::toArgb) }
            base = bmp
            before = bmp
            shown = bmp
            working = false
        }
    }

    private fun reset() {
        enhance = false; portrait = false; filter = null
        shown = null; before = null; base = null; video = null; aiJobId = null
    }

    fun toggleEnhance() { enhance = !enhance; apply() }
    fun togglePortrait() { portrait = !portrait; apply() }
    fun pickFilter(style: Style?) { filter = if (filter == style) null else style; apply() }

    private fun apply() {
        val src = base ?: return
        job?.cancel()
        working = true
        val e = enhance; val p = portrait; val f = filter
        job = scope.launch {
            var noPerson = false
            val result = try {
                withContext(Dispatchers.Default) {
                    var cur = src
                    fun swap(next: Bitmap) { if (cur !== src) cur.recycle(); cur = next }
                    if (e) swap(magic.enhance(cur))
                    if (f != null) swap(magic.filter(cur, f))
                    if (p) {
                        val withBlur = magic.portrait(cur)
                        if (withBlur == null) noPerson = true else swap(withBlur)
                    }
                    cur
                }
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                // Un efect care nu reușește nu are voie să închidă aplicația.
                enhance = false; portrait = false; filter = null
                message = context.getString(R.string.lumin_magic_failed)
                src
            }
            if (noPerson) {
                portrait = false
                message = context.getString(R.string.lumin_magic_no_person)
            }
            shown = result
            working = false
        }
    }

    /** Foto 3D: gratuit, pe telefon. */
    fun make3d() {
        val src = shown ?: return
        job?.cancel()
        working = true
        progress = 0f
        job = scope.launch {
            val file = try { photo3d.render(src) { p -> scope.launch { progress = p } } } catch (_: Throwable) { null }
            working = false
            if (file == null) message = context.getString(R.string.lumin_magic_no_person) else video = file
        }
    }

    // ---- efectele „super”, pe server ----

    private fun month(): String = LocalDate.now().let { AiCredits.month(it.year, it.monthValue) }

    fun remaining(kind: AiCredits.Kind): Int =
        AiCredits.remaining(kind, isPremium(), store.aiUsed(kind, month()), store.aiAliveTrialUsed())

    fun superStyle(style: AiStyle) = runAi(AiJob.Style, style = style)
    fun restore() = runAi(AiJob.Restore)
    fun edit(prompt: String) = runAi(AiJob.Edit, prompt = prompt)
    fun alive() = runAi(AiJob.Alive)

    private fun runAi(kind: AiJob, style: AiStyle? = null, prompt: String? = null) {
        val src = shown ?: return
        if (!ai.enabled) {
            message = context.getString(R.string.lumin_magic_server)
            return
        }
        val credit = if (kind == AiJob.Alive) AiCredits.Kind.Alive else AiCredits.Kind.Style
        if (remaining(credit) <= 0) {
            onNeedPremium()
            return
        }
        job?.cancel()
        working = true
        waiting = 1
        job = scope.launch {
            try {
                val (id, url) = ai.run(kind, src, store.installId, style, prompt) { s -> scope.launch { waiting = s } }
                aiJobId = id
                store.countAi(credit, month(), isPremium())
                if (kind == AiJob.Alive) {
                    video = ai.download(url, File(context.cacheDir, "lumin-alive.mp4"))
                } else {
                    val file = ai.download(url, File(context.cacheDir, "lumin-ai.img"))
                    val bmp = withContext(Dispatchers.IO) { BitmapFactory.decodeFile(file.absolutePath) }
                        ?: throw AiException("decode")
                    // Rezultatul devine noua bază: filtrele gratuite se pot pune peste el.
                    base = bmp
                    enhance = false; portrait = false; filter = null
                    shown = bmp
                }
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                message = context.getString(
                    when ((e as? AiException)?.code) {
                        "daily_limit" -> R.string.lumin_ai_err_daily
                        "budget" -> R.string.lumin_ai_err_busy
                        else -> R.string.lumin_ai_err_generic
                    }
                )
            } finally {
                working = false
                waiting = 0
            }
        }
    }

    /** Raportare de conținut generat (cerință Google Play pentru aplicațiile cu AI generativ). */
    fun report() {
        val id = aiJobId ?: return
        scope.launch { ai.report(id, "user_report") }
        message = context.getString(R.string.lumin_ai_reported)
        val orig = before
        if (orig != null) { base = orig; shown = orig }
        video = null
        aiJobId = null
    }

    fun closeVideo() { video = null }

    fun save() {
        val bmp = shown ?: return
        scope.launch {
            val uri = withContext(Dispatchers.IO) { PhotoMagic.saveImage(context, bmp) }
            message = context.getString(if (uri != null) R.string.lumin_magic_saved else R.string.lumin_grow_save_failed)
        }
    }

    fun saveVideo() {
        val file = video ?: return
        scope.launch {
            val uri = withContext(Dispatchers.IO) { Renderer.saveToGallery(context, file) }
            message = context.getString(if (uri != null) R.string.lumin_grow_saved else R.string.lumin_grow_save_failed)
        }
    }

    /** Copie ARGB_8888 dacă poza vine în alt format (de ex. RGBA_F16 la pozele HDR). */
    private fun toArgb(b: Bitmap): Bitmap {
        if (b.config == Bitmap.Config.ARGB_8888) return b
        val c = b.copy(Bitmap.Config.ARGB_8888, false) ?: return b
        b.recycle()
        return c
    }

    val canSave: Boolean get() = !working && (enhance || portrait || filter != null || shown !== before)

    fun close() = magic.close()
}
