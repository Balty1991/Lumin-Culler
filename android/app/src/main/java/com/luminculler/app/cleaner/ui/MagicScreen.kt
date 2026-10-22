package com.luminculler.app.cleaner.ui

import android.content.Intent
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.AiCredits
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Style
import com.luminculler.app.cleaner.magic.AiStyle

private enum class Panel { None, Filters, AiStyles }

/**
 * „Magie AI” pe o poză. Sus poza (ții apăsat pentru original), jos două
 * rânduri: efectele gratuite de pe telefon și efectele „super” pe server,
 * cu creditele rămase.
 */
@Composable
fun MagicScreen(model: LuminModel, media: Media) {
    val magic = model.magic
    LaunchedEffect(media.id) { magic.open(media) }
    var comparing by remember { mutableStateOf(false) }
    var panel by remember { mutableStateOf(Panel.None) }
    var editing by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        var area by remember { mutableStateOf(IntSize.Zero) }
        val brush = with(LocalDensity.current) { 22.dp.toPx() }
        Box(Modifier.fillMaxSize().padding(bottom = 200.dp).onSizeChanged { area = it }) {
            val bmp = if (comparing) magic.before else magic.shown
            // Unde stă poza pe ecran (ContentScale.Fit): de aici trecem din pixeli de ecran în 0..1 ai pozei.
            val fit = bmp?.let { fitRect(area, it.width, it.height) }
            Box(
                Modifier.fillMaxSize().pointerInput(magic.erasing, fit) {
                    if (magic.erasing && fit != null) {
                        fun norm(o: Offset) = Offset(((o.x - fit.left) / fit.width).coerceIn(0f, 1f), ((o.y - fit.top) / fit.height).coerceIn(0f, 1f))
                        detectDragGestures(
                            onDragStart = { magic.beginStroke(norm(it), brush / fit.width) },
                            onDrag = { change, _ -> magic.extendStroke(norm(change.position)) }
                        )
                    } else {
                        detectTapGestures(onPress = { comparing = true; tryAwaitRelease(); comparing = false })
                    }
                }
            ) {
                if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                if (magic.erasing && fit != null) {
                    Canvas(Modifier.fillMaxSize()) {
                        for (st in magic.strokes) {
                            val pts = st.points.map { Offset(fit.left + it.x * fit.width, fit.top + it.y * fit.height) }
                            val path = Path().apply {
                                moveTo(pts[0].x, pts[0].y)
                                for (p in pts.drop(1)) lineTo(p.x, p.y)
                                if (pts.size == 1) lineTo(pts[0].x + 0.5f, pts[0].y)
                            }
                            drawPath(path, Color(0x99FF3B5C), style = Stroke(width = st.radius * 2 * fit.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
                        }
                    }
                }
            }
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (magic.working) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Lumin.Accent)
                    if (magic.waiting > 0) {
                        Spacer(Modifier.height(10.dp))
                        Text(stringResource(R.string.lumin_ai_waiting, magic.waiting), color = Color.White, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        // Bandă întunecată sub titlu: altfel textul alb se pierde pe pozele luminoase.
        Row(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color(0x00000000))))
                .statusBarsPadding().padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 28.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() }, background = Color(0x55000000), tint = Color.White)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.lumin_magic_title), style = MaterialTheme.typography.titleLarge, color = Color.White)
                Text(stringResource(R.string.lumin_magic_hold), style = MaterialTheme.typography.labelMedium, color = Color(0xCCFFFFFF))
            }
            if (magic.aiJobId != null) {
                Text(
                    stringResource(R.string.lumin_ai_report), color = Color.White, style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.clip(CircleShape).background(Color(0x55000000)).clickable { magic.report() }.padding(horizontal = 14.dp, vertical = 8.dp)
                )
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Color(0xF0101018))
                .navigationBarsPadding()
                .padding(vertical = 12.dp)
        ) {
            if (magic.erasing) {
                ErasePanel(model)
            } else {
                when (panel) {
                    Panel.Filters -> ChipRow(
                        Style.entries.map { it to filterLabel(it) },
                        selected = magic.filter
                    ) { magic.pickFilter(it) }
                    Panel.AiStyles -> ChipRow(
                        AiStyle.entries.map { it to aiStyleLabel(it) },
                        selected = null
                    ) { magic.superStyle(it); panel = Panel.None }
                    Panel.None -> {}
                }

                SectionLabel(stringResource(R.string.lumin_magic_free))
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Effect(LIcons.Bolt, stringResource(R.string.lumin_magic_enhance), magic.enhance) { magic.toggleEnhance() }
                    Effect(LIcons.Blur, stringResource(R.string.lumin_magic_portrait), magic.portrait) { magic.togglePortrait() }
                    Effect(LIcons.Edit, stringResource(R.string.lumin_magic_filters), magic.filter != null || panel == Panel.Filters) {
                        panel = if (panel == Panel.Filters) Panel.None else Panel.Filters
                    }
                    Effect(LIcons.Layers, stringResource(R.string.lumin_magic_3d), false) { magic.make3d() }
                }

                val live = magic.ai.enabled
                val erases = magic.remaining(AiCredits.Kind.Erase)
                SectionLabel(
                    stringResource(R.string.lumin_magic_super) + "  ·  " +
                        if (live) stringResource(R.string.lumin_ai_credits, magic.remaining(AiCredits.Kind.Style), magic.remaining(AiCredits.Kind.Alive))
                        else if (erases == AiCredits.UNLIMITED) stringResource(R.string.lumin_erase_unlimited)
                        else stringResource(R.string.lumin_erase_left, erases),
                    gold = true
                )
                // Fără server, atingerea explică de ce nu merg încă, în loc să deschidă panouri sau dialoguri.
                val notYet = { magic.message = context.getString(R.string.lumin_magic_server) }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Effect(LIcons.Wand, stringResource(R.string.lumin_magic_erase), false, premium = true) { panel = Panel.None; magic.startErase() }
                    Effect(LIcons.Sparkle, stringResource(R.string.lumin_magic_styles), panel == Panel.AiStyles, premium = true, dim = !live) {
                        if (live) { panel = if (panel == Panel.AiStyles) Panel.None else Panel.AiStyles } else { notYet() }
                    }
                    Effect(LIcons.Star, stringResource(R.string.lumin_magic_restore), false, premium = true, dim = !live) { magic.restore() }
                    Effect(LIcons.Edit, stringResource(R.string.lumin_magic_edit), false, premium = true, dim = !live) { if (live) { editing = true } else { notYet() } }
                    Effect(LIcons.Play, stringResource(R.string.lumin_magic_alive), false, premium = true, dim = !live) { magic.alive() }
                }
                Spacer(Modifier.height(12.dp))
                Box(Modifier.padding(horizontal = 16.dp)) {
                    BigButton(stringResource(R.string.lumin_magic_save), { magic.save() }, enabled = magic.canSave)
                }
            }
        }

        val video = magic.video
        if (video != null) {
            Column(Modifier.fillMaxSize().background(Color(0xF2000000)).statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundIcon(LIcons.Close, stringResource(R.string.lumin_close), { magic.closeVideo() }, background = Color(0x33FFFFFF), tint = Color.White)
                    Spacer(Modifier.weight(1f))
                    if (magic.aiJobId != null) {
                        Text(stringResource(R.string.lumin_ai_report), color = Color.White, modifier = Modifier.clickable { magic.report() }.padding(8.dp))
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    // Cheia pe fișier: un clip nou (3D sau AI) recreează playerul, altfel rulează neîntrerupt.
                    androidx.compose.runtime.key(video.absolutePath + video.lastModified()) { AndroidView(
                        factory = { ctx -> VideoView(ctx).apply { setVideoPath(video.absolutePath); setOnPreparedListener { it.isLooping = true; start() } } },
                        modifier = Modifier.fillMaxWidth().aspectRatio(9f / 16f).clip(RoundedCornerShape(20.dp))
                    ) }
                }
                Spacer(Modifier.height(12.dp))
                BigButton(stringResource(R.string.lumin_share), {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", video)
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "video/mp4"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, null))
                }, icon = LIcons.Share)
                Spacer(Modifier.height(8.dp))
                GhostButton(stringResource(R.string.lumin_grow_save), { magic.saveVideo() })
            }
        }

        if (editing) {
            EditDialog(onDismiss = { editing = false }) { text -> editing = false; magic.edit(text) }
        }
    }
}

/** Dreptunghiul în care ContentScale.Fit așază o poză [w]x[h] într-o zonă [area]. */
private fun fitRect(area: IntSize, w: Int, h: Int): Rect? {
    if (area.width == 0 || area.height == 0 || w == 0 || h == 0) return null
    val scale = minOf(area.width / w.toFloat(), area.height / h.toFloat())
    val dw = w * scale
    val dh = h * scale
    val left = (area.width - dw) / 2f
    val top = (area.height - dh) / 2f
    return Rect(left, top, left + dw, top + dh)
}

@Composable
private fun ErasePanel(model: LuminModel) {
    val magic = model.magic
    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(stringResource(R.string.lumin_magic_erase), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.lumin_erase_hint), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIcon(LIcons.Close, stringResource(R.string.lumin_grow_cancel), { magic.cancelErase() })
            RoundIcon(LIcons.Undo, stringResource(R.string.lumin_erase_undo), { magic.undoStroke() }, enabled = magic.strokes.isNotEmpty())
            Box(Modifier.weight(1f)) {
                BigButton(stringResource(R.string.lumin_erase_apply), { magic.applyErase() }, enabled = magic.strokes.isNotEmpty() && !magic.working, icon = LIcons.Wand)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String, gold: Boolean = false) {
    Text(
        text, style = MaterialTheme.typography.labelMedium,
        color = if (gold) Lumin.Gold else Lumin.Muted,
        modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 8.dp)
    )
}

@Composable
private fun <T> ChipRow(items: List<Pair<T, String>>, selected: T?, onPick: (T) -> Unit) {
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        for ((value, label) in items) {
            val on = value == selected
            Text(
                label,
                color = if (on) Color(0xFF06211E) else Lumin.Text,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clip(CircleShape)
                    .background(if (on) Lumin.Keep else Lumin.SurfaceHigh)
                    .clickable { onPick(value) }
                    .padding(horizontal = 16.dp, vertical = 10.dp)
            )
        }
    }
}

@Composable
private fun filterLabel(s: Style): String = stringResource(
    when (s) {
        Style.Sketch -> R.string.lumin_filter_sketch
        Style.Watercolor -> R.string.lumin_filter_watercolor
        Style.Cartoon -> R.string.lumin_filter_cartoon
        Style.Vintage -> R.string.lumin_filter_vintage
        Style.Noir -> R.string.lumin_filter_noir
        Style.Pop -> R.string.lumin_filter_pop
    }
)

@Composable
private fun aiStyleLabel(s: AiStyle): String = stringResource(
    when (s) {
        AiStyle.Cartoon3d -> R.string.lumin_ai_style_3d
        AiStyle.Anime -> R.string.lumin_ai_style_anime
        AiStyle.Oil -> R.string.lumin_ai_style_oil
        AiStyle.Watercolor -> R.string.lumin_filter_watercolor
        AiStyle.Sketch -> R.string.lumin_filter_sketch
        AiStyle.Vintage -> R.string.lumin_filter_vintage
    }
)

@Composable
private fun Effect(icon: ImageVector, label: String, on: Boolean, premium: Boolean = false, dim: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier
            .width(88.dp)
            .alpha(if (dim) 0.45f else 1f)
            .clip(RoundedCornerShape(18.dp))
            .background(if (on) Color(0x33A78BFA) else Lumin.Surface)
            .border(if (on) 2.dp else 1.dp, if (on) Lumin.Accent else if (premium) Color(0x66FFC857) else Lumin.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape)
                .background(if (premium) Lumin.PremiumGradient else if (on) Lumin.AccentGradient else Brush.linearGradient(listOf(Lumin.SurfaceHigh, Lumin.SurfaceHigh))),
            contentAlignment = Alignment.Center
        ) { Icon(icon, null, tint = if (premium) Color(0xFF2A1400) else Color.White, modifier = Modifier.size(19.dp)) }
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lumin.Text, maxLines = 2, textAlign = TextAlign.Center)
    }
}

@Composable
private fun EditDialog(onDismiss: () -> Unit, onApply: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Lumin.Surface,
        title = { Text(stringResource(R.string.lumin_magic_edit), color = Lumin.Text) },
        text = {
            Column {
                Text(stringResource(R.string.lumin_edit_hint), color = Lumin.Muted, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(value = text, onValueChange = { text = it.take(300) }, placeholder = { Text(stringResource(R.string.lumin_edit_example)) })
            }
        },
        confirmButton = { TextButton(onClick = { if (text.trim().length >= 3) onApply(text.trim()) }) { Text(stringResource(R.string.lumin_edit_apply), color = Lumin.Accent) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.lumin_grow_cancel), color = Lumin.Muted) } }
    )
}
