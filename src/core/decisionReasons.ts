/**
 * core/decisionReasons.ts
 *
 * DE CE ai luat decizia — spus de om, in cuvintele lui, si legat de ce chiar
 * masoara motorul.
 *
 * Cerinta directa a utilizatorului: "sa pot sa ii adaug un comentariu sa ii
 * spun de ce am respins, ca să înțeleagă și să învețe din asta pentru viitor
 * — de exemplu resping ca nu îmi place fundalul din spate, nu are suficient
 * bokeh, sau nu îmi place pozitia corpului".
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CE POATE SI CE NU POATE MOTORUL, spus pe fata
 *
 * Toate cele trei exemple ale lui corespund unor lucruri pe care aplicatia
 * CHIAR le masoara si le are deja in vectorul de trasaturi: `bokehQuality`,
 * `negativeSpace`/`compositionScore` pentru fundal, `headroom`/`ruleOfThirds`/
 * `bodyCroppedAtEdge` pentru pozitia corpului. Deci un motiv APASAT nu e
 * decor: schimba felul in care se face pasul de invatare.
 *
 * Ce NU poate: sa citeasca text liber in romana si sa-l transforme intr-o
 * pondere. Pentru asta ar trebui un model de limbaj pe telefon, iar singurul
 * disponibil (Gemini Nano) scrie deocamdata doar in engleza si nu e pe toate
 * telefoanele. Nota scrisa de mana se pastreaza, se vede in istoric si se
 * poate CAUTA — dar motorul invata din butoanele apasate, nu din ea. Textul
 * din UI spune exact asta; o aplicatie n-are voie sa se prefaca ca intelege.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Fiecare motiv trimite catre trasaturile REALE pe care le acuza. La
 * antrenare, alea primesc un pas mai mare, restul unul mai mic (vezi
 * REASON_FEATURE_BOOST in ContextEngine.ts): omul a spus ce a cantarit, deci
 * gradientul se duce acolo, in loc sa se imparta egal peste tot.
 *
 * Nu exista motive care sa nu se lege de nimic. Un buton care nu schimba nimic
 * ar fi o minciuna politicoasa, si dupa cateva sute de apasari ar fi si o
 * minciuna scumpa.
 */

export interface DecisionReason {
  id: string;
  /** Trasaturile din FeatureVector pe care le acuza motivul. Vezi PRIOR_WEIGHTS. */
  features: string[];
  /** Pe ce decizii are sens sa fie oferit. */
  on: ('selected' | 'rejected')[];
}

export const DECISION_REASONS: DecisionReason[] = [
  // ── Ce se poate spune despre o poza respinsa ──
  { id: 'blurry', features: ['sharpness', 'subjectInFocus'], on: ['rejected'] },
  { id: 'subjectSoft', features: ['subjectInFocus', 'sharpness'], on: ['rejected'] },
  { id: 'background', features: ['negativeSpace', 'compositionScore', 'bokehQuality'], on: ['rejected'] },
  { id: 'noBokeh', features: ['bokehQuality', 'apertureRaw'], on: ['rejected'] },
  { id: 'pose', features: ['headroom', 'ruleOfThirds', 'bodyCroppedAtEdge', 'subjectProminence'], on: ['rejected'] },
  { id: 'expression', features: ['bestSmile', 'groupSmileRatio', 'groupAwkwardRatio', 'groupGenuineSmileRatio'], on: ['rejected'] },
  { id: 'eyes', features: ['allEyesOpen', 'groupEyesOpenRatio', 'avgEyeContact'], on: ['rejected'] },
  { id: 'exposure', features: ['exposureBalance', 'highlightClipping', 'shadowClipping'], on: ['rejected'] },
  { id: 'noise', features: ['isoPenalty', 'sharpness'], on: ['rejected'] },
  { id: 'crooked', features: ['horizonLevel', 'compositionScore'], on: ['rejected'] },
  { id: 'color', features: ['colorHarmony', 'groupSkinToneNaturalRatio'], on: ['rejected'] },
  { id: 'notAMemory', features: ['textCoverage', 'noCameraMetadata'], on: ['rejected'] },

  // ── Si despre una pastrata. Acelasi mecanism, alta directie: aici omul
  //    confirma ce a cantarit IN FAVOAREA ei, iar gradientul se duce tot acolo.
  { id: 'keepMoment', features: ['bestSmile', 'groupGenuineSmileRatio', 'avgEngagement'], on: ['selected'] },
  { id: 'keepLight', features: ['goldenHour', 'lightSoft', 'exposureBalance'], on: ['selected'] },
  { id: 'keepComposition', features: ['compositionScore', 'ruleOfThirds', 'leadingLines', 'symmetry'], on: ['selected'] },
  { id: 'keepSharp', features: ['sharpness', 'subjectInFocus', 'bokehQuality'], on: ['selected'] },
  { id: 'keepPerson', features: ['knownFaceRatio', 'subjectProminence', 'avgEyeContact'], on: ['selected'] }
];

const BY_ID = new Map(DECISION_REASONS.map(r => [r.id, r]));

/** Motivele oferite pentru o decizie anume, in ordinea din catalog. */
export function reasonsFor(decision: 'selected' | 'rejected'): DecisionReason[] {
  return DECISION_REASONS.filter(r => r.on.includes(decision));
}

/**
 * Trasaturile acuzate de motivele alese, fara duplicate.
 *
 * Id-urile necunoscute sunt ignorate in tacere, nu aruncate: o inregistrare
 * salvata de o versiune mai veche a aplicatiei nu are voie sa rupa o decizie.
 */
export function featuresForReasons(reasonIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of reasonIds) {
    for (const f of BY_ID.get(id)?.features ?? []) out.add(f);
  }
  return [...out];
}
