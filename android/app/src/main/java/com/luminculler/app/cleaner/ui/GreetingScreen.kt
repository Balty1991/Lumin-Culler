package com.luminculler.app.cleaner.ui

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.luminculler.app.R
import com.luminculler.app.cleaner.GreetingCard
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.grow.decodeOriented
import com.luminculler.app.cleaner.magic.AiException
import com.luminculler.app.cleaner.magic.AiJob
import com.luminculler.app.cleaner.magic.PhotoMagic
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * „Felicitare”: alegi o poză, ocazia și pentru cine e; AI-ul scrie trei
 * variante de text, iar Lumin face cardul, gata de trimis.
 */
@Composable
fun GreetingScreen(model: LuminModel) {
    var photo by remember { mutableStateOf<Media?>(null) }
    val p = photo
    androidx.activity.compose.BackHandler(enabled = p != null) { photo = null }
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { if (p != null) photo = null else model.back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_greet_title), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            if (p == null) PickPhoto(model) { photo = it } else Compose(model, p)
        }
    }
}

@Composable
private fun PickPhoto(model: LuminModel, onPick: (Media) -> Unit) {
    val photos = remember(model.photos) { model.gamePhotos().sortedByDescending { it.taken }.take(600) }
    Text(stringResource(R.string.lumin_greet_pick), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted, modifier = Modifier.padding(horizontal = 20.dp))
    Spacer(Modifier.height(12.dp))
    LazyVerticalGrid(
        columns = GridCells.Adaptive(110.dp),
        modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        items(photos, key = { it.id }) { m ->
            Thumb(m, Modifier.aspectRatio(0.8f).clip(RoundedCornerShape(10.dp)).clickable { onPick(m) })
        }
    }
}

@Composable
private fun Compose(model: LuminModel, photo: Media) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val occasions = listOf(
        stringResource(R.string.lumin_greet_birthday), stringResource(R.string.lumin_greet_nameday),
        stringResource(R.string.lumin_greet_anniversary), stringResource(R.string.lumin_greet_christmas),
        stringResource(R.string.lumin_greet_easter), stringResource(R.string.lumin_greet_thanks),
        stringResource(R.string.lumin_greet_love)
    )
    var occasion by remember { mutableStateOf(occasions[0]) }
    var forWhom by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("") }
    var texts by remember { mutableStateOf<List<String>?>(null) }
    var writing by remember { mutableStateOf(false) }
    var card by remember { mutableStateOf<Bitmap?>(null) }
    var bmp by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(photo.id) { bmp = withContext(Dispatchers.IO) { decodeOriented(context, Uri.parse(photo.uri), 1600) } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        val shown = card ?: bmp
        if (shown != null) {
            Image(shown.asImageBitmap(), null, Modifier.fillMaxWidth().height(320.dp).clip(RoundedCornerShape(20.dp)), contentScale = if (card != null) ContentScale.Fit else ContentScale.Crop)
        }
        Spacer(Modifier.height(16.dp))
        if (card == null) {
            Text(stringResource(R.string.lumin_greet_occasion), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (o in occasions) {
                    val on = o == occasion
                    Text(
                        o, color = if (on) androidx.compose.ui.graphics.Color(0xFF2A1400) else Lumin.Text, style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.clip(CircleShape).background(if (on) Lumin.Gold else Lumin.SurfaceHigh).clickable { occasion = o; texts = null }
                            .padding(horizontal = 14.dp, vertical = 9.dp)
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(forWhom, { forWhom = it.take(60); texts = null }, label = { Text(stringResource(R.string.lumin_greet_for)) }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(from, { from = it.take(60); texts = null }, label = { Text(stringResource(R.string.lumin_greet_from)) }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(16.dp))

            val list = texts
            if (list == null) {
                BigButton(stringResource(R.string.lumin_greet_write), {
                    writing = true
                    scope.launch {
                        try {
                            val extra = "Occasion: $occasion. " +
                                (if (forWhom.isNotBlank()) "For: ${forWhom.trim()}. " else "") +
                                (if (from.isNotBlank()) "From: ${from.trim()}. " else "")
                            texts = model.aiTexts(AiJob.Greeting, listOf(photo), extra).ifEmpty { throw AiException("empty") }
                        } catch (e: Throwable) {
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            model.message = aiErrorMessage(context, e)
                        } finally {
                            writing = false
                        }
                    }
                }, enabled = !writing && AiJob.Greeting in model.aiKinds, icon = LIcons.Sparkle, brush = Lumin.PremiumGradient, textColor = androidx.compose.ui.graphics.Color(0xFF2A1400))
                if (writing) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(color = Lumin.Accent, modifier = Modifier.width(22.dp).height(22.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.lumin_ai_writing), color = Lumin.Muted)
                    }
                }
                if (AiJob.Greeting !in model.aiKinds) {
                    Text(stringResource(R.string.lumin_greet_offline), color = Lumin.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                }
            } else {
                Text(stringResource(R.string.lumin_greet_choose), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
                Spacer(Modifier.height(8.dp))
                for (t in list) {
                    Text(
                        t, color = Lumin.Text, style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(14.dp)).background(Lumin.Surface)
                            .clickable {
                                val b = bmp ?: return@clickable
                                card = GreetingCard.render(context, b, occasion, t, watermark = !model.premium)
                            }.padding(14.dp)
                    )
                }
                GhostButton(stringResource(R.string.lumin_greet_again), { texts = null })
            }
        } else {
            val c = card!!
            BigButton(stringResource(R.string.lumin_share), {
                val file = File(context.cacheDir, "lumin-greeting.jpg")
                file.outputStream().use { c.compress(Bitmap.CompressFormat.JPEG, 92, it) }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "image/jpeg"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, null))
            }, icon = LIcons.Share)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton(stringResource(R.string.lumin_grow_save), {
                    scope.launch {
                        val uri = withContext(Dispatchers.IO) { PhotoMagic.saveImage(context, c) }
                        model.message = context.getString(if (uri != null) R.string.lumin_magic_saved else R.string.lumin_grow_save_failed)
                    }
                }, Modifier.weight(1f))
                GhostButton(stringResource(R.string.lumin_greet_other_text), { card = null }, Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
