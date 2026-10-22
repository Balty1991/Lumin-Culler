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
    var progress by mutableFloatStateOf(0f)
    var video by mutableStateOf<File?>(null)
    var message by mutableStateOf<String?>(null)
    private var job: Job? = null
    private var momentId: String? = null

    fun prepare(moment: Moment, suggestedTitle: String) {
        if (momentId != moment.id) {
            momentId = moment.id
            title = suggestedTitle
            video = null
            step = MovieStep.Options
        }
    }

    fun render(moment: Moment, faces: Map<Long, FaceHit>, watermark: Boolean) {
        job?.cancel()
        step = MovieStep.Rendering
        progress = 0f
        job = scope.launch {
            try {
                val shots = moment.photos.map { Shot(it, faces[it.id]) }
                // La mozaic, mai multe poze arată mai bine (4 pe pagină).
                val opts = Renderer.Options(template, format, title.trim(), "", dates, watermark)
                video = renderer.render(shots, opts) { p -> scope.launch { progress = p } }
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
