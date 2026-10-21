package com.luminculler.app.cleaner

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import androidx.core.content.FileProvider
import com.luminculler.app.R
import com.luminculler.app.cleaner.core.Bytes
import java.io.File
import java.util.Locale

fun reduceMotion(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

fun gestureHaptic(context: Context, style: String) {
    if (reduceMotion(context)) return
    val waveform = when (style) {
        "delete" -> longArrayOf(0, 12, 28, 18)
        "undo" -> longArrayOf(0, 8, 24, 14)
        "keep" -> longArrayOf(0, 9)
        else -> longArrayOf(0, 6)
    }
    val vibrator = if (Build.VERSION.SDK_INT >= 31) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    if (vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createWaveform(waveform, -1))
}

/** Cartonașul de share după o curățare: o imagine, în limba telefonului. */
fun shareFreedCard(activity: Activity, bytes: Long) {
    val size = Bytes.format(bytes, Locale.getDefault())
    val width = 1080
    val height = 1350
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(), 0xFF2A1858.toInt(), 0xFF0B0B11.toInt(), Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    paint.shader = null
    paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    paint.color = 0xFFA78BFA.toInt()
    paint.textSize = 54f
    canvas.drawText("Lumin", 110f, 210f, paint)
    paint.typeface = Typeface.DEFAULT
    paint.color = 0xFFC5C5D2.toInt()
    paint.textSize = 56f
    canvas.drawText(activity.getString(R.string.lumin_share_line1), 110f, 600f, paint)
    paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    paint.color = 0xFF5EE6B0.toInt()
    paint.textSize = 170f
    canvas.drawText(size, 100f, 790f, paint)
    paint.typeface = Typeface.DEFAULT
    paint.color = 0xFFF4F4F7.toInt()
    paint.textSize = 56f
    canvas.drawText(activity.getString(R.string.lumin_share_line2), 110f, 900f, paint)
    val file = File(activity.cacheDir, "lumin-freed.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, activity.getString(R.string.lumin_share_text, size))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, null))
}
