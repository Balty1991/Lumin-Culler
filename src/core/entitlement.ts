/**
 * core/entitlement.ts
 * Fundatia LOCALA a modelului freemium: TRIAJUL e gratuit la nesfarsit —
 * import, scor AI, sortare, grupare, oricate poze. Se plateste pentru ce faci
 * cu rezultatul: pentru pozele SCOASE din aplicatie peste un plafon lunar
 * generos (exportate sau sterse din telefon — vezi FREE_PHOTOS_PER_MONTH),
 * pentru a doua persoana recunoscuta, si pentru functiile de dupa triaj (vezi
 * isPremiumFeatureLocked).
 *
 * Sursa de adevar e Google Play, nu acest fisier: refreshEntitlement() intreaba
 * plugin-ul de billing si scrie raspunsul in PREMIUM_FLAG_KEY. isPremium()
 * ramane SINCRON si citeste doar cache-ul acela — altfel fiecare apelant
 * (state/store.ts, PersonsPanel, SessionOutcome) ar fi trebuit sa devina async
 * pentru o intrebare la care raspunsul se schimba de cateva ori pe an.
 *
 * De ce se pastreaza ultima stare cunoscuta: verificarea are nevoie de retea.
 * Fara cache, un abonat care deschide aplicatia in avion ar fi tratat ca
 * neabonat pana la urmatoarea conexiune. Cache-ul se actualizeaza doar cand Play
 * chiar RASPUNDE — un esec de retea nu sterge niciodata un abonament valid.
 *
 * Ce NU face: validare de chitanta pe server. Aplicatia n-are server, si a
 * adauga unul ar contrazice direct promisiunea ca nimic nu pleaca de pe telefon.
 * Un flag din localStorage e falsificabil de cine vrea neaparat; pentru un
 * abonament de consum la o aplicatie locala, ala e compromisul corect.
 */

import { isBillingAvailable, queryPremiumActive, queryPremiumPriceAnswer } from './billing';

const PREMIUM_FLAG_KEY = 'lumin-premium';
/** Play a confirmat cel putin o data ca abonamentul chiar poate fi cumparat — vezi isPurchasable(). */
const PURCHASABLE_KEY = 'lumin-billing-ready';
/** Play a raspuns explicit ca NU exista produsul (nu "n-am putut intreba") — vezi billingAnswerPending(). */
const NO_PRODUCT_KEY = 'lumin-billing-absent';
/** Numele cheii ramane cel vechi ca sa nu se piarda contorul celor care au deja aplicatia. */
const USAGE_LOG_KEY = 'lumin-export-log';

/**
 * Abonati la schimbarile de drepturi.
 *
 * De ce exista: isPremium() citeste localStorage SINCRON, deci React n-are cum
 * sa afle ca raspunsul s-a schimbat. Bug real: cine cumpara abonamentul (sau il
 * are deja cumparat pe alt telefon, si refreshEntitlement() il descopera la
 * pornire) ramanea cu lacatele pe ecran pana la urmatoarea re-randare provocata
 * de cu totul altceva — adica exact utilizatorul care tocmai a platit vedea in
 * continuare "Premium". Acum orice schimbare de stare anunta abonatii, iar
 * state/store.ts oglindeste raspunsul intr-un camp de care UI-ul chiar asculta.
 */
type EntitlementListener = () => void;
const listeners = new Set<EntitlementListener>();

/** Returneaza functia de dezabonare. */
export function subscribeEntitlement(listener: EntitlementListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyEntitlementChanged(): void {
  for (const listener of [...listeners]) {
    // Un abonat care arunca nu are voie sa-i taie pe ceilalti de la notificare.
    try { listener(); } catch (err) { console.error('Abonat la drepturi a esuat:', err); }
  }
}

/**
 * Cate poze poate SCOATE gratuit un utilizator neabonat dintr-o fereastra
 * glisanta de 30 de zile.
 *
 * "A scoate" acopera si exportul, si stergerea din telefon — observatie a
 * utilizatorului, si are dreptate: amandoua incaseaza rezultatul triajului.
 * Cine trage 5000 de poze, sterge respinsele si isi curata galeria a primit
 * exact folosul pentru care se plateste, fara sa exporte nimic. Un plafon doar
 * pe export ar fi fost o portita, nu un model.
 */
export const FREE_PHOTOS_PER_MONTH = 150;
/** Cate persoane poate inrola gratuit un utilizator neabonat (a doua+ cere abonament). */
export const FREE_ENROLLED_PERSONS = 1;

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reintreaba Google Play si actualizeaza cache-ul local. De apelat la pornire si
 * dupa o cumparare reusita.
 *
 * Scrie DOAR cand primeste un raspuns: queryPremiumActive() intoarce `false` si
 * la esec de retea (vezi core/billing.ts), iar pe web e mereu `false` — daca am
 * scrie neconditionat, o pornire offline sau o deschidere in browser ar sterge
 * abonamentul cuiva care chiar plateste.
 */
export async function refreshEntitlement(): Promise<boolean> {
  if (!isBillingAvailable()) return isPremium();
  const [active, priceAnswer] = await Promise.all([queryPremiumActive(), queryPremiumPriceAnswer()]);
  const before = { premium: isPremium(), purchasable: isPurchasable(), locked: isPremiumFeatureLocked() };
  try {
    localStorage.setItem(PREMIUM_FLAG_KEY, active ? '1' : '0');
    // Doar cand chiar am primit un pret. Un pret absent poate insemna "n-am
    // aflat" (fara retea, serviciu picat), nu "nu se poate cumpara" — deci nu
    // stergem un `1` scris cand Play chiar raspunsese.
    if (priceAnswer.price) {
      localStorage.setItem(PURCHASABLE_KEY, '1');
      // Produsul a aparut intre timp (publicat in Play Console, build semnat):
      // un "nu exista" scris mai demult n-are voie sa tina functiile deschise.
      localStorage.removeItem(NO_PRODUCT_KEY);
    } else if (priceAnswer.answered) {
      // Play A RASPUNS si n-are produsul. Asta, spre deosebire de un esec de
      // retea, e un raspuns definitiv: nu exista cale de plata, deci nu se
      // blocheaza nimic. Vezi billingAnswerPending().
      localStorage.setItem(NO_PRODUCT_KEY, '1');
    }
  } catch {
    // stocare indisponibila — ramane starea din memoria sesiunii curente
  }
  // Doar cand chiar s-a schimbat ceva: pornirea aplicatiei reverifica mereu
  // abonamentul, iar un anunt la fiecare pornire ar re-randa degeaba tot UI-ul.
  if (
    before.premium !== isPremium() || before.purchasable !== isPurchasable() ||
    before.locked !== isPremiumFeatureLocked()
  ) {
    notifyEntitlementChanged();
  }
  return active;
}

/**
 * Intrebarea de la pornire, cu reincercari cat timp Play n-a raspuns.
 *
 * Prima conectare la serviciul Play dupa o pornire la rece nu e instantanee, si
 * uneori esueaza de tot pe primul apel. Cu o singura incercare pierduta,
 * `isPurchasable()` ramanea fals pana cand utilizatorul se nimerea sa deschida
 * ecranul Premium — adica o sesiune intreaga cu toate functiile platite
 * deschise. Reincercam de cateva ori, in fundal, si ne oprim la primul raspuns
 * definitiv (pret sau "nu exista produsul").
 */
const STARTUP_RETRY_DELAYS_MS = [0, 1500, 4000, 9000];

export async function refreshEntitlementAtStartup(): Promise<void> {
  if (!isBillingAvailable()) return;
  for (const delay of STARTUP_RETRY_DELAYS_MS) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await refreshEntitlement();
    if (!billingAnswerPending()) return;
  }
}

/**
 * Exista o cale reala de plata pe acest dispozitiv.
 *
 * De asta atarna TOATE blocarile de plafon, si e singurul lucru care le
 * deosebeste de o inselatorie: un plafon care opreste utilizatorul fara sa-i dea
 * cum sa treaca de el nu e un model freemium, e un perete. Cat timp produsul nu
 * e configurat in Play Console sau build-ul nu e semnat, plafoanele raman pur
 * informative, exact ca inainte — iar cand configurarea e gata, se activeaza
 * singure, fara nicio schimbare de cod.
 */
export function isPurchasable(): boolean {
  try {
    return localStorage.getItem(PURCHASABLE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Cat timp mai presupunem ca SE POATE cumpara, pe un telefon unde Play exista,
 * dar inca n-a apucat sa raspunda.
 *
 * De ce o fereastra si nu "pentru totdeauna": pe un build de debug, sau pe un
 * telefon fara servicii Play, raspunsul nu vine niciodata. A bloca la nesfarsit
 * acolo ar fi exact peretele pe care tot fisierul asta il evita — un plafon fara
 * nicio cale de a trece de el. Dupa fereastra, ramane deschis ca inainte.
 */
const BILLING_ANSWER_GRACE_MS = 20_000;
/** Momentul incarcarii modulului = pornirea aplicatiei. */
const startedAt = Date.now();

/**
 * Inca asteptam raspunsul lui Play despre existenta produsului.
 *
 * BUG REAL, raportat de utilizator dupa ce a deschis ecranul Locatii fara sa fie
 * abonat: `isPurchasable()` e fals si INAINTE de primul raspuns al lui Play, nu
 * doar cand nu exista ce cumpara. Cum toate blocarile atarnau doar de el, prima
 * pornire de dupa instalare (si orice pornire in care interogarea esua) lasa
 * complet deschise ecranele rezervate abonatilor. Acum "n-am aflat inca" e o
 * stare distincta de "nu exista produs", si cat tine ea se blocheaza — pe un
 * telefon cu Play si cu plugin de billing, presupunerea corecta e ca exista o
 * cale de plata.
 */
function billingAnswerPending(): boolean {
  if (!isBillingAvailable()) return false; // web/PWA: n-a existat niciodata un magazin
  if (isPurchasable()) return false;       // stim deja: da, se poate cumpara
  try {
    if (localStorage.getItem(NO_PRODUCT_KEY) === '1') return false; // stim deja: nu exista produsul
  } catch {
    // stocare indisponibila — tratam ca "inca nu stim", si decide fereastra
  }
  return Date.now() - startedAt < BILLING_ANSWER_GRACE_MS;
}

/** Plafonul chiar opreste actiunea: nu esti abonat, ai depasit, SI ai de unde cumpara. */
export function isCapEnforced(): boolean {
  return !isPremium() && (isPurchasable() || billingAnswerPending());
}

/**
 * O functie rezervata abonatilor e blocata acum.
 *
 * Aceeasi regula ca la plafoane, si din acelasi motiv: nu blocam nimic cat timp
 * nu exista o cale reala de plata pe dispozitiv. Diferenta e doar de forma —
 * plafoanele sunt despre CAT, astea sunt despre CE.
 *
 * "Nu exista cale de plata" inseamna insa ceva precis: Play a spus-o, sau nu e
 * niciun Play (web/PWA). Cat timp intrebarea e inca pe drum, se blocheaza —
 * altfel prima pornire de dupa instalare deschide tot. Vezi billingAnswerPending().
 *
 * Ce e blocat, si de ce tocmai astea: predarea catre Lightroom (XMP),
 * plansa de contact, sugestia de combinare a doua cadre, recapul lunar,
 * prezentarea, locatiile si dosarul privat. Toate vin DUPA ce triajul s-a
 * terminat — sunt despre ce faci cu rezultatul, nu despre a-l obtine.
 *
 * Ce ramane gratuit desi s-ar fi putut bloca, ca decizie explicita: importul si
 * analiza AI (oricate poze), supervizorul galeriei, gruparea, stergerea pozelor
 * respinse, statisticile, si backup-ul profilului antrenat. Ultimul mai ales:
 * sunt deciziile TALE, iar a le tine ostatice ar fi santaj — si contrazice
 * dreptul la portabilitatea datelor.
 */
export function isPremiumFeatureLocked(): boolean {
  return !isPremium() && (isPurchasable() || billingAnswerPending());
}

export function isPremium(): boolean {
  try {
    return localStorage.getItem(PREMIUM_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * O intrare in jurnal: [inceputul orei, cate poze in acea ora].
 *
 * De ce pe ore, si nu un timestamp per poza (formatul vechi): jurnalul sta in
 * localStorage, unde bugetul e de ordinul a 5 MB pentru TOATA aplicatia. Un
 * fotograf care scoate 300 000 de poze intr-o luna producea 300 000 de numere,
 * adica ~4 MB de JSON — destul cat scrierea sa inceapa sa esueze cu
 * QuotaExceededError, iar `writeExportLog` inghite eroarea, deci contorul se
 * oprea in tacere din numarat. Pe ore, o fereastra de 30 de zile are cel mult
 * 720 de intrari, indiferent cate poze trec prin ea.
 *
 * Rotunjirea in jos la ora inseamna ca o intrare iese din fereastra cu pana la
 * o ora mai devreme decat momentul real. Diferenta e aleasa in favoarea
 * utilizatorului, si e neglijabila fata de o fereastra de 30 de zile.
 */
type UsageEntry = [bucketStart: number, count: number];

/**
 * Citeste jurnalul, acceptand SI formatul vechi (un `number` simplu per poza)
 * ca sa nu se piarda contorul celor care au deja aplicatia instalata: intrarile
 * vechi se convertesc la mers, iar prima scriere le persista comprimate.
 */
function readExportLog(): UsageEntry[] {
  try {
    const raw = localStorage.getItem(USAGE_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Adunate PE ORA chiar aici, nu doar transcrise una cate una. Fara pasul
    // asta, migrarea nu comprima nimic: formatul vechi are un timestamp per
    // poza, deci zeci de mii de intrari care cad toate in aceleasi cateva ore,
    // si prima scriere le-ar persista pe toate in noul format — adica exact
    // jurnalul nemarginit pe care formatul pe ore exista ca sa-l previna. Mai
    // rau, l-ar face si MAI MARE: o pereche `[1755000000000,1]` ocupa mai multi
    // octeti decat numarul `1755000000000` singur, deci prima scriere de dupa
    // actualizare umfla jurnalul cu ~30% si apropie QuotaExceededError-ul pe
    // care schimbarea trebuia sa-l indeparteze. Aceeasi unire repara si un
    // jurnal in formatul nou care ar contine, din orice motiv, doua intrari
    // pentru aceeasi ora.
    const merged = new Map<number, number>();
    const add = (bucket: number, count: number) => merged.set(bucket, (merged.get(bucket) ?? 0) + count);
    for (const item of parsed) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        add(bucketOf(item), 1); // format vechi: un timestamp per poza
      } else if (
        Array.isArray(item) && typeof item[0] === 'number' && Number.isFinite(item[0]) &&
        typeof item[1] === 'number' && Number.isFinite(item[1]) && item[1] > 0
      ) {
        add(item[0], Math.floor(item[1]));
      }
      // orice altceva = intrare corupta, se ignora tacut (jurnalul nu e critic)
    }
    // Perechi PROASPETE la fiecare citire: recordPhotosUsed incrementeaza pe loc
    // (`existing[1] += added`), deci n-are voie sa primeasca vreodata un tuplu
    // partajat cu altcineva.
    return [...merged].map(([bucket, count]): UsageEntry => [bucket, count]);
  } catch {
    return [];
  }
}

function writeExportLog(entries: UsageEntry[]): void {
  try {
    localStorage.setItem(USAGE_LOG_KEY, JSON.stringify(entries));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — folosirea continua fara sa fie numarata, degradare sigura
  }
}

function bucketOf(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

/**
 * Intrarile care conteaza ACUM: in fereastra de 30 de zile si nu din viitor.
 *
 * Filtrul de viitor nu e teoretic: ceasul telefonului poate sari inainte (fus
 * orar gresit la prima pornire, sincronizare NTP dupa o baterie descarcata,
 * sau utilizatorul insusi). Fara el, o singura intrare scrisa cu un ceas dat
 * cu un an inainte ramanea in fereastra un an intreg dupa corectarea ceasului,
 * si epuiza plafonul gratuit al cuiva care nu scosese nimic.
 */
function activeEntries(entries: UsageEntry[], now: number): UsageEntry[] {
  const cutoff = now - ROLLING_WINDOW_MS;
  const horizon = now + HOUR_MS; // o ora de toleranta = exact latimea unui bucket
  return entries.filter(([ts]) => ts > cutoff && ts <= horizon);
}

/** Cate poze au fost scoase (exportate SAU sterse din telefon) in ultimele 30 de zile — fereastra glisanta, nu "luna calendaristica". */
export function photosUsedInRollingMonth(now = Date.now()): number {
  return activeEntries(readExportLog(), now).reduce((sum, [, count]) => sum + count, 0);
}

/**
 * Inregistreaza `count` poze scoase ACUM (exportate sau sterse din telefon).
 * Apelata neconditionat, chiar si pentru abonati — jurnalul ramane util pentru
 * ecranul de folosire, indiferent de abonament.
 */
export function recordPhotosUsed(count: number, now = Date.now()): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const added = Math.floor(count);
  const kept = activeEntries(readExportLog(), now);
  const bucket = bucketOf(now);
  const existing = kept.find(([ts]) => ts === bucket);
  if (existing) existing[1] += added;
  else kept.push([bucket, added]);
  writeExportLog(kept);
  // Ecranul Premium si randul de folosire arata contorul asta — vezi
  // subscribeEntitlement: fara anunt, raman pe cifra dinainte de export.
  notifyEntitlementChanged();
}

/** Cate poze mai poate scoate gratuit utilizatorul in fereastra curenta (Infinity daca e premium). */
export function remainingFreePhotos(now = Date.now()): number {
  if (isPremium()) return Infinity;
  return Math.max(0, FREE_PHOTOS_PER_MONTH - photosUsedInRollingMonth(now));
}

/** true daca utilizatorul mai poate inrola inca o persoana fara abonament. */
export function canEnrollAnotherPersonFree(currentPersonCount: number): boolean {
  return isPremium() || currentPersonCount < FREE_ENROLLED_PERSONS;
}
