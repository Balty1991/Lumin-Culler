/**
 * core/momentStacks.ts
 *
 * Momentul, nu cadrul.
 *
 * Gruparea existenta (hashCompare.worker.ts) leaga poze aproape IDENTICE
 * vizual: acelasi dHash, apropiate in timp, acelasi subiect. E exact ce trebuie
 * pentru rafale si duplicate. Dar 42 de cadre de la aceeasi masa, facute din
 * unghiuri diferite, cu oamenii miscandu-se, nu cad in aceeasi cutie de dHash —
 * deci azi nu se grupeaza deloc si raman 42 de decizii separate.
 *
 * Exact scenariul din care porneste tot produsul: "am 42 de cadre dintr-un
 * moment, ajuta-ma sa pastrez una-doua".
 *
 * Modulul face gruparea GROSIERA, dupa timp: cadrele facute la mai putin de
 * `MOMENT_GAP_MS` unul de altul sunt acelasi moment. Nu se uita deloc la
 * imagini — doar la `capturedAt` — deci costa O(n log n) si nu adauga NIMIC in
 * pipeline-ul de analiza. Rularea e la cerere, peste pozele deja in memorie.
 *
 * Cele doua grupari nu se bat cap in cap, se completeaza: seria (`groupId`)
 * spune "astea doua sunt aceeasi poza", momentul spune "astea 42 sunt aceeasi
 * intamplare". De aceea propunerile de top pick se aleg din SERII DISTINCTE —
 * altfel primele trei ar fi trei variante ale aceluiasi cadru, ceea ce nu e o
 * alegere.
 */

export interface MomentPhoto {
  id: string;
  /** Momentul capturii (epoch ms). Fara el, poza nu poate intra in niciun moment. */
  capturedAt?: number;
  aiScore: number;
  status: 'selected' | 'review' | 'rejected' | 'pending';
  /** Seria de cadre cvasi-identice din care face parte, daca exista. */
  groupId?: string;
  /** Cate fete s-au detectat. Decide ce se propune dintr-un moment — vezi pickTopFrames. */
  faceCount?: number;
  /** Pare document/captura de ecran (vezi core/smartInbox.ts). Nu se propune decat in lipsa altceva. */
  isDocument?: boolean;
}

export interface MomentStack {
  /** Cheie stabila, derivata din prima poza — supravietuieste unei re-rulari. */
  key: string;
  ids: string[];
  startMs: number;
  endMs: number;
  /** 1-3 cadre propuse, din serii distincte, cele mai bune primele. */
  topPicks: string[];
  /** Cate cadre din moment nu au inca nicio decizie. */
  undecided: number;
}

/**
 * Sub un sfert de ora intre doua declansari, esti inca "in acelasi loc, la
 * aceeasi intamplare". Peste, de obicei te-ai mutat sau s-a schimbat ceva.
 * Pragul nu trebuie sa fie exact — trebuie sa fie PREVIZIBIL, ca utilizatorul
 * sa inteleaga de ce doua poze sunt impreuna.
 */
export const MOMENT_GAP_MS = 15 * 60 * 1000;
/** Sub atatea cadre, "momentul" e doar o poza sau doua — nu are ce sa simplifice. */
export const MIN_MOMENT_SIZE = 4;
/** Cate propuneri facem per moment. Mai multe n-ar mai fi o recomandare, ar fi o alta grila. */
export const MAX_TOP_PICKS = 3;

/**
 * Alege pana la `MAX_TOP_PICKS` cadre, cele mai bune, din SERII DISTINCTE.
 *
 * Fara conditia asta, pe un moment care contine o rafala de 20 de cadre
 * aproape identice, primele trei propuneri ar fi trei variante ale aceleiasi
 * poze — utilizatorul ar trebui inca sa aleaga intre ele, adica exact munca pe
 * care voiam sa o scutim. Pozele fara serie conteaza fiecare ca serie proprie.
 */
/**
 * Cat de mult MERITA poza sa reprezinte momentul, inainte de calitatea ei.
 *
 * Bug real, raportat cu doua capturi: dintr-o iesire cu copilul, propunerile au
 * fost urmele din zapada si doua poze cu niste hartii — in timp ce cadrele cu
 * copilul si cu pisica au ramas nepropuse. Cauza nu e un scor gresit, ci
 * intrebarea gresita: `aiScore` masoara cat de BINE FACUTA e o poza, si o coala
 * de hartie plata, bine luminata, e perfect clara si perfect expusa. Un copil
 * in miscare nu e.
 *
 * Un moment se reprezinta prin ce s-a intamplat in el, nu prin cel mai curat
 * dreptunghi. Deci intai categoria, si abia in interiorul ei scorul:
 *   2 = are oameni in ea
 *   1 = orice altceva (peisaj, detaliu)
 *   0 = document sau captura de ecran — doar daca nu exista nimic altceva
 */
function subjectTier(p: MomentPhoto): number {
  if (p.isDocument) return 0;
  return (p.faceCount ?? 0) > 0 ? 2 : 1;
}

export function pickTopFrames(photos: MomentPhoto[], limit = MAX_TOP_PICKS): string[] {
  const sorted = [...photos].sort((a, b) =>
    subjectTier(b) - subjectTier(a) || b.aiScore - a.aiScore || a.id.localeCompare(b.id));
  const seenSeries = new Set<string>();
  const picks: string[] = [];
  for (const p of sorted) {
    if (picks.length >= limit) break;
    const series = p.groupId || `solo:${p.id}`;
    if (seenSeries.has(series)) continue;
    seenSeries.add(series);
    picks.push(p.id);
  }
  return picks;
}

/**
 * Imparte pozele in momente, dupa pauzele dintre declansari.
 *
 * Pozele fara `capturedAt` sunt lasate PE DINAFARA, nu ingramadite intr-un
 * moment "necunoscut": fara ora reala nu putem spune ca fac parte din aceeasi
 * intamplare, iar o grupare inventata e mai rea decat lipsa ei.
 */
export function buildMomentStacks(
  photos: MomentPhoto[],
  gapMs = MOMENT_GAP_MS,
  minSize = MIN_MOMENT_SIZE
): MomentStack[] {
  const timed = photos.filter((p): p is MomentPhoto & { capturedAt: number } => typeof p.capturedAt === 'number');
  if (timed.length < minSize) return [];
  timed.sort((a, b) => a.capturedAt - b.capturedAt);

  const stacks: MomentStack[] = [];
  let current: (MomentPhoto & { capturedAt: number })[] = [timed[0]];

  const flush = () => {
    if (current.length < minSize) return;
    stacks.push({
      key: `moment-${current[0].id}`,
      ids: current.map(p => p.id),
      startMs: current[0].capturedAt,
      endMs: current[current.length - 1].capturedAt,
      topPicks: pickTopFrames(current),
      undecided: current.filter(p => p.status === 'pending' || p.status === 'review').length
    });
  };

  for (let i = 1; i < timed.length; i++) {
    if (timed[i].capturedAt - timed[i - 1].capturedAt <= gapMs) {
      current.push(timed[i]);
    } else {
      flush();
      current = [timed[i]];
    }
  }
  flush();

  // Momentele cu cel mai mult de decis primele: acolo e munca, si acolo
  // ajuta cel mai mult o propunere.
  return stacks.sort((a, b) => b.undecided - a.undecided || b.ids.length - a.ids.length || a.startMs - b.startMs);
}

/** Momentul din care face parte o poza, sau `null`. Pentru "aplica si celorlalte cadre din acelasi moment". */
export function momentOf(stacks: MomentStack[], photoId: string): MomentStack | null {
  return stacks.find(s => s.ids.includes(photoId)) ?? null;
}

/** Cate momente au inca ceva de decis. Pentru insigne, fara sa construim lista.  */
export function countOpenMoments(stacks: MomentStack[]): number {
  return stacks.filter(s => s.undecided > 0).length;
}
