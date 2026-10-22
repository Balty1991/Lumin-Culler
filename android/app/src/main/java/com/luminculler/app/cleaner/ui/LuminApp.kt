package com.luminculler.app.cleaner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import com.luminculler.app.R
import androidx.compose.ui.unit.dp
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.Route
import kotlinx.coroutines.delay

@Composable
fun LuminApp(model: LuminModel, onAllowPhotos: () -> Unit) {
    LuminTheme {
        BackHandler(enabled = model.route != Route.Moments && model.route != Route.Onboarding) { model.back() }
        Box(Modifier.fillMaxSize()) {
            AnimatedContent(
                targetState = model.route,
                contentKey = { it::class },
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
                label = "route"
            ) { route ->
                when (route) {
                    Route.Onboarding -> OnboardingScreen(onAllowPhotos)
                    Route.Moments -> MomentsScreen(model)
                    is Route.Story -> StoryScreen(model, route.moment)
                    is Route.Movie -> MovieScreen(model, route.moment)
                    Route.Today -> TodayScreen(model)
                    Route.Deck -> DeckScreen(model)
                    is Route.BasketView -> BasketScreen(model, route.kind)
                    is Route.Review -> ReviewScreen(model, route.items, route.fromBasket)
                    is Route.Done -> DoneScreen(model, route.bytes, route.count)
                    is Route.Paywall -> PaywallScreen(model, route.reason)
                    Route.Settings -> SettingsScreen(model)
                    Route.Grow -> GrowScreen(model)
                }
            }
            val r = model.route
            if (r == Route.Moments || r == Route.Today || r == Route.Settings) {
                BottomBar(model, Modifier.align(Alignment.BottomCenter))
            }
            val movieMessage = model.movie.message
            LaunchedEffect(movieMessage) {
                if (movieMessage != null) {
                    model.message = movieMessage
                    model.movie.message = null
                }
            }
            val growMessage = model.grow.message
            LaunchedEffect(growMessage) {
                if (growMessage != null) {
                    model.message = growMessage
                    model.grow.message = null
                }
            }
            val message = model.message
            if (message != null) {
                LaunchedEffect(message) {
                    delay(3200)
                    model.message = null
                }
                Snackbar(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp)) { Text(message) }
            }
        }
    }
}

/** Filele de jos: Momente, Curăță, Setări. */
@Composable
private fun BottomBar(model: LuminModel, modifier: Modifier) {
    Row(
        modifier
            .navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 12.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(Color(0xF2181822))
            .padding(6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Tab(LIcons.Sparkle, stringResource(R.string.lumin_tab_moments), model.route == Route.Moments) { model.route = Route.Moments }
        Tab(LIcons.Broom, stringResource(R.string.lumin_tab_clean), model.route == Route.Today) { model.route = Route.Today }
        Tab(LIcons.Tune, stringResource(R.string.lumin_settings), model.route == Route.Settings) { model.route = Route.Settings }
    }
}

@Composable
private fun Tab(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(22.dp))
            .background(if (selected) Color(0x33A78BFA) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, label, tint = if (selected) Lumin.Text else Lumin.Muted, modifier = Modifier.size(20.dp))
        if (selected) {
            Spacer(Modifier.size(8.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, color = Lumin.Text)
        }
    }
}
