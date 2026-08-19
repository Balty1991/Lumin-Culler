/**
 * state/galleryFolders.ts
 *
 * Ce foldere din galerie intra in triaj si care nu.
 *
 * Pana acum importul lua fie ce alegea utilizatorul manual din selectorul de
 * sistem, fie o perioada intreaga (supervizorul cronologic). Pe un telefon
 * real, galeria nu e omogena: "Camera" sunt amintiri, "WhatsApp Images" si
 * "Screenshots" sunt trafic. A trece si al doilea grup prin analiza costa timp,
 * baterie si — mai rau — umple coada de decizii cu lucruri pe care nimeni nu
 * vrea sa le judece cadru cu cadru.
 *
 * Excluderile sunt PERSISTENTE si per bucket MediaStore, deci alegerea facuta
 * o data ramane valabila la fiecare import viitor. Sunt reversibile oricand din
 * acelasi ecran: nimic nu dispare, doar nu mai e propus.
 *
 * Fara acces la localStorage (mod privat strict, stocare plina), totul degradeaza
 * spre "nimic exclus" — mai multa munca, niciodata pierdere de date.
 */

const EXCLUDED_KEY = 'lumin-excluded-folders';

/** Numele de bucket pe care le propunem excluse din prima, cand utilizatorul nu a ales inca nimic. */
const SUGGESTED_EXCLUDE = [
  'screenshots', 'screen shots', 'screen recordings',
  'whatsapp images', 'whatsapp video', 'whatsapp animated gifs', 'whatsapp stickers',
  'telegram', 'messenger', 'instagram', 'facebook', 'download', 'downloads',
  'documents', 'memes'
];

export interface GalleryFolder {
  id: string;
  name: string;
  count: number;
}

export function readExcludedFolderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    return new Set();
  }
}

export function writeExcludedFolderIds(ids: Set<string>): void {
  try { localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...ids])); } catch {
    // stocare indisponibila — excluderile nu supravietuiesc repornirii, dar
    // sesiunea curenta le respecta; nu merita sa oprim fluxul pentru asta
  }
}

/**
 * Foldere care ARATA a trafic, nu a amintiri — folosit doar ca SUGESTIE la
 * prima deschidere a ecranului, niciodata ca excludere tacuta. Utilizatorul
 * vede propunerea bifata si o poate desface inainte sa importe orice.
 *
 * Potrivire pe nume, nu pe cale: bucket-urile MediaStore au acelasi nume
 * afisat pe majoritatea telefoanelor, iar id-urile difera de la device la
 * device, deci nu pot fi puse intr-o lista fixa.
 */
export function suggestExcluded(folders: GalleryFolder[]): Set<string> {
  const out = new Set<string>();
  for (const f of folders) {
    const n = f.name.trim().toLowerCase();
    if (SUGGESTED_EXCLUDE.some(s => n === s || n.startsWith(s + ' ') || n.endsWith(' ' + s))) out.add(f.id);
  }
  return out;
}

/**
 * Folderele in ordinea in care ajuta: intai cele incluse, descrescator dupa
 * cate poze au (acolo e treaba reala), apoi cele excluse, tot descrescator.
 * Ordinea din MediaStore e ordinea primei aparitii, adica arbitrara pentru om.
 */
export function sortFolders(folders: GalleryFolder[], excluded: Set<string>): GalleryFolder[] {
  return [...folders].sort((a, b) => {
    const ax = excluded.has(a.id) ? 1 : 0;
    const bx = excluded.has(b.id) ? 1 : 0;
    if (ax !== bx) return ax - bx;
    return b.count - a.count;
  });
}

/** Cate poze raman de analizat dupa excluderi — numarul pe care il vede utilizatorul inainte sa apese. */
export function includedPhotoCount(folders: GalleryFolder[], excluded: Set<string>): number {
  return folders.reduce((sum, f) => sum + (excluded.has(f.id) ? 0 : f.count), 0);
}
