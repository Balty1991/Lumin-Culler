package com.luminculler.app.cleaner.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.luminculler.app.MainActivity
import com.luminculler.app.R
import com.luminculler.app.cleaner.Access
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.PaywallReason
import com.luminculler.app.cleaner.PlanKind
import com.luminculler.app.cleaner.PlanOffer
import com.luminculler.app.cleaner.Route
import com.luminculler.app.cleaner.core.Kind
import com.luminculler.app.cleaner.core.Media

private const val PRIVACY_URL = "https://balty1991.github.io/Lumin-Culler/privacy-policy.html"

@Composable
fun OnboardingScreen(onAllow: () -> Unit) {
    Backdrop {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp),
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                Modifier.size(72.dp).clip(RoundedCornerShape(22.dp)).background(Lumin.AccentGradient),
                contentAlignment = Alignment.Center
            ) { Icon(LIcons.Layers, null, tint = Color.White, modifier = Modifier.size(36.dp)) }
            Spacer(Modifier.height(28.dp))
            Text(stringResource(R.string.lumin_onb_title), style = MaterialTheme.typography.displaySmall, color = Lumin.Text)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.lumin_onb_sub), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted)
            Spacer(Modifier.height(28.dp))
            Bullet(LIcons.Star, stringResource(R.string.lumin_onb_b1))
            Bullet(LIcons.Layers, stringResource(R.string.lumin_onb_b2))
            Bullet(LIcons.Lock, stringResource(R.string.lumin_onb_b3))
            Spacer(Modifier.height(36.dp))
            BigButton(stringResource(R.string.lumin_allow_photos), onAllow)
            Spacer(Modifier.height(12.dp))
            Text(
                stringResource(R.string.lumin_onb_privacy), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun Bullet(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(Lumin.SurfaceHigh), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Lumin.Accent, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = Lumin.Text)
    }
}

@Composable
fun ReviewScreen(model: LuminModel, items: List<Media>, fromBasket: Kind?) {
    val total = items.sumOf { it.bytes }
    var permanentAsked by remember { mutableStateOf(false) }
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(pluralStringResource(R.plurals.lumin_review_title, items.size, items.size), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
                    Text(stringResource(R.string.lumin_review_sub, bytes(total)), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                }
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(104.dp),
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(items, key = { it.id }) { m -> SelectTile(m, true) { model.unmark(m) } }
            }
            Column(Modifier.padding(16.dp)) {
                Text(
                    stringResource(if (model.trash.isRecoverable) R.string.lumin_review_recoverable else R.string.lumin_review_permanent),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (model.trash.isRecoverable) Lumin.Muted else Lumin.Gold
                )
                Spacer(Modifier.height(12.dp))
                BigButton(
                    stringResource(
                        if (!model.trash.isRecoverable && permanentAsked) R.string.lumin_review_confirm_permanent else R.string.lumin_review_confirm,
                        bytes(total)
                    ),
                    {
                        if (!model.trash.isRecoverable && !permanentAsked) permanentAsked = true
                        else model.confirmDelete(items, fromBasket)
                    },
                    brush = androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color(0xFFFF6B6B), Color(0xFFFF8A5B))),
                    icon = LIcons.Delete,
                    enabled = items.isNotEmpty()
                )
                if (fromBasket == null) {
                    Spacer(Modifier.height(8.dp))
                    GhostButton(stringResource(R.string.lumin_review_keep_all), { model.keepAllMarked() })
                }
            }
        }
    }
}

@Composable
fun DoneScreen(model: LuminModel, bytesFreed: Long, count: Int) {
    Backdrop {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(Modifier.size(112.dp).clip(CircleShape).background(Color(0x225EE6B0)), contentAlignment = Alignment.Center) {
                Icon(LIcons.Check, null, tint = Lumin.Keep, modifier = Modifier.size(56.dp))
            }
            Spacer(Modifier.height(24.dp))
            if (count > 0) {
                Text(stringResource(R.string.lumin_done_freed, bytes(bytesFreed)), style = MaterialTheme.typography.headlineMedium, color = Lumin.Text, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Text(pluralStringResource(R.plurals.lumin_done_count, count, count), style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted, textAlign = TextAlign.Center)
            } else {
                Text(stringResource(R.string.lumin_done_kept), style = MaterialTheme.typography.headlineMedium, color = Lumin.Text, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat(bytes(model.freedBytes), stringResource(R.string.lumin_stat_total))
                Stat(pluralStringResource(R.plurals.lumin_streak_days, model.streak, model.streak), stringResource(R.string.lumin_stat_streak), Lumin.Gold)
            }
            Spacer(Modifier.height(28.dp))
            if (model.freedBytes > 0) {
                GhostButton(stringResource(R.string.lumin_share), { model.shareFreed() }, icon = LIcons.Share)
                Spacer(Modifier.height(10.dp))
            }
            BigButton(stringResource(R.string.lumin_back_home), { model.route = Route.Today })
            if (model.locked && model.reclaimableBytes > 0) {
                Spacer(Modifier.height(20.dp))
                Text(
                    stringResource(R.string.lumin_done_upsell, bytes(model.reclaimableBytes)),
                    style = MaterialTheme.typography.bodyMedium, color = Lumin.Gold, textAlign = TextAlign.Center,
                    modifier = Modifier.clickable { model.openPaywall() }.padding(8.dp)
                )
            }
        }
    }
}

@Composable
fun PaywallScreen(model: LuminModel, reason: PaywallReason) {
    LaunchedEffect(Unit) { if (!model.plansLoaded) model.loadPlans() }
    val plans = model.plans
    var choice by remember(plans) { mutableStateOf(plans.firstOrNull { it.kind == PlanKind.Yearly } ?: plans.firstOrNull()) }
    val context = LocalContext.current
    Backdrop {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(20.dp)
        ) {
            Row { Spacer(Modifier.weight(1f)); RoundIcon(LIcons.Close, stringResource(R.string.lumin_close), { model.back() }) }
            Spacer(Modifier.height(8.dp))
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(Lumin.PremiumGradient), contentAlignment = Alignment.Center) {
                Icon(LIcons.Star, null, tint = Color(0xFF2A1400), modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(18.dp))
            Text(stringResource(R.string.lumin_premium), style = MaterialTheme.typography.displaySmall, color = Lumin.Text)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(
                    when (reason) {
                        PaywallReason.ExtraStack -> R.string.lumin_pay_reason_stack
                        PaywallReason.BulkClean -> R.string.lumin_pay_reason_bulk
                        PaywallReason.Browse -> R.string.lumin_pay_reason_browse
                        PaywallReason.Magic -> R.string.lumin_pay_reason_magic
                    },
                    bytes(model.reclaimableBytes)
                ),
                style = MaterialTheme.typography.bodyLarge, color = Lumin.Muted
            )
            Spacer(Modifier.height(20.dp))
            Bullet(LIcons.Sparkle, stringResource(R.string.lumin_pay_b_ai))
            Bullet(LIcons.Play, stringResource(R.string.lumin_pay_b_alive))
            Bullet(LIcons.Movie, stringResource(R.string.lumin_pay_b_films))
            Bullet(LIcons.Delete, stringResource(R.string.lumin_pay_b1))
            Bullet(LIcons.Lock, stringResource(R.string.lumin_pay_b4))
            Spacer(Modifier.height(20.dp))

            if (!model.plansLoaded) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lumin.Accent) }
            } else if (plans.isEmpty()) {
                Card(Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.lumin_pay_none), Modifier.padding(18.dp), color = Lumin.Muted)
                }
            } else {
                val monthly = plans.firstOrNull { it.kind == PlanKind.Monthly }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (plan in plans) PlanCard(plan, plan == choice, monthly) { choice = plan }
                }
                Spacer(Modifier.height(18.dp))
                val c = choice
                BigButton(
                    if (c != null && c.trialDays > 0) pluralStringResource(R.plurals.lumin_pay_trial_cta, c.trialDays, c.trialDays)
                    else stringResource(R.string.lumin_pay_cta),
                    { c?.let { model.buy(it) } },
                    brush = Lumin.PremiumGradient,
                    textColor = Color(0xFF2A1400),
                    enabled = c != null
                )
                Spacer(Modifier.height(10.dp))
                if (c != null) {
                    Text(
                        when {
                            c.kind == PlanKind.Lifetime -> stringResource(R.string.lumin_pay_terms_lifetime, c.price)
                            c.trialDays > 0 -> pluralStringResource(R.plurals.lumin_pay_terms_trial, c.trialDays, c.trialDays, c.price, periodWord(c))
                            else -> stringResource(R.string.lumin_pay_terms, c.price, periodWord(c))
                        },
                        style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                Text(stringResource(R.string.lumin_restore), color = Lumin.Accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable { model.restore() }.padding(8.dp))
                Text(stringResource(R.string.lumin_privacy), color = Lumin.Accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL)))
                }.padding(8.dp))
            }
        }
    }
}

@Composable
private fun periodWord(plan: PlanOffer): String =
    stringResource(if (plan.kind == PlanKind.Yearly) R.string.lumin_per_year else R.string.lumin_per_month)

@Composable
private fun PlanCard(plan: PlanOffer, selected: Boolean, monthly: PlanOffer?, onClick: () -> Unit) {
    val title = stringResource(
        when (plan.kind) {
            PlanKind.Monthly -> R.string.lumin_plan_monthly
            PlanKind.Yearly -> R.string.lumin_plan_yearly
            PlanKind.Lifetime -> R.string.lumin_plan_lifetime
        }
    )
    val savings = if (plan.kind == PlanKind.Yearly && monthly != null && monthly.priceMicros > 0) {
        (100 - plan.priceMicros * 100 / (monthly.priceMicros * 12)).toInt()
    } else 0
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Color(0x1FFFC857) else Lumin.Surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) Lumin.Gold else Lumin.Line, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
                if (savings >= 5) {
                    Spacer(Modifier.width(8.dp))
                    Pill(stringResource(R.string.lumin_plan_save, savings), Lumin.Gold, Color(0xFF2A1400))
                }
            }
            if (plan.trialDays > 0) {
                Text(pluralStringResource(R.plurals.lumin_plan_trial, plan.trialDays, plan.trialDays), style = MaterialTheme.typography.bodyMedium, color = Lumin.Keep)
            } else if (plan.kind == PlanKind.Lifetime) {
                Text(stringResource(R.string.lumin_plan_once), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
            }
        }
        Text(plan.price, style = MaterialTheme.typography.titleMedium, color = Lumin.Text, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SettingsScreen(model: LuminModel) {
    val context = LocalContext.current
    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.lumin_settings), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
            }
            Spacer(Modifier.height(20.dp))

            if (model.premium) {
                SettingRow(stringResource(R.string.lumin_premium_active), stringResource(R.string.lumin_manage_sub)) {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/account/subscriptions?package=${context.packageName}"))
                    )
                }
            } else {
                PremiumBanner { model.openPaywall() }
            }
            Spacer(Modifier.height(12.dp))

            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lumin.Surface).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.lumin_reminder), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
                    Text(stringResource(R.string.lumin_reminder_hint), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                }
                Switch(
                    checked = model.dailyReminder,
                    onCheckedChange = { model.setReminder(it) },
                    colors = SwitchDefaults.colors(checkedTrackColor = Lumin.Keep)
                )
            }
            Spacer(Modifier.height(12.dp))

            if (model.access == Access.Partial) {
                SettingRow(stringResource(R.string.lumin_full_access), stringResource(R.string.lumin_partial_access)) {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
                }
                Spacer(Modifier.height(12.dp))
            }
            SettingRow(stringResource(R.string.lumin_pro_tools), stringResource(R.string.lumin_pro_tools_hint)) {
                context.startActivity(Intent(context, MainActivity::class.java))
            }
            Spacer(Modifier.height(12.dp))
            SettingRow(stringResource(R.string.lumin_privacy), stringResource(R.string.lumin_onb_privacy)) {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL)))
            }
            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.lumin_stats_line, bytes(model.freedBytes), model.freedCount),
                style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted
            )
        }
    }
}

@Composable
private fun SettingRow(title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lumin.Surface).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
        }
        Icon(LIcons.Chevron, null, tint = Lumin.Muted)
    }
}
