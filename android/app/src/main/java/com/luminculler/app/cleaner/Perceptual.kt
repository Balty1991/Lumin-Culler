package com.luminculler.app.cleaner

/** Distanța sub care două amprente dHash sunt aceeași poză, nu doar același nume. */
const val HASH_DISTANCE = 6

/**
 * dHash pe un rând de gri, lățime 9 pentru o grilă 9×8.
 * Bitul e 1 când pixelul din stânga e mai luminos decât cel din dreapta.
 */
fun dHashFromGray(gray: IntArray, width: Int = 9): Long {
    if (width < 2 || gray.size < width) return 0L
    val height = gray.size / width
    var hash = 0L
    var bit = 0
    for (y in 0 until height) {
        for (x in 0 until width - 1) {
            if (bit >= 64) return hash
            if (gray[y * width + x] > gray[y * width + x + 1]) hash = hash or (1L shl bit)
            bit++
        }
    }
    return hash
}

fun hamming(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)
