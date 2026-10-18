package com.luminculler.app.cleaner

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.Path
import androidx.core.content.FileProvider
import java.io.File
import kotlin.math.max
import kotlin.math.min

fun reduceMotion(context: Context): Boolean {
    val scale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    return scale == 0f
}

fun gestureHaptic(context: Context, style: String) {
    if (reduceMotion(context)) return
    val waveform = when (style) {
        "delete" -> longArrayOf(0, 12, 28, 18)
        "undo" -> longArrayOf(0, 8, 24, 14)
        "keep" -> longArrayOf(0, 9)
        "chip" -> longArrayOf(0, 6)
        else -> longArrayOf(0, 12)
    }
    val vibrator = if (Build.VERSION.SDK_INT >= 31) {
        val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        manager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(waveform, -1))
    else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(waveform[1])
    }
}

/** Accentul cadrului: cel mai saturat grup dintr-un eșantion de 12×12. */
fun accentOf(context: Context, uri: String): Int? {
    val parsed = Uri.parse(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = max(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    var sample = 1
    while (longest / sample > 24) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
    val small = Bitmap.createScaledBitmap(bitmap, 12, 12, true)
    val buckets = HashMap<Int, LongArray>()
    for (y in 0 until 12) {
        for (x in 0 until 12) {
            val pixel = small.getPixel(x, y)
            val r = Color.red(pixel)
            val g = Color.green(pixel)
            val b = Color.blue(pixel)
            val hi = max(r, max(g, b))
            val lo = min(r, min(g, b))
            if (hi < 28 || lo > 240) continue
            val key = ((r shr 4) shl 8) or ((g shr 4) shl 4) or (b shr 4)
            val acc = buckets.getOrPut(key) { LongArray(4) }
            acc[0] += r
            acc[1] += g
            acc[2] += b
            acc[3] += 1
        }
    }
    if (small !== bitmap) small.recycle()
    bitmap.recycle()
    var best = -1.0
    var color = 0xFF7DFFF4.toInt()
    for (acc in buckets.values) {
        if (acc[3] == 0L) continue
        val r = acc[0].toDouble() / acc[3]
        val g = acc[1].toDouble() / acc[3]
        val b = acc[2].toDouble() / acc[3]
        val hi = max(r, max(g, b))
        val lo = min(r, min(g, b))
        val sat = if (hi == 0.0) 0.0 else (hi - lo) / hi
        val score = sat * kotlin.math.sqrt(acc[3].toDouble())
        if (score > best) {
            best = score
            color = Color.rgb(r.toInt(), g.toInt(), b.toInt())
        }
    }
    return color
}

fun shareFreedCard(activity: Activity, bytes: Long) {
    val width = 1080
    val height = 1350
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(), 0xFF120814.toInt(), 0xFF05060F.toInt(), Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    paint.shader = null
    paint.color = 0xFF9EE7F5.toInt()
    paint.textSize = 42f
    canvas.drawText("LUMIN", 120f, 220f, paint)
    paint.color = 0xFFC5CAD6.toInt()
    paint.textSize = 48f
    canvas.drawText("I freed", 120f, 620f, paint)
    paint.color = 0xFFF4F6FB.toInt()
    paint.textSize = 120f
    canvas.drawText(formatFreed(bytes), 120f, 780f, paint)
    paint.textSize = 48f
    canvas.drawText("with Lumin", 120f, 880f, paint)
    val file = File(activity.cacheDir, "lumin-freed.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, "I freed ${formatFreed(bytes)} with Lumin")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, "Share"))
}

private fun formatFreed(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = -1
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return "%.1f %s".format(value, units[unit])
}

@Composable
fun FreedOrb(freed: Long, accent: androidx.compose.ui.graphics.Color, reduce: Boolean, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val target = (freed / 8_000_000_000f).coerceIn(0.08f, 1f)
    val level by animateFloatAsState(
        targetValue = target,
        animationSpec = if (reduce) spring(stiffness = Spring.StiffnessHigh) else spring(dampingRatio = 0.55f, stiffness = 180f),
        label = "orb"
    )
    var tilt by remember { mutableFloatStateOf(0f) }
    DisposableEffect(reduce) {
        if (reduce) return@DisposableEffect onDispose { }
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                tilt = (event.values[0] / 6f).coerceIn(-1f, 1f)
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        if (sensor != null) manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
        onDispose { manager.unregisterListener(listener) }
    }
    Canvas(modifier) {
        val radius = size.minDimension / 2f
        val center = Offset(size.width / 2f + tilt * radius * 0.08f, size.height / 2f)
        val path = Path().apply { addOval(androidx.compose.ui.geometry.Rect(center.x - radius, center.y - radius, center.x + radius, center.y + radius)) }
        clipPath(path) {
            drawRect(androidx.compose.ui.graphics.Color(0xFF10131C))
            val top = center.y + radius - level * radius * 1.8f + tilt * 6f
            drawRect(accent.copy(alpha = 0.9f), topLeft = Offset(0f, top), size = Size(size.width, size.height - top))
        }
        drawCircle(color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.35f), radius = radius, center = center, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f))
    }
}
