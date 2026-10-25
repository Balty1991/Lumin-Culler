package com.luminculler.app.cleaner

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.android.play.core.review.ReviewManagerFactory
import com.luminculler.app.R
import com.luminculler.app.billing.BillingSnapshot
import com.luminculler.app.billing.PlayBilling
import kotlinx.coroutines.delay

/**
 * Release surface. Home is the rescue list: fastest gigabytes first, then a
 * review, then Trash. Permanent delete is a second step, so undo exists.
 * Eyes feed the best-shot line. Video compression and the old WebView are
 * not opened from here.
 */
class CleanerActivity : ComponentActivity() {
    private lateinit var billing: PlayBilling
    private val billingState = mutableStateOf(BillingSnapshot())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        billingState.value = BillingSnapshot.cached(this)
        billing = PlayBilling(this) { billingState.value = it }
        billing.start()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                background = Color(0xFF05060F),
                surface = Color(0xFF10131C),
                primary = Color(0xFF7DFFF4),
                onPrimary = Color(0xFF06211E)
            )) {
                CleanerApp(billing, billingState.value)
            }
        }
    }

    override fun onDestroy() {
        if (::billing.isInitialized) billing.stop()
        super.onDestroy()
    }
}

private enum class Page { Rescue, Swipe, Review, Paywall, Settings, Result }
private enum class OpKind { Trash, Delete, Untrash }

private data class Held(
    val images: List<Shot>,
    val videos: List<Shot>,
    val permanent: Boolean,
    val allowanceBefore: AllowanceState,
    val bytes: Long
)

private data class PendingOp(
    val kind: OpKind,
    val uris: List<String>,
    val decision: AllowanceDecision?,
    val showResult: Boolean
)

@Composable
private fun CleanerApp(billing: PlayBilling, snapshot: BillingSnapshot) {
    val context = LocalContext.current
    val activity = context as Activity
    val repo = remember { GalleryRepository(context) }
    var page by remember { mutableStateOf(Page.Rescue) }
    var shots by remember { mutableStateOf<List<Shot>>(emptyList()) }
    var videos by remember { mutableStateOf<List<Shot>>(emptyList()) }
    var progress by remember { mutableStateOf<ScanProgress?>(null) }
    var access by remember { mutableStateOf(currentAccess(context)) }
    var videosAllowed by remember { mutableStateOf(currentVideos(context, access)) }
    var chip by remember { mutableStateOf(Basket.Duplicates) }
    var index by remember { mutableIntStateOf(0) }
    var reviewPile by remember { mutableStateOf<Pile?>(null) }
    var held by remember { mutableStateOf<Held?>(null) }
    var pending by remember { mutableStateOf<PendingOp?>(null) }
    var banner by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var allowance by remember { mutableStateOf(AllowanceStore.read(context)) }
    var freed by remember { mutableLongStateOf(readFreed(context)) }
    var paywallBytes by remember { mutableLongStateOf(0L) }
    var reminderOn by remember { mutableStateOf(reminderEnabled(context)) }
    val couldNot = stringResource(R.string.could_not_delete)
    val plan = remember(shots, videos) { rescuePlan(shots, videos, System.currentTimeMillis()) }
    val baskets = remember(shots, videos) { assign(shots, videos) }
    val best = remember(shots) { bestShotName(shots) }
    val enforced = billingEnforced(snapshot.answered, snapshot.purchasable, snapshot.premium)
    val safeTrash = Build.VERSION.SDK_INT >= 30
    val startRef = remember { StartRef() }

    fun succeedTrash(uris: List<String>, decision: AllowanceDecision?, showResult: Boolean) {
        val uriSet = uris.toSet()
        val images = shots.filter { it.uri in uriSet }
        val vids = videos.filter { it.uri in uriSet }
        val before = allowance
        if (decision != null && decision !is AllowanceDecision.Blocked) {
            allowance = commitAllowance(allowance, decision, System.currentTimeMillis())
            AllowanceStore.write(context, allowance)
        }
        shots = shots.filter { it.uri !in uriSet }
        videos = videos.filter { it.uri !in uriSet }
        held = Held(images, vids, false, before, images.sumOf { it.bytes } + vids.sumOf { it.bytes })
        noteReview(activity, images.size + vids.size)
        banner = !showResult
        if (showResult) page = Page.Result
    }

    fun succeedDelete(uris: List<String>) {
        val uriSet = uris.toSet()
        val inGallery = (shots + videos).filter { it.uri in uriSet }
        val inHeld = ((held?.images).orEmpty() + (held?.videos).orEmpty()).filter { it.uri in uriSet }
        val bytes = (inGallery.ifEmpty { inHeld }).sumOf { it.bytes }
        shots = shots.filter { it.uri !in uriSet }
        videos = videos.filter { it.uri !in uriSet }
        freed = addFreed(context, bytes)
        held = Held(emptyList(), emptyList(), true, allowance, bytes)
        page = Page.Result
    }

    fun succeedUndo() {
        val batch = held ?: return
        shots = batch.images + shots
        videos = batch.videos + videos
        allowance = batch.allowanceBefore
        AllowanceStore.write(context, allowance)
        held = null
        banner = false
        page = Page.Rescue
    }

    val sender = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val op = pending
        pending = null
        if (result.resultCode != Activity.RESULT_OK || op == null) return@rememberLauncherForActivityResult
        when (op.kind) {
            OpKind.Trash -> succeedTrash(op.uris, op.decision, op.showResult)
            OpKind.Delete -> succeedDelete(op.uris)
            OpKind.Untrash -> succeedUndo()
        }
    }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        access = currentAccess(context)
        videosAllowed = currentVideos(context, access)
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (reminderEnabled(context)) setReminderEnabled(context, true)
    }
    val writePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            pending = null
            return@rememberLauncherForActivityResult
        }
        // The uris were stored on the pending op by the NeedWrite branch.
        val op = pending
        pending = null
        if (op != null) startRef.launch(repo.preparePermanentDelete(op.uris), op.decision, op.showResult, OpKind.Delete)
    }

    startRef.launch = { prepared, decision, showResult, kind ->
        when (prepared) {
            is PreparedDelete.Dialog -> {
                pending = PendingOp(kind, prepared.uris, decision?.let { decisionForLaunched(it, prepared.uris.size) }, showResult)
                sender.launch(IntentSenderRequest.Builder(prepared.sender).build())
            }
            is PreparedDelete.Immediate -> when (kind) {
                OpKind.Trash -> succeedTrash(prepared.uris, decision?.let { decisionForLaunched(it, prepared.uris.size) }, showResult)
                OpKind.Delete -> succeedDelete(prepared.uris)
                OpKind.Untrash -> succeedUndo()
            }
            is PreparedDelete.NeedWrite -> {
                pending = PendingOp(OpKind.Delete, prepared.uris, decision, showResult)
                writePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            PreparedDelete.Unavailable -> notice = couldNot
        }
    }

    fun begin(uris: List<String>, decision: AllowanceDecision?, showResult: Boolean, trash: Boolean) {
        if (uris.isEmpty()) return
        if (trash && safeTrash) startRef.launch(repo.prepareTrash(uris), decision, showResult, OpKind.Trash)
        else startRef.launch(repo.preparePermanentDelete(uris), decision, showResult, OpKind.Delete)
    }

    LaunchedEffect(access) {
        if (access == PhotoAccess.Denied) return@LaunchedEffect
        repo.scan { incoming ->
            shots = incoming.shots
            videos = incoming.videos
            progress = incoming.progress
        }
    }
    LaunchedEffect(plan.suggestedBytes) { saveReclaimable(context, plan.suggestedBytes) }
    LaunchedEffect(Unit) { if (reminderEnabled(context)) setReminderEnabled(context, true) }
    LaunchedEffect(banner) {
        if (banner) {
            delay(5000)
            banner = false
        }
    }
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(2500)
            notice = null
        }
    }
    val swipeItems = baskets[chip].orEmpty()
    LaunchedEffect(swipeItems.size, chip) {
        if (index >= swipeItems.size) index = (swipeItems.size - 1).coerceAtLeast(0)
    }
    BackHandler(enabled = page != Page.Rescue) { page = Page.Rescue }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        Box(Modifier.padding(padding).statusBarsPadding()) {
            when (page) {
                Page.Rescue -> RescueScreen(
                    plan = plan,
                    progress = progress,
                    access = access,
                    videosAllowed = videosAllowed,
                    freed = freed,
                    firstCleanFree = allowance.fullPilesUsed < FREE_CLEAN_PILES,
                    reminderOn = reminderOn,
                    banner = banner,
                    canUndo = held?.permanent == false,
                    onAllow = { permissions.launch(photoPermissionRequest()) },
                    onSettingsApp = { openAppSettings(activity) },
                    onReview = { pile ->
                        reviewPile = pile
                        page = Page.Review
                    },
                    onSwipe = { page = Page.Swipe },
                    onPremium = {
                        paywallBytes = plan.suggestedBytes
                        page = Page.Paywall
                    },
                    onSettings = { page = Page.Settings },
                    onReminder = { enabled ->
                        reminderOn = enabled
                        setReminderEnabled(context, enabled)
                        if (enabled && Build.VERSION.SDK_INT >= 33) {
                            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    },
                    onUndo = {
                        val batch = held ?: return@RescueScreen
                        val uris = batch.images.map { it.uri } + batch.videos.map { it.uri }
                        startRef.launch(repo.prepareUntrash(uris), null, false, OpKind.Untrash)
                    }
                )
                Page.Swipe -> SwipeScreen(
                    baskets = baskets,
                    chip = chip,
                    index = index,
                    bestShot = best,
                    onChip = {
                        chip = it
                        index = 0
                    },
                    onTrash = { shot -> begin(listOf(shot.uri), null, false, trash = true) },
                    onKeep = { index += 1 },
                    onBack = { page = Page.Rescue }
                )
                Page.Review -> {
                    val pile = reviewPile
                    if (pile != null) {
                        ReviewScreen(
                            pile = pile,
                            safeTrash = safeTrash,
                            allowance = allowance,
                            enforced = enforced,
                            premium = snapshot.premium,
                            onBack = { page = Page.Rescue },
                            onConfirm = { chosen, decision -> begin(chosen.map { it.uri }, decision, true, trash = true) },
                            onPaywall = { bytes ->
                                paywallBytes = bytes
                                page = Page.Paywall
                            }
                        )
                    }
                }
                Page.Paywall -> PaywallScreen(
                    snapshot = snapshot,
                    bytes = paywallBytes,
                    onBuy = { billing.buy(it) },
                    onRestore = { billing.restore() },
                    onManage = { openSubscriptions(activity) },
                    onBack = { page = Page.Rescue }
                )
                Page.Settings -> SettingsScreen(
                    reminderOn = reminderOn,
                    onReminder = { enabled ->
                        reminderOn = enabled
                        setReminderEnabled(context, enabled)
                        if (enabled && Build.VERSION.SDK_INT >= 33) {
                            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    },
                    onRestore = { billing.restore() },
                    onManage = { openSubscriptions(activity) },
                    onBack = { page = Page.Rescue }
                )
                Page.Result -> ResultScreen(
                    bytes = held?.bytes ?: 0L,
                    permanent = held?.permanent == true,
                    remaining = plan.suggestedBytes,
                    onUndo = {
                        val batch = held ?: return@ResultScreen
                        val uris = batch.images.map { it.uri } + batch.videos.map { it.uri }
                        startRef.launch(repo.prepareUntrash(uris), null, false, OpKind.Untrash)
                    },
                    onFreeSpace = {
                        val batch = held ?: return@ResultScreen
                        val uris = batch.images.map { it.uri } + batch.videos.map { it.uri }
                        begin(uris, null, true, trash = false)
                    },
                    onShare = {
                        val bytes = held?.bytes ?: 0L
                        if (bytes > 0) shareFreedCard(activity, bytes, freed = held?.permanent == true)
                    },
                    onDone = { page = Page.Rescue }
                )
            }
            if (notice != null) {
                Text(notice ?: "", Modifier.align(Alignment.BottomCenter).padding(16.dp), color = Color.White)
            }
        }
    }
}

private fun noteReview(activity: Activity, added: Int) {
    val previous = ReviewStore.deletes(activity)
    val asked = ReviewStore.asked(activity)
    val ask = shouldAskForReview(previous, added, asked)
    ReviewStore.save(activity, previous + added.coerceAtLeast(0), asked || ask)
    if (!ask) return
    val manager = runCatching { ReviewManagerFactory.create(activity) }.getOrNull() ?: return
    manager.requestReviewFlow().addOnCompleteListener { task ->
        if (task.isSuccessful) manager.launchReviewFlow(activity, task.result)
    }
}

private fun currentAccess(context: Context): PhotoAccess {
    fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    return photoAccess(
        sdk = Build.VERSION.SDK_INT,
        images = granted(Manifest.permission.READ_MEDIA_IMAGES),
        legacyStorage = granted(Manifest.permission.READ_EXTERNAL_STORAGE),
        partial = Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
    )
}

private fun currentVideos(context: Context, photos: PhotoAccess): Boolean {
    val videos = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VIDEO) ==
        PackageManager.PERMISSION_GRANTED
    return videosReadable(Build.VERSION.SDK_INT, videos, photos)
}

private fun photoPermissionRequest(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
    )
    Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

private fun openAppSettings(activity: Activity) {
    activity.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
    )
}

private fun openSubscriptions(activity: Activity) {
    activity.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/account/subscriptions?package=${activity.packageName}"))
    )
}

private class StartRef {
    var launch: (PreparedDelete, AllowanceDecision?, Boolean, OpKind) -> Unit = { _, _, _, _ -> }
}

private const val FREED_PREFS = "lumin_native_freed"

private fun readFreed(context: Context): Long =
    context.getSharedPreferences(FREED_PREFS, Context.MODE_PRIVATE).getLong("bytes", 0L)

private fun addFreed(context: Context, bytes: Long): Long {
    val next = readFreed(context) + bytes.coerceAtLeast(0L)
    context.getSharedPreferences(FREED_PREFS, Context.MODE_PRIVATE).edit().putLong("bytes", next).apply()
    return next
}
