package com.luminculler.app.plugins

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.luminculler.app.MainActivity
import com.luminculler.app.R

/**
 * Analiza merge mai departe cu ecranul stins.
 *
 * DE CE. Singurul lucru pentru care auditul de dinaintea lansarii spune ca ar
 * plati un parinte: "pune telefonul in buzunar". La 2,46 s pe poza, o nunta de
 * 2000 de cadre inseamna ~82 de minute cu ecranul aprins — si pana acum chiar
 * asta cerea aplicatia, prin `keepScreenAwake` (core/wakeLock.ts). Cine incuia
 * telefonul pierdea importul la jumatate; de aici si abandonul, si reluarea
 * unui import intrerupt.
 *
 * CE FACE, exact. NU muta analiza in nativ — ea ruleaza mai departe in WebView,
 * unde e scrisa. Serviciul face doua lucruri, si numai ele:
 *
 *  1. tine procesul in grupul de PRIM-PLAN. Din Android 12 incoace, un proces
 *     ajuns in cache e INGHETAT: WebView-ul nu mai primeste timp de procesor,
 *     iar importul se opreste fara nicio eroare. Un serviciu de prim-plan e
 *     singura cale prin care Android accepta ca o aplicatie sa mai lucreze cu
 *     ecranul stins;
 *  2. tine un PARTIAL_WAKE_LOCK, ca procesorul sa nu adoarma intre poze.
 *
 * WebView-ul in sine nu se pune pe pauza: Capacitor porneste cu `KeepRunning`
 * adevarat, deci `handlePause` nu opreste temporizatoarele paginii. Bucata care
 * lipsea era exact starea procesului.
 *
 * Lacatul are un TERMEN. Un `release()` pierdut (proces omorat, exceptie pe un
 * drum neasteptat) ar tine procesorul treaz pana la repornire — adica bateria
 * goala fara nicio explicatie. Termenul face din cea mai proasta greseala
 * posibila o bataie de cap de o ora, nu o zi pierduta.
 */
class BackgroundAnalysisService : Service() {

    companion object {
        const val ACTION_START = "com.luminculler.app.ANALIZA_START"
        const val ACTION_UPDATE = "com.luminculler.app.ANALIZA_UPDATE"
        const val ACTION_STOP = "com.luminculler.app.ANALIZA_STOP"
        const val EXTRA_DONE = "done"
        const val EXTRA_TOTAL = "total"
        const val EXTRA_TEXT = "text"
        const val EXTRA_DETERMINAT = "determinat"

        private const val CHANNEL_ID = "lumin-culler-analiza"
        private const val NOTIFICATION_ID = 4202
        /**
         * Plafonul lacatului. Peste orice import realist (2000 de cadre la 2,46 s
         * inseamna ~82 de minute), si mult sub "am ramas fara baterie".
         */
        private const val WAKE_LOCK_MAX_MS = 3L * 60L * 60L * 1000L
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                opresteTot()
                return START_NOT_STICKY
            }
            else -> {
                val done = intent?.getIntExtra(EXTRA_DONE, 0) ?: 0
                val total = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0
                val text = intent?.getStringExtra(EXTRA_TEXT)
                // Implicit ADEVARAT: o notificare pornita fara extra (repornire,
                // apel vechi) arata bara reala, nu dunga fara sfarsit.
                val determinat = intent?.getBooleanExtra(EXTRA_DETERMINAT, true) ?: true
                porneste(done, total, text, determinat)
            }
        }
        // NU sticky: daca sistemul omoara procesul, importul din WebView oricum
        // nu mai exista. Un serviciu repornit singur ar tine un lacat pentru o
        // treaba care nu mai ruleaza.
        return START_NOT_STICKY
    }

    private fun porneste(done: Int, total: Int, text: String?, determinat: Boolean) {
        creeazaCanalul()
        val notificare = construiesteNotificarea(done, total, text, determinat)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notificare, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notificare)
        }
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LuminCuller:analiza")?.apply {
                setReferenceCounted(false)
                runCatching { acquire(WAKE_LOCK_MAX_MS) }
            }
        }
    }

    private fun opresteTot() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
        // REMOVE, nu DETACH: notificarea pleaca odata cu serviciul. Una ramasa in
        // bara dupa ce importul s-a terminat ar fi exact felul de gunoi care face
        // oamenii sa opreasca notificarile aplicatiei cu totul.
        // Fara ramura pentru API vechi: minSdk-ul proiectului e 26.
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
        super.onDestroy()
    }

    /** Canalul exista de la Android 8, iar minSdk-ul proiectului e 26 — fara garda. */
    private fun creeazaCanalul() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        // IMPORTANCE_LOW: fara sunet si fara vibratie. E o bara de progres, nu o
        // veste.
        val canal = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.analiza_canal_nume),
            NotificationManager.IMPORTANCE_LOW
        )
        canal.description = getString(R.string.analiza_canal_descriere)
        canal.setShowBadge(false)
        manager.createNotificationChannel(canal)
    }

    private fun construiesteNotificarea(done: Int, total: Int, text: String?, determinat: Boolean): Notification {
        val deschide = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // TITLU, nu text. Bug raportat cu o captura de pe ecranul de blocare:
        // se vedea doar titlul fix "Se analizeaza pozele" si o bara care parea
        // inghetata. Cauza: cand notificarea are bara de progres, Android ii da
        // barei exact randul pe care l-ar fi ocupat contentText — deci linia vie
        // trimisa din JS ("84 din 312 poze analizate") nu se vedea NICIODATA in
        // starea stransa, care e singura in care se uita cineva. Numarul trebuie
        // sa stea in titlu ca sa existe.
        //
        // Textul vine din partea de JS, care stie limba aleasa de om; sirul din
        // resurse e doar plasa de rezerva pentru clipa dintre pornirea
        // serviciului si primul update.
        //
        // FARA setSubText. A fost incercat, si a iesit invers: titlul, subtextul
        // si ora impart UN SINGUR rand, asa ca eticheta fixa a taiat titlul la
        // jumatate — "2 din 86 poze..." in loc de "2 din 86 poze analizate".
        // Raportat cu doua capturi. Randul e ingust; cine il umple cu o eticheta
        // care nu se schimba niciodata plateste cu singura parte care conteaza.
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(text ?: getString(R.string.analiza_titlu))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // PUBLIC pe ecranul de blocare. Raportat de utilizator: pe ecranul
            // de blocare CURAT nu aparea nimic — se vedea doar tragand panoul de
            // notificari in jos. Implicit, o notificare e VISIBILITY_PRIVATE,
            // adica sistemul are voie sa-i ascunda continutul (sau pe ea cu
            // totul) cat timp telefonul e incuiat.
            //
            // Aici nu e nimic de ascuns: textul e "14 din 72 poze analizate", o
            // cifra despre propriul import al omului. Iar ecranul incuiat e FIX
            // situatia pentru care exista notificarea asta — cine si-a pus
            // telefonul in buzunar nu deschide panouri, se uita o secunda la
            // ecran. O notificare de progres ascunsa exact cand trebuia citita
            // nu apara nimic.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(deschide)
        // Bara REALA doar unde exista un numar care creste monoton pana la capat.
        // Fazele dinainte si de dupa analiza isi numara propriile lucruri, iar o
        // bara pe fiecare inseamna o bara care se umple la jumatate, se intoarce
        // la zero si se umple iar — adica exact semnalul "a luat-o de la capat".
        // Dunga fara sfarsit spune adevarul: lucrez, nu stiu sa spun cat mai e.
        if (determinat && total > 0) builder.setProgress(total, done.coerceIn(0, total), false)
        else builder.setProgress(0, 0, true)
        return builder.build()
    }
}
