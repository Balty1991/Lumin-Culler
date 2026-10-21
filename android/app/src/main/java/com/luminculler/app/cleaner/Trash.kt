package com.luminculler.app.cleaner

import android.content.Context
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.luminculler.app.cleaner.core.Media

/** Cum se termină o ștergere cerută. */
sealed interface DeleteStep {
    /** Android 11+: dialogul sistemului, o singură dată pentru tot lotul. Pozele merg în coșul sistemului (30 de zile). */
    class Confirm(val sender: IntentSender, val items: List<Media>) : DeleteStep

    /** Android 8–10: șters direct (omul a confirmat deja în aplicație, iar ștergerea e definitivă). */
    class Done(val deleted: List<Media>) : DeleteStep
}

/**
 * Ștergerea, pe fiecare versiune de Android.
 *
 * De la Android 11 există coșul de gunoi al sistemului: o cerere, un dialog,
 * iar pozele se pot recupera 30 de zile din Galerie. Sub 11 nu există coș, iar
 * o aplicație care nu a creat fișierul îl poate șterge doar cu permisiunea de
 * scriere (Android 8–9) sau cu stocarea „legacy” (Android 10, vezi manifestul).
 * De aceea ecranul cere o confirmare în plus pe telefoanele vechi.
 */
class Trash(private val context: Context) {

    val isRecoverable: Boolean get() = Build.VERSION.SDK_INT >= 30

    fun request(items: List<Media>): DeleteStep {
        if (items.isEmpty()) return DeleteStep.Done(emptyList())
        if (Build.VERSION.SDK_INT >= 30) {
            val pending = MediaStore.createTrashRequest(context.contentResolver, items.map { Uri.parse(it.uri) }, true)
            return DeleteStep.Confirm(pending.intentSender, items)
        }
        val deleted = ArrayList<Media>()
        for (m in items) {
            try {
                if (context.contentResolver.delete(Uri.parse(m.uri), null, null) > 0) deleted.add(m)
            } catch (_: SecurityException) {
                // Fișierul nu e al nostru și n-avem voie să-l scriem. Rămâne pe
                // telefon; ecranul arată câte s-au șters cu adevărat.
            }
        }
        return DeleteStep.Done(deleted)
    }
}
