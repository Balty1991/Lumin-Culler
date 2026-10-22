package com.luminculler.app.cleaner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.Route
import com.luminculler.app.cleaner.core.Moment
import com.luminculler.app.cleaner.core.MomentKind
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Titlul unui moment, în limba telefonului. */
@Composable
fun momentTitle(m: Moment): String = when (m.kind) {
    MomentKind.YearsAgo -> pluralStringResource(R.plurals.lumin_years_ago, m.yearsAgo, m.yearsAgo)
    MomentKind.Trip -> dateRange(m.start, m.end)
    MomentKind.Person -> stringResource(R.string.lumin_moment_together)
}

@Composable
fun momentSubtitle(m: Moment): String = when (m.kind) {
    MomentKind.YearsAgo -> formatDate(m.start)
    MomentKind.Trip -> pluralStringResource(R.plurals.lumin_grow_person_photos, m.total, m.total)
    MomentKind.Person -> pluralStringResource(R.plurals.lumin_grow_person_photos, m.total, m.total) + " · " + yearSpan(m.start, m.end)
}

fun formatDate(ms: Long): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault())
        .format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

fun dateRange(start: Long, end: Long): String {
    val zone = ZoneId.systemDefault()
    val a = Instant.ofEpochMilli(start).atZone(zone).toLocalDate()
    val b = Instant.ofEpochMilli(end).atZone(zone).toLocalDate()
    val loc = Locale.getDefault()
    val full = DateTimeFormatter.ofPattern("d MMMM yyyy", loc)
    return when {
        a == b -> full.format(a)
        a.month == b.month && a.year == b.year -> "${a.dayOfMonth}–${full.format(b)}"
        a.year == b.year -> "${DateTimeFormatter.ofPattern("d MMM", loc).format(a)} – ${DateTimeFormatter.ofPattern("d MMM yyyy", loc).format(b)}"
        else -> "${DateTimeFormatter.ofPattern("MMM yyyy", loc).format(a)} – ${DateTimeFormatter.ofPattern("MMM yyyy", loc).format(b)}"
    }
}

fun yearSpan(start: Long, end: Long): String {
    val zone = ZoneId.systemDefault()
    val a = Instant.ofEpochMilli(start).atZone(zone).year
    val b = Instant.ofEpochMilli(end).atZone(zone).year
    return if (a == b) "$a" else "$a–$b"
}

@Composable
fun MomentsScreen(model: LuminModel) {
    Backdrop {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 96.dp)
        ) {
            Spacer(Modifier.height(12.dp))
            Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Lumin", style = MaterialTheme.typography.headlineMedium, color = Lumin.Text)
                    Text(stringResource(R.string.lumin_moments_sub), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                }
            }
            Spacer(Modifier.height(20.dp))

            val moments = model.moments
            val hero = moments.firstOrNull()
            if (hero != null) {
                HeroMoment(hero) { model.openStory(hero) }
                Spacer(Modifier.height(24.dp))
            } else {
                EmptyMoments(model.loading || model.scan.running)
                Spacer(Modifier.height(24.dp))
            }

            if (moments.size > 1) {
                SectionTitle(stringResource(R.string.lumin_moments_title))
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(moments.drop(1)) { m -> MomentCard(m) { model.openStory(m) } }
                }
                Spacer(Modifier.height(28.dp))
            }

            SectionTitle(stringResource(R.string.lumin_people_title))
            val people = model.grow.people
            if (people.isEmpty()) {
                Text(
                    if (model.grow.scanning && model.grow.scanTotal > 0)
                        stringResource(R.string.lumin_grow_scanning, model.grow.scanDone, model.grow.scanTotal)
                    else stringResource(R.string.lumin_people_empty),
                    style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted,
                    modifier = Modifier.padding(horizontal = 20.dp)
                )
            } else {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    items(people.take(20)) { person ->
                        Column(
                            Modifier.width(76.dp).clickable {
                                val m = model.moments.firstOrNull { it.person === person }
                                if (m != null) model.openStory(m) else { model.grow.choose(person); model.route = Route.Grow }
                            },
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            AsyncImage(
                                model = model.grow.crop(person.cover),
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(72.dp).clip(CircleShape).border(2.dp, Lumin.Accent, CircleShape).background(Lumin.SurfaceHigh)
                            )
                            Spacer(Modifier.height(6.dp))
                            Text("${person.photos}", style = MaterialTheme.typography.labelMedium, color = Lumin.Muted)
                        }
                    }
                }
            }
            Spacer(Modifier.height(28.dp))

            Box(Modifier.padding(horizontal = 20.dp)) { GrowEntry { model.openGrow() } }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = Lumin.Text, modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp))
}

@Composable
private fun HeroMoment(m: Moment, onClick: () -> Unit) {
    Box(
        Modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .height(440.dp)
            .clip(RoundedCornerShape(28.dp))
            .clickable(onClick = onClick)
    ) {
        Thumb(m.cover, Modifier.fillMaxSize(), size = 1400)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xE0000000))))
        Column(Modifier.align(Alignment.BottomStart).padding(22.dp)) {
            Pill(stringResource(if (m.kind == MomentKind.YearsAgo) R.string.lumin_moment_today else R.string.lumin_moment_label), Color(0x33FFFFFF), Color.White)
            Spacer(Modifier.height(10.dp))
            Text(momentTitle(m), style = MaterialTheme.typography.displaySmall, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(momentSubtitle(m), style = MaterialTheme.typography.bodyLarge, color = Color(0xD9FFFFFF))
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.clip(CircleShape).background(Color.White).padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(LIcons.Play, null, tint = Color.Black, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.lumin_moment_play), color = Color.Black, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun MomentCard(m: Moment, onClick: () -> Unit) {
    Box(
        Modifier
            .width(168.dp)
            .height(240.dp)
            .clip(RoundedCornerShape(22.dp))
            .clickable(onClick = onClick)
    ) {
        Thumb(m.cover, Modifier.fillMaxSize(), size = 600)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color(0xD0000000))))
        Column(Modifier.align(Alignment.BottomStart).padding(14.dp)) {
            Text(momentTitle(m), style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(momentSubtitle(m), style = MaterialTheme.typography.labelMedium, color = Color(0xCCFFFFFF), maxLines = 1)
        }
    }
}

@Composable
private fun EmptyMoments(working: Boolean) {
    Card(Modifier.padding(horizontal = 20.dp).fillMaxWidth()) {
        Column(Modifier.padding(22.dp)) {
            Text(
                stringResource(if (working) R.string.lumin_moments_preparing else R.string.lumin_moments_empty),
                style = MaterialTheme.typography.titleMedium, color = Lumin.Text
            )
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.lumin_moments_empty_hint), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        }
    }
}
