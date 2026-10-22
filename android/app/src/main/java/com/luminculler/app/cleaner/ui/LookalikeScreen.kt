package com.luminculler.app.cleaner.ui

import android.app.Activity
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.core.Person
import com.luminculler.app.cleaner.core.Resemblance
import com.luminculler.app.cleaner.shareLookalikeCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * „Pe cine seamănă?”: alegi copilul, apoi una sau două rude, și primești
 * procentele, cu perechea de poze în care seamănă cel mai mult.
 */
@Composable
fun LookalikeScreen(model: LuminModel) {
    var child by remember { mutableStateOf<Person?>(null) }
    var relatives by remember { mutableStateOf<List<Person>>(emptyList()) }
    var result by remember { mutableStateOf<Resemblance.Result?>(null) }
    var showing by remember { mutableStateOf(false) }
    val people = model.grow.people

    fun back() {
        when {
            showing -> { showing = false; result = null }
            child != null -> { child = null; relatives = emptyList() }
            else -> model.back()
        }
    }

    // Butonul „înapoi” al telefonului face un pas înapoi în ecran, nu iese direct.
    androidx.activity.compose.BackHandler(enabled = child != null) { back() }

    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_look_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            val c = child
            when {
                people.size < 2 -> Waiting(model)
                c == null -> PickPeople(
                    model, people, emptyList(),
                    title = stringResource(R.string.lumin_look_pick_child),
                    hint = stringResource(R.string.lumin_look_pick_child_hint)
                ) { child = it }
                !showing -> Column(Modifier.weight(1f)) {
                    Box(Modifier.weight(1f)) {
                        PickPeople(
                            model, people.filter { it !== c }, relatives,
                            title = stringResource(R.string.lumin_look_pick_parents, nameOf(model, c, null)),
                            hint = stringResource(R.string.lumin_look_pick_parents_hint)
                        ) { p ->
                            relatives = when {
                                p in relatives -> relatives - p
                                relatives.size >= 2 -> listOf(relatives[1], p)
                                else -> relatives + p
                            }
                        }
                    }
                    Box(Modifier.padding(16.dp)) {
                        BigButton(stringResource(R.string.lumin_look_go), { showing = true }, enabled = relatives.isNotEmpty(), icon = LIcons.Sparkle)
                    }
                }
                else -> {
                    LaunchedEffect(c, relatives) {
                        result = withContext(Dispatchers.Default) { Resemblance.compare(c.faces, relatives.map { it.faces }) }
                    }
                    val r = result
                    if (r == null) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lumin.Accent) }
                    } else {
                        ResultView(model, c, relatives, r)
                    }
                }
            }
        }
    }
}

@Composable
private fun nameOf(model: LuminModel, p: Person, index: Int?): String =
    model.personName(p) ?: when (index) {
        null -> stringResource(R.string.lumin_look_child)
        else -> stringResource(R.string.lumin_look_person_n, index + 1)
    }

@Composable
private fun Waiting(model: LuminModel) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        if (model.grow.scanning) CircularProgressIndicator(color = Lumin.Accent)
        Spacer(Modifier.height(16.dp))
        Text(
            if (model.grow.scanning && model.grow.scanTotal > 0) stringResource(R.string.lumin_grow_scanning, model.grow.scanDone, model.grow.scanTotal)
            else stringResource(R.string.lumin_look_need_people),
            style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted, textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun PickPeople(
    model: LuminModel,
    people: List<Person>,
    picked: List<Person>,
    title: String,
    hint: String,
    onPick: (Person) -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Text(title, style = MaterialTheme.typography.headlineSmall, color = Lumin.Text, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(4.dp))
        Text(hint, style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(16.dp))
        LazyVerticalGrid(
            columns = GridCells.Adaptive(96.dp),
            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            items(people.take(60)) { p ->
                val on = p in picked
                Column(Modifier.clickable { onPick(p) }.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box {
                        FaceCircle(model, p.cover, 80.dp, if (on) Lumin.Keep else Lumin.Line, if (on) 3.dp else 1.dp)
                        if (on) {
                            Box(
                                Modifier.align(Alignment.BottomEnd).size(26.dp).clip(CircleShape).background(Lumin.Keep),
                                contentAlignment = Alignment.Center
                            ) { Icon(LIcons.Check, null, tint = Color(0xFF06211E), modifier = Modifier.size(16.dp)) }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        model.personName(p) ?: "${p.photos}",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (model.personName(p) != null) Lumin.Text else Lumin.Muted,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
private fun FaceCircle(model: LuminModel, face: FaceHit, size: Dp, ring: Color, ringWidth: Dp = 2.dp) {
    AsyncImage(
        model = model.grow.crop(face),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape).border(ringWidth, ring, CircleShape).background(Lumin.SurfaceHigh)
    )
}

@Composable
private fun ResultView(model: LuminModel, child: Person, relatives: List<Person>, r: Resemblance.Result) {
    val context = LocalContext.current
    val childName = nameOf(model, child, null)
    val names = relatives.mapIndexed { i, p -> nameOf(model, p, i) }
    // Procentele „urcă” de la zero: un mic moment de suspans înainte de verdict.
    val reveal = remember(r) { Animatable(0f) }
    LaunchedEffect(r) { reveal.animateTo(1f, tween(1600, easing = FastOutSlowInEasing)) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Text(
            stringResource(R.string.lumin_look_result, childName, names[r.winner]),
            style = MaterialTheme.typography.headlineSmall, color = Lumin.Text, fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(20.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            relatives.forEachIndexed { i, p ->
                if (i == 1) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        FaceCircle(model, child.cover, 104.dp, Lumin.Gold, 3.dp)
                        Spacer(Modifier.height(6.dp))
                        Text(childName, style = MaterialTheme.typography.labelLarge, color = Lumin.Text, maxLines = 1)
                    }
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(100.dp)) {
                    FaceCircle(model, p.cover, 76.dp, if (i == r.winner) Lumin.Keep else Lumin.Line, 2.dp)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "${(r.percents[i] * reveal.value).toInt()}%",
                        fontSize = 34.sp, fontWeight = FontWeight.Bold,
                        color = if (i == r.winner) Lumin.Keep else Lumin.Text
                    )
                    Text(names[i], style = MaterialTheme.typography.labelLarge, color = Lumin.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (relatives.size == 1) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        FaceCircle(model, child.cover, 104.dp, Lumin.Gold, 3.dp)
                        Spacer(Modifier.height(6.dp))
                        Text(childName, style = MaterialTheme.typography.labelLarge, color = Lumin.Text, maxLines = 1)
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        // Bara de împărțire: cât din fața copilului „vine” de la fiecare.
        if (relatives.size == 2) {
            Row(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(Lumin.SurfaceHigh)) {
                val a = (r.percents[0] / 100f * reveal.value).coerceAtLeast(0.001f)
                val b = (r.percents[1] / 100f * reveal.value).coerceAtLeast(0.001f)
                Box(Modifier.weight(a).fillMaxSize().background(if (r.winner == 0) Lumin.Keep else Lumin.Accent))
                Box(Modifier.weight(1f - a - b + 0.002f).fillMaxSize())
                Box(Modifier.weight(b).fillMaxSize().background(if (r.winner == 1) Lumin.Keep else Lumin.Accent))
            }
        }

        Spacer(Modifier.height(28.dp))
        Text(stringResource(R.string.lumin_look_best_title), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.lumin_look_best_hint), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        Spacer(Modifier.height(12.dp))
        r.best.forEachIndexed { i, m ->
            if (m != null) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lumin.Surface).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FaceTile(model, m.child, if (m.child.taken > 0) formatDate(m.child.taken) else childName)
                    Text("≈", fontSize = 28.sp, color = Lumin.Gold, modifier = Modifier.padding(horizontal = 10.dp))
                    FaceTile(model, m.relative, if (m.relative.taken > 0) names[i] + " · " + formatDate(m.relative.taken) else names[i])
                }
                Spacer(Modifier.height(10.dp))
            }
        }

        Spacer(Modifier.height(16.dp))
        BigButton(stringResource(R.string.lumin_look_share), {
            val activity = context as? Activity ?: return@BigButton
            shareLookalikeCard(
                activity,
                model.grow.crop(child.cover), childName,
                relatives.mapIndexed { i, p -> Triple(model.grow.crop(p.cover), names[i], r.percents[i]) },
                watermark = !model.premium
            )
        }, icon = LIcons.Share)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.lumin_look_disclaimer), style = MaterialTheme.typography.labelMedium, color = Lumin.Muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.FaceTile(model: LuminModel, face: FaceHit, caption: String) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        AsyncImage(
            model = model.grow.crop(face),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(14.dp)).background(Lumin.SurfaceHigh)
        )
        Spacer(Modifier.height(6.dp))
        Text(caption, style = MaterialTheme.typography.labelMedium, color = Lumin.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
