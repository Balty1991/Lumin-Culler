package com.luminculler.app.cleaner.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.StackItem
import com.luminculler.app.cleaner.gestureHaptic
import com.luminculler.app.cleaner.reduceMotion
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs

@Composable
fun DeckScreen(model: LuminModel) {
    val stack = model.stack
    val current = stack.getOrNull(model.position)
    val next = stack.getOrNull(model.position + 1)
    val context = LocalContext.current
    val reduce = remember { reduceMotion(context) }
    val scope = rememberCoroutineScope()
    val offsetX = remember { Animatable(0f) }
    val offsetY = remember { Animatable(0f) }
    var fit by remember { mutableStateOf(false) }

    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Close, stringResource(R.string.lumin_close), { model.back() })
                Column(Modifier.weight(1f).padding(horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${(model.position + 1).coerceAtMost(stack.size)} / ${stack.size}", style = MaterialTheme.typography.labelLarge, color = Lumin.Text)
                    Spacer(Modifier.height(6.dp))
                    LinearProgressIndicator(
                        progress = { if (stack.isEmpty()) 0f else model.position.toFloat() / stack.size },
                        modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape),
                        color = Lumin.Keep,
                        trackColor = Lumin.SurfaceHigh
                    )
                }
                RoundIcon(LIcons.Undo, stringResource(R.string.lumin_undo), {
                    gestureHaptic(context, "undo")
                    model.undo()
                }, enabled = model.position > 0)
            }
            Spacer(Modifier.height(16.dp))

            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val widthPx = with(LocalDensity.current) { maxWidth.toPx() }
                val threshold = widthPx * 0.28f

                fun commit(keep: Boolean) {
                    scope.launch {
                        gestureHaptic(context, if (keep) "keep" else "delete")
                        if (!reduce) {
                            launch { offsetY.animateTo(offsetY.value + 60f, tween(180)) }
                            offsetX.animateTo(if (keep) widthPx * 1.4f else -widthPx * 1.4f, tween(200))
                        }
                        model.swipe(keep)
                        fit = false
                        offsetX.snapTo(0f)
                        offsetY.snapTo(0f)
                    }
                }

                if (next != null) {
                    key(next.media.id) {
                        val progress = (abs(offsetX.value) / threshold).coerceIn(0f, 1f)
                        PhotoCard(next, false, Modifier.fillMaxSize().graphicsLayer {
                            val s = 0.94f + 0.06f * progress
                            scaleX = s
                            scaleY = s
                            alpha = 0.6f + 0.4f * progress
                        })
                    }
                }
                if (current != null) {
                    key(current.media.id) {
                        val tracker = remember { VelocityTracker() }
                        PhotoCard(
                            current, fit,
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = offsetX.value
                                    translationY = offsetY.value
                                    rotationZ = offsetX.value / widthPx * 14f
                                }
                                .pointerInput(current.media.id) {
                                    detectDragGestures(
                                        onDragStart = { tracker.resetTracking() },
                                        onDragEnd = {
                                            val vx = tracker.calculateVelocity().x
                                            val x = offsetX.value
                                            when {
                                                x > threshold || vx > 1800f -> commit(true)
                                                x < -threshold || vx < -1800f -> commit(false)
                                                else -> scope.launch {
                                                    launch { offsetY.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
                                                    offsetX.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
                                                }
                                            }
                                        },
                                        onDrag = { change, drag ->
                                            change.consume()
                                            tracker.addPosition(change.uptimeMillis, change.position)
                                            scope.launch {
                                                offsetX.snapTo(offsetX.value + drag.x)
                                                offsetY.snapTo(offsetY.value + drag.y * 0.4f)
                                            }
                                        }
                                    )
                                }
                                .clickable { fit = !fit }
                        )
                        val p = (offsetX.value / threshold).coerceIn(-1f, 1f)
                        if (p > 0.05f) Stamp(stringResource(R.string.lumin_keep), Lumin.Keep, p, Modifier.align(Alignment.TopStart).padding(24.dp))
                        if (p < -0.05f) Stamp(stringResource(R.string.lumin_delete), Lumin.Delete, -p, Modifier.align(Alignment.TopEnd).padding(24.dp))
                    }
                }
            }

            Spacer(Modifier.height(18.dp))
            val markedBytes = model.marked.sumOf { it.bytes }
            Text(
                if (model.marked.isEmpty()) stringResource(R.string.lumin_deck_hint)
                else pluralStringResource(R.plurals.lumin_marked, model.marked.size, model.marked.size, bytes(markedBytes)),
                style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Delete, stringResource(R.string.lumin_delete), {
                    if (current != null) scope.launch {
                        gestureHaptic(context, "delete")
                        if (!reduce) offsetX.animateTo(-widthPxFallback(context), tween(200))
                        model.swipe(false)
                        fit = false
                        offsetX.snapTo(0f)
                    }
                }, size = 72.dp, tint = Lumin.Delete, background = Color(0x26FF6B6B), enabled = current != null)
                if (model.marked.isNotEmpty()) {
                    Text(
                        stringResource(R.string.lumin_finish),
                        style = MaterialTheme.typography.labelLarge, color = Lumin.Text,
                        modifier = Modifier.clip(CircleShape).background(Lumin.SurfaceHigh).clickable { model.finishStack() }.padding(horizontal = 18.dp, vertical = 12.dp)
                    )
                }
                RoundIcon(LIcons.Check, stringResource(R.string.lumin_keep), {
                    if (current != null) scope.launch {
                        gestureHaptic(context, "keep")
                        if (!reduce) offsetX.animateTo(widthPxFallback(context), tween(200))
                        model.swipe(true)
                        fit = false
                        offsetX.snapTo(0f)
                    }
                }, size = 72.dp, tint = Lumin.Keep, background = Color(0x265EE6B0), enabled = current != null)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

private fun widthPxFallback(context: android.content.Context): Float =
    context.resources.displayMetrics.widthPixels * 1.4f

@Composable
private fun PhotoCard(item: StackItem, fit: Boolean, modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(28.dp)).background(Lumin.Surface)) {
        Thumb(item.media, Modifier.fillMaxSize(), size = 1600, scale = if (fit) ContentScale.Fit else ContentScale.Crop)
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(140.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000))))
        )
        Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
            Pill(reasonLabel(item), Color(0x33FFFFFF), Color.White)
            Spacer(Modifier.height(8.dp))
            val date = if (item.media.taken > 0) DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(item.media.taken)) else ""
            Text(
                listOf(date, bytes(item.media.bytes)).filter { it.isNotEmpty() }.joinToString(" · "),
                color = Color.White, style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun Stamp(text: String, color: Color, strength: Float, modifier: Modifier) {
    Text(
        text.uppercase(),
        color = color,
        fontSize = 26.sp,
        fontWeight = FontWeight.Black,
        modifier = modifier
            .graphicsLayer { alpha = strength; rotationZ = if (color == Lumin.Keep) -12f else 12f }
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0x99000000))
            .padding(horizontal = 14.dp, vertical = 6.dp)
    )
}
