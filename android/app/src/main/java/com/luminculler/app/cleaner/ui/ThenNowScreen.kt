package com.luminculler.app.cleaner.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.LifecycleOwner
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.grow.Renderer
import com.luminculler.app.cleaner.grow.decodeOriented
import com.luminculler.app.cleaner.magic.PhotoMagic
import com.luminculler.app.cleaner.thennow.ThenNowVideo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * „Atunci și acum”: alegi o poză veche, camera o arată transparent peste ce
 * vede, ca s-o refaci la fel azi; apoi Lumin face clipul trecerii.
 */
@Composable
fun ThenNowScreen(model: LuminModel) {
    var old by remember { mutableStateOf<Media?>(null) }
    var now by remember { mutableStateOf<Bitmap?>(null) }
    val o = old
    val n = now
    androidx.activity.compose.BackHandler(enabled = o != null) {
        if (n != null) now = null else old = null
    }
    when {
        o == null -> PickOld(model) { old = it }
        n == null -> Camera(model, o, onBack = { old = null }) { now = it }
        else -> ThenNowResult(model, o, n, onRetake = { now = null })
    }
}

@Composable
private fun PickOld(model: LuminModel, onPick: (Media) -> Unit) {
    // Poze de cel puțin un an; cele mai vechi primele, că acolo e farmecul.
    val photos = remember(model.photos) {
        val cutoff = LocalDate.now().minusYears(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        model.gamePhotos().filter { it.taken in 1 until cutoff }.sortedBy { it.taken }.take(600)
    }
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_then_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            Text(stringResource(R.string.lumin_then_pick), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted, modifier = Modifier.padding(horizontal = 20.dp))
            Spacer(Modifier.height(12.dp))
            if (photos.isEmpty()) {
                Text(stringResource(R.string.lumin_then_none), color = Lumin.Muted, modifier = Modifier.padding(24.dp))
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(110.dp),
                modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(photos, key = { it.id }) { m ->
                    Box(Modifier.aspectRatio(0.8f).clip(RoundedCornerShape(10.dp)).clickable { onPick(m) }) {
                        Thumb(m, Modifier.fillMaxSize())
                        Text(
                            "${year(m)}", color = Color.White, style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.align(Alignment.BottomStart).padding(6.dp).clip(CircleShape).background(Color(0x88000000)).padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
            }
        }
    }
}

private fun year(m: Media): Int = Instant.ofEpochMilli(m.taken).atZone(ZoneId.systemDefault()).year

@Composable
private fun Camera(model: LuminModel, old: Media, onBack: () -> Unit, onShot: (Bitmap) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    var then by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(old.id) { then = withContext(Dispatchers.IO) { decodeOriented(context, Uri.parse(old.uri), 1600) } }
    var ghost by remember { mutableFloatStateOf(0.45f) }
    var front by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val t = then
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), onBack, background = Color(0x33FFFFFF), tint = Color.White)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_then_align), color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (!granted) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                        Text(stringResource(R.string.lumin_then_camera), color = Color.White, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(12.dp))
                        BigButton(stringResource(R.string.lumin_then_allow), { ask.launch(Manifest.permission.CAMERA) })
                    }
                } else if (t != null) {
                    // Cadrul are forma pozei vechi: previzualizarea și poza veche se suprapun exact.
                    Box(Modifier.fillMaxWidth().aspectRatio(t.width / t.height.toFloat(), matchHeightConstraintsFirst = t.height > t.width)) {
                        key(front) { CameraPreview(capture, front) }
                        Image(t.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = ghost)
                    }
                }
            }
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Text(stringResource(R.string.lumin_then_ghost), color = Color(0xCCFFFFFF), style = MaterialTheme.typography.labelMedium)
                Slider(ghost, { ghost = it }, valueRange = 0f..0.9f, colors = SliderDefaults.colors(thumbColor = Lumin.Gold, activeTrackColor = Lumin.Accent))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    RoundIcon(LIcons.Undo, stringResource(R.string.lumin_then_flip), { front = !front }, background = Color(0x33FFFFFF), tint = Color.White)
                    Box(
                        Modifier.size(78.dp).clip(CircleShape).border(5.dp, Color.White, CircleShape).padding(8.dp).clip(CircleShape)
                            .background(if (busy) Lumin.Muted else Color.White)
                            .clickable(enabled = granted && t != null && !busy) {
                                busy = true
                                capture.takePicture(ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageCapturedCallback() {
                                    override fun onCaptureSuccess(image: ImageProxy) {
                                        scope.launch {
                                            val shot = withContext(Dispatchers.Default) { toBitmap(image, front, t!!.width / t.height.toFloat()) }
                                            busy = false
                                            onShot(shot)
                                        }
                                    }
                                    override fun onError(exception: ImageCaptureException) { busy = false }
                                })
                            }
                    )
                    Spacer(Modifier.size(44.dp))
                }
            }
        }
    }
}

@Composable
private fun CameraPreview(capture: ImageCapture, front: Boolean) {
    val context = LocalContext.current
    val view = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(front) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val selector = ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build()
            val preview = Preview.Builder().setResolutionSelector(selector).build().also { it.setSurfaceProvider(view.surfaceProvider) }
            provider.unbindAll()
            try {
                provider.bindToLifecycle(
                    context as LifecycleOwner,
                    if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
                    preview, capture
                )
            } catch (_: Throwable) { }
        }, ContextCompat.getMainExecutor(context))
        onDispose { try { future.get().unbindAll() } catch (_: Throwable) { } }
    }
    AndroidView({ view }, Modifier.fillMaxSize())
}

/** Poza făcută, rotită corect, în oglindă la camera frontală (cum o vedea omul) și tăiată la forma pozei vechi. */
private fun toBitmap(image: ImageProxy, mirror: Boolean, ratio: Float): Bitmap {
    val raw = image.toBitmap()
    val m = Matrix().apply {
        postRotate(image.imageInfo.rotationDegrees.toFloat())
        if (mirror) postScale(-1f, 1f)
    }
    image.close()
    val turned = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
    if (turned !== raw) raw.recycle()
    val w = turned.width
    val h = turned.height
    val (cw, ch) = if (w / h.toFloat() > ratio) ((h * ratio).toInt() to h) else (w to (w / ratio).toInt())
    val out = Bitmap.createBitmap(turned, (w - cw) / 2, (h - ch) / 2, cw, ch)
    if (out !== turned) turned.recycle()
    return out
}

@Composable
private fun ThenNowResult(model: LuminModel, old: Media, now: Bitmap, onRetake: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var then by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(old.id) { then = withContext(Dispatchers.IO) { decodeOriented(context, Uri.parse(old.uri), 1600) } }
    var split by remember { mutableFloatStateOf(0.5f) }
    var video by remember { mutableStateOf<File?>(null) }
    var progress by remember { mutableStateOf<Float?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val thenLabel = "${year(old)}"
    val nowLabel = "${LocalDate.now().year}"

    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), onRetake)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_then_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            Spacer(Modifier.height(12.dp))
            val t = then
            val v = video
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (v != null) {
                    key(v.absolutePath + v.lastModified()) {
                        AndroidView(
                            factory = { ctx -> VideoView(ctx).apply { setVideoPath(v.absolutePath); setOnPreparedListener { it.isLooping = true; start() } } },
                            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp))
                        )
                    }
                } else if (t != null) {
                    // Comparatorul: tragi de bară ca să vezi cât din „atunci” și cât din „acum”.
                    Box(Modifier.fillMaxWidth().aspectRatio(t.width / t.height.toFloat(), matchHeightConstraintsFirst = t.height > t.width).clip(RoundedCornerShape(20.dp))) {
                        Image(now.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        Box(Modifier.fillMaxSize().clip(LeftPart(split))) {
                            Image(t.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        }
                        Text(thenLabel, color = Color.White, style = MaterialTheme.typography.titleLarge, modifier = Modifier.align(Alignment.BottomStart).padding(12.dp))
                        Text(nowLabel, color = Color.White, style = MaterialTheme.typography.titleLarge, modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp))
                    }
                }
                val p = progress
                if (p != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(progress = { p }, color = Lumin.Gold)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.lumin_then_making), color = Lumin.Text)
                }
            }
            if (video == null) Slider(split, { split = it }, colors = SliderDefaults.colors(thumbColor = Lumin.Gold, activeTrackColor = Lumin.Accent))
            message?.let { Text(it, color = Lumin.Keep, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 6.dp)) }
            Spacer(Modifier.height(8.dp))
            if (v == null) {
                BigButton(stringResource(R.string.lumin_then_make), {
                    val tb = then ?: return@BigButton
                    progress = 0f
                    scope.launch {
                        val file = try {
                            ThenNowVideo.render(context, tb, now, thenLabel, nowLabel, if (model.premium) null else "Lumin") { x -> scope.launch { progress = x } }
                        } catch (e: Throwable) {
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            null
                        }
                        progress = null
                        if (file != null) video = file else message = context.getString(R.string.lumin_magic_failed)
                    }
                }, enabled = progress == null && then != null, icon = LIcons.Movie, brush = Lumin.PremiumGradient, textColor = Color(0xFF2A1400))
                Spacer(Modifier.height(8.dp))
                GhostButton(stringResource(R.string.lumin_then_save_photo), {
                    val tb = then ?: return@GhostButton
                    scope.launch {
                        val uri = withContext(Dispatchers.IO) {
                            val img = ThenNowVideo.collage(tb, now, thenLabel, nowLabel)
                            PhotoMagic.saveImage(context, img).also { img.recycle() }
                        }
                        message = context.getString(if (uri != null) R.string.lumin_magic_saved else R.string.lumin_grow_save_failed)
                    }
                })
            } else {
                BigButton(stringResource(R.string.lumin_share), {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", v)
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "video/mp4"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, null))
                }, icon = LIcons.Share)
                Spacer(Modifier.height(8.dp))
                GhostButton(stringResource(R.string.lumin_grow_save), {
                    scope.launch {
                        val uri = withContext(Dispatchers.IO) { Renderer.saveToGallery(context, v) }
                        message = context.getString(if (uri != null) R.string.lumin_grow_saved else R.string.lumin_grow_save_failed)
                    }
                })
            }
        }
    }
}

/** Forma care păstrează doar partea din stânga a cadrului, până la [f]. */
private class LeftPart(private val f: Float) : androidx.compose.ui.graphics.Shape {
    override fun createOutline(size: androidx.compose.ui.geometry.Size, layoutDirection: androidx.compose.ui.unit.LayoutDirection, density: androidx.compose.ui.unit.Density) =
        androidx.compose.ui.graphics.Outline.Rectangle(androidx.compose.ui.geometry.Rect(0f, 0f, size.width * f, size.height))
}
