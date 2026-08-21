import type { PhotoStatus } from './db';
/**
 * core/momentRescue.ts
 * Cel mai bun cadru al unui moment nu se arunca niciodata singur.
 *
 * Ce nu stia motorul sa faca: decizia automata judeca fiecare poza fata de
 * restul BIBLIOTECII, si abia dupa aceea pozele se grupeaza in serii. Un om
 * face invers — se uita intai la cele patru cadre ale aceleiasi clipe si
 * intreaba "care e cea mai buna dintre astea?". Consecinta concreta a ordinii
 * de pana acum: o rafala facuta seara, in care toate cadrele ies putin moi,
 * putea fi respinsa INTREAGA. Nu pentru ca vreun cadru ar fi fost de neprivit,
 * ci pentru ca toate aveau acelasi mic defect. Momentul disparea complet,
 * inainte ca omul sa-l vada.
 *
 * Regula de aici e ingusta cu buna stiinta: nu muta nimic in plus la cos si nu
 * umfla niciun scor. Doar cand un grup ar ramane FARA NICIUN supravietuitor,
 * cel mai bun cadru al lui urca de la "respins" la "de verificat" — adica exact
 * acolo unde omul se uita oricum, si de unde il poate respinge cu o apasare
 * daca chiar nu-i place niciunul.
 *
 * Fara dependinte de DB: primeste stari, intoarce un id.
 */

export interface MomentMember {
  id: string;
  status: PhotoStatus;
}

/**
 * Id-ul cadrului care trebuie salvat, sau null cand nu e nimic de salvat.
 *
 * @param members membrii unui singur grup (serie/duplicate)
 * @param bestId cadrul pe care gruparea l-a socotit cel mai bun al grupului
 */
export function rescueBestOfMoment(members: MomentMember[], bestId: string): string | null {
  // Un grup de unul singur n-are "cel mai bun" cu sens — n-are cu ce compara,
  // si nici nu e o clipa fotografiata de mai multe ori. Acolo hotaraste regula
  // obisnuita (respingerea cere un defect care se poate numi).
  if (members.length < 2) return null;
  // Salvam DOAR cand momentul ar disparea de tot. Daca a ramas macar un cadru
  // in picioare, clipa e deja pastrata si n-avem de ce sa mai scoatem unul.
  if (!members.every(m => m.status === 'rejected')) return null;
  return members.some(m => m.id === bestId) ? bestId : null;
}
