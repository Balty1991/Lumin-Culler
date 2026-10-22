package com.luminculler.app.cleaner.ui

import android.content.Intent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.GuessYear
import com.luminculler.app.cleaner.core.Media
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * „Ghicește anul”: 10 poze din galerie, fără dată. Muți bara pe anul pe
 * care-l crezi, apoi afli adevărul și punctele. Bun de jucat cu familia.
 */
@Composable
fun GuessScreen(model: LuminModel) {
    val zone = remember { ZoneId.systemDefault() }
    val pool = remember(model.photos) { model.gamePhotos() }
    val range = remember(pool) { GuessYear.range(pool, zone) }
    var game by remember { mutableIntStateOf(0) }
    val rounds = remember(pool, game) { GuessYear.pick(pool, zone) }
    var round by remember(game) { mutableIntStateOf(0) }
    var score by remember(game) { mutableIntStateOf(0) }
    var guess by remember(game, round) { mutableStateOf(((range.first + range.last) / 2f)) }
    var revealed by remember(game, round) { mutableStateOf(false) }
    var best by remember { mutableIntStateOf(model.store.guessBest) }

    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(12.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.lumin_guess_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
                    if (rounds.isNotEmpty() && round < rounds.size) {
                        Text(stringResource(R.string.lumin_guess_round, round + 1, rounds.size), style = MaterialTheme.typography.labelMedium, color = Lumin.Muted)
                    }
                }
                Text("$score", fontSize = 28.sp, fontWeight = FontWeight.Black, color = Lumin.Gold)
            }

            when {
                !GuessYear.playable(pool, zone) -> Text(
                    stringResource(R.string.lumin_guess_unplayable), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp)
                )
                round >= rounds.size -> Final(score, best, onAgain = { game++ }, onShare = { shareScore(model, score) })
                else -> {
                    val photo = rounds[round]
                    val actual = GuessYear.year(photo, zone)
                    val picked = guess.roundToInt()
                    Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(24.dp))) {
                        Thumb(photo, Modifier.fillMaxSize(), size = 1400, scale = ContentScale.Crop)
                        if (revealed) Reveal(photo, actual, GuessYear.points(picked, actual))
                    }
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(
                            "$picked", fontSize = 56.sp, fontWeight = FontWeight.Black,
                            color = if (revealed) (if (picked == actual) Lumin.Keep else Lumin.Text) else Lumin.Text,
                            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
                        )
                        Slider(
                            value = guess,
                            onValueChange = { if (!revealed) guess = it },
                            valueRange = range.first.toFloat()..range.last.toFloat().coerceAtLeast(range.first + 1f),
                            steps = (range.last - range.first - 1).coerceAtLeast(0),
                            colors = SliderDefaults.colors(thumbColor = Lumin.Gold, activeTrackColor = Lumin.Accent)
                        )
                        Row {
                            Text("${range.first}", color = Lumin.Muted, style = MaterialTheme.typography.labelMedium)
                            Spacer(Modifier.weight(1f))
                            Text("${range.last}", color = Lumin.Muted, style = MaterialTheme.typography.labelMedium)
                        }
                        Spacer(Modifier.height(10.dp))
                        if (!revealed) {
                            BigButton(stringResource(R.string.lumin_guess_go), {
                                revealed = true
                                score += GuessYear.points(picked, actual)
                            }, brush = Lumin.PremiumGradient, textColor = Color(0xFF2A1400))
                        } else {
                            BigButton(stringResource(if (round == rounds.lastIndex) R.string.lumin_guess_finish else R.string.lumin_guess_next), {
                                if (round == rounds.lastIndex && score > best) { best = score; model.store.guessBest = score }
                                round++
                            })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Reveal(photo: Media, actual: Int, points: Int) {
    val pop = remember(photo.id) { Animatable(0.4f) }
    LaunchedEffect(photo.id) { pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xE6000000)))) {
        Column(Modifier.align(Alignment.BottomCenter).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$actual", fontSize = 64.sp, fontWeight = FontWeight.Black, color = Color.White, modifier = Modifier.scale(pop.value))
            Text(formatDate(photo.taken), color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(
                    when (points) { 100 -> R.string.lumin_guess_exact; 0 -> R.string.lumin_guess_miss; else -> R.string.lumin_guess_close },
                    points
                ),
                color = if (points > 0) Lumin.Keep else Lumin.Delete, fontWeight = FontWeight.Bold, fontSize = 20.sp,
                modifier = Modifier.graphicsLayer { alpha = pop.value }
            )
        }
    }
}

@Composable
private fun Final(score: Int, best: Int, onAgain: () -> Unit, onShare: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(when (GuessYear.rank(score)) { 3 -> "🏆"; 2 -> "🥈"; 1 -> "🙂"; else -> "🙈" }, fontSize = 80.sp)
        Spacer(Modifier.height(12.dp))
        Text("$score / ${GuessYear.MAX_SCORE}", fontSize = 48.sp, fontWeight = FontWeight.Black, color = Lumin.Gold)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(
                when (GuessYear.rank(score)) {
                    3 -> R.string.lumin_guess_rank3
                    2 -> R.string.lumin_guess_rank2
                    1 -> R.string.lumin_guess_rank1
                    else -> R.string.lumin_guess_rank0
                }
            ),
            style = MaterialTheme.typography.titleMedium, color = Lumin.Text, textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.lumin_guess_best, maxOf(best, score)), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        Spacer(Modifier.height(28.dp))
        BigButton(stringResource(R.string.lumin_guess_again), onAgain, brush = Lumin.PremiumGradient, textColor = Color(0xFF2A1400))
        Spacer(Modifier.height(10.dp))
        GhostButton(stringResource(R.string.lumin_guess_challenge), onShare, icon = LIcons.Share)
    }
}

private fun shareScore(model: LuminModel, score: Int) {
    val ctx = model.context
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, ctx.getString(R.string.lumin_guess_share_text, score, GuessYear.MAX_SCORE))
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    ctx.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
