/**
 * core/photoText.ts
 * Textul CITIT din poză, pregătit pentru căutare.
 *
 * DE CE EXISTA. Aplicatia rula deja OCR pe telefon (ML Kit, vezi
 * TextRecognitionPlugin.kt) — dar din tot ce citea folosea o singura cifra:
 * `textCoverage`, cat la suta din cadru e acoperit de text, ca sa deosebeasca
 * un document de o poza. Cuvintele propriu-zise erau aruncate.
 *
 * Iar cuvintele alea sunt exact ce face pozele acelea gasibile. Nimeni nu-si
 * aminteste ca a fotografiat "un dreptunghi alb pe 12 iulie"; isi aminteste ca
 * are pe undeva bonul de la service, parola de wifi de la cabana, numarul de
 * la locul de parcare, tabla de la sedinta. Cautarea aplicatiei stia deja sa
 * caute in nume de fisier, persoane, etichete, locuri si date — dar nu si in
 * singurul loc unde scria chiar raspunsul.
 *
 * Costul e ZERO inferenta noua: OCR-ul ruleaza deja, pe exact pozele unde
 * conteaza (fara fete si fara subiect concret, sau cu etichete de lucru
 * fabricat — vezi conditia din core/nativeAnalysis.ts). Se pastreaza rezultatul
 * pe care il aveam deja in mana si il stergeam.
 *
 * TOTUL RAMANE PE TELEFON, ca restul: textul intra in aceeasi baza IndexedDB
 * ca embedding-urile de fata si nu pleaca nicaieri. Diferenta fata de Google
 * Photos, care face acelasi lucru in cloud, e tocmai asta.
 */

/**
 * Cat text pastram per poza.
 *
 * O pagina A4 densa are vreo 3000 de caractere; o captura de ecran, cateva
 * sute. Plafonul e destul cat sa prinda ce cauta cineva (un cod, un nume, o
 * suma, un rand dintr-un meniu) si destul de mic cat 5000 de poze cu text sa
 * nu umfle baza cu megaocteti de proza pe care nimeni n-o citeste.
 *
 * Se taie de la SFARSIT, nu de la inceput: pe un document, partea de sus e
 * antetul (adesea acelasi pe toate paginile), iar ce deosebeste o poza de alta
 * vine mai jos. Pe o captura de ecran, oricum totul e sus.
 */
export const MAX_PHOTO_TEXT = 2000;

/**
 * Sub atatea caractere, ce a citit OCR-ul nu e text, e zgomot: o litera pe o
 * cutie, un numar pe un tricou, doua caractere ghicite dintr-o textura. Pastrat
 * ca text cautabil, ar produce potriviri care par magice si sunt intamplatoare
 * — cel mai prost fel de rezultat, fiindca nu poti sti ca e gresit.
 */
export const MIN_PHOTO_TEXT = 8;

/**
 * Blocurile intoarse de OCR, puse cap la cap intr-un singur sir cautabil.
 *
 * ML Kit da textul pe BLOCURI (paragrafe/zone), fiecare cu propriile treceri la
 * rand in interior. Pentru cautare, structura n-are nicio valoare — conteaza
 * doar cuvintele — iar spatiile albe multiple ar strica potrivirea pe expresii
 * de doua cuvinte ("cod\\n  wifi" nu se potriveste cu "cod wifi"). Deci tot ce e
 * spatiu alb devine UN spatiu.
 *
 * Intoarce `undefined`, nu sir gol, cand nu e nimic de pastrat — acelasi tipar
 * ca restul campurilor optionale din AnalysisRecord, unde absent inseamna
 * "nemasurat" si e tratat neutru peste tot.
 */
export function photoTextFromBlocks(blocks: readonly { text: string }[]): string | undefined {
  const brut = blocks.map(b => b.text).join(' ').replace(/\s+/g, ' ').trim();
  if (brut.length < MIN_PHOTO_TEXT) return undefined;
  return brut.length > MAX_PHOTO_TEXT ? brut.slice(0, MAX_PHOTO_TEXT) : brut;
}

/**
 * Bucata de text din jurul potrivirii, pentru afisare langa rezultat.
 *
 * Fara ea, cine cauta "wifi" primeste inapoi o poza cu un dreptunghi alb si
 * niciun motiv sa creada ca aplicatia a inteles ceva. Cu ea, vede randul in
 * care scrie chiar cuvantul cautat — iar increderea in cautare nu se cladeste
 * din rezultate corecte, ci din rezultate EXPLICATE.
 *
 * Cauta pe textul deja normalizat de apelant (fara diacritice, minuscule), dar
 * decupeaza din cel ORIGINAL, la aceleasi pozitii: normalizarea aplicatiei
 * (core/sceneTagLabels.ts:normalizeForSearch) nu schimba lungimea sirului —
 * scoate accentele de pe litere, nu litere — deci indicii raman valabili.
 */
export function textSnippet(
  text: string, normalizedText: string, normalizedQuery: string, radius = 30
): string | undefined {
  const at = normalizedText.indexOf(normalizedQuery);
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + normalizedQuery.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}
