package com.luminculler.app.cleaner

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import coil.compose.AsyncImage
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.PendingPurchasesParams
import com.luminculler.app.MainActivity
import com.luminculler.app.plugins.CleanReminderWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Ecranul nativ de curățare. Web-ul Capacitor rămâne pentru uneltele Pro.
 *
 * Ce merge aici: scan MediaStore, coșuri, swipe, lista de video, cel mai bun
 * cadru din rafală, trash prin MediaStore, ecranul de plată (aceleași id-uri
 * Play), setări și mementoul WorkManager.
 *
 * Scanarea are dHash și claritate pe tot lotul citit, cel mai bun cadru
 * din rafală și cartonașul de share. Ce rămâne: ochii închiși prin ML Kit
 * doar pe rafale, comprimarea video, revizuirea Play, lansarea cumpărării,
 * și mutarea uneltelor Pro din WebView.
 */
class CleanerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                background = Color(0xFF05060F),
                surface = Color(0xFF10131C),
                primary = Color(0xFF7DFFF4),
                onPrimary = Color(0xFF06211E)
            )) {
                CleanerRoot()
            }
        }
    }
}

private enum class Page { Deck, Settings, Paywall }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CleanerRoot() {
    val context = LocalContext.current
    var page by remember { mutableStateOf(Page.Deck) }
    var granted by remember { mutableStateOf(hasImages(context)) }
    var baskets by remember { mutableStateOf<Map<Basket, List<Shot>>>(emptyMap()) }
    var chip by remember { mutableStateOf(Basket.Blurry) }
    var index by remember { mutableIntStateOf(0) }
    var sheet by remember { mutableStateOf(false) }
    var freed by remember { mutableStateOf(readFreed(context)) }
    var ready by remember { mutableStateOf(false) }
    var bestShot by remember { mutableStateOf<String?>(null) }
    var undo by remember { mutableStateOf<Shot?>(null) }
    var accent by remember { mutableStateOf(Color(0xFF7DFFF4)) }
    var celebrated by remember { mutableStateOf<Long?>(null) }
    val reduce = reduceMotion(context)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        granted = hasImages(context)
    }
    val trash = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val shot = baskets[chip]?.getOrNull(index)
            if (shot != null) {
                val next = addFreed(context, shot.bytes)
                celebrated = next - freed
                freed = next
                undo = shot
                baskets = baskets.mapValues { (key, list) -> if (key == chip) list.filter { it.uri != shot.uri } else list }
            }
        }
    }
    val restore = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val shot = undo
        if (result.resultCode == Activity.RESULT_OK && shot != null) {
            freed = subtractFreed(context, shot.bytes)
            baskets = baskets.mapValues { (key, list) -> if (key == chip) listOf(shot) + list else list }
            index = 0
            undo = null
            gestureHaptic(context, "undo")
        }
    }

    LaunchedEffect(granted) {
        if (!granted) {
            ready = false
            return@LaunchedEffect
        }
        val loaded = withContext(Dispatchers.IO) { GalleryRepository(context).load() }
        baskets = loaded.baskets
        bestShot = loaded.bestShot
        ready = true
        index = 0
    }
    LaunchedEffect(shotUri(baskets, chip, index)) {
        val uri = shotUri(baskets, chip, index) ?: return@LaunchedEffect
        val next = withContext(Dispatchers.IO) { accentOf(context, uri) } ?: return@LaunchedEffect
        accent = Color(next)
    }
    LaunchedEffect(celebrated) {
        if (celebrated != null) {
            kotlinx.coroutines.delay(1600)
            celebrated = null
        }
    }

    val items = baskets[chip].orEmpty()
    val shot = items.getOrNull(index)
    var drag by remember(shot?.uri) { mutableStateOf(0f) }
    val turn = remember { Animatable(0f) }
    LaunchedEffect(chip) {
        if (reduce) return@LaunchedEffect
        turn.snapTo(-16f)
        turn.animateTo(0f, spring(dampingRatio = 0.72f, stiffness = 320f))
    }
    val askTrash = { target: Shot ->
        val pending = GalleryRepository(context).trash(listOf(target.uri))
        if (pending != null) trash.launch(androidx.activity.result.IntentSenderRequest.Builder(pending.intentSender).build())
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        AnimatedContent(
            targetState = page,
            transitionSpec = { (fadeIn() + scaleIn(initialScale = if (reduce) 1f else 0.94f)).togetherWith(fadeOut()) },
            label = "cleaner-page"
        ) { current ->
        when (current) {
            Page.Settings -> SettingsPage(onBack = { page = Page.Deck })
            Page.Paywall -> PaywallPage(onBack = { page = Page.Deck })
            Page.Deck -> Column(Modifier.fillMaxSize().padding(padding).statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Clean", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    FreedOrb(freed, accent, reduce, Modifier.size(40.dp))
                    TextButton(onClick = { page = Page.Paywall }) { Text(formatBytes(freed)) }
                    TextButton(onClick = {
                        context.startActivity(Intent(context, MainActivity::class.java))
                    }) { Text("Pro") }
                    TextButton(onClick = { page = Page.Settings }) { Text("Settings") }
                }
                if (celebrated != null) {
                    Text("Freed ${formatBytes(celebrated ?: 0)}", Modifier.padding(horizontal = 16.dp), color = accent)
                }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Basket.entries.forEach { basket ->
                        FilterChip(
                            selected = chip == basket,
                            onClick = {
                                if (chip != basket) gestureHaptic(context, "chip")
                                chip = basket
                                index = 0
                            },
                            label = { Text("${label(basket)} ${baskets[basket]?.size ?: 0}") }
                        )
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (granted && !ready) {
                        CircularProgressIndicator(Modifier.align(Alignment.Center), color = accent)
                    } else if (!granted) {
                        Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Photos stay on this phone. Allow access to sort them.")
                            Spacer(Modifier.height(12.dp))
                            Button(onClick = { permission.launch(imagePermissions()) }) { Text("Allow photos") }
                        }
                    } else if (chip == Basket.Videos) {
                        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (items.isEmpty()) Text("No video over 50 MB.")
                            items.forEach { video ->
                                Text("${video.name} · ${formatBytes(video.bytes)}")
                            }
                        }
                    } else if (shot == null) {
                        Text("Nothing in this basket.", Modifier.align(Alignment.Center))
                    } else {
                        AsyncImage(
                            model = shot.uri,
                            contentDescription = shot.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    rotationY = turn.value
                                    cameraDistance = 12 * density
                                }
                                .offset { IntOffset(drag.roundToInt(), 0) }
                                .pointerInput(shot.uri) {
                                    detectHorizontalDragGestures(
                                        onHorizontalDrag = { _, amount -> drag += amount },
                                        onDragEnd = {
                                            when {
                                                drag < -120f -> {
                                                    gestureHaptic(context, "delete")
                                                    askTrash(shot)
                                                }
                                                drag > 120f -> {
                                                    gestureHaptic(context, "keep")
                                                    index += 1
                                                }
                                            }
                                            drag = 0f
                                        }
                                    )
                                }
                        )
                    }
                }
                Column(Modifier.fillMaxWidth().background(Color(0xFF10131C), RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).padding(16.dp)) {
                    TextButton(onClick = { sheet = true }) {
                        Text(shot?.let { "${it.name} · ${formatBytes(it.bytes)}" } ?: label(chip))
                    }
                    if (shot != null && chip == Basket.Bursts && bestShot != null) Text("Best shot stays: $bestShot")
                    if (undo != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("${undo?.name} removed")
                            TextButton(onClick = {
                                val shot = undo ?: return@TextButton
                                val pending = GalleryRepository(context).untrash(listOf(shot.uri))
                                if (pending != null) restore.launch(androidx.activity.result.IntentSenderRequest.Builder(pending.intentSender).build())
                            }) { Text("Undo") }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (shot != null) {
                            Button(onClick = {
                                gestureHaptic(context, "delete")
                                askTrash(shot)
                            }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3A1518), contentColor = Color(0xFFFFD0D0))) { Text("Delete") }
                            Button(onClick = {
                                gestureHaptic(context, "keep")
                                index += 1
                            }, colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = Color(0xFF06211E))) { Text("Keep") }
                        }
                    }
                }
                if (sheet) {
                    ModalBottomSheet(onDismissRequest = { sheet = false }) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(label(chip), style = MaterialTheme.typography.titleMedium)
                            Text("Swipe left to trash, right to keep. Nothing leaves without the system dialog.")
                            TextButton(onClick = { page = Page.Paywall; sheet = false }) { Text("Premium") }
                            TextButton(onClick = {
                                val activity = context as? Activity
                                if (activity != null && freed > 0) shareFreedCard(activity, freed)
                            }) { Text("Share card") }
                            TextButton(onClick = { page = Page.Settings; sheet = false }) { Text("Reminder and settings") }
                        }
                    }
                }
            }
        }
        }
    }
}

@Composable
private fun SettingsPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val prefs = context.getSharedPreferences(CleanReminderWorker.PREFS, Context.MODE_PRIVATE)
    var on by remember { mutableStateOf(prefs.getBoolean("enabled", true)) }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("Monthly reminder")
            Switch(checked = on, onCheckedChange = { checked ->
                on = checked
                prefs.edit().putBoolean("enabled", checked).putInt(CleanReminderWorker.KEY_DAYS, 30).apply()
                val manager = WorkManager.getInstance(context)
                if (checked) {
                    val request = PeriodicWorkRequestBuilder<CleanReminderWorker>(30, TimeUnit.DAYS).build()
                    manager.enqueueUniquePeriodicWork(CleanReminderWorker.UNIQUE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
                } else {
                    manager.cancelUniqueWork(CleanReminderWorker.UNIQUE_WORK)
                }
            })
        }
        Text("The reminder uses the same WorkManager job as the web app. It does not delete anything.")
        TextButton(onClick = onBack) { Text("Back") }
    }
}

@Composable
private fun PaywallPage(onBack: () -> Unit) {
    val context = LocalContext.current
    var status by remember { mutableStateOf("Connecting to Google Play…") }
    LaunchedEffect(Unit) {
        val client = BillingClient.newBuilder(context)
            .setListener { _, _ -> }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
        client.startConnection(object : com.android.billingclient.api.BillingClientStateListener {
            override fun onBillingSetupFinished(result: com.android.billingclient.api.BillingResult) {
                status = if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    "Play Billing is ready. Plans: lumin_premium_monthly, lumin_premium_yearly, lumin_premium_lifetime."
                } else {
                    "Play Billing is not available here (${result.debugMessage}). The plan ids stay the same as the web paywall."
                }
            }
            override fun onBillingServiceDisconnected() {
                status = "Play Billing disconnected."
            }
        })
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Premium", style = MaterialTheme.typography.headlineSmall)
        Text(status)
        Text("Manual swipe stays free. Cleaning a whole basket and video compression stay Premium, same as the web app.")
        TextButton(onClick = onBack) { Text("Back") }
    }
}

private fun label(basket: Basket): String = when (basket) {
    Basket.Duplicates -> "Duplicates"
    Basket.Bursts -> "Bursts"
    Basket.Blurry -> "Blurry"
    Basket.Screenshots -> "Screenshots"
    Basket.Videos -> "Videos"
    Basket.Messengers -> "Messengers"
}

private fun imagePermissions(): Array<String> = if (Build.VERSION.SDK_INT >= 33) {
    arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
} else {
    arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

private fun hasImages(context: Context): Boolean {
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
    return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = -1
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return "%.1f %s".format(value, units[unit])
}

private const val FREED_PREFS = "lumin_native_freed"

private fun readFreed(context: Context): Long =
    context.getSharedPreferences(FREED_PREFS, Context.MODE_PRIVATE).getLong("bytes", 0L)

private fun shotUri(baskets: Map<Basket, List<Shot>>, chip: Basket, index: Int): String? =
    baskets[chip].orEmpty().getOrNull(index)?.uri

private fun subtractFreed(context: Context, bytes: Long): Long {
    val next = (readFreed(context) - bytes).coerceAtLeast(0L)
    context.getSharedPreferences(FREED_PREFS, Context.MODE_PRIVATE).edit().putLong("bytes", next).apply()
    return next
}

private fun addFreed(context: Context, bytes: Long): Long {
    val next = readFreed(context) + bytes
    context.getSharedPreferences(FREED_PREFS, Context.MODE_PRIVATE).edit().putLong("bytes", next).apply()
    return next
}
