package com.luminculler.app.cleaner.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.magic.AiException
import com.luminculler.app.cleaner.magic.AiJob
import kotlinx.coroutines.launch

/** Copiază textul ales, ca omul să-l lipească în Instagram, WhatsApp sau unde trimite. */
fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("Lumin", text))
}

fun aiErrorMessage(context: Context, e: Throwable): String = context.getString(
    when ((e as? AiException)?.code) {
        "daily_limit" -> R.string.lumin_ai_err_daily
        "budget" -> R.string.lumin_ai_err_busy
        else -> R.string.lumin_ai_err_generic
    }
)

/**
 * Lista de texte scrise de AI: atingi unul și se copiază. [texts] null =
 * încă se scriu.
 */
@Composable
fun AiTextsDialog(title: String, texts: List<String>?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Lumin.Surface,
        title = { Text(title, color = Lumin.Text) },
        text = {
            if (texts == null) {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Lumin.Accent)
                    Text(stringResource(R.string.lumin_ai_writing), color = Lumin.Muted, modifier = Modifier.padding(top = 12.dp))
                }
            } else {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.lumin_ai_tap_copy), color = Lumin.Muted, style = MaterialTheme.typography.bodySmall)
                    for (t in texts) {
                        Text(
                            t, color = Lumin.Text, style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lumin.SurfaceHigh)
                                .clickable { onPick(t) }.padding(14.dp)
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.lumin_close), color = Lumin.Accent) } }
    )
}

/** Butonul „Text pentru postare”: apare doar când serverul AI poate scrie texte. */
@Composable
fun CaptionButton(model: LuminModel, photos: List<Media>, modifier: Modifier = Modifier) {
    if (AiJob.Caption !in model.aiKinds || photos.isEmpty()) return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var texts by remember { mutableStateOf<List<String>?>(null) }
    GhostButton(stringResource(R.string.lumin_caption_button), {
        open = true
        if (texts == null) scope.launch {
            try {
                texts = model.aiTexts(AiJob.Caption, photos).ifEmpty { throw AiException("empty") }
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                open = false
                model.message = aiErrorMessage(context, e)
            }
        }
    }, modifier, icon = LIcons.Sparkle)
    if (open) {
        AiTextsDialog(stringResource(R.string.lumin_caption_title), texts, onDismiss = { open = false }) { t ->
            copyText(context, t)
            open = false
            model.message = context.getString(R.string.lumin_copied)
        }
    }
}
