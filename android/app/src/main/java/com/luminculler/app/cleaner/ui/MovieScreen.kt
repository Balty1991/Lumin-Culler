package com.luminculler.app.cleaner.ui

import android.content.Intent
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Moment
import com.luminculler.app.cleaner.grow.Format
import com.luminculler.app.cleaner.grow.MovieStep
import com.luminculler.app.cleaner.grow.Template

@Composable
fun MovieScreen(model: LuminModel, moment: Moment) {
    val movie = model.movie
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_story_make_movie), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            when (movie.step) {
                MovieStep.Options -> MovieOptions(model, moment)
                MovieStep.Rendering -> Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    CircularProgressIndicator(progress = { movie.progress }, color = Lumin.Accent, trackColor = Lumin.SurfaceHigh, modifier = Modifier.size(96.dp), strokeWidth = 8.dp)
                    Spacer(Modifier.height(20.dp))
                    Text(stringResource(R.string.lumin_movie_rendering, (movie.progress * 100).toInt()), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
                    Spacer(Modifier.height(24.dp))
                    GhostButton(stringResource(R.string.lumin_grow_cancel), { movie.cancel() })
                }
                MovieStep.Done -> MovieDone(model, moment)
            }
        }
    }
}

@Composable
private fun MovieOptions(model: LuminModel, moment: Moment) {
    val movie = model.movie
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            moment.photos.take(4).forEach { p ->
                Thumb(p, Modifier.weight(1f).aspectRatio(0.75f).clip(RoundedCornerShape(14.dp)), size = 300)
            }
        }
        Spacer(Modifier.height(22.dp))

        Label(stringResource(R.string.lumin_movie_style))
        val templates = listOf(
            Template.Cinematic to R.string.lumin_tpl_cinematic,
            Template.Flash to R.string.lumin_tpl_flash,
            Template.Mosaic to R.string.lumin_tpl_mosaic
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((t, label) in templates) {
                OptionTile(stringResource(label), templateHint(t), movie.template == t, Modifier.weight(1f)) { movie.template = t }
            }
        }
        Spacer(Modifier.height(22.dp))

        Label(stringResource(R.string.lumin_movie_format))
        val formats = listOf(
            Format.Story to R.string.lumin_fmt_story,
            Format.Square to R.string.lumin_fmt_square,
            Format.Wide to R.string.lumin_fmt_wide
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((f, label) in formats) {
                FormatTile(f, stringResource(label), movie.format == f, Modifier.weight(1f)) { movie.format = f }
            }
        }
        Spacer(Modifier.height(22.dp))

        Label(stringResource(R.string.lumin_movie_text))
        OutlinedTextField(
            value = movie.title,
            onValueChange = { movie.title = it.take(32) },
            label = { Text(stringResource(R.string.lumin_movie_title)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lumin.Accent, unfocusedBorderColor = Lumin.Line)
        )
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.lumin_movie_dates), style = MaterialTheme.typography.bodyLarge, color = Lumin.Text, modifier = Modifier.weight(1f))
            Switch(checked = movie.dates, onCheckedChange = { movie.dates = it }, colors = SwitchDefaults.colors(checkedTrackColor = Lumin.Keep))
        }
        Spacer(Modifier.height(24.dp))
        if (!model.premium) {
            Text(stringResource(R.string.lumin_grow_watermark), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
            Spacer(Modifier.height(10.dp))
        }
        BigButton(stringResource(R.string.lumin_movie_make), {
            movie.render(moment, model.grow.facesByMedia(), watermark = !model.premium)
        }, icon = LIcons.Movie)
    }
}

@Composable
private fun templateHint(t: Template): String = stringResource(
    when (t) {
        Template.Cinematic -> R.string.lumin_tpl_cinematic_hint
        Template.Flash -> R.string.lumin_tpl_flash_hint
        Template.Mosaic -> R.string.lumin_tpl_mosaic_hint
        Template.Timelapse -> R.string.lumin_grow_entry
    }
)

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, color = Lumin.Text, modifier = Modifier.padding(bottom = 10.dp))
}

@Composable
private fun OptionTile(title: String, hint: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) Color(0x26A78BFA) else Lumin.Surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) Lumin.Accent else Lumin.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(12.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
        Spacer(Modifier.height(4.dp))
        Text(hint, style = MaterialTheme.typography.labelMedium, color = Lumin.Muted, maxLines = 3)
    }
}

@Composable
private fun FormatTile(f: Format, label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) Color(0x26A78BFA) else Lumin.Surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) Lumin.Accent else Lumin.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(Modifier.height(56.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .height(if (f.h >= f.w) 52.dp else 30.dp)
                    .aspectRatio(f.w.toFloat() / f.h)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (selected) Lumin.AccentGradient else Brush.linearGradient(listOf(Lumin.SurfaceHigh, Lumin.SurfaceHigh)))
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lumin.Text, textAlign = TextAlign.Center)
    }
}

@Composable
private fun MovieDone(model: LuminModel, moment: Moment) {
    val movie = model.movie
    val file = movie.video ?: return
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            AndroidView(
                factory = { ctx ->
                    VideoView(ctx).apply {
                        setVideoPath(file.absolutePath)
                        setOnPreparedListener { it.isLooping = true; start() }
                    }
                },
                modifier = Modifier.aspectRatio(movie.format.w.toFloat() / movie.format.h).clip(RoundedCornerShape(20.dp))
            )
        }
        Spacer(Modifier.height(16.dp))
        BigButton(stringResource(R.string.lumin_share), {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "video/mp4"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(send, null))
        }, icon = LIcons.Share)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GhostButton(stringResource(R.string.lumin_grow_save), { movie.save() }, Modifier.weight(1f))
            GhostButton(stringResource(R.string.lumin_movie_other_style), { movie.back() }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        CaptionButton(model, moment.photos.take(3))
    }
}
