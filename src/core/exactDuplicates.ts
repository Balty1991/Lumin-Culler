/**
 * core/exactDuplicates.ts
 *
 * Copiile identice — aceeasi poza, salvata de mai multe ori.
 *
 * Gruparea existenta (hashCompare.worker.ts) cauta cadre ASEMANATOARE: rafale,
 * poze facute la o secunda distanta, aceeasi scena din doi pasi. Aia e munca
 * grea si acolo decizia chiar cere un om, pentru ca fiecare cadru e diferit.
 *
 * Copiile identice sunt cu totul altceva, si sunt cazul cel mai des intalnit
 * intr-o galerie de telefon: aceeasi poza primita pe WhatsApp si salvata de
 * doua ori, descarcata din nou dintr-o conversatie, copiata dintr-un backup.
 * Aici nu exista nicio alegere de facut — una dintre ele e de prisos prin
 * definitie, si ocupa loc degeaba.
 *
 * CUM SE RECUNOSC: acelasi dHash SI aceeasi dimensiune in octeti. dHash-ul
 * singur e o amprenta perceptuala de 64 de biti — doua poze diferite pot,
 * teoretic, sa o imparta. Aceeasi dimensiune la octet peste aceeasi amprenta
 * inseamna, practic sigur, acelasi fisier. Pozele fara dimensiune cunoscuta
 * (importate inainte ca acel camp sa existe) NU se potrivesc niciodata: mai
 * bine ratam o copie decat sa propunem stergerea a doua poze diferite.
 *
 * CE FACE CU ELE: nimic, singur. Propune si atat. Stergerea automata a unei
 * "copii" e exact gestul care distruge increderea intr-o aplicatie de curatat
 * galerii — pentru ca in ziua in care greseste, a sters o amintire.
 */

export interface DuplicateCandidate {
  id: string;
  dHash: string;
  /** Dimensiunea fisierului. Fara ea, poza nu intra in nicio pereche. */
  sizeBytes?: number;
  fileName: string;
  /** Momentul capturii, daca se stie — decide care copie se pastreaza. */
  capturedAt?: number;
  /** Momentul importului — plasa de rezerva cand nu exista ora capturii. */
  importedAt: number;
  status: 'selected' | 'review' | 'rejected' | 'pending';
}

export interface DuplicateSet {
  /** Cheie stabila intre rulari (amprenta + dimensiune). */
  key: string;
  /** Copia pastrata: cea deja pastrata de utilizator, altfel cea mai veche. */
  keepId: string;
  /** Celelalte, in ordine stabila. */
  duplicateIds: string[];
  /** Cati octeti s-ar elibera scotand duplicatele (dimensiunea x cate sunt in plus). */
  wastedBytes: number;
}

/**
 * Care copie ramane.
 *
 * Intai una pe care utilizatorul a pastrat-o deja explicit — daca a decis o
 * data, nu-i schimbam decizia. Apoi cea mai VECHE: originalul, nu copia
 * descarcata a treia oara. La egalitate, numele, ca rezultatul sa nu depinda
 * de ordinea in care s-au citit pozele.
 */
function pickKeeper(items: DuplicateCandidate[]): DuplicateCandidate {
  const rank = (p: DuplicateCandidate) => (p.status === 'selected' ? 0 : 1);
  const when = (p: DuplicateCandidate) => p.capturedAt ?? p.importedAt;
  return [...items].sort((a, b) =>
    rank(a) - rank(b) || when(a) - when(b) || a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id)
  )[0];
}

/** Grupurile de copii identice, cele care elibereaza cel mai mult loc primele. */
export function findExactDuplicates(items: DuplicateCandidate[]): DuplicateSet[] {
  const buckets = new Map<string, DuplicateCandidate[]>();
  for (const p of items) {
    // Fara amprenta sau fara dimensiune nu putem afirma "identic" — si aici
    // afirmatia trebuie sa fie sigura, pentru ca duce direct la stergere.
    if (!p.dHash || typeof p.sizeBytes !== 'number' || p.sizeBytes <= 0) continue;
    const key = `${p.dHash}:${p.sizeBytes}`;
    const list = buckets.get(key);
    if (list) list.push(p); else buckets.set(key, [p]);
  }
  const sets: DuplicateSet[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const keeper = pickKeeper(members);
    const duplicates = members
      .filter(p => p.id !== keeper.id)
      .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id));
    sets.push({
      key,
      keepId: keeper.id,
      duplicateIds: duplicates.map(p => p.id),
      wastedBytes: (keeper.sizeBytes ?? 0) * duplicates.length
    });
  }
  return sets.sort((a, b) => b.wastedBytes - a.wastedBytes || a.key.localeCompare(b.key));
}

export interface DuplicateSummary {
  /** Cate grupuri de copii exista. */
  sets: number;
  /** Cate poze ar fi scoase in total. */
  duplicates: number;
  /** Cat loc s-ar elibera. */
  wastedBytes: number;
}

export function summariseDuplicates(sets: DuplicateSet[]): DuplicateSummary {
  return {
    sets: sets.length,
    duplicates: sets.reduce((n, s) => n + s.duplicateIds.length, 0),
    wastedBytes: sets.reduce((n, s) => n + s.wastedBytes, 0)
  };
}

/** Toate id-urile de scos, pentru operatia in masa. */
export function allDuplicateIds(sets: DuplicateSet[]): string[] {
  return sets.flatMap(s => s.duplicateIds);
}
