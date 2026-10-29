package com.luminculler.app.plugins

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import com.luminculler.app.MainActivity

/**
 * Butonul Cherrypic din panoul rapid (tragi de sus de două ori → creion →
 * „Sortează azi”). Atins, deschide aplicația direct în sortarea zilei — aceeași
 * acțiune ca notificarea de seară („today”, vezi DailyDigestReceiver.EXTRA_ACTION).
 */
class SortTileService : TileService() {
    override fun onClick() {
        super.onClick()
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(DailyDigestReceiver.EXTRA_ACTION, "today")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pending = PendingIntent.getActivity(this, 41, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(intent)
        }
    }
}
