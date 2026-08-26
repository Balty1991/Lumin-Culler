import type { EditAdjustments } from './imageAdjust';

/**
 * core/editStyle.ts
 *
 * STILUL TAU DE EDITARE, invatat din ce faci si aplicat mai departe.
 *
 * Cerinta utilizatorului, dupa ce a vazut reclama Aftershoot ("applies your
 * base edit across your gallery"). Aia e alta functie decat trierea: nu
 * "care poza", ci "cum arata o poza cand am terminat eu cu ea".
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CE SE INVATA, SI DE CE ASA
 *
 * NU valorile absolute la care ajungi. O poza intunecata cere +30 la expunere
 * de la oricine — asta nu e stilul tau, e ce cerea poza. Daca am invata
 * absolutul, prima ta sesiune de poze subexpuse ar convinge motorul ca "iti
 * plac pozele luminoase" si le-ar lumina apoi si pe cele deja bune.
 *
 * Se invata DIFERENTA fata de ce ar fi facut Auto singur. Auto rezolva deja ce
 * cerea poza; ce mai adaugi tu peste el, constant, ala e stilul. Daca dupa Auto
 * mai pui mereu +8 contrast si -5 pe cald, aia se invata — si nimic altceva.
 *
 * Media e o medie simpla, cu numarator. Nu e un model, si nici nu are de ce sa
 * fie: sunt paisprezece numere, si intrebarea "cat adaugi de obicei" chiar are
 * ca raspuns o medie.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * Cate poze editate trebuie sa vada inainte sa aiba curajul sa aplice ceva.
 *
 * Trei, nu una: o singura poza pe care ai impins contrastul la maximum ca sa
 * vezi ce face n-are voie sa devina "stilul" tau. Sub prag, profilul se
 * strange in tacere si nu schimba nimic.
 */
export const STYLE_MIN_SAMPLES = 3;

/**
 * Cat de mult are voie stilul sa mute un slider, oricat de constant ai fi.
 *
 * Fara plafon, cineva care editeaza treizeci de poze de concert (toate impinse
 * tare) ar ajunge cu un stil care distruge o poza normala. Plafonul e generos
 * cat sa se simta, si strans cat sa nu strice: peste el, tot ce e in plus e
 * treaba ta cu sliderul, nu a motorului.
 */
export const STYLE_MAX_DELTA = 25;

/** Sliderele din care se invata stil. Deliberat NU toate. */
const STYLE_KEYS = [
  'exposure', 'contrast', 'saturation', 'temperature', 'tint',
  'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'vignette', 'sharpen',
  // Gradarea si bobul stau aici din acelasi motiv ca vinieta: sunt alegeri de
  // GUST, constante de la o poza la alta la acelasi om, si exact felul de
  // lucru pe care merita sa-l inveti din ce a facut el de mana.
  'grade', 'grain'
] as const;

export type StyleKey = typeof STYLE_KEYS[number];

/**
 * De ce lipsesc `noiseReduction`, `crop`, `rotationDeg`, `curves`, `hsl`:
 *
 *  - reducerea de zgomot depinde de ISO-ul cadrului, nu de gust;
 *  - decuparea si indreptarea depind de ce e IN cadru — un stil de recadrare
 *    aplicat orbeste taie capete de oameni;
 *  - curbele si gamele de culoare sunt structuri, nu numere, si o medie intre
 *    doua curbe nu inseamna nimic.
 *
 * Toate raman perfect editabile manual. Doar nu se invata din ele.
 */
export interface EditStyleProfile {
  /** Media diferentelor fata de Auto, per slider. */
  deltas: Partial<Record<StyleKey, number>>;
  /** Din cate poze editate s-a strans. */
  samples: number;
  updatedAt: number;
}

export const EMPTY_STYLE: EditStyleProfile = { deltas: {}, samples: 0, updatedAt: 0 };

function clampDelta(value: number): number {
  return Math.max(-STYLE_MAX_DELTA, Math.min(STYLE_MAX_DELTA, value));
}

/** Diferenta dintre unde ai ajuns tu si ce facuse Auto, doar pe sliderele de stil. */
export function styleDelta(userEdit: EditAdjustments, autoBaseline: EditAdjustments): Partial<Record<StyleKey, number>> {
  const out: Partial<Record<StyleKey, number>> = {};
  for (const key of STYLE_KEYS) {
    const delta = (userEdit[key] ?? 0) - (autoBaseline[key] ?? 0);
    // Sub o unitate nu e o alegere, e zgomot de deget pe un slider.
    if (Math.abs(delta) >= 1) out[key] = delta;
  }
  return out;
}

/**
 * Profilul dupa inca o poza editata.
 *
 * Sliderele pe care NU le-ai atins de data asta intra in medie ca 0, nu se
 * sar: "de data asta n-am adaugat contrast" e o informatie la fel de reala ca
 * "am adaugat 8", si fara ea o singura poza cu contrast impins ar ramane
 * pentru totdeauna media, oricate poze normale ar urma dupa.
 */
export function foldStyleSample(
  profile: EditStyleProfile,
  delta: Partial<Record<StyleKey, number>>
): EditStyleProfile {
  const n = profile.samples;
  const deltas: Partial<Record<StyleKey, number>> = {};
  for (const key of STYLE_KEYS) {
    const previous = profile.deltas[key] ?? 0;
    const next = (previous * n + (delta[key] ?? 0)) / (n + 1);
    if (Math.abs(next) >= 0.5) deltas[key] = Math.round(next * 10) / 10;
  }
  return { deltas, samples: n + 1, updatedAt: Date.now() };
}

/** true daca profilul are destul cat sa merite aplicat. */
export function styleIsReady(profile: EditStyleProfile): boolean {
  return profile.samples >= STYLE_MIN_SAMPLES && Object.keys(profile.deltas).length > 0;
}

/**
 * Auto, plus stilul tau peste el.
 *
 * Rezultatul ramane in -100..100 pe fiecare slider: stilul ADAUGA la ce a
 * hotarat Auto, nu inlocuieste, si nu are voie sa iasa din scala.
 */
export function applyStyle(auto: EditAdjustments, profile: EditStyleProfile): EditAdjustments {
  if (!styleIsReady(profile)) return auto;
  const out: EditAdjustments = { ...auto };
  for (const key of STYLE_KEYS) {
    const delta = profile.deltas[key];
    if (delta === undefined) continue;
    const combined = (out[key] ?? 0) + clampDelta(delta);
    out[key] = Math.max(-100, Math.min(100, Math.round(combined)));
  }
  return out;
}

/** Sliderele pe care stilul chiar le muta, cele mai apasate intai — pentru mesajul catre om. */
export function styleTopKeys(profile: EditStyleProfile, limit = 3): StyleKey[] {
  return (Object.entries(profile.deltas) as [StyleKey, number][])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([key]) => key);
}
