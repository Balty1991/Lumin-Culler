/**
 * core/subjectSignificance.ts
 *
 * Cat de mult CONTEAZA o poza — separat de cat de bine e facuta.
 *
 * Scorul AI raspunde la o singura intrebare: cat de bine iesit e cadrul.
 * Claritate, expunere, compozitie, lumina. Intrebarea e corecta pentru un
 * fotograf de nunta, unde mestesugul CHIAR e criteriul.
 *
 * Pentru poze ocazionale nu e. O coala de hartie plata, bine luminata, e
 * perfect clara si perfect expusa — deci primeste un scor mare. Un copil in
 * miscare nu e. Bug real, raportat cu doua capturi: dintr-o iesire cu copilul,
 * propunerile au fost urmele din zapada si doua poze cu niste hartii, in timp
 * ce cadrele cu copilul si cu pisica au ramas nepropuse. Aceeasi cauza face ca
 * un document sa ajunga in "cele mai bune poze din tot evenimentul".
 *
 * Modulul asta NU inlocuieste scorul si nu-l modifica. Da doar ordinea in care
 * se pun intrebarile: intai CINE e in cadru, apoi cat de bine a iesit. Un
 * document ramane un document oricat de clar ar fi, iar o poza cu cineva drag
 * nu cade sub el pentru cateva puncte de claritate.
 *
 * Se aplica doar acolo unde aplicatia prezinta sau alege "cele mai bune".
 * NU se aplica la sortarea grilei: acolo utilizatorul alege explicit criteriul
 * ("Scor AI", "Claritate"), iar o ordine rescrisa pe ascuns ar fi o minciuna.
 */
import { TEXT_DOMINANT_THRESHOLD } from './importPipeline';

/** Minimul necesar. Orice PhotoView se potriveste structural. */
export interface SignificanceSignals {
  faceCount?: number;
  /** Persoane pe care utilizatorul le-a inrolat el insusi. */
  knownFaceCount?: number;
  /** Fractiune din cadru acoperita de text (OCR nativ). Absenta = necunoscut, nu "zero". */
  textCoverage?: number;
}

/** Apare cineva pe care utilizatorul l-a inrolat. */
export const RANK_KNOWN_PERSON = 3;
/** Apar oameni, dar niciunul inrolat. */
export const RANK_PEOPLE = 2;
/** Peisaj, detaliu, obiect — orice altceva. */
export const RANK_OTHER = 1;
/** Document sau captura de ecran. Nu e o amintire, oricat de curat ar fi cadrul. */
export const RANK_DOCUMENT = 0;

/**
 * Cat de mult merita poza sa reprezinte ceva. Mai mare = mai important.
 *
 * Documentul e verificat PRIMUL, inaintea fetelor: o captura de ecran a unei
 * conversatii poate contine fete, iar o poza a unui act de identitate contine
 * chiar o fata inrolata. Ordinea inversa le-ar promova exact pe cele care n-au
 * ce cauta intr-un "cele mai bune".
 */
export function subjectRank(p: SignificanceSignals): number {
  if (p.textCoverage !== undefined && p.textCoverage >= TEXT_DOMINANT_THRESHOLD) return RANK_DOCUMENT;
  if ((p.knownFaceCount ?? 0) > 0) return RANK_KNOWN_PERSON;
  if ((p.faceCount ?? 0) > 0) return RANK_PEOPLE;
  return RANK_OTHER;
}

/**
 * Comparator descrescator: intai cine e in cadru, apoi cat de bine a iesit.
 *
 * Gandit sa inlocuiasca un `(a, b) => b.aiScore - a.aiScore` existent, deci
 * pastreaza exact acelasi comportament in interiorul aceleiasi categorii.
 */
export function compareBySignificance<T extends SignificanceSignals & { aiScore: number }>(a: T, b: T): number {
  return subjectRank(b) - subjectRank(a) || b.aiScore - a.aiScore;
}
