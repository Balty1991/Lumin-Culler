package com.luminculler.app.plugins

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Notificari locale native.
 *
 * De ce exista: setarea "Notificari inteligente" folosea Notification API din
 * pagina, care in WebView-ul Android nu e disponibila — utilizatorul apasa
 * comutatorul si primea "Browserul de aici nu poate trimite notificari", un
 * mesaj despre un browser pe care el nu-l vede nicaieri, la o setare care nu
 * facea nimic. Aici notificarea e a sistemului: apare in bara de sus, ca
 * oricare alta, si merge offline.
 *
 * Scris de mana peste NotificationManager, fara @capacitor/local-notifications:
 * acelasi tipar ca restul plugin-urilor din proiect (vezi BillingPlugin.kt) —
 * androidx.core e deja dependinta, deci nu se adauga nimic in APK.
 *
 * NU e un push de fundal: aplicatia trebuie sa ruleze ca sa decida ca merita
 * o notificare (vezi state/smartNotification.ts). Un push adevarat ar cere
 * server + abonament, adica exact ce aplicatia asta nu are si nu vrea.
 */
@CapacitorPlugin(
    name = "Notifications",
    // Alias scris ca literal, nu ca referinta la constanta din companion-ul
    // aceleiasi clase: argumentele de adnotare trebuie sa fie constante de
    // compilare, iar referinta ar fi circulara.
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])]
)
class NotificationsPlugin : Plugin() {

    companion object {
        const val ALIAS = "notifications"
        private const val CHANNEL_ID = "lumin-culler-reminders"
        private const val NOTIFICATION_ID = 4201
    }

    /**
     * "Chiar pot trimite o notificare acum?" — nu doar permisiunea de la Android
     * 13 incoace, ci si comutatorul din setarile sistemului, pe care omul il
     * poate opri oricand din afara aplicatiei. Amandoua trebuie sa fie da.
     */
    private fun canNotify(): Boolean {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return enabled
        val permitted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        return enabled && permitted
    }

    private fun statusResult(): JSObject {
        val result = JSObject()
        result.put("granted", canNotify())
        return result
    }

    @PluginMethod
    fun checkAccess(call: PluginCall) {
        call.resolve(statusResult())
    }

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        if (canNotify()) {
            call.resolve(statusResult())
            return
        }
        // Sub Android 13 nu exista nicio permisiune de cerut: daca notificarile
        // sunt oprite, sunt oprite din setarile sistemului si doar de acolo se
        // pot reporni. Raspundem cinstit "nu", in loc sa deschidem un dialog
        // care nu exista.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(statusResult())
            return
        }
        requestPermissionForAlias(ALIAS, call, "accessCallback")
    }

    @PermissionCallback
    private fun accessCallback(call: PluginCall) {
        call.resolve(statusResult())
    }

    /**
     * Numele canalului vine din JS ca sa fie in limba aplicatiei — utilizatorul
     * il vede in Setari > Aplicatii > Notificari, unde poate opri exact acest
     * tip de notificare fara sa le opreasca pe toate.
     */
    @PluginMethod
    fun show(call: PluginCall) {
        val title = call.getString("title")
        if (title == null) {
            call.reject("title is required")
            return
        }
        val body = call.getString("body") ?: ""
        val channelName = call.getString("channelName") ?: "Reminders"

        val result = JSObject()
        if (!canNotify()) {
            result.put("shown", false)
            call.resolve(result)
            return
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_DEFAULT)
            )
        }

        // La atingere se deschide aplicatia, nu se pierde tapul. FLAG_IMMUTABLE
        // e obligatoriu de la Android 12 incolo pentru orice PendingIntent fara
        // date variabile.
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending = if (launch != null) {
            PendingIntent.getActivity(
                context, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else {
            null
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
        if (pending != null) builder.setContentIntent(pending)

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
            result.put("shown", true)
        } catch (e: SecurityException) {
            // Permisiunea poate fi retrasa intre verificare si trimitere.
            result.put("shown", false)
        }
        call.resolve(result)
    }
}
