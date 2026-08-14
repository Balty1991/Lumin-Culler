/**
 * core/groupSelection.ts
 * Alegerea "celei mai bune" poze dintr-un grup de cadre similare (serie/
 * duplicate), aplicand o ierarhie de criterii fotografice explicita —
 * claritate > expunere > compozitie > expresii faciale > contact vizual —
 * in loc sa se bazeze STRICT pe scorul AI brut (care, la "cold start" cu
 * modelul neantrenat, poate fi aproape identic pentru cadre foarte similare
 * si nu distinge bine intre ele).
 *
 * Zero dependinte (nu importa db.ts / store.ts / Dexie) ca sa poata fi
 * folosit atat din hashCompare.worker.ts (grupare la import) cat si din
 * state/store.ts (selectBestPhotoInGroup, apelabil din UI) fara import-uri
 * circulare sau a trage tot bundle-ul aplicatiei intr-un worker.
 */

export interface GroupCandidate {
  id: string;
  sharpness: number;              // 0..100
  exposure: number;                // 0..100
  compositionScore?: number;       // 0..1, absent = neutru
  faceCount: number;
  bestSmile: number;               // 0..1
  groupSmileRatio?: number;        // 0..1, doar la faceCount > 1
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;     // 0..1, doar la faceCount > 1
  avgEyeContact?: number;          // 0..1
  /**
   * Fractiune de fete prinse "la mijlocul vorbirii"/cascat (vezi
   * groupAwkwardRatio pe AnalysisRecord) — 0..1, absent = neutru.
   * Intr-o rafala e adesea SINGURA diferenta reala intre cadre: claritatea,
   * expunerea si compozitia sunt practic identice de la un cadru la altul, dar
   * unul are gura deschisa la mijlocul unui cuvant. Fara el, alegerea intre
   * doua cadre gemene se facea la a patra zecimala a claritatii.
   */
  groupAwkwardRatio?: number;
  /** Subiectul principal e mai clar decat fundalul. Absent/necunoscut = neutru. */
  subjectInFocus?: boolean;
  /** Fractiune de pixeli arsi in highlights, 0..1 — absent = neutru. */
  highlightClipping?: number;
  /** Scorul dat de motorul invatat (0..100). Absent = se foloseste doar ierarhia fixa de mai jos. */
  aiScore?: number;
}

/** Cat ramane din claritatea globala cand subiectul insusi e confirmat neclar — vezi fixedScore. */
const SUBJECT_BLUR_DISCOUNT = 0.6;

/**
 * Scor compozit 0..1 pentru un candidat — nu doar un tiebreak lexicografic
 * (ar ignora complet criteriile secundare la orice diferenta, oricat de mica,
 * pe primul), ci o medie ponderata dupa importanta fotografica: claritatea
 * conteaza cel mai mult (o poza neclara nu se salveaza prin nimic altceva),
 * urmata de expunere, compozitie, apoi calitatea expresiilor/contactul vizual.
 */
function fixedScore(c: GroupCandidate): number {
  const exposureBalance = 1 - Math.abs(c.exposure - 50) / 50;
  // Expresia: zambet + ochi deschisi, minus momentele prinse la mijlocul
  // vorbirii. Scaderea, nu media: o expresie stanjenitoare e un DEFECT al
  // cadrului, nu inca o calitate care se mediaza cu celelalte — un cadru cu
  // toata lumea zambind si unul singur cu gura deschisa la mijlocul unui cuvant
  // trebuie sa iasa clar in urma celui curat.
  const faceQuality = c.faceCount > 0
    ? Math.max(0,
        0.5 * (c.faceCount > 1 ? c.groupSmileRatio ?? c.bestSmile : c.bestSmile)
        + 0.5 * (c.faceCount > 1 ? c.groupEyesOpenRatio ?? (c.allEyesOpen ? 1 : 0) : (c.allEyesOpen ? 1 : 0))
        - (c.groupAwkwardRatio ?? 0))
    : 0.5;
  const eyeContact = c.avgEyeContact ?? 0.5;
  // Claritatea GLOBALA nu distinge cadrul cu subiectul clar si fundalul difuz de
  // cel in care s-a intamplat exact invers — diferenta cea mai frecventa intre
  // doua cadre dintr-o rafala in care autofocusul "vaneaza". Acelasi rationament
  // ca subjectConfirmedOutOfFocus din importPipeline.ts: cand subiectul e
  // CONFIRMAT neclar, claritatea globala nu mai e o masura de incredere a
  // cadrului (poate fi mare doar din prim-planul ascutit), deci o scontam.
  //
  // Modificator, nu termen separat cu pondere proprie: claritatea trebuie sa
  // ramana criteriul dominant cu greutatea ei intreaga — un cadru complet neclar
  // nu are voie sa castige o serie oricat de bine ar sta la restul.
  // Necunoscut (absent, web/inregistrari vechi) nu sconteaza nimic.
  const clarity = (c.sharpness / 100) * (c.subjectInFocus === false ? SUBJECT_BLUR_DISCOUNT : 1);
  // Highlights arse: dintre defectele care despart doua cadre dintr-o rafala,
  // singurul complet ireparabil la editare — detaliul chiar lipseste din fisier.
  const highlights = 1 - Math.min(1, Math.max(0, c.highlightClipping ?? 0));
  return (
    0.35 * clarity +
    0.18 * exposureBalance +
    0.07 * highlights +
    0.18 * (c.compositionScore ?? 0.5) +
    0.15 * faceQuality +
    0.07 * eyeContact
  );
}

/**
 * Scorul final al unui candidat: ierarhia fixa de mai sus, amestecata cu ce a
 * invatat motorul din deciziile TALE.
 *
 * De ce amestec si nu una sau alta: ierarhia fixa e robusta cand motorul nu
 * stie inca nimic (cadre aproape identice primesc scoruri AI aproape egale, si
 * alegerea ar fi la noroc) — de asta a fost scrisa. Dar dupa zeci de corectii,
 * a IGNORA complet ce a invatat inseamna ca, exact la decizia cu cel mai mare
 * impact din culling (ce cadru supravietuieste dintr-o rafala), preferintele
 * tale n-au niciun cuvant de spus. `learnedWeight` creste de la 0 la 1 pe
 * masura ce motorul chiar are ce spune — vezi ContextEngine.learnedWeight().
 */
function groupScore(c: GroupCandidate, learnedWeight: number): number {
  const fixed = fixedScore(c);
  const blended = c.aiScore === undefined || learnedWeight <= 0
    ? fixed
    : (() => {
        const w = Math.max(0, Math.min(1, learnedWeight));
        return (1 - w) * fixed + w * (Math.max(0, Math.min(100, c.aiScore)) / 100);
      })();
  // Bug real gasit de auditul QA: cu un singur camp ne-finit pe un candidat
  // (sharpness/exposure NaN dintr-o inregistrare corupta sau dintr-un plugin
  // nativ care a intors un numar invalid), scorul lui devenea NaN — iar ORICE
  // comparatie cu NaN e falsa, deci bucla `score > bestScore` din
  // pickBestInGroup nu-l mai putea inlocui NICIODATA odata ce ajungea `best`.
  // Concret: daca poza corupta era PRIMA din serie, castiga automat rafala
  // (devine cadrul propus, restul sunt demovate la 'review') indiferent cat de
  // bune erau celelalte — iar rezultatul depindea de ordinea din vector, nu de
  // calitate. Un candidat nemasurabil trebuie sa fie ULTIMUL, nu primul.
  return Number.isFinite(blended) ? blended : 0;
}

/** Returneaza id-ul celui mai bun candidat dintr-un grup (dupa groupScore). Arunca daca grupul e gol. */
export function pickBestInGroup(candidates: GroupCandidate[], learnedWeight = 0): string {
  if (!candidates.length) throw new Error('pickBestInGroup: grup gol');
  let best = candidates[0];
  let bestScore = groupScore(best, learnedWeight);
  for (let i = 1; i < candidates.length; i++) {
    const score = groupScore(candidates[i], learnedWeight);
    if (score > bestScore) { bestScore = score; best = candidates[i]; }
  }
  return best.id;
}
