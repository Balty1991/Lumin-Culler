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
import androidx.compose.ui.unit.dp
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.Route
import kotlinx.coroutines.delay

@Composable
fun LuminApp(model: LuminModel, onAllowPhotos: () -> Unit) {
    LuminTheme {
        BackHandler(enabled = model.route != Route.Today && model.route != Route.Onboarding) { model.back() }
        Box(Modifier.fillMaxSize()) {
            AnimatedContent(
                targetState = model.route,
                contentKey = { it::class },
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
                label = "route"
            ) { route ->
                when (route) {
                    Route.Onboarding -> OnboardingScreen(onAllowPhotos)
                    Route.Today -> TodayScreen(model)
                    Route.Deck -> DeckScreen(model)
                    is Route.BasketView -> BasketScreen(model, route.kind)
                    is Route.Review -> ReviewScreen(model, route.items, route.fromBasket)
                    is Route.Done -> DoneScreen(model, route.bytes, route.count)
                    is Route.Paywall -> PaywallScreen(model, route.reason)
                    Route.Settings -> SettingsScreen(model)
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
