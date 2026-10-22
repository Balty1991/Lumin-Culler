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
data class Signals(
    val blur: Float,
    val hash: Long,
    val flat: Boolean,
    /**
     * dHash 16×16 (256 de biți, în 4 Long-uri). Amprenta de 64 de biți e prea
     * grosieră ca dovadă de duplicat: două capturi din aceeași aplicație, cu
     * cifre diferite, ies identice pe 9×8. Pe cea fină, diferențele de text și
     * de cadru se văd.
     */
    val fine: LongArray = LongArray(0)
) {
    override fun equals(other: Any?): Boolean =
        other is Signals && blur == other.blur && hash == other.hash && flat == other.flat && fine.contentEquals(other.fine)

    override fun hashCode(): Int = (hash xor fine.contentHashCode().toLong()).hashCode()
}
