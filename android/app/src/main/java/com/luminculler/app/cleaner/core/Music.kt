package com.luminculler.app.cleaner.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tanh
import kotlin.random.Random

/** Starea muzicii unui film. */
enum class Mood { Happy, Calm, Tender }

/**
 * Muzica filmelor, compusă pe loc: acorduri în tonalitate, câteva
 * instrumente sintetizate (fundal moale, pian, instrument ciupit, bas, tobe
 * discrete), un ecou ușor și intrare/ieșire lină. Nimic descărcat, deci
 * nicio problemă de drepturi; fiecare film are muzica lui (după [seed]).
 *
 * Ieșirea: PCM 16 biți, stereo întrețesut (L, R, L, R…).
 */
object Music {
    const val SAMPLE_RATE = 44_100

    private class Style(val bpm: Int, val progression: IntArray, val sevenths: Boolean)

    /** Treptele acordurilor (0 = I, 5 = vi…) în gama majoră. */
    private fun style(mood: Mood) = when (mood) {
        Mood.Happy -> Style(104, intArrayOf(0, 4, 5, 3), sevenths = false)   // I–V–vi–IV
        Mood.Calm -> Style(72, intArrayOf(0, 5, 3, 4), sevenths = true)      // I–vi–IV–V, cu septime
        Mood.Tender -> Style(66, intArrayOf(5, 3, 0, 4), sevenths = true)    // vi–IV–I–V
    }

    private val MAJOR = intArrayOf(0, 2, 4, 5, 7, 9, 11)

    private fun hz(midi: Int): Double = 440.0 * 2.0.pow((midi - 69) / 12.0)

    /** Notele acordului de pe treapta [degree], în jurul notei MIDI [root]. */
    private fun chord(root: Int, degree: Int, sevenths: Boolean): IntArray {
        fun note(step: Int): Int {
            val octave = step / 7
            return root + 12 * octave + MAJOR[step % 7]
        }
        val tones = mutableListOf(note(degree), note(degree + 2), note(degree + 4))
        if (sevenths) tones += note(degree + 6)
        return tones.toIntArray()
    }

    fun render(mood: Mood, seconds: Float, seed: Long = 1L, sampleRate: Int = SAMPLE_RATE): ShortArray {
        val rnd = Random(seed)
        val st = style(mood)
        val root = intArrayOf(60, 62, 65, 67)[rnd.nextInt(4)] // Do, Re, Fa sau Sol
        val n = (seconds * sampleRate).toInt().coerceAtLeast(sampleRate)
        val left = FloatArray(n)
        val right = FloatArray(n)
        val beat = 60.0 / st.bpm
        val bar = beat * 4

        fun add(start: Double, dur: Double, freq: Double, gain: Float, pan: Float, voice: (t: Double, f: Double) -> Double) {
            val s0 = (start * sampleRate).toInt()
            if (s0 >= n) return
            val len = (dur * sampleRate).toInt()
            val gl = gain * (1f - pan) * 0.5f * 2f
            val gr = gain * (1f + pan) * 0.5f * 2f
            // Fiecare notă se închide lin în ultimele 40 ms: o tăietură bruscă s-ar auzi ca un pocnet.
            val tail = (0.04 * sampleRate).toInt()
            for (i in 0 until len) {
                val k = s0 + i
                if (k >= n) break
                val close = if (i > len - tail) (len - i) / tail.toFloat() else 1f
                val v = voice(i.toDouble() / sampleRate, freq).toFloat() * close
                left[k] += v * gl
                right[k] += v * gr
            }
        }

        // Instrumentele: anvelopă × câteva armonice.
        val pad = { t: Double, f: Double ->
            val env = minOf(1.0, t / 0.8) * 1.0
            env * (sin(2 * PI * f * t) + 0.35 * sin(2 * PI * f * 1.003 * t) + 0.18 * sin(2 * PI * f * 2 * t))
        }
        val piano = { t: Double, f: Double ->
            val env = exp(-t * 2.2) * minOf(1.0, t / 0.005)
            env * (sin(2 * PI * f * t) + 0.45 * sin(4 * PI * f * t) * exp(-t * 3) + 0.2 * sin(6 * PI * f * t) * exp(-t * 5))
        }
        val bell = { t: Double, f: Double ->
            val env = exp(-t * 1.6) * minOf(1.0, t / 0.003)
            env * (sin(2 * PI * f * t) + 0.3 * sin(2 * PI * f * 2.76 * t) * exp(-t * 4))
        }
        val pluck = { t: Double, f: Double ->
            val env = exp(-t * 6.0) * minOf(1.0, t / 0.002)
            env * (sin(2 * PI * f * t) + 0.5 * sin(4 * PI * f * t) * exp(-t * 8) + 0.25 * sin(6 * PI * f * t) * exp(-t * 12))
        }
        val bass = { t: Double, f: Double ->
            val env = minOf(1.0, t / 0.01) * exp(-t * 1.2)
            env * (sin(2 * PI * f * t) + 0.2 * sin(4 * PI * f * t))
        }
        val kick = { t: Double, _: Double ->
            val f = 45 + 75 * exp(-t * 30)
            exp(-t * 14) * sin(2 * PI * f * t)
        }

        val bars = (seconds / bar).toInt() + 1
        for (b in 0 until bars) {
            val t0 = b * bar
            val notes = chord(root, st.progression[b % st.progression.size], st.sevenths)
            // Fundal: acordul ținut tot timpul măsurii.
            for ((i, m) in notes.withIndex()) {
                add(t0, bar + 0.6, hz(m - 12), if (mood == Mood.Happy) 0.05f else 0.08f, (i - 1.5f) * 0.3f) { t, f ->
                    val release = if (t > bar) maxOf(0.0, 1 - (t - bar) / 0.6) else 1.0
                    pad(t, f) * release
                }
            }
            // Basul: rădăcina, pe timpi.
            val bassStep = if (mood == Mood.Happy) 1 else 2
            for (q in 0 until 4 step bassStep) add(t0 + q * beat, beat * bassStep, hz(notes[0] - 24), 0.16f, 0f, bass)
            when (mood) {
                Mood.Happy -> {
                    // Instrument ciupit pe optimi, sus-jos prin acord; tobă mare pe 1 și 3, „ț” pe contratimp.
                    for (e in 0 until 8) {
                        val m = notes[(if (e % 4 < 2) e % 4 else 4 - e % 4).coerceAtMost(notes.size - 1)] + 12
                        add(t0 + e * beat / 2, beat, hz(m), 0.10f, if (e % 2 == 0) -0.4f else 0.4f, pluck)
                    }
                    for (q in intArrayOf(0, 2)) add(t0 + q * beat, 0.35, 0.0, 0.32f, 0f, kick)
                    for (q in 0 until 4) {
                        val s0 = ((t0 + q * beat + beat / 2) * sampleRate).toInt()
                        for (i in 0 until (0.04 * sampleRate).toInt()) {
                            val k = s0 + i
                            if (k >= n) break
                            val v = (rnd.nextFloat() * 2 - 1) * exp(-i / (0.008 * sampleRate)).toFloat() * 0.05f
                            left[k] += v * 0.8f; right[k] += v
                        }
                    }
                }
                Mood.Calm -> {
                    // Clopoței rari, din notele acordului, cu o octavă mai sus.
                    for (q in 0 until 4) {
                        if (rnd.nextFloat() < 0.65f) add(t0 + q * beat + rnd.nextDouble() * 0.05, 2.5, hz(notes[rnd.nextInt(notes.size)] + 12), 0.09f, rnd.nextFloat() - 0.5f, bell)
                    }
                }
                Mood.Tender -> {
                    // Pian: arpegiu lent, plus melodia pe primul timp.
                    for (q in 0 until 4) add(t0 + q * beat, 2.2, hz(notes[q % notes.size]), 0.10f, -0.2f + q * 0.13f, piano)
                    add(t0, 3.0, hz(notes[rnd.nextInt(notes.size)] + 12), 0.08f, 0.2f, piano)
                }
            }
        }

        // Ecou stereo (două întârzieri diferite pe stânga și pe dreapta) pentru spațiu.
        fun echo(x: FloatArray, delaySec: Double, feedback: Float, mix: Float) {
            val d = (delaySec * sampleRate).toInt()
            val y = x.copyOf()
            for (i in d until n) y[i] += y[i - d] * feedback
            for (i in 0 until n) x[i] = x[i] * (1 - mix) + y[i] * mix
        }
        echo(left, 0.23, 0.35f, 0.3f)
        echo(right, 0.31, 0.35f, 0.3f)

        // Intrare de o secundă, ieșire de două; apoi saturație moale și volum la -3 dB.
        val fadeIn = sampleRate
        val fadeOut = minOf(2 * sampleRate, n / 3)
        var peak = 1e-6f
        for (i in 0 until n) {
            var g = 1f
            if (i < fadeIn) g = i / fadeIn.toFloat()
            if (i > n - fadeOut) g = minOf(g, (n - i) / fadeOut.toFloat())
            left[i] = tanh(left[i] * 1.2f) * g
            right[i] = tanh(right[i] * 1.2f) * g
            peak = maxOf(peak, abs(left[i]), abs(right[i]))
        }
        val scale = 0.707f / peak * 32767f
        val out = ShortArray(n * 2)
        for (i in 0 until n) {
            out[2 * i] = (left[i] * scale).toInt().coerceIn(-32767, 32767).toShort()
            out[2 * i + 1] = (right[i] * scale).toInt().coerceIn(-32767, 32767).toShort()
        }
        return out
    }

    /** Starea potrivită unei amintiri: excursiile vesele, „acum X ani” emoționante, oamenii liniștiți. */
    fun moodFor(kind: MomentKind): Mood = when (kind) {
        MomentKind.Trip -> Mood.Happy
        MomentKind.YearsAgo -> Mood.Tender
        MomentKind.Person -> Mood.Calm
    }
}
