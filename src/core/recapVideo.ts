/**
 * core/recapVideo.ts
 *
 * Planul unui recap video — cine apare, cat sta pe ecran, cat dureaza tot.
 *
 * Prezentarea exista deja si ruleaza pozele pe ecran intreg. Ce lipsea era
 * un FISIER: puteai sa te uiti, dar nu puteai trimite nimic mai departe. Un
 * clip de douazeci de secunde cu cele mai bune poze ale lunii e ceva ce omul
 * trimite in familie — iar fiecare trimitere e reclama pentru aplicatie.
 *
 * Modulul asta nu deseneaza nimic si nu inregistreaza nimic (vezi
 * recapVideoRender.ts pentru partea care atinge canvas-ul si MediaRecorder).
 * Aici sta doar aritmetica, ca sa poata fi verificata fara browser: cate poze
 * incap, cat sta fiecare, unde incepe si unde se termina fiecare tranzitie.
 *
 * DE CE UN PLAFON DE DURATA: un recap e ceva ce se priveste pana la capat.
 * Patruzeci de poze la doua secunde fac un minut si douazeci — adica ceva ce
 * nimeni nu deschide a doua oara, si pe care nimeni nu-l trimite. Plafonul nu e
 * o limitare tehnica, e definitia lucrului.
 */

/** Cat sta o poza pe ecran, fara tranzitii. Sub o secunda si jumatate nu apuci sa te uiti la ea. */
export const HOLD_MS = 1800;
/** Trecerea de la o poza la alta. Se SUPRAPUNE peste hold-uri, nu se adauga la ele. */
export const FADE_MS = 500;
/** Peste atat, nimeni nu se mai uita pana la capat. */
export const MAX_TOTAL_MS = 30_000;
/** Sub atatea poze nu e un recap, e o poza cu muzica. */
export const MIN_PHOTOS = 3;
/** Cadre pe secunda. 30 e destul pentru un fade si o panoramare lenta, si e de doua ori mai ieftin decat 60. */
export const FPS = 30;

export interface RecapFrame {
  id: string;
  /** Cand incepe sa se vada, in milisecunde de la inceputul clipului. */
  startMs: number;
  /** Cat timp e vizibila, inclusiv intrarea si iesirea. */
  durationMs: number;
}

export interface RecapPlan {
  frames: RecapFrame[];
  totalMs: number;
  fadeMs: number;
  fps: number;
  /** Cate poze au ramas pe dinafara din cauza plafonului de durata. */
  omitted: number;
}

/**
 * Cate poze incap intr-un clip de cel mult `MAX_TOTAL_MS`.
 *
 * Fiecare poza aduce HOLD_MS, dar tranzitiile se suprapun, deci n poze
 * inseamna n*HOLD - (n-1)*FADE. Rezolvat pentru n, nu cautat prin incercari.
 */
function fitCount(available: number, maxTotalMs: number): number {
  const perExtra = HOLD_MS - FADE_MS;
  const n = Math.floor((maxTotalMs - FADE_MS) / perExtra);
  return Math.max(1, Math.min(available, n));
}

/**
 * Planul clipului din pozele DEJA alese si ordonate de apelant.
 *
 * Nu reordoneaza nimic: ordinea vine din recap (cele mai bune ale lunii, deja
 * trecute prin subjectSignificance) sau din prezentare. Aici doar taiem la
 * plafon si calculam timpii.
 */
export function planRecapVideo(photoIds: string[], maxTotalMs = MAX_TOTAL_MS): RecapPlan | null {
  if (photoIds.length < MIN_PHOTOS) return null;
  const count = fitCount(photoIds.length, maxTotalMs);
  const frames: RecapFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      id: photoIds[i],
      startMs: i * (HOLD_MS - FADE_MS),
      durationMs: HOLD_MS
    });
  }
  const last = frames[frames.length - 1];
  return {
    frames,
    totalMs: last.startMs + last.durationMs,
    fadeMs: FADE_MS,
    fps: FPS,
    omitted: photoIds.length - count
  };
}

/**
 * Cat de vizibila e o poza la un moment dat: 0 = deloc, 1 = complet.
 *
 * Intrarea si iesirea sunt liniare. Prima poza nu are fade-in si ultima nu are
 * fade-out — un clip care incepe si se termina in negru pare rupt, nu montat.
 */
export function frameOpacity(plan: RecapPlan, index: number, timeMs: number): number {
  const f = plan.frames[index];
  if (!f) return 0;
  const end = f.startMs + f.durationMs;
  // Comparatii STRICTE, nu `<=` / `>=`: la exact `startMs` prima poza trebuie sa
  // se vada deja complet, altfel clipul incepe cu un cadru negru. Bug prins de
  // testul "in orice moment se vede ceva".
  if (timeMs < f.startMs || timeMs > end) return 0;
  const isFirst = index === 0;
  const isLast = index === plan.frames.length - 1;
  if (!isFirst && timeMs < f.startMs + plan.fadeMs) {
    return (timeMs - f.startMs) / plan.fadeMs;
  }
  if (!isLast && timeMs > end - plan.fadeMs) {
    return (end - timeMs) / plan.fadeMs;
  }
  return 1;
}

/**
 * Panoramare lenta peste durata unei poze: 1 la inceput, `PAN_SCALE` la final.
 *
 * Fara ea, un clip din poze fixe arata ca un slideshow de PowerPoint. Cu ea,
 * arata filmat. Deliberat mic: peste cateva procente devine ametitor pe un
 * ecran de telefon.
 */
export const PAN_SCALE = 1.06;

export function frameScale(plan: RecapPlan, index: number, timeMs: number): number {
  const f = plan.frames[index];
  if (!f) return 1;
  const progress = Math.max(0, Math.min(1, (timeMs - f.startMs) / f.durationMs));
  return 1 + (PAN_SCALE - 1) * progress;
}
