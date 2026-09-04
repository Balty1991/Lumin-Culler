/**
 * core/aiDecision.ts
 * Cine a pus eticheta pe poză — motorul, sau omul.
 *
 * DE CE EXISTA. Bara de severitate era IREVERSIBILA, si utilizatorul a
 * raportat-o cu doua capturi: apesi "Ingaduitor", 17 poze nedecise primesc
 * eticheta, apoi te razgandesti si apesi "Echilibrat" — si nu se mai intampla
 * nimic. Cele 17 sunt acum `selected`/`rejected`, iar `isUserDecided` le
 * ocoleste "ca sa nu calce peste decizia ta". Doar ca nu era decizia ta, era
 * propunerea motorului de acum trei secunde.
 *
 * Cauza nu era in bara, ci in modelul de date: statusul nu spunea CINE l-a
 * pus. Comentariul din core/strictnessPreview.ts descria lipsa asta si o trata
 * ca pe un dat de care previzualizarea trebuie sa se fereasca. Nu era un dat,
 * era un camp care lipsea — vezi PhotoRecord.aiDecided.
 *
 * Ce se schimba pentru om, si e singurul lucru care conteaza: cele trei trepte
 * de severitate devin ce arata ca sunt — trei optiuni intre care te poti muta
 * inainte si inapoi, nu trei usi cu sens unic.
 */
import type { PhotoRecord } from './db';
import { isUserDecided } from '../state/batchOps';

/**
 * Poza pe care severitatea NU are voie s-o atinga.
 *
 * Diferit de `isUserDecided`, si diferenta e chiar rostul acestui fisier:
 * acolo intrebarea e "are poza asta o eticheta hotarata?", aici e "a hotarat-o
 * OMUL?". Prima trebuie sa ramana cum e — operatiile in masa (Auto-Cull,
 * respinge sub prag, rezolva seriile) sunt pornite explicit de om pe ce vede
 * el pe ecran, si n-au de ce sa se apuce sa rescrie ce e deja etichetat.
 *
 * ABSENT = poze de dinaintea campului, despre care nu se mai poate sti. Sunt
 * tratate ca decizii ale omului, adica exact comportamentul de pana acum:
 * pentru bibliotecile existente nu se schimba nimic, iar prudenta merge in
 * directia in care greseala doare mai putin — a nu rasturna o alegere reala e
 * mai important decat a putea rasturna o propunere.
 */
export function lockedFromAutoDecision(photo: Pick<PhotoRecord, 'status' | 'aiDecided'>): boolean {
  if (!isUserDecided(photo.status)) return false;
  return photo.aiDecided !== true;
}
