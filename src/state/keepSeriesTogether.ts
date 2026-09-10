/**
 * state/keepSeriesTogether.ts
 * Seria rămâne o unitate în grilă.
 *
 * Raportat de utilizator: "modul de afișare în grilă este haotic, nu sunt
 * ordonate după persoane sau serii". Grila sortează implicit după data
 * capturii, ceea ce e corect pentru a parcurge o zi — dar o serie nu e o
 * secvență neîntreruptă în timp. Între două cadre ale aceluiași moment încape
 * o poză cu altceva (o etichetă de produs, un ceas, un cadru la întâmplare),
 * iar atunci cele două cadre care trebuie comparate ajung despărțite pe ecran.
 *
 * Exact acolo se pierde valoarea aplicației: ca să alegi între trei cadre
 * aproape identice, trebuie să le vezi unul lângă altul. Dacă al treilea e cu
 * două rânduri mai jos, comparația se face din memorie.
 *
 * Ancora e PRIMUL membru în ordinea deja sortată, nu cel mai bun sau cel mai
 * vechi: așa seria apare exact acolo unde omul o caută în firul zilei, iar
 * ordinea generală rămâne cea aleasă. Ceilalți membri urcă lângă el, în
 * ordinea în care erau deja între ei.
 */
export function keepSeriesTogether<T extends { groupId?: string }>(photos: T[]): T[] {
  // Nicio serie de refăcut — cazul obișnuit pe o bibliotecă fără grupuri.
  // Ieșirea devreme păstrează ACEEAȘI referință de array, ceea ce contează:
  // apelantul o memoizează, iar un array nou ar declanșa re-randări degeaba.
  if (!photos.some(p => p.groupId)) return photos;

  const membri = new Map<string, T[]>();
  for (const p of photos) {
    if (!p.groupId) continue;
    const lista = membri.get(p.groupId);
    if (lista) lista.push(p);
    else membri.set(p.groupId, [p]);
  }

  const rezultat: T[] = [];
  const asezate = new Set<string>();
  for (const p of photos) {
    if (!p.groupId) { rezultat.push(p); continue; }
    // Primul membru întâlnit trage toată seria după el; restul sunt deja puse.
    if (asezate.has(p.groupId)) continue;
    asezate.add(p.groupId);
    rezultat.push(...membri.get(p.groupId)!);
  }
  return rezultat;
}
