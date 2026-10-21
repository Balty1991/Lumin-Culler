package com.luminculler.app.cleaner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Paleta Lumin: noapte caldă, verde-mentă pentru „păstrează”, coral pentru „șterge”. */
object Lumin {
    val Bg = Color(0xFF0B0B11)
    val Surface = Color(0xFF15151E)
    val SurfaceHigh = Color(0xFF1E1E2A)
    val Line = Color(0xFF2A2A38)
    val Text = Color(0xFFF4F4F7)
    val Muted = Color(0xFF9B9BAA)
    val Keep = Color(0xFF5EE6B0)
    val Delete = Color(0xFFFF6B6B)
    val Accent = Color(0xFFA78BFA)
    val Gold = Color(0xFFFFC857)
    val AccentGradient = Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF3B82F6)))
    val PremiumGradient = Brush.linearGradient(listOf(Color(0xFFFFC857), Color(0xFFFF8A5B)))
}

private val typography = Typography(
    displaySmall = TextStyle(fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 19.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.3.sp)
)

@Composable
fun LuminTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = Lumin.Bg,
            surface = Lumin.Surface,
            surfaceVariant = Lumin.SurfaceHigh,
            primary = Lumin.Keep,
            onPrimary = Color(0xFF04261A),
            secondary = Lumin.Accent,
            error = Lumin.Delete,
            onBackground = Lumin.Text,
            onSurface = Lumin.Text,
            onSurfaceVariant = Lumin.Muted,
            outline = Lumin.Line
        ),
        typography = typography,
        content = content
    )
}

/** Fundalul tuturor ecranelor: negru cu o lumină violetă sus. */
@Composable
fun Backdrop(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Lumin.Bg)
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0x3A7C5CFF), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(200f, -100f),
                    radius = 1400f
                )
            ),
        content = content
    )
}
