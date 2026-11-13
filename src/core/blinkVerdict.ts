/**
 * core/blinkVerdict.ts
 * „Ochi închiși” spus ca un om, nu ca un senzor (raportat: tortul cu familia, tata care râde
 * cu copilul pe canapea, respinse pentru „cineva are ochii închiși”; nu erau).
 *
 *  - Râsul strânge ochii: o față care zâmbește larg nu clipește, cât ochii nu sunt de tot închiși.
 *  - Un singur ochi „închis” e de obicei un cap întors, o șuviță sau o umbră: clipitul ia ambii ochi.
 *  - Fețele mici din fundal (trecători, o rudă departe) nu decid poza.
 *  - La un grup, poza e „cu ochii închiși” doar dacă fața principală clipește sau jumătate din fețe.
 */
export interface EyeFace {
  /** [x, y, w, h], fracții din imagine. */
  box?: readonly number[];
  smile?: number;
  /** Înclinarea capului sus/jos, în grade, când se știe. */
  pitch?: number;
  eyesOpen: { left: number; right: number };
}

/** Peste atât, zâmbetul strânge ochii (râs), nu clipește. */
export const LAUGH_SMILE = 0.6;
/** Fețele sub atâta din cea mai mare nu decid poza. */
const MINOR_FACE = 0.55;
/** Fețele sub 5% din lățimea pozei nu decid poza (dacă nu e singura). */
const TINY_FACE = 0.05;

/** Peste atâtea grade sus/jos, pleoapele par lăsate fără să fie închise. */
export const TILT_DEG = 15;

export function faceBlinks(f: EyeFace, rawThreshold: number): boolean {
  const { left, right } = f.eyesOpen;
  // Privirea în jos (la tort, la o jucărie): pleoapele coboară și par închise. Cu capul înclinat,
  // „închis” înseamnă doar ochi aproape lipiți (raportat: copilul aplecat peste tort, „ochi închiși”).
  const threshold = Math.abs(f.pitch ?? 0) >= TILT_DEG ? rawThreshold * 0.45 : rawThreshold;
  // Clipitul închide ambii ochi; cu unul singur sub prag, celălalt trebuie să fie și el aproape.
  const both = left < threshold && right < threshold;
  const oneDeep = Math.min(left, right) < threshold * 0.5 && Math.max(left, right) < threshold * 1.4;
  if (!both && !oneDeep) return false;
  // Râde: ochii strânși, dar nu de tot închiși.
  if ((f.smile ?? 0) >= LAUGH_SMILE && Math.max(left, right) >= threshold * 0.35) return false;
  return true;
}

const width = (f: EyeFace) => (f.box && f.box.length >= 3 ? f.box[2] : undefined);

/** Fețele care contează: cea mai mare și cele apropiate de ea ca mărime. */
export function mainFaces<T extends EyeFace>(faces: readonly T[]): T[] {
  if (faces.length <= 1) return [...faces];
  const widths = faces.map(f => width(f) ?? 0);
  const biggest = Math.max(...widths);
  if (!(biggest > 0)) return [...faces];
  return faces.filter((_, i) => widths[i] >= biggest * MINOR_FACE && widths[i] >= TINY_FACE);
}

/** Poza are „ochii închiși”: fața principală clipește, sau cel puțin jumătate din fețele principale. */
export function photoEyesClosed(faces: readonly EyeFace[], threshold: number): boolean {
  const main = mainFaces(faces);
  if (!main.length) return false;
  const lead = main.reduce((a, b) => ((width(b) ?? 0) > (width(a) ?? 0) ? b : a));
  if (faceBlinks(lead, threshold)) return true;
  const closed = main.filter(f => faceBlinks(f, threshold)).length;
  return main.length >= 2 && closed * 2 >= main.length;
}

/** Din fețele deja marcate (isBlinking): poza are ochii deschiși după regula fețelor principale. */
export function eyesOpenFromFlags(faces: readonly (EyeFace & { isBlinking: boolean })[]): boolean {
  const main = mainFaces(faces);
  if (!main.length) return true;
  const lead = main.reduce((a, b) => ((width(b) ?? 0) > (width(a) ?? 0) ? b : a));
  if (lead.isBlinking) return false;
  const closed = main.filter(f => f.isBlinking).length;
  return !(main.length >= 2 && closed * 2 >= main.length);
}
