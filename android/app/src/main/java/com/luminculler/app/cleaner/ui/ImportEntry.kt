package com.luminculler.app.cleaner.ui

import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel

/**
 * Câte poze lasă selectorul de sistem dintr-o dată (de obicei 100). Peste
 * limita lui, cererea ar fi respinsă.
 */
private fun pickLimit(): Int = try {
    if (Build.VERSION.SDK_INT >= 33) MediaStore.getPickImagesMaxLimit().coerceIn(2, 100) else 100
} catch (_: Throwable) {
    100
}

/**
 * „Adaugă din Google Foto”: deschide selectorul de poze al telefonului, care
 * arată și pozele din cloud-ul Google Foto. Pozele alese intră în amintiri,
 * oameni și jocuri.
 */
@Composable
fun ImportEntry(model: LuminModel, modifier: Modifier = Modifier) {
    val limit = remember { pickLimit() }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(limit)) { uris ->
        model.importPhotos(uris)
    }
    val busy = model.importing
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Lumin.Surface)
            .border(1.dp, Lumin.Line, RoundedCornerShape(24.dp))
            .clickable(enabled = busy == null) {
                pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (busy != null) {
            CircularProgressIndicator(color = Lumin.Accent, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
        } else {
            Text("☁️", style = MaterialTheme.typography.headlineSmall)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.lumin_import_title), style = MaterialTheme.typography.titleMedium, color = Lumin.Text)
            Text(
                when {
                    busy != null -> stringResource(R.string.lumin_import_progress, busy.first, busy.second)
                    model.importedPhotos.isNotEmpty() -> pluralStringResource(R.plurals.lumin_import_count, model.importedPhotos.size, model.importedPhotos.size)
                    else -> stringResource(R.string.lumin_import_hint)
                },
                style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted
            )
        }
        if (busy == null) androidx.compose.material3.Icon(LIcons.Chevron, null, tint = Lumin.Muted)
    }
}
