/**
 * core/showAnchors.ts
 * Comutatorul ancorelor de pe fotografie — vezi core/photoAnchors.ts.
 *
 * Exista dintr-un motiv precis, si merita scris: pe ACEST ecran au mai fost
 * odata desene peste poza — cutii in jurul fiecarei fete — si au fost scoase
 * dupa feedback direct ("distrageau de la evaluarea pozei, un overlay animat pe
 * fiecare fata, pe fiecare poza"; vezi comentariul de la .detail-face-frame in
 * styles.css). Ancorele sunt alt obiect: cel mult trei, niciodata animate, si
 * fiecare spune ceva anume (un nume, o cauza), nu doar "aici e o fata". Dar
 * sunt pe acelasi ecran si din aceeasi familie, iar peste o parere deja
 * exprimata nu se trece in tacere.
 *
 * Implicit PORNIT (redesignul cerut), oprit dintr-un singur comutator.
 */
const KEY = 'lumin-photo-anchors';

export function readShowAnchors(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function writeShowAnchors(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila — setarea se aplica pentru sesiunea curenta
  }
}
