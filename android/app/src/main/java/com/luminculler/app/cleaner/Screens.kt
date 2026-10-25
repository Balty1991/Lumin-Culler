package com.luminculler.app.cleaner

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.luminculler.app.R
import com.luminculler.app.billing.BillingNotice
import com.luminculler.app.billing.BillingSnapshot
import com.luminculler.app.billing.PlanOffer

private val Ink = Color(0xFF05060F)
private val Card = Color(0xFF10131C)
private val Accent = Color(0xFF7DFFF4)
private val OnAccent = Color(0xFF06211E)
private val Danger = Color(0xFF3A1518)
private val DangerText = Color(0xFFFFD0D0)

@Composable
fun RescueScreen(
    plan: RescuePlan,
    progress: ScanProgress?,
    access: PhotoAccess,
    videosAllowed: Boolean,
    freed: Long,
    firstCleanFree: Boolean,
    reminderOn: Boolean,
    banner: Boolean,
    canUndo: Boolean,
    onAllow: () -> Unit,
    onSettingsApp: () -> Unit,
    onReview: (Pile) -> Unit,
    onSwipe: () -> Unit,
    onPremium: () -> Unit,
    onSettings: () -> Unit,
    onReminder: (Boolean) -> Unit,
    onUndo: () -> Unit
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.clean_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            FreedOrb(freed, Accent, reduce = false, Modifier.size(36.dp))
        }
        Text(stringResource(R.string.rescue_gb, formatBytes(plan.suggestedBytes)), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Accent)
        if (freed > 0) Text(stringResource(R.string.freed_so_far, formatBytes(freed)), color = Color(0xFFC5CAD6))
        Text(stringResource(R.string.promise), color = Color(0xFFC5CAD6))
        progress?.let { ProgressLine(it) }
        if (access == PhotoAccess.Denied) {
            Text(stringResource(R.string.allow_photos_body))
            Button(onClick = onAllow) { Text(stringResource(R.string.allow_photos)) }
            TextButton(onClick = onSettingsApp) { Text(stringResource(R.string.open_settings)) }
        }
        if (access == PhotoAccess.Limited) {
            Text(stringResource(R.string.limited_access))
            TextButton(onClick = onAllow) { Text(stringResource(R.string.choose_more)) }
        }
        if (access != PhotoAccess.Denied && !videosAllowed) {
            TextButton(onClick = onAllow) { Text(stringResource(R.string.allow_videos)) }
        }
        if (firstCleanFree && plan.suggestedBytes > 0) Text(stringResource(R.string.first_clean_free), color = Accent)
        if (banner) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.trashed_one))
                if (canUndo) TextButton(onClick = onUndo) { Text(stringResource(R.string.undo)) }
            }
        }
        val fastest = plan.piles.firstOrNull { it.suggestedCount > 0 }?.id
        if (access != PhotoAccess.Denied && plan.piles.isEmpty() && progress?.phase == ScanPhase.Done) {
            Text(stringResource(R.string.empty_gallery))
        }
        for (pile in plan.piles) {
            PileCard(pile, fastest == pile.id, onReview = { onReview(pile) })
        }
        if (access != PhotoAccess.Denied) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.remind_me), modifier = Modifier.weight(1f))
                Switch(checked = reminderOn, onCheckedChange = onReminder)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onSwipe) { Text(stringResource(R.string.swipe_mode)) }
            TextButton(onClick = onPremium) { Text(stringResource(R.string.premium)) }
            TextButton(onClick = onSettings) { Text(stringResource(R.string.settings)) }
        }
    }
}

@Composable
private fun ProgressLine(progress: ScanProgress) {
    val text = when (progress.phase) {
        ScanPhase.Metadata -> stringResource(R.string.scanning_meta)
        ScanPhase.Thumbnails -> stringResource(R.string.scanning_thumbs, progress.done, progress.total)
        ScanPhase.Faces -> stringResource(R.string.scanning_faces)
        ScanPhase.Done -> return
    }
    Text(text, color = Color(0xFF9AA3B2))
}

@Composable
private fun PileCard(pile: Pile, fastest: Boolean, onReview: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Card, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (fastest) Text(stringResource(R.string.fastest), color = Accent, fontWeight = FontWeight.Bold)
        Text(pileTitle(pile.id), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (pile.suggestedCount > 0) {
            Text(stringResource(R.string.pile_meta, formatBytes(pile.suggestedBytes), pile.suggestedCount))
            Text(effortText(pile.effortSeconds), color = Color(0xFF9AA3B2))
        } else {
            Text(stringResource(R.string.pile_opt_in), color = Color(0xFF9AA3B2))
        }
        val leftOut = pile.items.count { !it.suggested }
        if (leftOut > 0) Text(stringResource(R.string.pile_left_out, leftOut), color = Color(0xFF9AA3B2))
        TextButton(onClick = onReview) { Text(stringResource(R.string.review)) }
    }
}

@Composable
fun ReviewScreen(
    pile: Pile,
    safeTrash: Boolean,
    allowance: AllowanceState,
    enforced: Boolean,
    premium: Boolean,
    onBack: () -> Unit,
    onConfirm: (List<Shot>, AllowanceDecision) -> Unit,
    onPaywall: (Long) -> Unit
) {
    val suggested = remember(pile) { pile.items.filter { it.suggested }.map { it.shot.uri }.toSet() }
    var checked by remember(pile) { mutableStateOf(suggested) }
    val chosen = pile.items.map { it.shot }.filter { it.uri in checked }
    val now = remember { System.currentTimeMillis() }
    val decision = decideAllowance(chosen.size, premium, enforced, allowance, now)
    val sending = selectForClean(chosen, decision)
    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp)) {
        Text(stringResource(R.string.review_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(if (safeTrash) stringResource(R.string.review_safe) else stringResource(R.string.review_permanent_warning))
        TextButton(onClick = { checked = suggested }) { Text(stringResource(R.string.select_suggested)) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(pile.items, key = { it.shot.uri }) { candidate ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = candidate.shot.uri in checked,
                        onCheckedChange = { on ->
                            checked = if (on) checked + candidate.shot.uri else checked - candidate.shot.uri
                        }
                    )
                    Column(Modifier.weight(1f)) {
                        Text(candidate.shot.name, maxLines = 1)
                        Text(
                            "${formatBytes(candidate.shot.bytes)} · ${reasonLine(candidate)}",
                            color = Color(0xFF9AA3B2),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
        when (decision) {
            is AllowanceDecision.Partial -> Text(stringResource(R.string.free_plan_partial, decision.take, chosen.size, formatBytes(chosen.sumOf { it.bytes } - sending.sumOf { it.bytes })))
            AllowanceDecision.Blocked -> Text(stringResource(R.string.daily_limit, formatBytes(chosen.sumOf { it.bytes })))
            is AllowanceDecision.All -> Unit
        }
        if (!safeTrash) Text(stringResource(R.string.android10_one), color = Color(0xFF9AA3B2))
        Button(
            onClick = {
                if (decision is AllowanceDecision.Blocked) onPaywall(chosen.sumOf { it.bytes })
                else if (sending.isNotEmpty()) onConfirm(sending, decision)
            },
            enabled = chosen.isNotEmpty() || decision is AllowanceDecision.Blocked,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent)
        ) {
            Text(
                when {
                    decision is AllowanceDecision.Blocked -> stringResource(R.string.premium)
                    safeTrash -> stringResource(R.string.move_to_trash, sending.size, formatBytes(sending.sumOf { it.bytes }))
                    else -> stringResource(R.string.delete_permanently_count, sending.size, formatBytes(sending.sumOf { it.bytes }))
                }
            )
        }
        TextButton(onClick = onBack) { Text(stringResource(R.string.settings_back)) }
    }
}

@Composable
fun ResultScreen(
    bytes: Long,
    permanent: Boolean,
    remaining: Long,
    onUndo: () -> Unit,
    onFreeSpace: () -> Unit,
    onShare: () -> Unit,
    onDone: () -> Unit
) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            if (permanent) stringResource(R.string.result_freed, formatBytes(bytes)) else stringResource(R.string.result_trashed, formatBytes(bytes)),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold
        )
        Text(if (permanent) stringResource(R.string.result_freed_body) else stringResource(R.string.result_trashed_body))
        if (remaining > 0) Text(stringResource(R.string.still_waiting, formatBytes(remaining)), color = Accent)
        Text(stringResource(R.string.promise), color = Color(0xFFC5CAD6))
        if (!permanent) {
            Button(onClick = onFreeSpace, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent)) {
                Text(stringResource(R.string.free_space_now))
            }
            Text(stringResource(R.string.free_space_hint), color = Color(0xFF9AA3B2))
            TextButton(onClick = onUndo) { Text(stringResource(R.string.undo)) }
        }
        Button(onClick = onShare, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Card, contentColor = Accent)) {
            Text(stringResource(R.string.share))
        }
        TextButton(onClick = onDone) { Text(if (permanent) stringResource(R.string.done) else stringResource(R.string.keep_in_trash)) }
    }
}

@Composable
fun PaywallScreen(
    snapshot: BillingSnapshot,
    bytes: Long,
    onBuy: (String) -> Unit,
    onRestore: () -> Unit,
    onManage: () -> Unit,
    onBack: () -> Unit
) {
    val ordered = snapshot.plans.sortedBy { planOrder(it.kind) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(stringResource(R.string.paywall_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (bytes > 0) Text(stringResource(R.string.paywall_gb, formatBytes(bytes)), style = MaterialTheme.typography.titleLarge, color = Accent)
        Text(stringResource(R.string.paywall_promise))
        when {
            snapshot.premium -> Text(stringResource(R.string.paywall_owned))
            snapshot.loading && ordered.isEmpty() -> Text(stringResource(R.string.paywall_connecting))
            ordered.isEmpty() -> Text(stringResource(R.string.paywall_empty))
        }
        when (snapshot.notice) {
            BillingNotice.Restored -> Text(stringResource(R.string.paywall_restored))
            BillingNotice.NoPurchase -> Text(stringResource(R.string.paywall_none))
            BillingNotice.Unavailable -> Text(stringResource(R.string.paywall_empty))
            null -> Unit
        }
        for (plan in ordered) {
            val yearly = plan.kind == "yearly"
            Button(
                onClick = { onBuy(plan.productId) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (yearly) Accent else Card,
                    contentColor = if (yearly) OnAccent else Accent
                )
            ) {
                Column {
                    Text(planLabel(plan), fontWeight = FontWeight.Bold)
                    Text(planPrice(plan))
                }
            }
        }
        TextButton(onClick = onRestore) { Text(stringResource(R.string.paywall_restore)) }
        TextButton(onClick = onManage) { Text(stringResource(R.string.paywall_manage)) }
        TextButton(onClick = onBack) { Text(stringResource(R.string.paywall_not_now)) }
    }
}

@Composable
fun SettingsScreen(
    reminderOn: Boolean,
    onReminder: (Boolean) -> Unit,
    onRestore: () -> Unit,
    onManage: () -> Unit,
    onBack: () -> Unit
) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings_reminder), modifier = Modifier.weight(1f))
            Switch(checked = reminderOn, onCheckedChange = onReminder)
        }
        Text(stringResource(R.string.settings_reminder_body), color = Color(0xFF9AA3B2))
        Text(stringResource(R.string.settings_privacy))
        TextButton(onClick = onRestore) { Text(stringResource(R.string.paywall_restore)) }
        TextButton(onClick = onManage) { Text(stringResource(R.string.paywall_manage)) }
        TextButton(onClick = onBack) { Text(stringResource(R.string.settings_back)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeScreen(
    baskets: Map<Basket, List<Shot>>,
    chip: Basket,
    index: Int,
    bestShot: String?,
    onChip: (Basket) -> Unit,
    onTrash: (Shot) -> Unit,
    onKeep: () -> Unit,
    onBack: () -> Unit
) {
    val items = baskets[chip].orEmpty()
    val shot = items.getOrNull(index)
    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.clean_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TextButton(onClick = onBack) { Text(stringResource(R.string.settings_back)) }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (basket in Basket.entries) {
                FilterChip(
                    selected = chip == basket,
                    onClick = { onChip(basket) },
                    label = { Text("${basketLabel(basket)} ${baskets[basket]?.size ?: 0}") }
                )
            }
        }
        Text(stringResource(R.string.swipe_hint), color = Color(0xFF9AA3B2))
        if (chip == Basket.Videos) {
            if (items.isEmpty()) Text(stringResource(R.string.no_large_videos))
            LazyColumn(Modifier.weight(1f)) {
                items(items, key = { it.uri }) { video ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("${video.name} · ${formatBytes(video.bytes)}", modifier = Modifier.weight(1f))
                        TextButton(onClick = { onTrash(video) }) { Text(stringResource(R.string.trash)) }
                    }
                }
            }
        } else if (shot == null) {
            Text(stringResource(R.string.nothing_in_basket), modifier = Modifier.weight(1f))
        } else {
            val context = LocalContext.current
            var drag by remember(shot.uri) { mutableStateOf(0f) }
            coil.compose.AsyncImage(
                model = shot.uri,
                contentDescription = shot.name,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .offset { IntOffset(drag.roundToInt(), 0) }
                    .pointerInput(shot.uri) {
                        detectHorizontalDragGestures(
                            onHorizontalDrag = { _, amount -> drag += amount },
                            onDragEnd = {
                                when {
                                    drag < -120f -> {
                                        gestureHaptic(context, "delete")
                                        onTrash(shot)
                                    }
                                    drag > 120f -> {
                                        gestureHaptic(context, "keep")
                                        onKeep()
                                    }
                                }
                                drag = 0f
                            }
                        )
                    },
                contentScale = androidx.compose.ui.layout.ContentScale.Crop
            )
            Text("${shot.name} · ${formatBytes(shot.bytes)}")
            if (chip == Basket.Bursts && bestShot != null) Text(stringResource(R.string.best_shot, bestShot))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onTrash(shot) }, colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = DangerText)) {
                    Text(stringResource(R.string.trash))
                }
                Button(onClick = onKeep, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent)) {
                    Text(stringResource(R.string.keep))
                }
            }
        }
    }
}

@Composable
private fun pileTitle(id: PileId): String = when (id) {
    PileId.Videos -> stringResource(R.string.pile_videos)
    PileId.Messengers -> stringResource(R.string.pile_messengers)
    PileId.Duplicates -> stringResource(R.string.pile_duplicates)
    PileId.Screenshots -> stringResource(R.string.pile_screenshots)
    PileId.Bursts -> stringResource(R.string.pile_bursts)
    PileId.Blurry -> stringResource(R.string.pile_blurry)
}

@Composable
private fun effortText(seconds: Double): String {
    val rounded = seconds.toInt().coerceAtLeast(1)
    return if (rounded >= 90) stringResource(R.string.effort_minutes, (rounded + 30) / 60)
    else stringResource(R.string.effort_seconds, rounded)
}

@Composable
private fun reasonLine(candidate: Candidate): String {
    val reason = when (candidate.reason) {
        ReasonCode.LargeVideo -> stringResource(R.string.reason_large_video)
        ReasonCode.ChatVideo -> stringResource(R.string.reason_chat_video)
        ReasonCode.Status -> stringResource(R.string.reason_status)
        ReasonCode.Sticker -> stringResource(R.string.reason_sticker)
        ReasonCode.Gif -> stringResource(R.string.reason_gif)
        ReasonCode.Voice -> stringResource(R.string.reason_voice)
        ReasonCode.ChatCopy -> stringResource(R.string.reason_chat_copy)
        ReasonCode.ChatOnly -> stringResource(R.string.reason_chat_only)
        ReasonCode.Duplicate -> stringResource(R.string.reason_duplicate)
        ReasonCode.Burst -> stringResource(R.string.reason_burst)
        ReasonCode.ScreenshotOld -> stringResource(R.string.reason_screenshot_old)
        ReasonCode.ScreenshotRecent -> stringResource(R.string.reason_screenshot_recent)
        ReasonCode.Blurry -> stringResource(R.string.reason_blurry)
    }
    val edgeLabels = ArrayList<String>()
    for (edge in candidate.edges) edgeLabels.add(edgeLabel(edge))
    val edges = edgeLabels.joinToString(", ")
    val keep = candidate.keepName?.let { stringResource(R.string.keep_name, it) }
    return listOfNotNull(reason, keep, edges.ifBlank { null }).joinToString(" · ")
}

@Composable
private fun edgeLabel(edge: KeepEdge): String = when (edge) {
    KeepEdge.Sharper -> stringResource(R.string.edge_sharper)
    KeepEdge.EyesOpen -> stringResource(R.string.edge_eyes)
    KeepEdge.Exposure -> stringResource(R.string.edge_exposure)
    KeepEdge.HasFace -> stringResource(R.string.edge_face)
    KeepEdge.Original -> stringResource(R.string.edge_original)
}

@Composable
private fun basketLabel(basket: Basket): String = when (basket) {
    Basket.Duplicates -> stringResource(R.string.basket_duplicates)
    Basket.Bursts -> stringResource(R.string.basket_bursts)
    Basket.Blurry -> stringResource(R.string.basket_blurry)
    Basket.Screenshots -> stringResource(R.string.basket_screenshots)
    Basket.Videos -> stringResource(R.string.basket_videos)
    Basket.Messengers -> stringResource(R.string.basket_messengers)
}

@Composable
private fun planLabel(plan: PlanOffer): String {
    val name = when (plan.kind) {
        "yearly" -> stringResource(R.string.plan_yearly)
        "lifetime" -> stringResource(R.string.plan_lifetime)
        else -> stringResource(R.string.plan_monthly)
    }
    val badge = when (plan.kind) {
        "yearly" -> stringResource(R.string.plan_best)
        "lifetime" -> stringResource(R.string.plan_once)
        else -> null
    }
    return if (badge == null) name else "$name · $badge"
}

@Composable
private fun planPrice(plan: PlanOffer): String =
    if (plan.trialDays > 0) stringResource(R.string.plan_trial, plan.trialDays, plan.price) else plan.price

private fun planOrder(kind: String): Int = when (kind) {
    "yearly" -> 0
    "lifetime" -> 1
    else -> 2
}
