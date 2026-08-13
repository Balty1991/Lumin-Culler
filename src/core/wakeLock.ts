/**
 * core/wakeLock.ts
 * Tine ecranul aprins cat timp ruleaza un import (cerinta directa: "sa
 * analizeze si in fundal cu ecranul inchis").
 *
 * CE REZOLVA ASTA, EXACT: pana acum, daca lasai telefonul din mana in timpul
 * unei analize lungi, ecranul se stingea singur dupa 30s-1min, iar WebView-ul
 * era suspendat de sistem — analiza se oprea, si o gaseai neterminata cand
 * reveneai. Cu Screen Wake Lock (API web standard, exista in WebView-ul
 * Android modern), ecranul ramane aprins cat dureaza importul si analiza merge
 * pana la capat fara sa stai cu degetul pe telefon.
 *
 * CE NU REZOLVA: nu face analiza sa mearga cu ecranul CHIAR stins. Asta nu se
 * poate obtine din JS — cand Android stinge ecranul si suspenda activitatea,
 * WebView-ul nu mai primeste timp de procesor, indiferent ce cere pagina.
 * Singura cale reala e un foreground service nativ (Kotlin, cu notificare
 * permanenta) care sa tina procesul viu; e o bucata de lucru pe partea
 * Android, separata de aplicatia web.
 *
 * Blocarea se re-cere automat cand utilizatorul revine in aplicatie: sistemul
 * elibereaza wake lock-ul de fiecare data cand pagina devine ascunsa (regula
 * din specificatie), deci fara re-cerere s-ar pierde definitiv la primul
 * comutat intre aplicatii.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

let sentinel: WakeLockSentinelLike | null = null;
/** Cate operatii lungi cer simultan ecranul aprins — eliberam abia cand ajunge la 0. */
let holders = 0;
let visibilityBound = false;
/**
 * Cererea in zbor. Fara ea, doua apeluri pornite in acelasi tick treceau
 * amandoua de verificarea `sentinel` (inca null, prima cerere nefiind
 * rezolvata) si ceream DOUA blocari: a doua o suprascria pe prima in
 * `sentinel`, iar prima ramanea tinuta pentru totdeauna — ecranul nu se mai
 * stingea nici dupa ce importul se termina. Prins de test.
 */
let acquiring: Promise<void> | null = null;

function wakeLockApi(): WakeLockNavigator['wakeLock'] | undefined {
  return (navigator as unknown as WakeLockNavigator).wakeLock;
}

export function isWakeLockSupported(): boolean {
  return typeof wakeLockApi()?.request === 'function';
}

function acquire(): Promise<void> {
  const api = wakeLockApi();
  if (!api || sentinel || holders === 0) return Promise.resolve();
  if (acquiring) return acquiring;
  acquiring = (async () => {
    try {
      const granted = await api.request('screen');
      // Ultimul detinator a putut pleca cat timp cererea era in zbor (import
      // scurt sau anulat) — eliberam pe loc, altfel ecranul ar ramane aprins.
      if (holders === 0) {
        void granted.release().catch(() => {});
        return;
      }
      sentinel = granted;
      granted.addEventListener('release', () => { sentinel = null; });
    } catch {
      // Refuzata (fila ascunsa in acel moment, politica de baterie, permisiune) —
      // importul merge mai departe exact ca inainte, doar fara ecranul tinut aprins.
      sentinel = null;
    } finally {
      acquiring = null;
    }
  })();
  return acquiring;
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && holders > 0 && !sentinel) void acquire();
}

/** Cere ecranul aprins. Intoarce functia de eliberare — apeleaz-o in `finally`. */
export function keepScreenAwake(): () => void {
  holders++;
  if (!visibilityBound) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = true;
  }
  void acquire();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders > 0) return;
    const current = sentinel;
    sentinel = null;
    void current?.release().catch(() => {
      // deja eliberata de sistem (ecran stins, fila ascunsa) — nimic de facut
    });
  };
}
