package com.luminculler.app.cleaner.core

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Stilurile artistice care rulează pe telefon, gratuit și fără internet. */
enum class Style { Sketch, Watercolor, Cartoon, Vintage, Noir, Pop }

/**
 * Stilurile, ca transformări pe pixeli ARGB (Kotlin pur, testabil pe JVM).
 * Nu sunt rețele neurale: sunt filtre clasice combinate cu grijă, ca rezultatul
 * să arate a desen, a acuarelă, a film — și să păstreze exact oamenii din poză.
 */
object Styles {

    fun apply(style: Style, px: IntArray, w: Int, h: Int, seed: Long = 7L): IntArray = when (style) {
        Style.Sketch -> sketch(px, w, h)
        Style.Watercolor -> watercolor(px, w, h, seed)
        Style.Cartoon -> cartoon(px, w, h)
        Style.Vintage -> vintage(px, w, h, seed)
        Style.Noir -> noir(px, w, h, seed)
        Style.Pop -> pop(px)
    }

    // ---- unelte ----

    private fun r(p: Int) = (p shr 16) and 0xFF
    private fun g(p: Int) = (p shr 8) and 0xFF
    private fun b(p: Int) = p and 0xFF
    private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)
    private fun luma(p: Int) = (r(p) * 299 + g(p) * 587 + b(p) * 114) / 1000

    fun gray(px: IntArray): IntArray = IntArray(px.size) { luma(px[it]) }

    /** Estompare pe un singur canal, cu sume glisante: O(n) indiferent de rază. */
    fun blurChannel(src: IntArray, w: Int, h: Int, radius: Int): IntArray {
        if (radius <= 0) return src.copyOf()
        val tmp = IntArray(src.size)
        val out = IntArray(src.size)
        val size = radius * 2 + 1
        for (y in 0 until h) {
            var sum = 0
            for (k in -radius..radius) sum += src[y * w + k.coerceIn(0, w - 1)]
            for (x in 0 until w) {
                tmp[y * w + x] = sum / size
                sum += src[y * w + (x + radius + 1).coerceAtMost(w - 1)] - src[y * w + (x - radius).coerceAtLeast(0)]
            }
        }
        for (x in 0 until w) {
            var sum = 0
            for (k in -radius..radius) sum += tmp[k.coerceIn(0, h - 1) * w + x]
            for (y in 0 until h) {
                out[y * w + x] = sum / size
                sum += tmp[(y + radius + 1).coerceAtMost(h - 1) * w + x] - tmp[(y - radius).coerceAtLeast(0) * w + x]
            }
        }
        return out
    }

    /** Mărimea muchiilor (Sobel) pe tonuri de gri, 0..~1000. */
    fun edges(gray: IntArray, w: Int, h: Int): IntArray {
        val out = IntArray(gray.size)
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            val gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]
            val gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]
            out[i] = sqrt((gx * gx + gy * gy).toDouble()).toInt()
        }
        return out
    }

    private fun blurColor(px: IntArray, w: Int, h: Int, radius: Int): IntArray {
        val rr = blurChannel(IntArray(px.size) { r(px[it]) }, w, h, radius)
        val gg = blurChannel(IntArray(px.size) { g(px[it]) }, w, h, radius)
        val bb = blurChannel(IntArray(px.size) { b(px[it]) }, w, h, radius)
        return IntArray(px.size) { argb(rr[it], gg[it], bb[it]) }
    }

    /** Zgomot determinist (aceeași poză → același rezultat). */
    private fun noise(i: Int, seed: Long): Int {
        var x = i.toLong() * 6364136223846793005L + seed
        x = x xor (x ushr 33)
        x *= -0xae502812aa7333L
        x = x xor (x ushr 29)
        return ((x and 0xFF).toInt()) - 128
    }

    private fun vignette(px: IntArray, w: Int, h: Int, strength: Float) {
        val cx = w / 2f
        val cy = h / 2f
        val maxD = sqrt(cx * cx + cy * cy)
        for (y in 0 until h) for (x in 0 until w) {
            val d = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxD
            val f = 1f - strength * (d * d)
            val p = px[y * w + x]
            px[y * w + x] = argb((r(p) * f).roundToInt(), (g(p) * f).roundToInt(), (b(p) * f).roundToInt())
        }
    }

    // ---- stiluri ----

    /** Creion: „color dodge” între gri și negativul lui estompat — liniile ies singure din contururi. */
    fun sketch(px: IntArray, w: Int, h: Int): IntArray {
        val gr = gray(px)
        val inv = IntArray(gr.size) { 255 - gr[it] }
        val radius = (minOf(w, h) / 90).coerceIn(2, 14)
        val blurred = blurChannel(inv, w, h, radius)
        return IntArray(px.size) { i ->
            val base = gr[i]
            val bl = blurred[i]
            val v = if (bl >= 255) 255 else minOf(255, base * 255 / (255 - bl))
            // Puțin mai mult contrast, ca liniile să nu iasă spălate.
            val c = (((v - 128) * 1.15f) + 128).roundToInt()
            argb(c, c, c)
        }
    }

    /** Acuarelă: culori netezite și puțin spălate, contururi care „sângerează”, textură de hârtie. */
    fun watercolor(px: IntArray, w: Int, h: Int, seed: Long): IntArray {
        val radius = (minOf(w, h) / 160).coerceIn(1, 8)
        val soft = blurColor(px, w, h, radius)
        val e = edges(gray(soft), w, h)
        return IntArray(px.size) { i ->
            val p = soft[i]
            val lift = 0.82f
            var rr = (r(p) * lift + 255 * (1 - lift))
            var gg = (g(p) * lift + 255 * (1 - lift))
            var bb = (b(p) * lift + 255 * (1 - lift))
            val dark = (e[i] / 6f).coerceAtMost(70f)
            val paper = noise(i, seed) / 24f
            rr -= dark - paper; gg -= dark - paper; bb -= dark - paper
            argb(rr.roundToInt(), gg.roundToInt(), bb.roundToInt())
        }
    }

    /** Desen animat: culori reduse la câteva niveluri, peste contururi negre. */
    fun cartoon(px: IntArray, w: Int, h: Int): IntArray {
        val radius = (minOf(w, h) / 220).coerceIn(1, 6)
        val soft = blurColor(px, w, h, radius)
        val e = edges(gray(soft), w, h)
        val levels = 6
        val step = 255 / (levels - 1)
        fun q(v: Int) = ((v + step / 2) / step) * step
        return IntArray(px.size) { i ->
            if (e[i] > 220) argb(25, 25, 30)
            else {
                val p = soft[i]
                // Culorile puțin mai vii înainte de reducere, ca la animație.
                val l = luma(p)
                val s = 1.3f
                argb(q((l + (r(p) - l) * s).roundToInt()), q((l + (g(p) - l) * s).roundToInt()), q((l + (b(p) - l) * s).roundToInt()))
            }
        }
    }

    /** Film vechi: tonuri calde, negru ridicat (decolorat), culoare mai stinsă, granulație, margini întunecate. */
    fun vintage(px: IntArray, w: Int, h: Int, seed: Long): IntArray {
        val out = IntArray(px.size) { i ->
            val p = px[i]
            val l = luma(p)
            val s = 0.75f
            var rr = l + (r(p) - l) * s
            var gg = l + (g(p) - l) * s
            var bb = l + (b(p) - l) * s
            rr = rr * 1.06f + 14; gg = gg * 1.0f + 6; bb = bb * 0.86f + 10
            // Negrul ridicat: niciun pixel nu coboară sub ~22.
            rr = 22 + rr * (233f / 255f); gg = 22 + gg * (233f / 255f); bb = 22 + bb * (233f / 255f)
            val grain = noise(i, seed) / 14f
            argb((rr + grain).roundToInt(), (gg + grain).roundToInt(), (bb + grain).roundToInt())
        }
        vignette(out, w, h, 0.35f)
        return out
    }

    /** Alb-negru dramatic: contrast în S, granulație fină, margini întunecate. */
    fun noir(px: IntArray, w: Int, h: Int, seed: Long): IntArray {
        val out = IntArray(px.size) { i ->
            val l = luma(px[i]) / 255f
            val s = l * l * (3 - 2 * l) // curbă în S
            val v = (s * 255 + noise(i, seed) / 18f).roundToInt()
            argb(v, v, v)
        }
        vignette(out, w, h, 0.45f)
        return out
    }

    /** Pop: culori mult mai vii și contrast mai mare, fără să ardă pielea. */
    fun pop(px: IntArray): IntArray = IntArray(px.size) { i ->
        val p = px[i]
        val l = luma(p)
        val s = 1.5f
        fun c(v: Int): Int {
            val sat = l + (v - l) * s
            return (((sat - 128) * 1.12f) + 128).roundToInt()
        }
        argb(c(r(p)), c(g(p)), c(b(p)))
    }

    /** Pentru teste: cât de colorat e un pixel (0 = gri). */
    fun chroma(p: Int): Int = maxOf(abs(r(p) - g(p)), abs(g(p) - b(p)), abs(r(p) - b(p)))
}
