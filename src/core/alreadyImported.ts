/**
 * core/alreadyImported.ts
 *
 * Fisierele pe care biblioteca le are DEJA.
 *
 * Bug real, reprodus de auditul de dinaintea lansarii: import de 20 de poze,
 * anulare la a 9-a, apoi aceleasi 20 alese din nou -> 29 de poze in
 * biblioteca, fara niciun avertisment. Scanarea rapida de copii
 * (quickDuplicateScan) compara lotul doar cu EL INSUSI; de ce e deja importat
 * nu se uita nimeni.
 *
 * Consecinta nu e doar dezordinea: omul isi repara singur problema stergand
 * duplicatele, iar stergerea consuma din plafonul gratuit. Adica plateste
 * pentru o greseala a aplicatiei.
 *
 * Identitatea unui fisier, in ordinea increderii:
 *
 *  1. `mediaUri` — URI-ul content:// primit de la galeria Android. E chiar
 *     identificatorul sistemului pentru acea poza: daca se potriveste, e
 *     aceeasi intrare din MediaStore, fara dubiu.
 *  2. nume + marime in octeti. Nu citeste nimic de pe disc (obiectele File
 *     poarta deja `name` si `size`) si e destul: doua fisiere cu acelasi nume
 *     SI aceeasi marime la octet sunt, in practica, acelasi fisier reales.
 *
 * Ce NU face, intentionat: nu compara continutul si nu cauta poze
 * ASEMANATOARE. Aceeasi fotografie descarcata a doua oara sub alt nume nu e
 * prinsa aici — aia e treaba gruparii de serii si a lui exactDuplicates, dupa
 * analiza. Aici se prinde exact cazul raportat: acelasi fisier, ales din nou.
 *
 * Prudenta merge intr-o singura directie: la indoiala, poza INTRA in import.
 * O poza importata de doua ori se poate sterge; una sarita din greseala nu se
 * mai vede niciodata ca lipseste.
 */

/** Ce se tine minte despre o poza deja importata — restul inregistrarii nu conteaza aici. */
export interface ImportedIdentity {
  fileName: string;
  sizeBytes?: number;
  mediaUri?: string;
}

/** Ce se stie despre un fisier ales acum, inainte de orice decodare. */
export interface CandidateFile {
  name: string;
  size: number;
  mediaUri?: string;
}

export interface LibraryIndex {
  uris: Set<string>;
  namesAndSizes: Set<string>;
}

/** Cheia "nume + marime". Numele se compara fara diferenta de majuscule: Android si SAF nu sunt consecvente. */
function nameSizeKey(fileName: string, sizeBytes: number): string {
  return fileName.toLowerCase() + ' ' + sizeBytes;
}

export function emptyLibraryIndex(): LibraryIndex {
  return { uris: new Set(), namesAndSizes: new Set() };
}

/** Adauga o poza deja importata in index. Inregistrarile fara marime (dinaintea campului `sizeBytes`) intra doar cu URI-ul, daca il au. */
export function addToLibraryIndex(index: LibraryIndex, photo: ImportedIdentity): void {
  if (photo.mediaUri) index.uris.add(photo.mediaUri);
  if (photo.sizeBytes !== undefined && photo.fileName) {
    index.namesAndSizes.add(nameSizeKey(photo.fileName, photo.sizeBytes));
  }
}

export function buildLibraryIndex(photos: Iterable<ImportedIdentity>): LibraryIndex {
  const index = emptyLibraryIndex();
  for (const photo of photos) addToLibraryIndex(index, photo);
  return index;
}

export function isAlreadyImported(index: LibraryIndex, file: CandidateFile): boolean {
  if (file.mediaUri && index.uris.has(file.mediaUri)) return true;
  return index.namesAndSizes.has(nameSizeKey(file.name, file.size));
}

/**
 * Imparte lotul ales in "de importat" si "deja in biblioteca", pastrand
 * ordinea. Pe masura ce trece prin lista, adauga si fisierele acceptate in
 * index: doua copii ale aceluiasi fisier alese IN ACELASI lot se reduc tot la
 * una, fara sa mai fie nevoie de o a doua trecere.
 */
export function partitionAlreadyImported<T extends CandidateFile>(
  files: T[],
  index: LibraryIndex
): { fresh: T[]; alreadyImported: number } {
  const fresh: T[] = [];
  let alreadyImported = 0;
  for (const file of files) {
    if (isAlreadyImported(index, file)) { alreadyImported++; continue; }
    fresh.push(file);
    addToLibraryIndex(index, { fileName: file.name, sizeBytes: file.size, mediaUri: file.mediaUri });
  }
  return { fresh, alreadyImported };
}
