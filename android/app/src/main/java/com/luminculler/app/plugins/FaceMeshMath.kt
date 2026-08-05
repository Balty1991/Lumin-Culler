package com.luminculler.app.plugins

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Port Kotlin al analizei fine de fata (zambet autentic/expresie/contact
 * vizual) din faceAnalysis.worker.ts (Faza 4). Fara dependinte MediaPipe/
 * Capacitor — opereaza pe puncte de reper simple (coordonate PIXEL,
 * convertite din NormalizedLandmark-urile MediaPipe de catre
 * FaceMeshPlugin.kt) si pe un map de blendshape-uri.
 *
 * O parte (eyeOpenness/mouthAspectRatio/eyeCropBox) e port 1:1 — Human.js
 * foloseste chiar topologia MediaPipe Face Mesh (vezi comentariul liniei 77
 * din faceAnalysis.worker.ts: "MediaPipe Face Mesh landmark indices"), deci
 * indicii de mai jos sunt identici cu cei din JS.
 *
 * O alta parte (happy/surprise/negative) NU are echivalent direct MediaPipe —
 * Human.js foloseste un model dedicat de emotie (FER, 7 clase), pe care
 * Google nu il publica oficial (aceeasi ratiune ca la recunoasterea de
 * persoane: un clasificator "aceasta fata e furioasa/trista" isi are
 * propriile probleme de gen bias/provenienta a datelor). Aproximam
 * happy/surprise/negative din blendshape-urile MediaPipe (coeficienti de
 * pozitie musculara, NU o emotie clasificata) — o aproximare rezonabila de
 * inginerie, NU un port fidel.
 */
object FaceMeshMath {

    data class Point(val x: Double, val y: Double)
    data class EyeIndices(val top: Int, val bottom: Int, val inner: Int, val outer: Int)

    // Aceiasi indici ca LEFT_EYE/RIGHT_EYE/MOUTH din faceAnalysis.worker.ts.
    val LEFT_EYE = EyeIndices(top = 159, bottom = 145, inner = 133, outer = 33)
    val RIGHT_EYE = EyeIndices(top = 386, bottom = 374, inner = 362, outer = 263)
    private const val MOUTH_TOP = 13
    private const val MOUTH_BOTTOM = 14
    private const val MOUTH_LEFT = 61
    private const val MOUTH_RIGHT = 291

    private fun dist(a: Point, b: Point): Double = hypot(a.x - b.x, a.y - b.y)

    /** Eye Aspect Ratio -> deschidere normalizata 0..1. */
    fun eyeOpenness(mesh: List<Point>, eye: EyeIndices): Double {
        val vertical = dist(mesh[eye.top], mesh[eye.bottom])
        val horizontal = dist(mesh[eye.inner], mesh[eye.outer])
        if (horizontal == 0.0) return 0.0
        val ear = vertical / horizontal
        return min(1.0, max(0.0, (ear - 0.08) / 0.25))
    }

    fun mouthAspectRatio(mesh: List<Point>): Double {
        val horizontal = dist(mesh[MOUTH_LEFT], mesh[MOUTH_RIGHT])
        if (horizontal == 0.0) return 0.0
        return dist(mesh[MOUTH_TOP], mesh[MOUTH_BOTTOM]) / horizontal
    }

    private const val MOUTH_OPEN_THRESHOLD = 0.32
    fun isMouthOpen(mesh: List<Point>): Boolean = mouthAspectRatio(mesh) > MOUTH_OPEN_THRESHOLD

    private const val GROUP_SMILE_THRESHOLD = 0.4
    private const val GENUINE_SMILE_EYE_THRESHOLD = 0.77

    /** smile = happy aproximat (vezi approximateEmotion) — FaceInsight.smile din JS e literalmente emotion.happy rotunjit. */
    fun isGenuineSmile(smile: Double, leftEyeOpen: Double, rightEyeOpen: Double): Boolean {
        if (smile < GROUP_SMILE_THRESHOLD) return false
        val eyeOpen = (leftEyeOpen + rightEyeOpen) / 2
        return eyeOpen < GENUINE_SMILE_EYE_THRESHOLD
    }

    fun isAwkwardExpression(mouthOpen: Boolean, happy: Double, surprise: Double): Boolean {
        if (!mouthOpen) return false
        return happy < 0.3 && surprise < 0.3
    }

    fun engagementScore(happy: Double, surprise: Double, negative: Double): Double =
        max(0.0, min(1.0, 0.5 + 0.5 * happy + 0.25 * surprise - 0.5 * negative))

    private const val EYE_CONTACT_ANGLE_LIMIT = 0.6 // radiani (~34°)

    /**
     * Versiune simplificata fata de JS: doar pozitia capului (yaw/pitch), fara
     * termenul de gaze/iris — indicii exacti ai punctelor de iris in output-ul
     * MediaPipe nu au putut fi verificati fara un device real in acest sandbox,
     * asa ca am preferat sa omit acel termen (risc de semnal gresit) decat sa
     * ghicesc indicii. Ramane un proxy rezonabil: "e capul intors spre camera".
     */
    fun eyeContactScore(yaw: Double, pitch: Double): Double =
        max(0.0, min(1.0, 1 - (abs(yaw) + abs(pitch) * 0.7) / EYE_CONTACT_ANGLE_LIMIT))

    data class HeadPose(val yaw: Double, val pitch: Double)

    /**
     * Extrage yaw/pitch dintr-o matrice de transformare faciala MediaPipe (4x4,
     * COLUMN-major, per documentatia oficiala — element(rand r, coloana c) =
     * m[c*4+r], NU m[r*4+c]). Conventie standard Tait-Bryan pentru rotatie —
     * NEVERIFICATA pe un device real (fara SDK Android in acest sandbox); daca
     * eyeContactScore pare gresit la testarea pe device (ex. mereu ~1 sau
     * valori care nu se schimba cu pozitia capului), aici e primul loc de
     * verificat.
     */
    fun headPoseFromMatrix(m: FloatArray): HeadPose {
        val r20 = m[2].toDouble()  // rand 2, coloana 0 -> index 0*4+2
        val r21 = m[6].toDouble()  // rand 2, coloana 1 -> index 1*4+2
        val r22 = m[10].toDouble() // rand 2, coloana 2 -> index 2*4+2
        val pitch = asin((-r21).coerceIn(-1.0, 1.0))
        val yaw = atan2(r20, r22)
        return HeadPose(yaw, pitch)
    }

    data class ApproxEmotion(val happy: Double, val surprise: Double, val negative: Double)

    /**
     * Aproximare happy/surprise/negative din blendshape-uri MediaPipe (NU un
     * clasificator de emotie — vezi comentariul de la inceputul fisierului).
     * Nume standard ARKit (52 blendshape-uri) — cheile asteptate in `bs`.
     */
    fun approximateEmotion(bs: Map<String, Double>): ApproxEmotion {
        fun v(name: String) = bs[name] ?: 0.0
        val happy = ((v("mouthSmileLeft") + v("mouthSmileRight")) / 2).coerceIn(0.0, 1.0)
        val surprise = (
            (v("jawOpen") + v("browInnerUp") +
                (v("browOuterUpLeft") + v("browOuterUpRight")) / 2 +
                (v("eyeWideLeft") + v("eyeWideRight")) / 2) / 4
        ).coerceIn(0.0, 1.0)
        val negative = (
            (v("browDownLeft") + v("browDownRight")) / 2 +
                (v("mouthFrownLeft") + v("mouthFrownRight")) / 2
        ).div(2).coerceIn(0.0, 1.0)
        return ApproxEmotion(happy, surprise, negative)
    }

    /** Regiune (coordonate PIXEL) pentru decupajul de catchlight — vezi ImageMath.detectCatchlight pentru pasul urmator. */
    data class CropBox(val x: Double, val y: Double, val size: Double)

    fun eyeCropBox(mesh: List<Point>, eye: EyeIndices): CropBox {
        val cx = (mesh[eye.inner].x + mesh[eye.outer].x) / 2
        val cy = (mesh[eye.top].y + mesh[eye.bottom].y) / 2
        val size = max(4.0, dist(mesh[eye.inner], mesh[eye.outer]) * 1.6)
        return CropBox(cx - size / 2, cy - size / 2, size)
    }
}
