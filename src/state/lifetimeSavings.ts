/**
 * state/lifetimeSavings.ts
 * Cat a lucrat aplicatia pentru tine DE CAND o folosesti, nu doar la ultimul import.
 *
 * DE CE EXISTA. Cardul de dupa import (ui/SessionOutcome.tsx) spune deja ce s-a
 * intamplat acum: "≈ 42 de minute economisite". E adevarat si se citeste bine,
 * dar dispare odata cu cardul, iar cifra unei singure sedinte e mereu mica in
 * raport cu pretul unui abonament. Cine deschide ecranul Premium a doua luna are
 * in cap ultimul import, nu suma celor douasprezece de dinainte — desi exact
 * suma aia e argumentul.
 *
 * Deci: un total cumulat, minuscul, tinut separat de poze. SEPARAT e cuvantul
 * important, si e aceeasi lectie ca la state/streak.ts: daca l-am calcula din
 * pozele aflate ACUM in biblioteca, "Goleste sesiunea" sau stergerea respinselor
 * de pe telefon ar rescrie retroactiv istoria — ai fi platit cu munca facuta si
 * ti-ai fi pierdut dovada ei in aceeasi apasare.
 *
 * CE NU TINE, deliberat: nicio secunda. Timpul NU se stocheaza, se recalculeaza
 * de fiecare data din `autoDecided` inmultit cu ritmul tau masurat ACUM (vezi
 * core/decisionPace.ts). Doua motive, si al doilea conteaza mai mult:
 *  - ritmul se rafineaza pe masura ce iei decizii, deci un total insumat din
 *    estimari vechi ar fi o gramada de aproximari inghetate, tot mai gresite;
 *  - un numar de secunde scris in localStorage n-ar mai putea fi verificat de
 *    nimeni, nici macar de noi. Din doua numarul intregi (cate poze, ce ritm)
 *    oricine poate reface cifra si poate vedea daca minte.
 *
 * Regula de onestitate din core/sessionOutcome.ts ramane in picioare aici,
 * neatinsa: fara ritm masurat nu se afiseaza niciun timp. Un total cumulat e
 * exact locul unde tentatia de a inventa e cea mai mare, fiindca cifra e mai
 * mare si suna mai bine — si tocmai de-aia nu se inventeaza.
 */

const STORAGE_KEY = 'lumin-lifetime-savings';

export interface LifetimeSavings {
  /** Cate loturi importate au produs un rezultat (importuri goale nu se numara). */
  sessions: number;
  /** Cate poze au trecut in total prin analiza. */
  imported: number;
  /** Cate au primit o decizie automata — din ele iese timpul, cand exista un ritm. */
  autoDecided: number;
  /** Momentul primului lot numarat, ca sa se poata spune "de cand". 0 = necunoscut. */
  firstTs: number;
}

const EMPTY: LifetimeSavings = { sessions: 0, imported: 0, autoDecided: 0, firstTs: 0 };

/** Un intreg nenegativ, sau 0. Orice altceva din localStorage e date stricate, nu o valoare. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Totalul de pana acum. Niciodata null: fara localStorage (mod privat, cota
 * plina, cheie stricata de mana) raspunsul e zero, iar interfata pur si simplu
 * n-are ce arata — nu e o eroare de raportat nimanui.
 */
export function readLifetime(): LifetimeSavings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const o = parsed as Record<string, unknown>;
    return {
      sessions: count(o.sessions),
      imported: count(o.imported),
      autoDecided: count(o.autoDecided),
      firstTs: count(o.firstTs)
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Adauga un lot la total. Apelata dupa fiecare import care chiar a adus poze
 * (vezi state/store.ts:runImport, langa `summarizeSession`).
 *
 * Un lot fara nicio poza nu se numara deloc — nici macar ca sedinta. Un import
 * anulat inainte sa intre ceva in baza nu e o sedinta de lucru, si a-l numara ar
 * umfla exact cifra care trebuie sa ramana credibila.
 *
 * Intoarce noul total, ca apelantul sa nu mai citeasca inca o data.
 */
export function recordLifetimeSession(
  batch: { imported: number; autoDecided: number },
  now: number = Date.now()
): LifetimeSavings {
  const previous = readLifetime();
  if (count(batch.imported) <= 0) return previous;
  const next: LifetimeSavings = {
    sessions: previous.sessions + 1,
    imported: previous.imported + count(batch.imported),
    autoDecided: previous.autoDecided + count(batch.autoDecided),
    firstTs: previous.firstTs || count(now)
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Cota plina sau mod privat: totalul nu creste, restul importului merge mai
    // departe neatins. Un contor de afisaj n-are voie sa rupa importul.
  }
  return next;
}

/**
 * Are destul cat sa merite aratat? Sub doua sedinte nu e un "total": e ultimul
 * import spus a doua oara, cu alte cuvinte — iar cardul de sesiune tocmai l-a
 * spus mai bine, cu miniaturi.
 */
export const MIN_SESSIONS_FOR_TOTAL = 2;

export function hasLifetimeStory(lifetime: LifetimeSavings): boolean {
  return lifetime.sessions >= MIN_SESSIONS_FOR_TOTAL && lifetime.autoDecided > 0;
}
