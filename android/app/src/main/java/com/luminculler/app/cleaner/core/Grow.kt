package com.luminculler.app.cleaner.core

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * O față găsită într-o poză, gata de aliniat.
 *
 * Ochii sunt în coordonate NORMALIZATE (0..1) ale pozei orientate corect, ca
 * să poată fi folosiți la orice rezoluție: mică la scanare, mare la randare.
 * `ax, ay` e ochiul din stânga imaginii, `bx, by` cel din dreapta.
 */
class FaceHit(
    val mediaId: Long,
    val taken: Long,
    val ax: Float, val ay: Float,
    val bx: Float, val by: Float,
    /** Lățimea feței, ca fracție din lățimea pozei. */
    val width: Float,
    val yaw: Float,
    /** Vector L2-normalizat; produsul scalar e similaritatea cosinus. */
    val embedding: FloatArray
) {
    /** Distanța dintre ochi, în aceleași unități normalizate ca ochii. */
    val eyeDistance: Float get() = hypot(bx - ax, by - ay)
}

object Grow {
    /**
     * Praguri pe descriptorul FaceRes (similaritate cosinus), aliniate cu
     * aplicația web: acolo 0.55 = recunoscut, 0.65 = grupare automată.
     */
    const val MATCH = 0.60f
    /** Între asta și MATCH: propuse, dar nebifate. Omul decide. */
    const val MAYBE = 0.50f
    /** Pentru gruparea pe persoane fără om în buclă, mai strict. */
    const val CLUSTER = 0.60f
    /** O persoană se schimbă în timp: comparăm doar cu fețe acceptate din jurul aceleiași perioade. */
    const val WINDOW_MS = 2L * 365 * 24 * 3600 * 1000
    const val MAX_ACCEPTED = 400

    fun dot(a: FloatArray, b: FloatArray): Float {
        var s = 0f
        val n = minOf(a.size, b.size)
        for (i in 0 until n) s += a[i] * b[i]
        return s
    }

    fun normalize(v: FloatArray): FloatArray {
        var s = 0.0
        for (x in v) s += x.toDouble() * x
        val n = sqrt(s).toFloat()
        return if (n == 0f) v else FloatArray(v.size) { v[it] / n }
    }

    class Candidates(val accepted: List<FaceHit>, val maybe: List<FaceHit>)

    /**
     * Pornind de la fața aleasă de om, adună pe rând fața cea mai asemănătoare
     * cu oricare față deja acceptată din aceeași perioadă. Așa urmărește un
     * copil care crește: fața de la 5 ani seamănă cu cea de la 4, nu neapărat
     * cu cea de la 1. Cel mult o față pe poză.
     */
    fun candidates(seed: FaceHit, faces: List<FaceHit>): Candidates {
        val pool = faces.filter { it !== seed }
        val best = FloatArray(pool.size) { -1f }
        val usedMedia = HashSet<Long>().apply { add(seed.mediaId) }
        val accepted = ArrayList<FaceHit>().apply { add(seed) }
        val taken = BooleanArray(pool.size)

        fun update(from: FaceHit) {
            for (i in pool.indices) {
                if (taken[i]) continue
                val f = pool[i]
                if (from.taken > 0 && f.taken > 0 && kotlin.math.abs(from.taken - f.taken) > WINDOW_MS) continue
                val s = dot(from.embedding, f.embedding)
                if (s > best[i]) best[i] = s
            }
        }
        update(seed)
        while (accepted.size < MAX_ACCEPTED) {
            var pick = -1
            var score = MATCH
            for (i in pool.indices) {
                if (taken[i] || pool[i].mediaId in usedMedia) continue
                if (best[i] >= score) {
                    score = best[i]
                    pick = i
                }
            }
            if (pick < 0) break
            taken[pick] = true
            usedMedia.add(pool[pick].mediaId)
            accepted.add(pool[pick])
            update(pool[pick])
        }
        val maybe = pool.indices
            .filter { !taken[it] && pool[it].mediaId !in usedMedia && best[it] >= MAYBE }
            .sortedByDescending { best[it] }
            .map { pool[it] }
            .distinctBy { it.mediaId }
            .take(120)
        return Candidates(accepted.sortedBy { it.taken }, maybe)
    }

    /**
     * Ce intră în video: cel mult una pe zi (cea mai frontală), apoi alese
     * uniform pe toată perioada, ca anii să curgă egal, nu să stea o lună
     * întreagă pe aceeași vacanță.
     */
    fun frames(selected: List<FaceHit>, maxFrames: Int = MAX_FRAMES): List<FaceHit> {
        val perDay = selected.sortedBy { it.taken }
            .groupBy { if (it.taken > 0) it.taken / 86_400_000L else -it.mediaId }
            .values.map { day -> day.minBy { kotlin.math.abs(it.yaw) } }
            .sortedBy { it.taken }
        if (perDay.size <= maxFrames) return perDay
        val dated = perDay.filter { it.taken > 0 }
        if (dated.size < 2) return List(maxFrames) { i -> perDay[(i.toLong() * perDay.size / maxFrames).toInt()] }
        // Ținte egal distanțate în timp; pentru fiecare, cea mai apropiată poză încă nefolosită.
        val start = dated.first().taken
        val end = dated.last().taken
        val used = HashSet<FaceHit>()
        val out = ArrayList<FaceHit>()
        for (i in 0 until maxFrames) {
            val target = start + (end - start) * i / (maxFrames - 1)
            val pick = dated.filter { it !in used }.minByOrNull { kotlin.math.abs(it.taken - target) } ?: break
            used.add(pick)
            out.add(pick)
        }
        return out.sortedBy { it.taken }
    }

    const val MAX_FRAMES = 40

    /** Cât stă fiecare poză pe ecran: destul cât să o vezi, iar videoul să rămână sub ~45 s. */
    fun secondsPerPhoto(count: Int): Float = (36f / count.coerceAtLeast(1)).coerceIn(0.9f, 2.0f)
}

/** O persoană găsită în galerie: fețele ei și una reprezentativă, de arătat. */
class Person(val faces: List<FaceHit>) {
    val cover: FaceHit get() = faces.maxBy { it.width - kotlin.math.abs(it.yaw) / 200f }
    val photos: Int get() = faces.distinctBy { it.mediaId }.size
}

object People {
    /**
     * Grupare lacomă: fețele, de la cea mai mare la cea mai mică, intră în
     * persoana cu care seamănă cel mai mult (comparată cu până la [REPS] fețe
     * reprezentative ale ei), sau încep una nouă. Rezultă fiecare om o dată,
     * cu câte poze are — ca „Oameni” din Google Foto.
     */
    fun cluster(faces: List<FaceHit>, threshold: Float = Grow.CLUSTER, minPhotos: Int = 3): List<Person> {
        val groups = ArrayList<MutableList<FaceHit>>()
        val reps = ArrayList<MutableList<FaceHit>>()
        for (f in faces.sortedByDescending { it.width }) {
            var best = -1
            var score = threshold
            for (g in reps.indices) {
                for (r in reps[g]) {
                    val s = Grow.dot(f.embedding, r.embedding)
                    if (s > score) {
                        score = s
                        best = g
                    }
                }
            }
            if (best < 0) {
                groups.add(arrayListOf(f))
                reps.add(arrayListOf(f))
            } else {
                groups[best].add(f)
                if (reps[best].size < REPS) reps[best].add(f)
            }
        }
        return groups.map { Person(it) }.filter { it.photos >= minPhotos }.sortedByDescending { it.photos }
    }

    const val REPS = 3
}

/**
 * Transformarea care duce ochii unei poze peste ochii-țintă din cadrul video:
 * rotire + scalare + translație (fără deformare). Întoarce cele 9 valori ale
 * unei matrice 3×3, pe rânduri, în formatul lui android.graphics.Matrix.
 */
object Align {
    fun matrix(
        ax: Float, ay: Float, bx: Float, by: Float,
        tax: Float, tay: Float, tbx: Float, tby: Float
    ): FloatArray {
        val srcAngle = atan2((by - ay).toDouble(), (bx - ax).toDouble())
        val dstAngle = atan2((tby - tay).toDouble(), (tbx - tax).toDouble())
        val srcLen = hypot((bx - ax).toDouble(), (by - ay).toDouble())
        val dstLen = hypot((tbx - tax).toDouble(), (tby - tay).toDouble())
        val s = if (srcLen == 0.0) 1.0 else dstLen / srcLen
        val r = dstAngle - srcAngle
        val c = cos(r) * s
        val n = sin(r) * s
        // p' = R·S·(p − a) + ta
        val tx = tax - (c * ax - n * ay)
        val ty = tay - (n * ax + c * ay)
        return floatArrayOf(c.toFloat(), (-n).toFloat(), tx.toFloat(), n.toFloat(), c.toFloat(), ty.toFloat(), 0f, 0f, 1f)
    }

    fun apply(m: FloatArray, x: Float, y: Float): Pair<Float, Float> =
        Pair(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5])
}
