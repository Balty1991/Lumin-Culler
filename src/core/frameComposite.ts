/**
 * core/frameComposite.ts
 * "Niciun cadru nu e bun pentru toată lumea" — ce două cadre să combini.
 *
 * Problema, si de ce e reala: la o poza de grup, sansa ca TOTI sa iasa bine in
 * acelasi cadru scade rapid cu numarul de oameni. La cinci persoane, statistic,
 * de multe ori pur si simplu NU exista cadrul perfect — fotograful trage zece
 * cadre si niciunul nu e "acela". Fluxul profesionist pentru asta e vechi si
 * bine cunoscut: iei cel mai bun cadru si lipesti peste el capul unei persoane
 * dintr-un alt cadru (head swap, in Photoshop).
 *
 * Ce nu stie nimeni fara sa se uite atent la toate cadrele, unul cate unul, e
 * CARE doua cadre. Aplicatia stie deja, pentru fiecare fata: cine e (embedding
 * de identitate), daca are ochii deschisi, daca zambeste autentic, daca a fost
 * prinsa la mijlocul unui cuvant. Deci poate raspunde exact la intrebarea aia,
 * fara niciun model nou si fara niciun cost de analiza in plus.
 *
 * Ce NU face: montajul. Aplicatia nu lipeste nimic — spune ce sa combini, adica
 * partea pe care un om n-o poate face din ochi. Restul e o operatie de doua
 * minute in orice editor.
 *
 * De ce e plafonat la MAX_SWAPS: daca trei oameni ies prost in cadrul de baza,
 * sfatul "combina patru cadre" nu mai e un sfat, e o alta sedinta foto. Peste
 * pragul ala, raspunsul onest e ca seria n-are un cadru salvabil — si tacerea
 * spune asta mai bine decat o lista.
 *
 * Fara dependinte (nici db.ts): pur, testabil direct.
 */

/** Cat de asemanatoare trebuie sa fie doua fete ca sa le consideram acelasi om intre cadre. */
export const SAME_PERSON_THRESHOLD = 0.5;

/** Peste cat considera "arata bine" — sub asta, persoana strica cadrul. */
export const GOOD_ENOUGH = 0.6;

/** Cat trebuie sa castige o persoana din alt cadru ca sa merite mentionat schimbul. */
export const MIN_SWAP_GAIN = 0.25;

/** Peste atatea schimburi, seria n-are un cadru de baza salvabil — vezi nota de sus. */
export const MAX_SWAPS = 2;

export interface CompositeFace {
  /** Embedding de identitate (FaceInsight.embedding). Fara el, fata nu poate fi urmarita intre cadre. */
  embedding?: number[];
  /** 0..1 — cat de bine arata persoana in acest cadru; vezi faceAppearance(). */
  quality: number;
  /** Numele persoanei, cand e una inrolata (FaceInsight.personName). Vezi FrameSwap.name. */
  name?: string | null;
}

export interface CompositeFrame {
  id: string;
  faces: CompositeFace[];
}

export interface FrameSwap {
  /**
   * Indexul persoanei, in ordinea primei aparitii in serie (dupa filtrarea
   * celor care apar intr-un singur cadru). E o eticheta de rezerva, nu o
   * referinta pe care utilizatorul o poate urmari cu ochiul — vezi `name`.
   */
  person: number;
  /**
   * Numele persoanei, cand e una inrolata.
   *
   * Fara el, sfatul suna "persoana 3 arata mai bine in cadrul 4" — si nimeni nu
   * stie care e a treia: numerotarea vine din ordinea interna de detectie, care
   * nu apare nicaieri pe ecran. Cu un nume, aceeasi propozitie devine imediat
   * urmaribila.
   */
  name?: string;
  /** Cadrul din care sa iei acea persoana. */
  fromFrameId: string;
  /** Cat de mult arata mai bine acolo, 0..1. */
  gain: number;
}

export interface CompositeHint {
  /** Cadrul de la care sa pornesti — cel mai bun pentru cei mai multi. */
  baseFrameId: string;
  /** Cine sa fie luat din alt cadru. Niciodata gol: fara schimburi nu exista sfat de dat. */
  swaps: FrameSwap[];
  /** Cate persoane distincte au putut fi urmarite intre cadre — baza afirmatiei. */
  personCount: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Cat de bine arata o fata, 0..1. Ochii cantaresc cel mai mult si sunt
 * eliminatorii: intr-o poza de grup, un singur om cu ochii inchisi strica poza
 * indiferent cat de bine zambesc ceilalti — de aceea clipitul duce direct
 * scorul aproape de zero, in loc sa fie mediat cu restul.
 */
export function faceAppearance(f: {
  isBlinking: boolean; smile: number; eyeContact?: number; awkward?: boolean;
}): number {
  if (f.isBlinking) return 0;
  const smile = Math.max(0, Math.min(1, f.smile));
  const gaze = Math.max(0, Math.min(1, f.eyeContact ?? 0.5));
  const base = 0.55 + 0.3 * smile + 0.15 * gaze;
  // expresie stanjenitoare (gura deschisa la mijlocul unui cuvant): nu e la fel
  // de grav ca ochii inchisi, dar scoate persoana din "arata bine"
  return Math.max(0, Math.min(1, f.awkward ? base - 0.45 : base));
}

/**
 * Urmareste aceeasi persoana intre cadre. Fiecare "pista" e o persoana; pozitia
 * ei in vectorul intors e indicele folosit de FrameSwap.person.
 *
 * Potrivire lacoma, incrementala: fiecare fata merge la pista cea mai
 * asemanatoare peste prag, altfel deschide una noua. O fata fara embedding nu
 * poate fi urmarita si e ignorata cu totul — mai bine tacem despre ea decat s-o
 * confundam cu altcineva.
 */
function trackPersons(frames: readonly CompositeFrame[]): {
  perFrame: Map<string, number>[];
  nameOf: Map<string, string>;
} {
  /**
   * `reference`, nu "centroida": pastram embedding-ul PRIMEI aparitii si
   * comparam totul cu el, fara sa mediem. E o simplificare constienta —
   * intr-o serie, aceeasi persoana isi schimba putin unghiul intre cadre, deci
   * o medie ar fi ceva mai robusta. Deocamdata nu merita: cadrele unei serii
   * sunt facute la secunde-minute distanta, iar pragul de potrivire e oricum
   * permisiv. De recalibrat daca la testare se rup piste care ar trebui sa fie
   * una singura.
   */
  const tracks: { reference: number[] }[] = [];
  /** per cadru: indicele pistei -> calitatea persoanei in acel cadru */
  const perFrame: Map<string, number>[] = [];
  /** indicele pistei -> numele persoanei, daca s-a aflat din vreun cadru */
  const nameOf = new Map<string, string>();

  for (const frame of frames) {
    const qualityByTrack = new Map<string, number>();
    for (const face of frame.faces) {
      if (!face.embedding?.length) continue;
      let bestTrack = -1;
      let bestSim = SAME_PERSON_THRESHOLD;
      for (let t = 0; t < tracks.length; t++) {
        const sim = cosine(face.embedding, tracks[t].reference);
        if (sim >= bestSim) { bestSim = sim; bestTrack = t; }
      }
      if (bestTrack === -1) {
        tracks.push({ reference: [...face.embedding] });
        bestTrack = tracks.length - 1;
      }
      // o persoana poate aparea o singura data per cadru; daca detectia a dat
      // doua fete apropiate, pastram cea mai buna
      const previous = qualityByTrack.get(String(bestTrack));
      if (previous === undefined || face.quality > previous) qualityByTrack.set(String(bestTrack), face.quality);
      // primul cadru in care persoana a fost recunoscuta da numele; celelalte
      // nu il suprascriu (recunoasterea poate rata pe un cadru, nu si invers)
      if (face.name && !nameOf.has(String(bestTrack))) nameOf.set(String(bestTrack), face.name);
    }
    perFrame.push(qualityByTrack);
  }
  return { perFrame, nameOf };
}

/**
 * Cadrul de la care sa pornesti si cine sa fie luat din alta parte — sau null
 * cand nu e nimic de spus (un singur cadru, o singura persoana, nicio persoana
 * urmaribila, un cadru deja bun pentru toti, sau prea multi de schimbat).
 */
export function suggestComposite(frames: readonly CompositeFrame[]): CompositeHint | null {
  if (frames.length < 2) return null;
  const { perFrame, nameOf } = trackPersons(frames);

  // Persoanele care apar in CEL PUTIN doua cadre — doar despre ele se poate
  // spune "arata mai bine dincolo".
  const seenIn = new Map<string, number>();
  for (const frame of perFrame) for (const track of frame.keys()) seenIn.set(track, (seenIn.get(track) ?? 0) + 1);
  const persons = [...seenIn.entries()].filter(([, n]) => n >= 2).map(([track]) => track);
  // Cu o singura persoana, "cel mai bun cadru" e deja raspunsul complet — nu e
  // nimic de combinat, iar asta alege oricum pickBestInGroup.
  if (persons.length < 2) return null;

  const scoreOf = (frameIndex: number, track: string) => perFrame[frameIndex].get(track) ?? 0;

  // Cadrul de baza: cel cu cei mai multi oameni "buni"; la egalitate, cel cu
  // suma cea mai mare. NU cel cu media cea mai mare — o poza in care doi ies
  // stralucit si unul clipeste e mai proasta decat una in care toti sunt decenti.
  let baseIndex = 0, bestGood = -1, bestSum = -1;
  frames.forEach((_, i) => {
    const good = persons.filter(t => scoreOf(i, t) >= GOOD_ENOUGH).length;
    const sum = persons.reduce((s, t) => s + scoreOf(i, t), 0);
    if (good > bestGood || (good === bestGood && sum > bestSum)) { bestGood = good; bestSum = sum; baseIndex = i; }
  });

  const swaps: FrameSwap[] = [];
  persons.forEach((track, personIndex) => {
    const here = scoreOf(baseIndex, track);
    if (here >= GOOD_ENOUGH) return;
    let bestFrame = -1, bestScore = here;
    frames.forEach((_, i) => {
      if (i === baseIndex) return;
      const score = scoreOf(i, track);
      if (score > bestScore) { bestScore = score; bestFrame = i; }
    });
    if (bestFrame === -1 || bestScore - here < MIN_SWAP_GAIN || bestScore < GOOD_ENOUGH) return;
    const name = nameOf.get(track);
    swaps.push({ person: personIndex, fromFrameId: frames[bestFrame].id, gain: bestScore - here, ...(name ? { name } : {}) });
  });

  if (!swaps.length || swaps.length > MAX_SWAPS) return null;
  return {
    baseFrameId: frames[baseIndex].id,
    swaps: swaps.sort((a, b) => b.gain - a.gain),
    personCount: persons.length
  };
}
