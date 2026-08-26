import type { PhotoView } from './store';

/**
 * state/libraryGroups.ts
 * Gruparea bibliotecii pe SUBIECT, cand te uiti la toate pozele.
 *
 * Cerinta utilizatorului: "la biblioteca, in Toate, ar trebui grupate primele
 * persoanele cred, sau o grupare mai interesanta".
 *
 * Are dreptate, si motivul e ca "Toate" era singurul ecran unde ordinea nu
 * spunea nimic. Filtrul "de verificat" are deja benzi de PLAN (state/reviewPlan.ts:
 * ce confirmi din mers, ce compari, unde te uiti tu). "Toate" era o grila plata
 * de zeci de poze in care nu exista niciun reper.
 *
 * Axa aleasa e CINE apare in poza, nu cand sau unde. Doua motive:
 *  - cronologia exista deja, ca ordine implicita in interiorul fiecarei benzi;
 *  - locul e adesea absent (multe poze n-au GPS), iar o grupare care se aplica
 *    doar pe jumatate din biblioteca nu e o grupare.
 *
 * Ordinea benzilor: persoanele inrolate primele, cea cu cele mai multe poze in
 * frunte, apoi "alti oameni" (fete pe care nu le stim), apoi ce n-are oameni
 * deloc. Nu e o ierarhie de valoare — e ordinea in care cauti ceva intr-o
 * galerie de telefon.
 *
 * O poza cu doua persoane inrolate intra la PRIMA dintre ele, o singura data.
 * Duplicarea ar fi insemnat aceeasi poza de doua ori in aceeasi grila, cu doua
 * numere de cadru diferite.
 */

export type SubjectBandKind = 'person' | 'others' | 'nobody';

export interface SubjectBand {
  kind: SubjectBandKind;
  /** Numele persoanei, pentru benzile de tip 'person'. Absent altfel — titlul vine din i18n. */
  name?: string;
  count: number;
}

export interface GroupedLibrary {
  /** Pozele reasezate: intai pe benzi, cronologic in interiorul fiecareia. */
  photos: PhotoView[];
  /** Indexul primei poze din fiecare banda -> banda. Gol daca nu are rost sa grupam. */
  bands: Map<number, SubjectBand>;
}

const byTime = (a: PhotoView, b: PhotoView) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0);

/**
 * Gruparea, sau lista neatinsa cand n-are rost.
 *
 * "N-are rost" inseamna: nicio persoana inrolata (atunci n-avem dupa ce grupa),
 * sau ar iesi o singura banda (atunci separatorul n-ar imparti nimic, doar ar
 * adauga un rand de text peste o lista care era deja limpede).
 */
export function groupBySubject(photos: PhotoView[], enrolledNames: readonly string[]): GroupedLibrary {
  if (!enrolledNames.length || photos.length === 0) return { photos, bands: new Map() };

  const buckets = new Map<string, PhotoView[]>();
  const others: PhotoView[] = [];
  const nobody: PhotoView[] = [];
  const enrolled = new Set(enrolledNames);

  for (const photo of photos) {
    // Prima persoana inrolata din poza, in ordinea inrolarii — nu prima
    // recunoscuta, ca sa nu depinda de ordinea in care s-a intamplat sa cada
    // fetele in analiza.
    const owner = enrolledNames.find(name => photo.personNames.includes(name));
    if (owner) {
      const list = buckets.get(owner);
      if (list) list.push(photo); else buckets.set(owner, [photo]);
    } else if (photo.faceCount > 0 || photo.personNames.some(n => !enrolled.has(n))) {
      others.push(photo);
    } else {
      nobody.push(photo);
    }
  }

  const personBands = [...buckets.entries()]
    .map(([name, list]) => ({ name, list: [...list].sort(byTime) }))
    // Cea cu cele mai multe poze in frunte; la egalitate, ordinea inrolarii,
    // ca rezultatul sa fie stabil intre randari.
    .sort((a, b) => b.list.length - a.list.length || enrolledNames.indexOf(a.name) - enrolledNames.indexOf(b.name));

  const sections: { band: SubjectBand; list: PhotoView[] }[] = [];
  for (const { name, list } of personBands) {
    sections.push({ band: { kind: 'person', name, count: list.length }, list });
  }
  if (others.length) sections.push({ band: { kind: 'others', count: others.length }, list: [...others].sort(byTime) });
  if (nobody.length) sections.push({ band: { kind: 'nobody', count: nobody.length }, list: [...nobody].sort(byTime) });

  if (sections.length < 2) return { photos, bands: new Map() };

  const ordered: PhotoView[] = [];
  const bands = new Map<number, SubjectBand>();
  for (const section of sections) {
    bands.set(ordered.length, section.band);
    ordered.push(...section.list);
  }
  return { photos: ordered, bands };
}
