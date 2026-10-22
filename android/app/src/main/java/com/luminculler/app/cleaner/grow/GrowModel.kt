package com.luminculler.app.cleaner.grow

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.luminculler.app.R
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.core.Grouping
import com.luminculler.app.cleaner.core.Grow
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.People
import com.luminculler.app.cleaner.core.Person
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

enum class GrowStep { Pick, Review, Rendering, Done }

/**
 * „Cum a crescut”: alegi o față, aplicația îi găsește pozele în timp, tu
 * confirmi, iar ea montează un video aliniat după ochi.
 */
class GrowModel(private val context: Context, private val scope: CoroutineScope) {
    private val scanner = FaceScanner(context)
    private val renderer = Renderer(context)

    var step by mutableStateOf(GrowStep.Pick)
    var faces by mutableStateOf<List<FaceHit>>(emptyList())
    var scanDone by mutableStateOf(0)
    var scanTotal by mutableStateOf(0)
    var scanning by mutableStateOf(false)
    var seed by mutableStateOf<FaceHit?>(null)
    var accepted by mutableStateOf<List<FaceHit>>(emptyList())
    var maybe by mutableStateOf<List<FaceHit>>(emptyList())
    var selected by mutableStateOf<Set<FaceHit>>(emptySet())
    /** Ce a scos omul de mână: o nouă căutare nu le mai bifează la loc. */
    private var excluded: Set<FaceHit> = emptySet()
    var title by mutableStateOf("")
    var progress by mutableFloatStateOf(0f)
    var video by mutableStateOf<File?>(null)
    var message by mutableStateOf<String?>(null)

    private var media: Map<Long, Media> = emptyMap()
    private var scanJob: Job? = null
    private var renderJob: Job? = null

    /** Oamenii din galerie, fiecare o singură dată, cei cu cele mai multe poze primii. */
    var people by mutableStateOf<List<Person>>(emptyList())
    private var clusterJob: Job? = null

    private fun recluster() {
        if (clusterJob?.isActive == true) return
        val all = faces
        clusterJob = scope.launch {
            people = withContext(Dispatchers.Default) { People.cluster(all).take(60) }
            onPeople?.invoke()
        }
    }

    /** Anunțat când se schimbă lista de oameni (pentru momentele „cu o persoană”). */
    var onPeople: (() -> Unit)? = null

    /** Fața cea mai mare din fiecare poză, ca filmele să țină subiectul în cadru. */
    fun facesByMedia(): Map<Long, FaceHit> =
        faces.groupBy { it.mediaId }.mapValues { (_, list) -> list.maxBy { it.width } }

    fun crop(face: FaceHit): File = scanner.cropFile(face, scanner.indexInPhoto(face))

    fun open(photos: List<Media>) {
        step = if (video != null && step == GrowStep.Done) GrowStep.Done else GrowStep.Pick
        ensureScan(photos)
    }

    /**
     * Au apărut poze noi (de ex. aduse din Google Foto): repornim căutarea.
     * Pozele deja scanate sunt sărite, deci costă doar cât cele noi.
     */
    fun rescan(photos: List<Media>) {
        scanJob?.cancel()
        scanJob = null
        ensureScan(photos)
    }

    /** Pornește (o dată) căutarea fețelor în fundal; o folosesc și momentele cu oameni. */
    fun ensureScan(photos: List<Media>) {
        media = photos.associateBy { it.id }
        if (scanJob != null) return
        val candidates = photos.filter { !Grouping.isScreenshot(it) && !Grouping.isChat(it) }
        scanJob = scope.launch {
            scanning = true
            faces = withContext(Dispatchers.IO) { scanner.snapshot() }
            recluster()
            scanner.scan(candidates) { done, total ->
                scope.launch {
                    scanDone = done
                    scanTotal = total
                    if (done % 600 == 0 || done == total) {
                        faces = scanner.snapshot()
                        recluster()
                    }
                }
            }
            faces = scanner.snapshot()
            clusterJob?.join()
            recluster()
            scanning = false
            // Scanarea s-a terminat cât omul se uita la propuneri: le refacem pe toată galeria.
            val s = seed
            if (s != null && step == GrowStep.Review) refresh(s)
        }
    }

    fun choose(person: Person) = choose(person.cover)

    fun choose(face: FaceHit) {
        seed = face
        excluded = emptySet()
        selected = emptySet()
        step = GrowStep.Review
        refresh(face)
    }

    private fun refresh(face: FaceHit) {
        scope.launch {
            val all = faces
            val c = withContext(Dispatchers.Default) { Grow.candidates(face, all) }
            if (seed !== face) return@launch
            val manual = selected.filter { it in c.maybe }
            accepted = c.accepted
            maybe = c.maybe
            selected = c.accepted.filter { it !in excluded }.toSet() + manual
        }
    }

    fun toggle(face: FaceHit) {
        if (face in selected) {
            selected = selected - face
            excluded = excluded + face
        } else {
            selected = selected + face
            excluded = excluded - face
        }
    }

    fun render(watermark: Boolean) {
        val chosen = (accepted + maybe).filter { it in selected }
        if (chosen.size < 3) {
            message = context.getString(R.string.lumin_grow_need_more)
            return
        }
        renderJob?.cancel()
        step = GrowStep.Rendering
        progress = 0f
        renderJob = scope.launch {
            try {
                val frames = Grow.frames(chosen)
                val shots = frames.mapNotNull { f -> media[f.mediaId]?.let { Shot(it, f) } }
                video = renderer.render(shots, Renderer.Options(Template.Timelapse, Format.Story, title.trim(), watermark = watermark)) { p ->
                    scope.launch { progress = p }
                }
                step = GrowStep.Done
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                message = context.getString(R.string.lumin_grow_failed)
                step = GrowStep.Review
            }
        }
    }

    fun cancelRender() {
        renderJob?.cancel()
        step = GrowStep.Review
    }

    fun save() {
        val file = video ?: return
        scope.launch {
            val uri = withContext(Dispatchers.IO) { Renderer.saveToGallery(context, file) }
            message = context.getString(if (uri != null) R.string.lumin_grow_saved else R.string.lumin_grow_save_failed)
        }
    }

    fun restart() {
        seed = null
        accepted = emptyList()
        maybe = emptyList()
        selected = emptySet()
        video = null
        step = GrowStep.Pick
    }

    /** Înapoi în interiorul fluxului; false = ieși din „Cum a crescut”. */
    fun back(): Boolean = when (step) {
        GrowStep.Pick -> false
        GrowStep.Review -> { step = GrowStep.Pick; true }
        GrowStep.Rendering -> { cancelRender(); true }
        GrowStep.Done -> { step = GrowStep.Review; true }
    }

    fun close() {
        scanJob?.cancel()
        renderJob?.cancel()
        scanner.close()
    }
}
