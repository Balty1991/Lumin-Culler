package com.luminculler.app.cleaner.grow

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.luminculler.app.R
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.core.Moment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

enum class MovieStep { Options, Rendering, Done }

/** Un film dintr-un moment: șablon, format, titlu, apoi montaj și distribuire. */
class MovieModel(private val context: Context, private val scope: CoroutineScope) {
    private val renderer = Renderer(context)

    var step by mutableStateOf(MovieStep.Options)
    var template by mutableStateOf(Template.Cinematic)
    var format by mutableStateOf(Format.Story)
    var title by mutableStateOf("")
    var dates by mutableStateOf(true)
    /** Muzica filmului; null = fără muzică. Se alege singură după amintire, omul o poate schimba. */
    /** „Povestea amintirii”: fraze scrise de AI, ca subtitrare. */
    var story by mutableStateOf(false)
    /** Cât timp AI-ul scrie povestea, înainte de montaj. */
    var writing by mutableStateOf(false)
    var mood by mutableStateOf<com.luminculler.app.cleaner.core.Mood?>(com.luminculler.app.cleaner.core.Mood.Calm)
    var progress by mutableFloatStateOf(0f)
    var video by mutableStateOf<File?>(null)
    var message by mutableStateOf<String?>(null)
    private var job: Job? = null
    private var momentId: String? = null

    fun prepare(moment: Moment, suggestedTitle: String) {
        if (momentId != moment.id) {
            momentId = moment.id
            title = suggestedTitle
            mood = com.luminculler.app.cleaner.core.Music.moodFor(moment.kind)
            video = null
            step = MovieStep.Options
        }
    }

    fun render(moment: Moment, faces: Map<Long, FaceHit>, watermark: Boolean, storyText: (suspend () -> List<String>)? = null) {
        job?.cancel()
        step = MovieStep.Rendering
        progress = 0f
        job = scope.launch {
            try {
                val shots = moment.photos.map { Shot(it, faces[it.id]) }
                // La mozaic, mai multe poze arată mai bine (4 pe pagină).
                // Povestea se cere înainte de montaj; dacă AI-ul nu răspunde, filmul se face fără ea.
                val lines = if (story && storyText != null) {
                    writing = true
                    try { storyText() } catch (e: Throwable) { if (e is kotlinx.coroutines.CancellationException) throw e; emptyList() } finally { writing = false }
                } else emptyList()
                val opts = Renderer.Options(template, format, title.trim(), "", dates, watermark, lines)
                val silent = renderer.render(shots, opts) { p -> scope.launch { progress = p * 0.92f } }
                val m = mood
                video = if (m == null) silent else Soundtrack.addMusic(silent, m, seed = moment.id.hashCode().toLong() + template.ordinal)
                progress = 1f
                step = MovieStep.Done
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                message = context.getString(R.string.lumin_grow_failed)
                step = MovieStep.Options
            }
        }
    }

    fun cancel() {
        job?.cancel()
        step = MovieStep.Options
    }

    fun save() {
        val file = video ?: return
        scope.launch {
            val uri = withContext(Dispatchers.IO) { Renderer.saveToGallery(context, file) }
            message = context.getString(if (uri != null) R.string.lumin_grow_saved else R.string.lumin_grow_save_failed)
        }
    }

    /** Înapoi în interiorul fluxului; false = ieși din film. */
    fun back(): Boolean = when (step) {
        MovieStep.Options -> false
        MovieStep.Rendering -> { cancel(); true }
        MovieStep.Done -> { step = MovieStep.Options; true }
    }
}
