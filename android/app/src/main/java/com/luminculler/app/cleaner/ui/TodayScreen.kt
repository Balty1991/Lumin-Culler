package com.luminculler.app.cleaner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.Access
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Kind
import com.luminculler.app.cleaner.core.Reason

@Composable
fun TodayScreen(model: LuminModel) {
    Backdrop {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Lumin", style = MaterialTheme.typography.headlineMedium, color = Lumin.Text, modifier = Modifier.weight(1f))
                if (model.streak > 0) {
                    Pill(pluralStringResource(R.plurals.lumin_streak_days, model.streak, model.streak), Color(0x33FFC857), Lumin.Gold, LIcons.Bolt)
                    Spacer(Modifier.width(8.dp))
                }
                RoundIcon(LIcons.Tune, stringResource(R.string.lumin_settings), { model.route = com.luminculler.app.cleaner.Route.Settings })
            }
            Spacer(Modifier.height(20.dp))

            StackHero(model)
            Spacer(Modifier.height(16.dp))
            GrowEntry { model.openGrow() }
            Spacer(Modifier.height(16.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat(bytes(model.freedBytes), stringResource(R.string.lumin_stat_freed), Lumin.Keep)
                Stat(bytes(model.reclaimableBytes), stringResource(R.string.lumin_stat_reclaimable))
            }

            if (model.scan.running) {
                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.lumin_scanning, model.scan.done, model.scan.total),
                    style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted
                )
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { model.scan.done.toFloat() / model.scan.total.coerceAtLeast(1) },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                    color = Lumin.Accent,
                    trackColor = Lumin.SurfaceHigh
                )
            }

            if (model.access == Access.Partial) {
                Spacer(Modifier.height(16.dp))
                Card(Modifier.fillMaxWidth(), onClick = { model.route = com.luminculler.app.cleaner.Route.Settings }) {
                    Text(stringResource(R.string.lumin_partial_access), Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                }
            }

            Spacer(Modifier.height(28.dp))
            Text(stringResource(R.string.lumin_quick_clean), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.lumin_quick_clean_hint), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
            Spacer(Modifier.height(12.dp))
            val nonEmpty = model.baskets.values.filter { it.count > 0 }
            if (nonEmpty.isEmpty() && !model.loading && !model.scan.running) {
                Card(Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.lumin_all_clean), Modifier.padding(20.dp), color = Lumin.Muted)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (basket in nonEmpty) BasketRow(basket.kind, basket.count, basket.bytes, model.locked && model.store.freeBulkUsed) { model.openBasket(basket.kind) }
            }

            if (model.locked) {
                Spacer(Modifier.height(20.dp))
                PremiumBanner { model.openPaywall() }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun StackHero(model: LuminModel) {
    val stack = model.stack
    val left = (stack.size - model.position).coerceAtLeast(0)
    val memory = stack.drop(model.position).firstOrNull { it.reason == Reason.Memory }
    Card(Modifier.fillMaxWidth(), onClick = if (left > 0) ({ model.openDeck() }) else null) {
        Column(Modifier.padding(20.dp)) {
            Box(Modifier.fillMaxWidth().height(190.dp), contentAlignment = Alignment.Center) {
                val preview = stack.drop(model.position).take(3)
                if (preview.isEmpty()) {
                    Box(
                        Modifier.size(120.dp).clip(CircleShape).background(Color(0x225EE6B0)),
                        contentAlignment = Alignment.Center
                    ) { Icon(LIcons.Check, null, tint = Lumin.Keep, modifier = Modifier.size(56.dp)) }
                } else {
                    preview.reversed().forEachIndexed { i, item ->
                        val depth = preview.size - 1 - i
                        Thumb(
                            item.media,
                            Modifier
                                .size(width = 132.dp, height = 172.dp)
                                .offset(x = (depth * 26 - 26).dp)
                                .rotate(depth * 7f - 7f)
                                .clip(RoundedCornerShape(18.dp))
                                .border(2.dp, Lumin.Bg, RoundedCornerShape(18.dp))
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            when {
                model.loading && stack.isEmpty() -> {
                    Text(stringResource(R.string.lumin_preparing), style = MaterialTheme.typography.headlineSmall, color = Lumin.Text)
                }
                left > 0 -> {
                    Text(stringResource(R.string.lumin_today_stack), style = MaterialTheme.typography.headlineSmall, color = Lumin.Text)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        pluralStringResource(R.plurals.lumin_stack_left, left, left),
                        style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted
                    )
                    if (memory != null) {
                        Spacer(Modifier.height(10.dp))
                        Pill(pluralStringResource(R.plurals.lumin_memory_inside, memory.yearsAgo, memory.yearsAgo), Color(0x33A78BFA), Lumin.Accent, LIcons.Star)
                    }
                    Spacer(Modifier.height(18.dp))
                    BigButton(
                        stringResource(if (model.position == 0) R.string.lumin_start else R.string.lumin_continue),
                        { model.openDeck() }
                    )
                }
                model.marked.isNotEmpty() -> {
                    // Teancul e parcurs, dar ștergerea n-a fost confirmată (ex. omul a ieșit din ecranul de confirmare).
                    Text(stringResource(R.string.lumin_today_stack), style = MaterialTheme.typography.headlineSmall, color = Lumin.Text)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        pluralStringResource(R.plurals.lumin_marked, model.marked.size, model.marked.size, bytes(model.marked.sumOf { it.bytes })),
                        style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted
                    )
                    Spacer(Modifier.height(18.dp))
                    BigButton(stringResource(R.string.lumin_finish), { model.finishStack() })
                }
                else -> {
                    Text(stringResource(R.string.lumin_done_today), style = MaterialTheme.typography.headlineSmall, color = Lumin.Text)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.lumin_done_today_hint), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted)
                    Spacer(Modifier.height(18.dp))
                    GhostButton(
                        stringResource(R.string.lumin_another_stack),
                        { model.anotherStack() },
                        icon = if (model.canStartAnotherStack) null else LIcons.Lock
                    )
                }
            }
        }
    }
}

@Composable
private fun BasketRow(kind: Kind, count: Int, size: Long, locked: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Lumin.Surface)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val color = kindColor(kind)
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(color.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
            Icon(kindIcon(kind), null, tint = color, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(kindTitle(kind), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
            Text(
                pluralStringResource(R.plurals.lumin_items, count, count) + " · " + bytes(size),
                style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted
            )
        }
        if (locked) Icon(LIcons.Lock, null, tint = Lumin.Gold, modifier = Modifier.size(18.dp).padding(end = 4.dp))
        Icon(LIcons.Chevron, null, tint = Lumin.Muted)
    }
}

@Composable
fun PremiumBanner(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(Lumin.PremiumGradient)
            .clickable(onClick = onClick)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.lumin_premium), style = MaterialTheme.typography.titleMedium, color = Color(0xFF2A1400), fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.lumin_premium_banner), style = MaterialTheme.typography.bodyMedium, color = Color(0xCC2A1400))
        }
        Icon(LIcons.Chevron, null, tint = Color(0xFF2A1400))
    }
}
