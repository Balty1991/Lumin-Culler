package com.luminculler.app.plugins

import android.app.Activity
import android.app.LocaleManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.LocaleList
import android.speech.RecognizerIntent
import android.view.HapticFeedbackConstants
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import java.io.File

/**
 * Legăturile „moderne” cu telefonul, adunate într-un singur plugin:
 *
 *  - haptic: vibrațiile fine ale sistemului (respectă setarea omului de vibrații);
 *  - dynamicColors: culorile Material You din fundalul ales (Android 12+);
 *  - systemBars: icoane închise/deschise pe barele de sus și jos, după temă;
 *  - voiceSearch: dictare prin fereastra de vorbire a telefonului (fără
 *    permisiunea de microfon pentru aplicație — o cere serviciul de vorbire);
 *  - appLocale / setAppLocale: limba aplicației din setările Android (13+);
 *  - pendingShares: poze trimise spre Cherrypic din alte aplicații;
 *  - checkUpdate / startUpdate / completeUpdate: actualizare din aplicație (Play);
 *  - setHdr / isUltraHdr: pozele Ultra HDR afișate cu luminozitatea lor.
 */
@CapacitorPlugin(name = "Device")
class DevicePlugin : Plugin() {

    private var updates: AppUpdateManager? = null
    private val installListener = InstallStateUpdatedListener { state ->
        if (state.installStatus() == InstallStatus.DOWNLOADED) notifyListeners("updateDownloaded", JSObject())
    }
    /** Fișierele primite prin „Trimite”, copiate în cache, așteptând să le ia partea de JS. */
    private val shared = mutableListOf<JSObject>()

    override fun load() {
        activity?.intent?.let { takeShare(it) }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        if (takeShare(intent)) notifyListeners("shared", JSObject().put("count", shared.size))
    }

    // ── Vibrații ──────────────────────────────────────────────────────────

    @PluginMethod
    fun haptic(call: PluginCall) {
        val type = call.getString("type") ?: "tick"
        val view = bridge?.webView
        if (view == null) { call.resolve(); return }
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val constant = when (type) {
            "confirm" -> if (modern) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            "reject" -> if (modern) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            "long" -> HapticFeedbackConstants.LONG_PRESS
            "success" -> if (modern) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        view.post { view.performHapticFeedback(constant) }
        call.resolve()
    }

    // ── Culori ────────────────────────────────────────────────────────────

    @PluginMethod
    fun dynamicColors(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve(JSObject().put("available", false))
            return
        }
        val ctx = context
        fun hex(id: Int) = String.format("#%06X", 0xFFFFFF and ContextCompat.getColor(ctx, id))
        fun tones(ids: IntArray): JSObject {
            val o = JSObject()
            val names = arrayOf("100", "200", "300", "400", "500", "600", "700")
            ids.forEachIndexed { i, id -> o.put(names[i], hex(id)) }
            return o
        }
        val a1 = intArrayOf(android.R.color.system_accent1_100, android.R.color.system_accent1_200, android.R.color.system_accent1_300,
            android.R.color.system_accent1_400, android.R.color.system_accent1_500, android.R.color.system_accent1_600, android.R.color.system_accent1_700)
        val a2 = intArrayOf(android.R.color.system_accent2_100, android.R.color.system_accent2_200, android.R.color.system_accent2_300,
            android.R.color.system_accent2_400, android.R.color.system_accent2_500, android.R.color.system_accent2_600, android.R.color.system_accent2_700)
        val a3 = intArrayOf(android.R.color.system_accent3_100, android.R.color.system_accent3_200, android.R.color.system_accent3_300,
            android.R.color.system_accent3_400, android.R.color.system_accent3_500, android.R.color.system_accent3_600, android.R.color.system_accent3_700)
        call.resolve(JSObject().put("available", true).put("accent1", tones(a1)).put("accent2", tones(a2)).put("accent3", tones(a3)))
    }

    @PluginMethod
    fun systemBars(call: PluginCall) {
        val light = call.getBoolean("light") ?: false
        val act = activity
        if (act == null) { call.resolve(); return }
        act.runOnUiThread {
            val ctl = WindowCompat.getInsetsController(act.window, act.window.decorView)
            ctl.isAppearanceLightStatusBars = light
            ctl.isAppearanceLightNavigationBars = light
        }
        call.resolve()
    }

    // ── Căutare vocală ────────────────────────────────────────────────────

    @PluginMethod
    fun voiceSearch(call: PluginCall) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            call.getString("lang")?.let { putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
            call.getString("prompt")?.let { putExtra(RecognizerIntent.EXTRA_PROMPT, it) }
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        if (intent.resolveActivity(context.packageManager) == null) {
            call.resolve(JSObject().put("available", false))
            return
        }
        startActivityForResult(call, intent, "voiceResult")
    }

    @ActivityCallback
    private fun voiceResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val text = if (result.resultCode == Activity.RESULT_OK)
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        else null
        call.resolve(JSObject().put("available", true).put("text", text ?: ""))
    }

    // ── Limba aplicației (Android 13+) ────────────────────────────────────

    @PluginMethod
    fun appLocale(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { call.resolve(JSObject().put("supported", false)); return }
        val lm = context.getSystemService(LocaleManager::class.java)
        val list = lm?.applicationLocales
        val tag = if (list == null || list.size() == 0) "" else list[0].language
        call.resolve(JSObject().put("supported", true).put("lang", tag))
    }

    @PluginMethod
    fun setAppLocale(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { call.resolve(); return }
        val lang = call.getString("lang") ?: ""
        val lm = context.getSystemService(LocaleManager::class.java)
        runCatching { lm?.applicationLocales = if (lang.isEmpty()) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(lang) }
        call.resolve()
    }

    // ── „Trimite către Cherrypic” ─────────────────────────────────────────

    /** Copiază pozele primite în cache (permisiunea pe URI ține doar cât trăiește intentul). */
    private fun takeShare(intent: Intent): Boolean {
        val uris = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> intentStream(intent)?.let { uris.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> intentStreams(intent)?.let { uris.addAll(it) }
            else -> return false
        }
        if (uris.isEmpty()) return false
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        var added = 0
        uris.take(500).forEachIndexed { i, uri ->
            runCatching {
                val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                if (!mime.startsWith("image/")) return@runCatching
                val ext = when { mime.contains("png") -> "png"; mime.contains("heic") || mime.contains("heif") -> "heic"; mime.contains("webp") -> "webp"; else -> "jpg" }
                val name = "share-${System.currentTimeMillis()}-$i.$ext"
                val out = File(dir, name)
                context.contentResolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
                if (out.length() > 0) {
                    shared.add(JSObject().put("path", out.absolutePath).put("name", name).put("mime", mime))
                    added++
                }
            }
        }
        // Același intent nu trebuie luat de două ori (rotire, revenire din fundal).
        intent.action = Intent.ACTION_MAIN
        return added > 0
    }

    @Suppress("DEPRECATION")
    private fun intentStream(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun intentStreams(intent: Intent): List<Uri>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

    @PluginMethod
    fun pendingShares(call: PluginCall) {
        val arr = JSArray()
        shared.forEach { arr.put(it) }
        shared.clear()
        call.resolve(JSObject().put("files", arr))
    }

    @PluginMethod
    fun clearShares(call: PluginCall) {
        runCatching { File(context.cacheDir, "shared").listFiles()?.forEach { it.delete() } }
        call.resolve()
    }

    // ── Actualizare din aplicație (Google Play) ───────────────────────────

    @PluginMethod
    fun checkUpdate(call: PluginCall) {
        val mgr = updates ?: runCatching { AppUpdateManagerFactory.create(context) }.getOrNull()
        if (mgr == null) { call.resolve(JSObject().put("available", false)); return }
        updates = mgr
        mgr.appUpdateInfo.addOnCompleteListener { task ->
            if (!task.isSuccessful) { call.resolve(JSObject().put("available", false)); return@addOnCompleteListener }
            val info = task.result
            val ready = info.installStatus() == InstallStatus.DOWNLOADED
            val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
            call.resolve(JSObject().put("available", available).put("downloaded", ready).put("versionCode", info.availableVersionCode()))
        }
    }

    @PluginMethod
    fun startUpdate(call: PluginCall) {
        val mgr = updates
        val act = activity
        if (mgr == null || act == null) { call.resolve(JSObject().put("started", false)); return }
        mgr.appUpdateInfo.addOnCompleteListener { task ->
            if (!task.isSuccessful) { call.resolve(JSObject().put("started", false)); return@addOnCompleteListener }
            mgr.registerListener(installListener)
            val started = runCatching {
                mgr.startUpdateFlow(task.result, act, AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE))
            }.isSuccess
            call.resolve(JSObject().put("started", started))
        }
    }

    @PluginMethod
    fun completeUpdate(call: PluginCall) {
        updates?.completeUpdate()
        call.resolve()
    }

    // ── Ultra HDR ─────────────────────────────────────────────────────────

    @PluginMethod
    fun setHdr(call: PluginCall) {
        val on = call.getBoolean("on") ?: false
        val act = activity
        if (act == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { call.resolve(); return }
        act.runOnUiThread {
            runCatching { act.window.colorMode = if (on) ActivityInfo.COLOR_MODE_HDR else ActivityInfo.COLOR_MODE_DEFAULT }
        }
        call.resolve()
    }

    /** O poză Ultra HDR are în antet descrierea „hdrgm” a hărții de câștig — ajung primii 256 KB. */
    @PluginMethod
    fun isUltraHdr(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.resolve(JSObject().put("hdr", false)); return
        }
        Thread {
            val hdr = runCatching {
                context.contentResolver.openInputStream(Uri.parse(uri))?.use { input ->
                    val buf = ByteArray(256 * 1024)
                    var n = 0
                    while (n < buf.size) { val r = input.read(buf, n, buf.size - n); if (r <= 0) break; n += r }
                    String(buf, 0, n, Charsets.ISO_8859_1).contains("hdrgm:")
                } ?: false
            }.getOrDefault(false)
            call.resolve(JSObject().put("hdr", hdr))
        }.start()
    }
}
