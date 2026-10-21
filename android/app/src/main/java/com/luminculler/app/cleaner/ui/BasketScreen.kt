package com.luminculler.app.cleaner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.luminculler.app.R
import com.luminculler.app.cleaner.LuminModel
import com.luminculler.app.cleaner.core.Kind
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Plan

/**
 * Un coș: tot ce propune AI-ul, deja bifat. La duplicate și rafale, poza care
 * rămâne stă prima în grup, marcată „Rămâne”, ca omul să vadă ce păstrează.
 */
@Composable
fun BasketScreen(model: LuminModel, kind: Kind) {
    val basket = model.baskets[kind]
    val groups = basket?.groups.orEmpty()
    val all = remember(basket) { groups.flatMap { it.extras } }
    var selected by remember(basket) { mutableStateOf(all.map { it.id }.toSet()) }
    val chosen = all.filter { it.id in selected }
    val canClean = Plan.canBulkClean(!model.locked, model.store.freeBulkUsed)

    Backdrop {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(LIcons.Back, stringResource(R.string.lumin_back), { model.back() })
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(kindTitle(kind), style = MaterialTheme.typography.titleLarge, color = Lumin.Text)
                    Text(
                        pluralStringResource(R.plurals.lumin_items, all.size, all.size) + " · " + bytes(all.sumOf { it.bytes }),
                        style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted
                    )
                }
                Text(
                    stringResource(if (selected.size == all.size) R.string.lumin_select_none else R.string.lumin_select_all),
                    color = Lumin.Accent, style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.clip(CircleShape).clickable {
                        selected = if (selected.size == all.size) emptySet() else all.map { it.id }.toSet()
                    }.padding(10.dp)
                )
            }
            Text(kindHint(kind), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted, modifier = Modifier.padding(horizontal = 20.dp))
            Spacer(Modifier.height(12.dp))

            LazyVerticalGrid(
                columns = GridCells.Adaptive(108.dp),
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                for ((index, group) in groups.withIndex()) {
                    val keeper = group.keeper
                    if (keeper != null) {
                        if (index > 0) item(span = { GridItemSpan(maxLineSpan) }) { Spacer(Modifier.height(10.dp)) }
                        item(key = "k${keeper.id}") { KeeperTile(keeper) }
                    }
                    items(group.extras, key = { it.id }) { m ->
                        SelectTile(m, m.id in selected) { selected = if (m.id in selected) selected - m.id else selected + m.id }
                    }
                }
            }

            Column(Modifier.padding(16.dp)) {
                if (!canClean) {
                    Text(stringResource(R.string.lumin_bulk_locked), style = MaterialTheme.typography.bodyMedium, color = Lumin.Muted)
                    Spacer(Modifier.height(10.dp))
                } else if (model.locked) {
                    Text(stringResource(R.string.lumin_bulk_first_free), style = MaterialTheme.typography.bodyMedium, color = Lumin.Gold)
                    Spacer(Modifier.height(10.dp))
                }
                BigButton(
                    if (chosen.isEmpty()) stringResource(R.string.lumin_select_some)
                    else pluralStringResource(R.plurals.lumin_delete_n, chosen.size, chosen.size, bytes(chosen.sumOf { it.bytes })),
                    { model.cleanFromBasket(kind, chosen, all.filter { it.id !in selected }) },
                    brush = if (canClean) androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color(0xFFFF6B6B), Color(0xFFFF8A5B))) else Lumin.PremiumGradient,
                    icon = if (canClean) LIcons.Delete else LIcons.Lock,
                    textColor = if (canClean) Color.White else Color(0xFF2A1400),
                    enabled = chosen.isNotEmpty()
                )
            }
        }
    }
}

@Composable
private fun KeeperTile(media: Media) {
    Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(14.dp)).border(2.dp, Lumin.Keep, RoundedCornerShape(14.dp))) {
        Thumb(media, Modifier.fillMaxSize())
        Box(
            Modifier.align(Alignment.BottomStart).padding(6.dp).clip(CircleShape).background(Lumin.Keep).padding(horizontal = 8.dp, vertical = 3.dp)
        ) { Text(stringResource(R.string.lumin_stays), color = Color(0xFF04261A), style = MaterialTheme.typography.labelMedium) }
    }
}

@Composable
fun SelectTile(media: Media, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick)) {
        Thumb(media, Modifier.fillMaxSize())
        if (!selected) Box(Modifier.fillMaxSize().background(Color(0x99000000)))
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(6.dp)
                .size(24.dp)
                .clip(CircleShape)
                .background(if (selected) Lumin.Delete else Color(0x66000000))
                .border(1.5.dp, Color.White, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (selected) Icon(LIcons.Check, null, tint = Color.White, modifier = Modifier.size(16.dp))
        }
        if (media.isVideo) {
            Text(
                bytes(media.bytes),
                color = Color.White, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.align(Alignment.BottomStart).padding(6.dp).clip(CircleShape).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}
