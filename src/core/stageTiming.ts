/**
 * core/stageTiming.ts
 *
 * Cat dureaza fiecare etapa a importului, pe ACEST telefon.
 *
 * Pana acum exista un singur numar: ETA-ul global (etaEstimate.ts), calculat
 * din poze/secunda. E suficient ca sa arati o bara de progres, dar nu raspunde
 * la intrebarea care conteaza cand ceva merge prost: unde s-a dus timpul.
 * Un import lent poate fi decodare (RAW pe un procesor slab), poate fi analiza
 * AI (backend cazut pe WASM), poate fi scrierea in baza de date (stocare
 * aproape plina) sau gruparea (comparatie O(n^2) pe o biblioteca mare). Fara
 * defalcare, toate arata la fel din afara: "e lent".
 *
 * CE SE INREGISTREAZA: numai durate si numaratori. Niciun nume de fisier,
 * nicio miniatura, niciun embedding, niciun text OCR, nicio coordonata. Nimic
 * din ce se strange aici nu poate identifica o poza sau o persoana, si nimic
 * nu pleaca de pe dispozitiv — datele stau in localStorage si se sterg dintr-o
 * apasare. Daca vreodata ajung sa fie trimise undeva, asta devine o decizie
 * separata, cu opt-in explicit si Data Safety actualizat.
 *
 * Pentru fiecare etapa tinem numaratorul, totalul si un esantion MARGINIT de
 * durate. Esantionul marginit e alegerea importanta: media singura ascunde
 * exact cazul interesant (o poza din o suta care dureaza 40 de secunde se
 * pierde intr-o medie), iar pastrarea tuturor duratelor ar creste nelimitat pe
 * o biblioteca de mii de poze. Cu rezervoir sampling, p90 ramane reprezentativ
 * la memorie constanta.
 */

/** Etapele masurate. Ordinea e cea in care ruleaza, si e ordinea de afisare. */
export const STAGES = ['decode', 'derivatives', 'analysis', 'exif', 'persist', 'grouping'] as const;
export type Stage = (typeof STAGES)[number];

/** Cate durate pastram per etapa. 200 e destul pentru un p90 stabil si ramane sub ~2 KB in localStorage. */
export const SAMPLE_CAP = 200;

const KEY = 'lumin-stage-timing';

interface StageRecord {
  count: number;
  totalMs: number;
  /** Esantion marginit prin rezervoir sampling — vezi comentariul din capul fisierului. */
  sample: number[];
  /** Cate valori au trecut prin esantion, pentru ca inlocuirea sa ramana uniforma. */
  seen: number;
}

type Store = Partial<Record<Stage, StageRecord>>;

let memory: Store | null = null;

function load(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memory = isStore(parsed) ? parsed : {};
  } catch {
    memory = {};
  }
  return memory;
}

function isStore(v: unknown): v is Store {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const [k, rec] of Object.entries(v)) {
    if (!(STAGES as readonly string[]).includes(k)) return false;
    const r = rec as Partial<StageRecord>;
    if (typeof r?.count !== 'number' || typeof r?.totalMs !== 'number') return false;
    if (!Array.isArray(r.sample) || !r.sample.every(x => typeof x === 'number' && Number.isFinite(x))) return false;
  }
  return true;
}

let flushHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Scrierea e amanata: `record()` e chemat o data per poza per etapa, adica de
 * mii de ori intr-un import mare. Un `setItem` sincron de fiecare data ar pune
 * serializare JSON pe firul principal exact in bucla care trebuie sa ramana
 * rapida — instrumentul ar deveni el insusi incetinirea pe care o masoara.
 */
function scheduleFlush(): void {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    flush();
  }, 2000);
}

export function flush(): void {
  if (!memory) return;
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch {
    // stocare plina sau indisponibila — masuratorile raman in memorie pentru
    // sesiunea curenta; a pierde diagnosticul nu merita sa rupa un import
  }
}

/** Inregistreaza o durata pentru o etapa. Duratele negative sau non-finite se ignora. */
export function record(stage: Stage, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const store = load();
  const rec = store[stage] ?? (store[stage] = { count: 0, totalMs: 0, sample: [], seen: 0 });
  rec.count++;
  rec.totalMs += ms;
  rec.seen++;
  if (rec.sample.length < SAMPLE_CAP) {
    rec.sample.push(ms);
  } else {
    // Rezervoir sampling: fiecare valoare vazuta are aceeasi sansa sa ramana
    // in esantion, indiferent cand a aparut — altfel primele 200 de poze ale
    // primului import ar decide pentru totdeauna cum arata distributia.
    const j = Math.floor(Math.random() * rec.seen);
    if (j < SAMPLE_CAP) rec.sample[j] = ms;
  }
  scheduleFlush();
}

/**
 * Masoara `fn` si inregistreaza durata, indiferent daca reuseste sau arunca.
 * Un esec care dureaza 30 de secunde e exact ce vrem sa vedem in raport, nu ce
 * vrem sa pierdem.
 */
export async function timed<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    record(stage, performance.now() - t0);
  }
}

/** Varianta sincrona, pentru etapele care nu asteapta nimic (ex. derivate). */
export function timedSync<T>(stage: Stage, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(stage, performance.now() - t0);
  }
}

export interface StageStat {
  stage: Stage;
  count: number;
  totalMs: number;
  /** Media aritmetica peste TOATE aparitiile, nu doar peste esantion. */
  avgMs: number;
  /** Mediana si percentila 90, calculate pe esantion. */
  p50Ms: number;
  p90Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  // Cea mai apropiata pozitie, cu prindere in interval — pentru esantioane mici
  // orice interpolare mai fina ar sugera o precizie care nu exista.
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/** Statisticile per etapa, in ordinea din pipeline. Etapele fara masuratori lipsesc. */
export function readStageStats(): StageStat[] {
  const store = load();
  const out: StageStat[] = [];
  for (const stage of STAGES) {
    const rec = store[stage];
    if (!rec || rec.count === 0) continue;
    const sorted = [...rec.sample].sort((a, b) => a - b);
    out.push({
      stage,
      count: rec.count,
      totalMs: rec.totalMs,
      avgMs: rec.totalMs / rec.count,
      p50Ms: percentile(sorted, 0.5),
      p90Ms: percentile(sorted, 0.9)
    });
  }
  return out;
}

/** Sterge tot ce s-a masurat. */
export function resetStageStats(): void {
  memory = {};
  if (flushHandle !== null) { clearTimeout(flushHandle); flushHandle = null; }
  try { localStorage.removeItem(KEY); } catch {
    // vezi flush(): stocarea indisponibila nu e o eroare pentru apelant
  }
}

/** Doar pentru teste — goleste memoria fara sa atinga localStorage. */
export function __resetMemoryForTests(): void {
  memory = null;
  if (flushHandle !== null) { clearTimeout(flushHandle); flushHandle = null; }
}
