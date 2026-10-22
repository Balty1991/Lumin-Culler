package com.luminculler.app.cleaner.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.DayPart
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Recap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.format.TextStyle
import java.util.Locale

/** Felii din poveste; cele fără date (de ex. fără oameni) se sar. */
private enum class Slide { Intro, Count, Month, Day, Part, Streak, People, Finale }

/**
 * „Anul tău în poze”: povești pe tot ecranul, ca la Instagram. Atingi în
 * dreapta pentru următoarea, în stânga pentru înapoi; fiecare se poate
 * trimite ca imagine.
 */
@Composable
fun RecapScreen(model: LuminModel) {
    val years = remember(model.photos) { model.recapYears() }
    var year by remember { mutableStateOf(years.firstOrNull()) }
    var recap by remember { mutableStateOf<Recap?>(null) }
    LaunchedEffect(year, model.grow.people) {
        val y = year ?: return@LaunchedEffect
        recap = withContext(Dispatchers.Default) { model.buildRecap(y) }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val r = recap
        if (r == null) {
            Backdrop {
                Column(Modifier.fillMaxSize().statusBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text(
                        stringResource(if (years.isEmpty()) R.string.lumin_recap_empty else R.string.lumin_moments_preparing),
                        style = MaterialTheme.typography.titleMedium, color = Lumin.Text, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        } else {
            Story(model, r, years, onYear = { year = it })
        }
        Row(Modifier.statusBarsPadding().padding(top = 18.dp, start = 8.dp)) {
            RoundIcon(LIcons.Close, stringResource(R.string.lumin_close), { model.back() }, background = Color(0x33000000), tint = Color.White)
        }
    }
}

@Composable
private fun Story(model: LuminModel, r: Recap, years: List<Int>, onYear: (Int) -> Unit) {
    val slides = remember(r) { Slide.entries.filter { it != Slide.People || r.people.isNotEmpty() } }
    var index by remember(r) { mutableIntStateOf(0) }
    val slide = slides[index]
    // Fiecare felie stă 7 secunde, apoi trece singură; o atingere o schimbă imediat.
    val timer = remember(r, index) { Animatable(0f) }
    LaunchedEffect(r, index) {
        timer.animateTo(1f, tween(7000, easing = LinearEasing))
        if (index < slides.lastIndex) index++
    }
    val layer = rememberGraphicsLayer()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    Box(
        Modifier.fillMaxSize().pointerInput(r, slides.size) {
            detectTapGestures { o ->
                if (o.x < size.width / 3f) { if (index > 0) index-- } else if (index < slides.lastIndex) index++
            }
        }
    ) {
        // Felia se desenează într-un strat ca să poată fi salvată ca imagine exact cum se vede.
        Box(
            Modifier.fillMaxSize().drawWithContent {
                layer.record { this@drawWithContent.drawContent() }
                drawLayer(layer)
            }
        ) {
            AnimatedContent(slide, transitionSpec = { fadeIn(tween(400)) togetherWith fadeOut(tween(300)) }, label = "slide") { s ->
                SlideView(model, r, s)
            }
        }

        // Benzile de progres de sus, ca la povești.
        Row(
            Modifier.statusBarsPadding().padding(start = 64.dp, end = 12.dp, top = 8.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            slides.indices.forEach { i ->
                val f = when { i < index -> 1f; i == index -> timer.value; else -> 0f }
                Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(Color(0x55FFFFFF))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(f).background(Color.White))
                }
            }
        }

        Row(
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (years.size > 1 && slide == Slide.Intro) {
                for (y in years.take(4)) {
                    Text(
                        "$y", color = if (y == r.year) Color.Black else Color.White,
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.clip(CircleShape).background(if (y == r.year) Color.White else Color(0x33FFFFFF))
                            .clickable { onYear(y) }.padding(horizontal = 14.dp, vertical = 8.dp)
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.clip(CircleShape).background(Color.White).clickable {
                    scope.launch {
                        val img = layer.toImageBitmap().asAndroidBitmap()
                        val activity = context as? Activity ?: return@launch
                        shareSlide(activity, img, r.year)
                    }
                }.padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                androidx.compose.material3.Icon(LIcons.Share, null, tint = Color.Black, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.lumin_share), color = Color.Black, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

private suspend fun shareSlide(activity: Activity, image: Bitmap, year: Int) {
    val file = File(activity.cacheDir, "lumin-recap.png")
    withContext(Dispatchers.IO) {
        // Stratul poate fi un bitmap „hardware”, care nu se poate comprima direct.
        val soft = image.copy(Bitmap.Config.ARGB_8888, false)
        file.outputStream().use { soft.compress(Bitmap.CompressFormat.PNG, 100, it) }
        soft.recycle()
    }
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, activity.getString(R.string.lumin_recap_share_text, year))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, null))
}

/** Fundal: o poză a anului, estompată și întunecată, cu culoarea feliei peste. */
@Composable
private fun Background(media: Media?, tint: Color) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (media != null) Thumb(media, Modifier.fillMaxSize().blur(28.dp), size = 500)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.78f), Color(0xEE0B0B11)))))
    }
}

@Composable
private fun SlideFrame(media: Media?, tint: Color, content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Background(media, tint)
        Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(start = 28.dp, end = 28.dp, top = 72.dp, bottom = 88.dp), content = content)
    }
}

@Composable
private fun Big(text: String, size: Int = 64, color: Color = Color.White) =
    Text(text, fontSize = size.sp, lineHeight = (size * 1.05).sp, fontWeight = FontWeight.Black, color = color)

@Composable
private fun Line(text: String) = Text(text, fontSize = 22.sp, lineHeight = 28.sp, color = Color(0xE6FFFFFF))

private fun monthName(m: Int): String =
    java.time.Month.of(m).getDisplayName(TextStyle.FULL_STANDALONE, Locale.getDefault()).replaceFirstChar { it.titlecase(Locale.getDefault()) }

@Composable
private fun SlideView(model: LuminModel, r: Recap, s: Slide) {
    val cover = r.highlights.getOrNull(r.highlights.size / 2) ?: r.busiestDayPhotos.firstOrNull()
    when (s) {
        Slide.Intro -> SlideFrame(cover, Color(0xFF6D28D9)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Text(stringResource(R.string.lumin_recap_kicker), fontSize = 20.sp, color = Lumin.Gold, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Big("${r.year}", 120)
                Big(stringResource(R.string.lumin_recap_intro), 44)
                Spacer(Modifier.height(16.dp))
                Line(stringResource(R.string.lumin_recap_intro_hint))
            }
        }
        Slide.Count -> SlideFrame(r.highlights.firstOrNull(), Color(0xFF0E7490)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Line(stringResource(R.string.lumin_recap_count_pre))
                Big("%,d".format(Locale.getDefault(), r.photos), 104, Lumin.Keep)
                Big(stringResource(R.string.lumin_recap_count_post), 40)
                Spacer(Modifier.height(18.dp))
                Line(stringResource(R.string.lumin_recap_count_days, r.days, r.videos))
                r.growth?.let { g ->
                    Spacer(Modifier.height(10.dp))
                    Line(stringResource(if (g >= 0) R.string.lumin_recap_growth_up else R.string.lumin_recap_growth_down, kotlin.math.abs(g), r.year - 1))
                }
            }
        }
        Slide.Month -> SlideFrame(r.highlights.getOrNull(1), Color(0xFFBE185D)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Line(stringResource(R.string.lumin_recap_month_pre))
                Big(monthName(r.busiestMonth), 72)
                Line(stringResource(R.string.lumin_recap_month_post, r.months[r.busiestMonth - 1]))
                Spacer(Modifier.height(28.dp))
                val max = r.months.max().coerceAtLeast(1)
                Row(Modifier.fillMaxWidth().height(140.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                    r.months.forEachIndexed { i, n ->
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier.fillMaxWidth().height((8 + 112f * n / max).dp).clip(RoundedCornerShape(6.dp))
                                    .background(if (i == r.busiestMonth - 1) Lumin.Gold else Color(0x66FFFFFF))
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(monthName(i + 1).take(1), fontSize = 12.sp, color = Color(0xB3FFFFFF))
                        }
                    }
                }
            }
        }
        Slide.Day -> SlideFrame(r.busiestDayPhotos.firstOrNull(), Color(0xFFB45309)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Line(stringResource(R.string.lumin_recap_day_pre))
                r.busiestDay?.let { Big(formatDate(it.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()), 46) }
                Line(stringResource(R.string.lumin_recap_day_post))
                Spacer(Modifier.height(20.dp))
                val pics = r.busiestDayPhotos.take(6)
                for (row in pics.chunked(3)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (m in row) Thumb(m, Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(12.dp)), size = 360)
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
        Slide.Part -> SlideFrame(cover, Color(0xFF1D4ED8)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Text(
                    when (r.dayPart) { DayPart.Morning -> "☀️"; DayPart.Afternoon -> "🌤️"; DayPart.Evening -> "🌆"; DayPart.Night -> "🌙" },
                    fontSize = 72.sp
                )
                Spacer(Modifier.height(8.dp))
                Line(stringResource(R.string.lumin_recap_part_pre))
                Big(
                    stringResource(
                        when (r.dayPart) {
                            DayPart.Morning -> R.string.lumin_recap_part_morning
                            DayPart.Afternoon -> R.string.lumin_recap_part_afternoon
                            DayPart.Evening -> R.string.lumin_recap_part_evening
                            DayPart.Night -> R.string.lumin_recap_part_night
                        }
                    ), 54
                )
                Spacer(Modifier.height(12.dp))
                Line(stringResource(R.string.lumin_recap_part_post, r.dayPartShare))
            }
        }
        Slide.Streak -> SlideFrame(r.highlights.lastOrNull(), Color(0xFF047857)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Line(stringResource(R.string.lumin_recap_streak_pre))
                Big("${r.longestStreak}", 120, Lumin.Gold)
                Big(stringResource(R.string.lumin_recap_streak_post), 40)
                Spacer(Modifier.height(18.dp))
                Line(
                    stringResource(
                        R.string.lumin_recap_weekday,
                        r.favoriteWeekday.getDisplayName(TextStyle.FULL_STANDALONE, Locale.getDefault())
                    )
                )
            }
        }
        Slide.People -> SlideFrame(cover, Color(0xFF9333EA)) {
            Column(Modifier.align(Alignment.CenterStart)) {
                Big(stringResource(R.string.lumin_recap_people), 54)
                Spacer(Modifier.height(24.dp))
                r.people.forEachIndexed { i, (p, n) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}", fontSize = 34.sp, fontWeight = FontWeight.Black, color = Lumin.Gold, modifier = Modifier.width(36.dp))
                        AsyncImage(
                            model = model.grow.crop(p.cover), contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(if (i == 0) 92.dp else 70.dp).clip(CircleShape).border(3.dp, if (i == 0) Lumin.Gold else Color.White, CircleShape)
                        )
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(model.personName(p) ?: "", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text(stringResource(R.string.lumin_recap_people_count, n), fontSize = 18.sp, color = Color(0xCCFFFFFF))
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
        Slide.Finale -> SlideFrame(cover, Color(0xFF6D28D9)) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                val pics = r.highlights.take(12)
                for (row in pics.chunked(4)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        for (m in row) Thumb(m, Modifier.weight(1f).aspectRatio(0.8f).clip(RoundedCornerShape(10.dp)), size = 300)
                        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(5.dp))
                }
                Spacer(Modifier.height(20.dp))
                Big(stringResource(R.string.lumin_recap_finale, r.year), 40)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.lumin_recap_footer), fontSize = 16.sp, color = Color(0xB3FFFFFF))
            }
        }
    }
}
