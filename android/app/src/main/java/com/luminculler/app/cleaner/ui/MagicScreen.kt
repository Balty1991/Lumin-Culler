package com.luminculler.app.cleaner.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Media

/**
 * „Magie AI” pe o poză: efectele de pe telefon se aplică pe loc; cele care
 * cer server sunt arătate cinstit ca „în curând”.
 */
@Composable
fun MagicScreen(model: LuminModel, media: Media) {
    val magic = model.magic
    LaunchedEffect(media.id) { magic.open(media) }
    var comparing by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(onPress = {
                        comparing = true
                        tryAwaitRelease()
                        comparing = false
                    })
                },
            contentAlignment = Alignment.Center
        ) {
            val bmp = if (comparing) magic.before else magic.shown
            if (bmp != null) {
                Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
            if (magic.working) CircularProgressIndicator(color = Lumin.Accent)
        }

        Row(Modifier.statusBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() }, background = Color(0x55000000), tint = Color.White)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.lumin_magic_title), style = MaterialTheme.typography.titleLarge, color = Color.White)
                Text(stringResource(R.string.lumin_magic_hold), style = MaterialTheme.typography.labelMedium, color = Color(0xCCFFFFFF))
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Color(0xE6101018))
                .navigationBarsPadding()
                .padding(vertical = 16.dp)
        ) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Effect(LIcons.Bolt, stringResource(R.string.lumin_magic_enhance), magic.enhance, null) { magic.toggleEnhance() }
                Effect(LIcons.Blur, stringResource(R.string.lumin_magic_portrait), magic.portrait, null) { magic.togglePortrait() }
                Effect(LIcons.Play, stringResource(R.string.lumin_magic_alive), false, stringResource(R.string.lumin_magic_soon)) {
                    model.message = model.context.getString(R.string.lumin_magic_server)
                }
                Effect(LIcons.Sparkle, stringResource(R.string.lumin_magic_styles), false, stringResource(R.string.lumin_magic_soon)) {
                    model.message = model.context.getString(R.string.lumin_magic_server)
                }
            }
            Spacer(Modifier.height(14.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                BigButton(stringResource(R.string.lumin_magic_save), { magic.save() }, enabled = !magic.working && (magic.enhance || magic.portrait))
            }
        }
    }
}

@Composable
private fun Effect(icon: ImageVector, label: String, on: Boolean, badge: String?, onClick: () -> Unit) {
    Column(
        Modifier
            .width(92.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (on) Color(0x33A78BFA) else Lumin.Surface)
            .border(if (on) 2.dp else 1.dp, if (on) Lumin.Accent else Lumin.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(if (on) Lumin.AccentGradient else androidx.compose.ui.graphics.Brush.linearGradient(listOf(Lumin.SurfaceHigh, Lumin.SurfaceHigh))), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lumin.Text, maxLines = 2)
        if (badge != null) {
            Spacer(Modifier.height(4.dp))
            Text(badge, style = MaterialTheme.typography.labelMedium, color = Lumin.Gold)
        }
    }
}
