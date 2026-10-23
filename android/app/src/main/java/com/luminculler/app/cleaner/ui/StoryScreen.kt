package com.luminculler.app.cleaner.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.Route
import com.luminculler.app.cleaner.core.Moment
import com.luminculler.app.cleaner.core.MomentKind
import com.luminculler.app.cleaner.reduceMotion

/**
 * Povestea unui moment, pe tot ecranul, ca „Amintiri” din Google Foto: pozele
 * trec singure, cu o apropiere lentă; atingi dreapta pentru următoarea,
 * stânga pentru cea dinainte, ții apăsat ca să oprești.
 */
@Composable
fun StoryScreen(model: LuminModel, moment: Moment) {
    val photos = moment.photos
    var index by remember(moment.id) { mutableIntStateOf(0) }
    var paused by remember { mutableStateOf(false) }
    val progress = remember(moment.id, index) { Animatable(0f) }
    val context = LocalContext.current
    val reduce = remember { reduceMotion(context) }
    val ai = model.aiTitles[moment.id]
    val title = ai?.first ?: momentTitle(moment, model.personName(moment.person))
    LaunchedEffect(moment.id) { model.ensureAiTitle(moment) }
    // Muzica poveștii: compusă după felul amintirii, cât ține povestea; se oprește la ieșire.
    androidx.compose.runtime.DisposableEffect(moment.id, model.storyMusicOn) {
        if (model.storyMusicOn) {
            model.storyMusic.play(
                com.luminculler.app.cleaner.core.Music.moodFor(moment.kind),
                seconds = photos.size * SLIDE_MS / 1000f + 2f,
                seed = moment.id.hashCode().toLong()
            )
        }
        onDispose { model.storyMusic.stop() }
    }
    var naming by remember { mutableStateOf(false) }

    LaunchedEffect(moment.id, index, paused) {
        if (paused) return@LaunchedEffect
        val left = ((1f - progress.value) * SLIDE_MS).toInt().coerceAtLeast(1)
        progress.animateTo(1f, tween(left, easing = LinearEasing))
        if (index < photos.lastIndex) index++ else model.back()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(moment.id) {
                detectTapGestures(
                    onPress = {
                        paused = true
                        tryAwaitRelease()
                        paused = false
                    },
                    onTap = { pos ->
                        if (pos.x < size.width / 3f) {
                            if (index > 0) index--
                        } else {
                            if (index < photos.lastIndex) index++ else model.back()
                        }
                    }
                )
            }
    ) {
        Crossfade(targetState = index, label = "story") { i ->
            val p = photos.getOrNull(i) ?: return@Crossfade
            Thumb(
                p,
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val z = if (reduce) 1f else 1f + 0.08f * (if (i == index) progress.value else 1f)
                        scaleX = z
                        scaleY = z
                    },
                size = 1600
            )
        }
        // Următoarea poză se încarcă din timp, ca trecerea să nu aștepte.
        photos.getOrNull(index + 1)?.let { Thumb(it, Modifier.size(1.dp), size = 1600) }

        Box(Modifier.fillMaxWidth().height(200.dp).background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))))
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(320.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD9000000))))
        )

        Column(Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                photos.indices.forEach { i ->
                    val fill = when {
                        i < index -> 1f
                        i == index -> progress.value
                        else -> 0f
                    }
                    Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(Color(0x55FFFFFF))) {
                        Box(Modifier.fillMaxWidth(fill).height(3.dp).background(Color.White))
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleLarge, color = Color.White)
                    if (!ai?.second.isNullOrBlank()) {
                        Text(ai!!.second, style = MaterialTheme.typography.bodyMedium, color = Color(0xE6FFFFFF), fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
                    }
                    photos.getOrNull(index)?.let { if (it.taken > 0) Text(formatDate(it.taken), style = MaterialTheme.typography.bodyMedium, color = Color(0xCCFFFFFF)) }
                }
                RoundIcon(
                    if (model.storyMusicOn) LIcons.Volume else LIcons.VolumeOff,
                    stringResource(if (model.storyMusicOn) R.string.lumin_music_mute else R.string.lumin_music_unmute),
                    { model.toggleStoryMusic() }, background = Color(0x33FFFFFF), tint = Color.White
                )
                Spacer(Modifier.width(8.dp))
                if (moment.person != null) {
                    RoundIcon(LIcons.Edit, stringResource(R.string.lumin_name_person), { paused = true; naming = true }, background = Color(0x33FFFFFF), tint = Color.White)
                    Spacer(Modifier.width(8.dp))
                }
                RoundIcon(LIcons.Close, stringResource(R.string.lumin_close), { model.back() }, background = Color(0x33FFFFFF), tint = Color.White)
            }
        }

        Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(20.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
                StoryAction(LIcons.Movie, stringResource(R.string.lumin_story_make_movie), Modifier.weight(1f)) {
                    model.openMovie(moment, title)
                }
                StoryAction(LIcons.Sparkle, stringResource(R.string.lumin_magic_short), Modifier.weight(1f)) {
                    photos.getOrNull(index)?.let { model.openMagic(it) }
                }
                val person = moment.person
                if (moment.kind == MomentKind.Person && person != null) {
                    StoryAction(LIcons.Layers, stringResource(R.string.lumin_grow_title), Modifier.weight(1f)) {
                        model.grow.ensureScan(model.photos)
                        model.grow.choose(person)
                        model.route = Route.Grow
                    }
                }
            }
        }
        val person = moment.person
        if (naming && person != null) {
            NameDialog(model.personName(person) ?: "", onDismiss = { naming = false; paused = false }) { name ->
                model.setPersonName(person, name)
                naming = false
                paused = false
            }
        }
    }
}

@Composable
private fun StoryAction(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, modifier: Modifier, onClick: () -> Unit) {
    // Iconița deasupra textului și aceeași înălțime pentru toate: trei butoane încap
    // pe orice ecran fără ca vreun text să se rupă pe trei rânduri.
    Column(
        modifier.fillMaxHeight().clip(RoundedCornerShape(22.dp)).background(Color.White).clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(icon, null, tint = Color.Black, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(6.dp))
        Text(text, color = Color.Black, style = MaterialTheme.typography.labelLarge, textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 2)
    }
}

private const val SLIDE_MS = 4000

@Composable
fun NameDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Lumin.Surface,
        title = { Text(stringResource(R.string.lumin_name_person), color = Lumin.Text) },
        text = {
            androidx.compose.material3.OutlinedTextField(
                value = text,
                onValueChange = { text = it.take(24) },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.lumin_name_hint)) }
            )
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = { onSave(text) }) { Text(stringResource(R.string.lumin_name_save), color = Lumin.Accent) }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text(stringResource(R.string.lumin_grow_cancel), color = Lumin.Muted) }
        }
    )
}
