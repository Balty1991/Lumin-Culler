/**
 * core/searchFuzzy.ts
 *
 * Ultima plasa a cautarii: cuvintele care sunt ACELASI cuvant, scris putin
 * altfel.
 *
 * Doua situatii, si amandoua se intampla la fiecare cautare de pe telefon:
 *
 *  - forma cuvantului. Cine cauta "copii" nu gaseste o poza etichetata
 *    "copil", desi vrea exact acea poza. La fel "munti"/"munte",
 *    "case"/"casa". Potrivirea pe subsir prinde doar un sens ("copil" e in
 *    "copilul"), nu si pe celalalt.
 *  - tastarea. "nunat" in loc de "nunta", "protret" in loc de "portret" — pe
 *    o tastatura de telefon, cu degetul mare, se intampla des.
 *
 * Amandoua sunt, in scris, o singura greseala: o litera in plus, una lipsa,
 * una schimbata, sau doua inversate. Exact ce masoara distanta de mai jos.
 *
 * De ce distanta 1 si nu 2: la 2 incep sa se atinga cuvinte care chiar sunt
 * diferite ("mare"/"masa", "casa"/"cana"), iar o cautare care raspunde cu
 * altceva decat ai cerut e mai rea decat una care nu raspunde. Pragul de
 * lungime (5 litere) e pentru acelasi motiv: pe cuvinte scurte, o singura
 * litera schimbata inseamna aproape mereu alt cuvant.
 */

/** Sub atatea litere, o singura greseala schimba prea des sensul. */
export const LUNGIME_MINIMA = 5;

/**
 * true daca `a` si `b` difera prin cel mult o singura greseala de scris:
 * o litera in plus, una lipsa, una schimbata, sau doua vecine inversate.
 *
 * E distanta Damerau-Levenshtein plafonata la 1 — dar scrisa direct, fara
 * matrice: cand raspunsul cautat e doar "cel mult unu", se poate decide dintr-o
 * singura parcurgere, iar functia asta e chemata de multe ori pe fiecare
 * apasare de tasta.
 */
export function oSinguraGreseala(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  if (la === lb) {
    // Aceeasi lungime: ori o litera schimbata, ori doua vecine inversate.
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    // o litera schimbata
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // doua vecine inversate ("nunat" vs "nunta")
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }

  // Lungimi diferite prin 1: una e cealalta cu o litera in plus.
  const lung = la > lb ? a : b;
  const scurt = la > lb ? b : a;
  let i = 0;
  while (i < scurt.length && lung[i] === scurt[i]) i++;
  return lung.slice(i + 1) === scurt.slice(i);
}

/**
 * Cuvintele dintr-un text deja normalizat, ca multime.
 *
 * Taie pe orice nu e litera sau cifra, deci "IMG_2026-07.jpg" da
 * ["img", "2026", "07", "jpg"]. Cuvintele prea scurte nu intra: nu vor fi
 * niciodata comparate oricum (vezi LUNGIME_MINIMA), si ar umfla degeaba
 * multimea pe care o parcurgem la fiecare cautare.
 */
export function cuvinteDinText(textNormalizat: string): Set<string> {
  const out = new Set<string>();
  for (const cuvant of textNormalizat.split(/[^\p{L}\p{N}]+/u)) {
    if (cuvant.length >= LUNGIME_MINIMA - 1) out.add(cuvant);
  }
  return out;
}

/**
 * true daca `cuvant` e, cu cel mult o greseala, unul dintre cuvintele din text.
 *
 * Compara doar cu cuvinte de lungime apropiata — restul nu pot fi la distanta
 * 1, si le sarim inainte sa platim comparatia.
 */
export function seGasesteAproape(cuvant: string, cuvinte: Set<string>): boolean {
  if (cuvant.length < LUNGIME_MINIMA) return false;
  for (const candidat of cuvinte) {
    if (Math.abs(candidat.length - cuvant.length) > 1) continue;
    if (oSinguraGreseala(cuvant, candidat)) return true;
  }
  return false;
}
