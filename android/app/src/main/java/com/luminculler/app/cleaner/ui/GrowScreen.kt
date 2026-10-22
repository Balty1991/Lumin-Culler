package com.luminculler.app.cleaner.ui

import android.content.Intent
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.FaceHit
import com.luminculler.app.cleaner.grow.GrowModel
import com.luminculler.app.cleaner.grow.GrowStep
import java.util.Calendar

@Composable
fun GrowScreen(model: LuminModel) {
    val grow = model.grow
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_grow_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            when (grow.step) {
                GrowStep.Pick -> PickStep(grow)
                GrowStep.Review -> ReviewStep(grow, model)
                GrowStep.Rendering -> RenderingStep(grow)
                GrowStep.Done -> DoneStep(grow, model)
            }
        }
    }
}

@Composable
private fun FaceTile(grow: GrowModel, face: FaceHit, selected: Boolean?, onClick: () -> Unit) {
    Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)) {
        AsyncImage(
            model = grow.crop(face),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().background(Lumin.SurfaceHigh)
        )
        if (selected == false) Box(Modifier.fillMaxSize().background(Color(0xA0000000)))
        if (face.taken > 0) {
            Text(
                Calendar.getInstance().apply { timeInMillis = face.taken }.get(Calendar.YEAR).toString(),
                color = Color.White, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.align(Alignment.BottomStart).padding(6.dp).clip(CircleShape).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
        if (selected != null) {
            Box(
                Modifier.align(Alignment.TopEnd).padding(6.dp).size(22.dp).clip(CircleShape)
                    .background(if (selected) Lumin.Keep else Color(0x66000000)).border(1.5.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center
            ) { if (selected) Icon(LIcons.Check, null, tint = Color(0xFF04261A), modifier = Modifier.size(14.dp)) }
        }
    }
}

@Composable
private fun ScanBar(grow: GrowModel) {
    if (!grow.scanning || grow.scanTotal == 0) return
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
        Text(stringResource(R.string.lumin_grow_scanning, grow.scanDone, grow.scanTotal), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = { grow.scanDone.toFloat() / grow.scanTotal.coerceAtLeast(1) },
            modifier = Modifier.fillMaxWidth().height(5.dp).clip(CircleShape), color = Lumin.Accent, trackColor = Lumin.SurfaceHigh
        )
    }
}

@Composable
private fun PickStep(grow: GrowModel) {
    Text(stringResource(R.string.lumin_grow_pick), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted, modifier = Modifier.padding(horizontal = 20.dp))
    ScanBar(grow)
    val faces = grow.pickable
    if (faces.isEmpty()) {
        Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
            if (grow.scanning) CircularProgressIndicator(color = Lumin.Accent)
            else Text(stringResource(R.string.lumin_grow_no_faces), color = Lumin.Muted)
        }
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(96.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(faces) { f -> FaceTile(grow, f, null) { grow.choose(f) } }
    }
}

@Composable
private fun ReviewStep(grow: GrowModel, model: LuminModel) {
    val count = grow.selected.size
    Column(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(96.dp),
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    Text(stringResource(R.string.lumin_grow_review), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted)
                    if (grow.scanning) {
                        Spacer(Modifier.height(6.dp))
                        Text(stringResource(R.string.lumin_grow_still_scanning), style = MaterialTheme.typography.bodyMedium, color = Lumin.Gold)
                    }
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = grow.title,
                        onValueChange = { grow.title = it.take(24) },
                        label = { Text(stringResource(R.string.lumin_grow_name)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lumin.Accent, unfocusedBorderColor = Lumin.Line)
                    )
                }
            }
            items(grow.accepted) { f -> FaceTile(grow, f, f in grow.selected) { grow.toggle(f) } }
            if (grow.maybe.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(stringResource(R.string.lumin_grow_maybe), style = MaterialTheme.typography.titleMedium, color = Lumin.Text, modifier = Modifier.padding(top = 12.dp))
                }
                items(grow.maybe) { f -> FaceTile(grow, f, f in grow.selected) { grow.toggle(f) } }
            }
        }
        Column(Modifier.padding(16.dp)) {
            if (!model.premium) {
                Text(stringResource(R.string.lumin_grow_watermark), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                Spacer(Modifier.height(8.dp))
            }
            BigButton(
                pluralStringResource(R.plurals.lumin_grow_make, count, count),
                { grow.render(watermark = !model.premium) },
                enabled = count >= 3
            )
        }
    }
}

@Composable
private fun RenderingStep(grow: GrowModel) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        CircularProgressIndicator(progress = { grow.progress }, color = Lumin.Accent, trackColor = Lumin.SurfaceHigh, modifier = Modifier.size(96.dp), strokeWidth = 8.dp)
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.lumin_grow_rendering, (grow.progress * 100).toInt()), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
        Spacer(Modifier.height(24.dp))
        GhostButton(stringResource(R.string.lumin_grow_cancel), { grow.cancelRender() })
    }
}

@Composable
private fun DoneStep(grow: GrowModel, model: LuminModel) {
    val file = grow.video ?: return
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
                modifier = Modifier.aspectRatio(9f / 16f).clip(RoundedCornerShape(20.dp))
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
            GhostButton(stringResource(R.string.lumin_grow_save), { grow.save() }, Modifier.weight(1f))
            GhostButton(stringResource(R.string.lumin_grow_again), { grow.restart() }, Modifier.weight(1f))
        }
        if (model.locked) {
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(R.string.lumin_grow_upsell), style = MaterialTheme.typography.bodyMedium, color = Lumin.Gold,
                modifier = Modifier.clickable { model.openPaywall() }.padding(6.dp)
            )
        }
    }
}

@Composable
fun GrowEntry(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Lumin.AccentGradient)
            .clickable(onClick = onClick)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Pill(stringResource(R.string.lumin_new), Color(0x33FFFFFF), Color.White)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.lumin_grow_title), style = MaterialTheme.typography.titleLarge, color = Color.White)
            Text(stringResource(R.string.lumin_grow_entry), style = MaterialTheme.typography.bodyMedium, color = Color(0xE6FFFFFF))
        }
        Icon(LIcons.Chevron, null, tint = Color.White)
    }
}
