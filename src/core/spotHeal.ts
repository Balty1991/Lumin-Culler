/**
 * core/spotHeal.ts
 * Vindecare de pete — degetul trece peste un cos, un fir de praf de pe
 * senzor sau un om intrat in cadru, si zona se umple cu textura din jur.
 * In Snapseed instrumentul se numeste "Healing".
 *
 * NU e "inpainting" cu retea neuronala si nici nu vrea sa fie: ar insemna
 * inca un model de descarcat si inca un buget de timp, iar aplicatia asta are
 * o promisiune explicita de viteza. Metoda e cea clasica din editoarele
 * foto — cautare de petic (patch matching):
 *
 *   1. Din tusa degetului iese o masca (cercuri unite, cu margine moale).
 *   2. Se cauta, pe un inel in jurul petei, peticul de aceeasi marime al carui
 *      CHENAR seamana cel mai bine cu chenarul petei. Chenarul e singura parte
 *      pe care o cunoastem in ambele locuri — mijlocul e exact ce vrem sa
 *      inlocuim, deci nu are ce sa ne spuna.
 *   3. Peticul castigator se copiaza peste pata, cu o trecere lina la margini,
 *      ca sa nu ramana un contur vizibil.
 *
 * Tusele se pastreaza pe PhotoRecord.edits, nu in pixeli: editarea ramane
 * complet reversibila si se re-aplica identic la export, pe rezolutia mare.
 */

export interface HealStroke {
  /** Punctele tusei, in coordonate 0..1 ale imaginii ORIGINALE. */
  points: { x: number; y: number }[];
  /** Raza pensulei, ca fractie din latura mai mare a imaginii. */
  radius: number;
}

export const DEFAULT_HEAL_RADIUS = 0.035;
export const MIN_HEAL_RADIUS = 0.008;
export const MAX_HEAL_RADIUS = 0.12;

/** Cate directii incercam pe inelul de cautare. 16 = din 22.5 in 22.5 grade. */
const SEARCH_DIRECTIONS = 24;
/** Razele inelului, ca multiplu al razei petei — mai aproape e mai probabil sa se potriveasca, mai departe scapa de zone care se repeta. */
/**
 * Inelele pe care se cauta zona-sursa, ca multiplu de raza petei. S-a adaugat
 * unul APROPIAT (1.15): pe o suprafata continua — piele, cer, zapada, perete —
 * cel mai bun petic e aproape mereu vecinul imediat, fiindca acolo lumina si
 * textura sunt inca aceleasi. Inainte cea mai apropiata sursa era la peste doua
 * raze distanta, si pe un gradient (un cer care se inchide, o obrazul in umbra)
 * peticul venea deja cu alta luminozitate.
 */
const SEARCH_RINGS = [1.15, 1.7, 2.4, 3.2];
/**
 * Cu cat un candidat e mai departe, cu atat trebuie sa fie mai bun ca sa fie
 * ales. Fara asta, doua zone la fel de potrivite se departajau la intamplare, si
 * de multe ori castiga cea de departe — cu alta lumina.
 */
const DISTANCE_PENALTY = 0.12;
/**
 * Cat de mult poate fi mutat tonul peticului ca sa se potriveasca cu zona in
 * care intra (pe canal, 0..255). Peste atat nu mai e o potrivire, e o pata noua.
 */
const MAX_TONE_SHIFT = 46;
/** Latimea benzii de chenar pe care o comparam, in pixeli. */
const BORDER_BAND = 3;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Masca tusei ca valori 0..1 (1 = se inlocuieste complet, 0 = nu se atinge),
 * impreuna cu dreptunghiul care o incadreaza. Marginea e moale pe ultimii 35%
 * din raza: o masca dura ar lasa un cerc vizibil, oricat de bine ar fi ales
 * peticul.
 */
export function buildStrokeMask(
  stroke: HealStroke, width: number, height: number
): { mask: Float32Array; x0: number; y0: number; x1: number; y1: number } | null {
  if (!stroke.points.length) return null;
  const rPx = Math.max(1, stroke.radius * Math.max(width, height));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x * width); maxX = Math.max(maxX, p.x * width);
    minY = Math.min(minY, p.y * height); maxY = Math.max(maxY, p.y * height);
  }
  const x0 = Math.max(0, Math.floor(minX - rPx - 1));
  const y0 = Math.max(0, Math.floor(minY - rPx - 1));
  const x1 = Math.min(width, Math.ceil(maxX + rPx + 1));
  const y1 = Math.min(height, Math.ceil(maxY + rPx + 1));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  const mask = new Float32Array(w * h);
  const soft = rPx * 0.65; // raza de la care incepe estomparea
  for (const p of stroke.points) {
    const cx = p.x * width, cy = p.y * height;
    const bx0 = Math.max(x0, Math.floor(cx - rPx)), bx1 = Math.min(x1, Math.ceil(cx + rPx));
    const by0 = Math.max(y0, Math.floor(cy - rPx)), by1 = Math.min(y1, Math.ceil(cy + rPx));
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= rPx) continue;
        const v = dist <= soft ? 1 : 1 - (dist - soft) / (rPx - soft);
        const idx = (y - y0) * w + (x - x0);
        if (v > mask[idx]) mask[idx] = v; // cercurile tusei se unesc, nu se aduna
      }
    }
  }
  return { mask, x0, y0, x1, y1 };
}

/**
 * Cauta deplasarea (dx, dy) care aduce cel mai potrivit petic. Scorul se
 * calculeaza DOAR pe pixelii de chenar (masca aproape zero, dar in interiorul
 * dreptunghiului) — vezi comentariul din capul fisierului. Intoarce null daca
 * niciun candidat nu incape complet in imagine.
 */
export function findBestSourceOffset(
  d: Uint8ClampedArray, width: number, height: number,
  region: { mask: Float32Array; x0: number; y0: number; x1: number; y1: number }
): { dx: number; dy: number } | null {
  const { mask, x0, y0, x1, y1 } = region;
  const w = x1 - x0, h = y1 - y0;
  const radius = Math.max(w, h) / 2;

  // pixelii de chenar: in dreptunghi, dar practic neatinsi de masca
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = mask[y * w + x];
      if (m > 0.02) continue;
      // doar banda dinspre marginea dreptunghiului, nu tot ce e in afara petei
      if (x >= BORDER_BAND && x < w - BORDER_BAND && y >= BORDER_BAND && y < h - BORDER_BAND) continue;
      border.push(y * w + x);
    }
  }
  if (border.length === 0) return null;

  let best: { dx: number; dy: number } | null = null;
  let bestScore = Infinity;
  for (let r = 0; r < SEARCH_RINGS.length; r++) {
    const ring = SEARCH_RINGS[r];
    const penalty = 1 + DISTANCE_PENALTY * r;
    for (let k = 0; k < SEARCH_DIRECTIONS; k++) {
      const angle = (k / SEARCH_DIRECTIONS) * Math.PI * 2;
      const dx = Math.round(Math.cos(angle) * radius * ring * 2);
      const dy = Math.round(Math.sin(angle) * radius * ring * 2);
      if (dx === 0 && dy === 0) continue;
      if (x0 + dx < 0 || y0 + dy < 0 || x1 + dx > width || y1 + dy > height) continue;

      let raw = 0;
      const cap = bestScore / penalty; // pragul brut de la care candidatul e deja mai slab
      for (const idx of border) {
        const bx = idx % w, by = (idx - bx) / w;
        const ti = ((y0 + by) * width + (x0 + bx)) * 4;
        const si = ((y0 + by + dy) * width + (x0 + bx + dx)) * 4;
        const dr = d[ti] - d[si], dg = d[ti + 1] - d[si + 1], db = d[ti + 2] - d[si + 2];
        raw += dr * dr + dg * dg + db * db;
        if (raw >= cap) break; // taiere devreme
      }
      const score = raw * penalty;
      if (score < bestScore) { bestScore = score; best = { dx, dy }; }
    }
  }
  return best;
}

/**
 * Aplica o tusa peste bufferul RGBA, la fata locului. Intoarce false cand nu
 * s-a putut vindeca (tusa goala, sau nicio zona-sursa valida — de exemplu o
 * pata fix in colt, cu tot inelul de cautare in afara imaginii).
 */
export function applyHealStroke(d: Uint8ClampedArray, width: number, height: number, stroke: HealStroke): boolean {
  const region = buildStrokeMask(stroke, width, height);
  if (!region) return false;
  const offset = findBestSourceOffset(d, width, height, region);
  if (!offset) return false;

  const { mask, x0, y0, x1, y1 } = region;
  const w = x1 - x0, h = y1 - y0;
  // sursa se citeste dintr-o COPIE: altfel, cand peticul se suprapune peste
  // zona deja rescrisa, am clona pixeli pe care tocmai i-am inlocuit si pata
  // s-ar intinde in loc sa dispara.
  const src = d.slice();

  /**
   * Potrivirea de ton — diferenta dintre "clone stamp" si "healing".
   *
   * Raportat de utilizator: "la retus nu corecteaza tocmai ok". Pana acum
   * peticul se lipea exact asa cum era in zona-sursa. Chiar si cea mai buna
   * sursa are aproape mereu alta luminozitate decat locul in care intra (o
   * obraz e mai luminat intr-o parte, cerul se inchide spre zenit), asa ca
   * ramanea o pata vizibila — de culoarea potrivita, dar de alt ton.
   *
   * Aici se masoara, pe chenarul zonei, cu cat difera in medie sursa de
   * destinatie, si toata bucata copiata se muta cu acea diferenta. Chenarul e
   * exact locul unde peticul trebuie sa se lege de restul imaginii, deci acolo
   * se face si potrivirea. E varianta ieftina a blendingului in domeniul
   * gradientului (Poisson), suficienta pentru pete mici si fara costul lui.
   */
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0.02) continue;
      if (x >= BORDER_BAND && x < w - BORDER_BAND && y >= BORDER_BAND && y < h - BORDER_BAND) continue;
      const ti = ((y0 + y) * width + (x0 + x)) * 4;
      const si = ((y0 + y + offset.dy) * width + (x0 + x + offset.dx)) * 4;
      sumR += d[ti] - src[si];
      sumG += d[ti + 1] - src[si + 1];
      sumB += d[ti + 2] - src[si + 2];
      n++;
    }
  }
  const shiftR = n ? clampShift(sumR / n) : 0;
  const shiftG = n ? clampShift(sumG / n) : 0;
  const shiftB = n ? clampShift(sumB / n) : 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const m = mask[(y - y0) * w + (x - x0)];
      if (m <= 0.002) continue;
      const ti = (y * width + x) * 4;
      const si = ((y + offset.dy) * width + (x + offset.dx)) * 4;
      const r = src[si] + shiftR, g = src[si + 1] + shiftG, b = src[si + 2] + shiftB;
      d[ti] = clamp255(d[ti] + (r - d[ti]) * m);
      d[ti + 1] = clamp255(d[ti + 1] + (g - d[ti + 1]) * m);
      d[ti + 2] = clamp255(d[ti + 2] + (b - d[ti + 2]) * m);
    }
  }
  return true;
}

function clampShift(v: number): number {
  return v > MAX_TONE_SHIFT ? MAX_TONE_SHIFT : v < -MAX_TONE_SHIFT ? -MAX_TONE_SHIFT : v;
}

/** Aplica toate tusele, in ordinea in care au fost desenate. */
export function applyHealStrokes(d: Uint8ClampedArray, width: number, height: number, strokes: HealStroke[] | undefined): void {
  if (!strokes?.length) return;
  for (const s of strokes) applyHealStroke(d, width, height, s);
}
