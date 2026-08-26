/**
 * core/descriptionTags.ts
 *
 * Descrierea scrisa de model, transformata in etichete de subiect.
 *
 * Cerinta utilizatorului: "pot sa folosim, daca merge, descrierea automata sa
 * ajute motorul sa inteleaga mai bine fotografia in decizii".
 *
 * Da, si e cel mai bun lucru care se putea intampla cu ea. Motivul e ca
 * memoria de subiecte (learning/tagMemory.ts) invata deja exact asa: tine
 * minte pe ce etichete pastrezi si pe ce arunci. Pana acum primea doar
 * etichetele ML Kit — vreo 400 de concepte generale ("dog", "beach", "food").
 *
 * O descriere ca "A double rainbow arches over a residential street with a
 * fence and a parked van" contine "rainbow", "street", "fence", "van". Primul
 * nu e in vocabularul ML Kit deloc, iar celelalte trei descriu contextul pe
 * care etichetele generale il rateaza. Cu cateva zeci de decizii, motorul
 * ajunge sa stie ca pastrezi curcubeie si arunci parcari — ceva ce din
 * "outdoor, sky, cloud" nu se putea deduce niciodata.
 *
 * ATENTIE, si e o limita reala: descrierea vine in ENGLEZA (atat suporta
 * deocamdata API-ul Google). Nu conteaza pentru invatare — etichetele sunt
 * chei interne, nu text aratat cuiva, si se compara doar intre ele. Ar conta
 * daca le-am afisa; nu le afisam.
 */

/**
 * Cuvinte care apar in aproape orice descriere si nu spun nimic despre ce e in
 * poza. Fara ele, "the" si "with" ar deveni cele mai frecvente doua "subiecte"
 * din biblioteca si ar ingropa semnalul real.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'for',
  'with', 'without', 'over', 'under', 'above', 'below', 'near', 'next', 'into', 'onto',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'while', 'as',
  'front', 'background', 'foreground', 'side', 'image', 'photo', 'picture', 'shot',
  'appears', 'seems', 'shows', 'showing', 'featuring', 'wearing', 'holding', 'standing',
  'sitting', 'looking', 'other', 'another', 'some', 'several', 'few', 'many'
]);

/** Cel mult atatea etichete dintr-o descriere — o propozitie lunga n-are voie sa domine memoria. */
const MAX_TAGS = 8;

/**
 * Plural simplu -> singular, ca "rainbows" sa cada peste "rainbow" de la ML Kit.
 *
 * Deliberat naiv: nu e un lematizator si n-are de ce sa fie. Greseste pe
 * neregulate ("children" ramane "children"), dar consecventa conteaza mai mult
 * decat corectitudinea — atat timp cat aceeasi forma iese mereu la fel,
 * memoria invata pe ea la fel de bine.
 */
function singular(word: string): string {
  if (word.length < 5 || !word.endsWith('s')) return word;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  return word.slice(0, -1);
}

/**
 * Etichetele de subiect dintr-o descriere. Lista goala cand nu exista descriere
 * — apelantul nu trebuie sa verifice nimic in plus.
 */
export function descriptionTags(description: string | undefined): string[] {
  if (!description) return [];
  const seen = new Set<string>();
  for (const raw of description.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const word = singular(raw);
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/**
 * Toate etichetele pe care se sprijina decizia: cele de la modelul de etichete,
 * plus cele scoase din descriere.
 *
 * Un singur loc, chemat si la INVATARE (recordTagDecision) si la PREDICTIE
 * (tagAffinity). Daca cele doua ar calcula listele separat, motorul ar invata
 * pe un set si ar prezice pe altul — genul de nepotrivire care nu da nicio
 * eroare si strica tacut tot ce e dupa ea.
 */
export function subjectTags(analysis: { sceneTags?: string[]; aiDescription?: string }): string[] {
  const tags = new Set(analysis.sceneTags ?? []);
  for (const tag of descriptionTags(analysis.aiDescription)) tags.add(tag);
  return [...tags];
}
