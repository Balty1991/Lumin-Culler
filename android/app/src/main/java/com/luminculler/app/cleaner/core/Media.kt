package com.luminculler.app.cleaner.core

/**
 * O poză sau un video din galerie, așa cum îl vede MediaStore.
 *
 * Tot ce e în pachetul `core` e Kotlin pur, fără android.*: se testează pe JVM
 * (test/…/core) și decide ce ajunge pe ecran. Stratul Android doar citește și
 * șterge.
 */
data class Media(
    val id: Long,
    val uri: String,
    val name: String,
    val bytes: Long,
    val folder: String,
    /** Momentul fotografierii, în milisecunde. 0 când nu se știe. */
    val taken: Long,
    val isVideo: Boolean = false,
    val durationMs: Long = 0L
)

/**
 * Ce măsurăm pe o miniatură de ~96 px.
 *
 * `blur` e varianța laplacianului: mică = fără muchii = probabil mișcată sau
 * nefocalizată. `flat` marchează cadrele aproape uniforme (cer, perete, poză
 * neagră), la care și claritatea și amprenta sunt zgomot: nu le punem la
 * neclare și nu le comparăm ca duplicate.
 */
data class Signals(val blur: Float, val hash: Long, val flat: Boolean)
