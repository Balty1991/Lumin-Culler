package com.luminculler.app.cleaner.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.VideoFrameDecoder
import coil.request.ImageRequest
import com.luminculler.app.R
import com.luminculler.app.cleaner.core.Bytes
import com.luminculler.app.cleaner.core.Kind
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Reason
import com.luminculler.app.cleaner.core.StackItem
import java.util.Locale

object Images {
    @Volatile private var loader: ImageLoader? = null

    /** Un singur ImageLoader, care știe și cadre din video. */
    fun loader(context: Context): ImageLoader = loader ?: synchronized(this) {
        loader ?: ImageLoader.Builder(context.applicationContext)
            .components { add(VideoFrameDecoder.Factory()) }
            .crossfade(true)
            .build()
            .also { loader = it }
    }
}

@Composable
fun Thumb(media: Media, modifier: Modifier = Modifier, size: Int = 320, scale: ContentScale = ContentScale.Crop) {
    val context = LocalContext.current
    AsyncImage(
        model = ImageRequest.Builder(context).data(media.uri).size(size).build(),
        imageLoader = Images.loader(context),
        contentDescription = media.name,
        contentScale = scale,
        modifier = modifier.background(Lumin.SurfaceHigh)
    )
}

fun bytes(value: Long): String = Bytes.format(value, Locale.getDefault())

@Composable
fun kindTitle(kind: Kind): String = stringResource(
    when (kind) {
        Kind.Duplicates -> R.string.lumin_kind_duplicates
        Kind.Similar -> R.string.lumin_kind_similar
        Kind.Blurry -> R.string.lumin_kind_blurry
        Kind.Screenshots -> R.string.lumin_kind_screenshots
        Kind.Chats -> R.string.lumin_kind_chats
        Kind.Videos -> R.string.lumin_kind_videos
    }
)

@Composable
fun kindHint(kind: Kind): String = stringResource(
    when (kind) {
        Kind.Duplicates -> R.string.lumin_kind_duplicates_hint
        Kind.Similar -> R.string.lumin_kind_similar_hint
        Kind.Blurry -> R.string.lumin_kind_blurry_hint
        Kind.Screenshots -> R.string.lumin_kind_screenshots_hint
        Kind.Chats -> R.string.lumin_kind_chats_hint
        Kind.Videos -> R.string.lumin_kind_videos_hint
    }
)

fun kindIcon(kind: Kind): ImageVector = when (kind) {
    Kind.Duplicates -> LIcons.Copy
    Kind.Similar -> LIcons.Layers
    Kind.Blurry -> LIcons.Blur
    Kind.Screenshots -> LIcons.Phone
    Kind.Chats -> LIcons.Chat
    Kind.Videos -> LIcons.Video
}

fun kindColor(kind: Kind): Color = when (kind) {
    Kind.Duplicates -> Color(0xFF60A5FA)
    Kind.Similar -> Color(0xFFA78BFA)
    Kind.Blurry -> Color(0xFFF472B6)
    Kind.Screenshots -> Color(0xFF34D399)
    Kind.Chats -> Color(0xFF4ADE80)
    Kind.Videos -> Color(0xFFFBBF24)
}

/** Eticheta de pe cardul din teanc: de ce e poza aici. */
@Composable
fun reasonLabel(item: StackItem): String = when (item.reason) {
    Reason.Memory -> androidx.compose.ui.res.pluralStringResource(R.plurals.lumin_years_ago, item.yearsAgo, item.yearsAgo)
    Reason.Suggested -> item.kind?.let { kindTitle(it) } ?: stringResource(R.string.lumin_reason_suggested)
    Reason.Recent -> stringResource(R.string.lumin_reason_recent)
    Reason.Older -> stringResource(R.string.lumin_reason_older)
}

@Composable
fun Pill(text: String, color: Color = Lumin.SurfaceHigh, textColor: Color = Lumin.Text, icon: ImageVector? = null) {
    Row(
        Modifier.clip(CircleShape).background(color).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (icon != null) Icon(icon, null, tint = textColor, modifier = Modifier.size(14.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = textColor)
    }
}

@Composable
fun BigButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    brush: Brush = Lumin.AccentGradient,
    textColor: Color = Color.White,
    icon: ImageVector? = null,
    enabled: Boolean = true
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (enabled) brush else Brush.linearGradient(listOf(Lumin.SurfaceHigh, Lumin.SurfaceHigh)))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Icon(icon, null, tint = textColor, modifier = Modifier.size(20.dp))
            Box(Modifier.size(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) textColor else Lumin.Muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(18.dp))
            .border(1.dp, Lumin.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Icon(icon, null, tint = Lumin.Text, modifier = Modifier.size(18.dp))
            Box(Modifier.size(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = Lumin.Text)
    }
}

@Composable
fun RoundIcon(icon: ImageVector, description: String, onClick: () -> Unit, size: Dp = 44.dp, tint: Color = Lumin.Text, background: Color = Lumin.SurfaceHigh, enabled: Boolean = true) {
    Box(
        Modifier.size(size).clip(CircleShape).background(background).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, description, tint = if (enabled) tint else Lumin.Muted.copy(alpha = 0.4f), modifier = Modifier.size(size * 0.48f))
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(24.dp))
            .background(Lumin.Surface)
            .border(1.dp, Lumin.Line, RoundedCornerShape(24.dp))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
    ) { content() }
}

@Composable
fun RowScope.Stat(value: String, label: String, color: Color = Lumin.Text) {
    Column(
        Modifier.weight(1f).clip(RoundedCornerShape(18.dp)).background(Lumin.Surface).padding(vertical = 14.dp, horizontal = 12.dp)
    ) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.Bold, maxLines = 1)
        Box(Modifier.height(2.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lumin.Muted, maxLines = 1)
    }
}
