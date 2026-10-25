package com.luminculler.app.cleaner

fun formatBytes(bytes: Long): String {
    val safe = bytes.coerceAtLeast(0L)
    if (safe < 1024) return "$safe B"
    val units = arrayOf("KB", "MB", "GB")
    var value = safe.toDouble()
    var unit = -1
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return "%.1f %s".format(value, units[unit])
}
