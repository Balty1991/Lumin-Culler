package com.luminculler.app.cleaner.magic

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.luminculler.app.R
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.grow.decodeOriented
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Starea ecranului „Magie AI” pentru o poză. */
class MagicModel(private val context: Context, private val scope: CoroutineScope) {
    private val magic = PhotoMagic(context)
    private var media: Media? = null
    private var original: Bitmap? = null
    private var job: Job? = null

    var shown by mutableStateOf<Bitmap?>(null)
    var before by mutableStateOf<Bitmap?>(null)
    var enhance by mutableStateOf(false)
    var portrait by mutableStateOf(false)
    var working by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)

    fun open(m: Media) {
        if (media?.id == m.id && original != null) return
        media = m
        enhance = false
        portrait = false
        shown = null
        before = null
        working = true
        job?.cancel()
        job = scope.launch {
            val bmp = withContext(Dispatchers.IO) { decodeOriented(context, Uri.parse(m.uri), 2048) }
            original = bmp
            before = bmp
            shown = bmp
            working = false
        }
    }

    fun toggleEnhance() {
        enhance = !enhance
        apply()
    }

    fun togglePortrait() {
        portrait = !portrait
        apply()
    }

    private fun apply() {
        val src = original ?: return
        job?.cancel()
        working = true
        val e = enhance
        val p = portrait
        job = scope.launch {
            val result = withContext(Dispatchers.Default) {
                var cur = src
                if (e) cur = magic.enhance(cur)
                if (p) {
                    val withBlur = magic.portrait(cur)
                    if (withBlur == null) {
                        message = context.getString(R.string.lumin_magic_no_person)
                        portrait = false
                    } else {
                        if (cur !== src) cur.recycle()
                        cur = withBlur
                    }
                }
                cur
            }
            shown = result
            working = false
        }
    }

    fun save() {
        val bmp = shown ?: return
        scope.launch {
            val uri = withContext(Dispatchers.IO) { PhotoMagic.saveImage(context, bmp) }
            message = context.getString(if (uri != null) R.string.lumin_magic_saved else R.string.lumin_grow_save_failed)
        }
    }

    fun close() = magic.close()
}
