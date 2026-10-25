/**
 * core/billing.ts
 * Punte catre plugin-ul Capacitor local Billing (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/BillingPlugin.kt).
 *
 * Singura parte a aplicatiei care vorbeste cu o retea. Restul ramane strict pe
 * telefon, iar asta nu se schimba: aici nu pleaca nicio poza, niciun nume si
 * niciun semnal de folosire — doar intrebarea "contul asta de Google are
 * abonamentul activ?", pusa de Play, nu de noi.
 *
 * Pe web/PWA nu exista Play, deci fiecare functie de aici raspunde ca pentru un
 * utilizator neabonat. Nu e o degradare: exact asa se comporta si o instalare
 * Android inaintea primei cumparari.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface RawPlan {
  id: string;
  price: string;
  /** Sir, nu numar: micro-unitatile depasesc precizia sigura a lui Number pentru monede slabe. */
  priceMicros: string;
  currency: string;
  /** Durata ISO-8601 a ciclului de facturare, exact cum o da Play ("P1M", "P1Y"). */
  period: string;
  periodDays: number;
  offerToken: string;
  /** Zile gratuite inainte de prima plata, cand oferta aleasa are o perioada de proba. */
  trialDays?: number;
}

interface BillingPluginApi {
  status(): Promise<{ active: boolean }>;
  price(): Promise<{ price?: string }>;
  plans(): Promise<{ plans: RawPlan[] }>;
  subscribe(options?: { productId?: string }): Promise<{ purchased: boolean; cancelled: boolean }>;
}

const BillingNative = registerPlugin<BillingPluginApi>('Billing');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv. */
export function isBillingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Billing');
}

/** Raspunsul Play despre entitlement, fara a confunda „neabonat” cu „n-am putut verifica”. */
export interface PremiumStatusAnswer {
  /** Play a raspuns la interogarea abonamentului. */
  answered: boolean;
  /** Valoarea are sens numai cand `answered` este true. */
  active: boolean;
}

/**
 * Interogare cu stare explicita. Distinctia protejeaza cache-ul unui abonat
 * atunci cand Play Services sau reteaua nu raspund temporar.
 */
export async function queryPremiumStatusAnswer(): Promise<PremiumStatusAnswer> {
  if (!isBillingAvailable()) return { answered: false, active: false };
  try {
    return { answered: true, active: (await BillingNative.status()).active };
  } catch (err) {
    console.error('Nu am putut verifica abonamentul:', err);
    return { answered: false, active: false };
  }
}

/**
 * Varianta simpla, pastrata pentru apelantii care au nevoie doar de un boolean.
 * Persistenta entitlement-ului trebuie sa foloseasca `queryPremiumStatusAnswer()`
 * pentru a nu rescrie cache-ul dupa un esec temporar.
 */
export async function queryPremiumActive(): Promise<boolean> {
  return (await queryPremiumStatusAnswer()).active;
}

/**
 * Raspunsul lui Play la intrebarea despre pret, cu trei stari, nu doua.
 *
 * `answered: false` inseamna "N-AM PUTUT INTREBA" (fara retea, serviciul Play
 * picat, build de debug caruia Play nu-i raspunde). `answered: true` cu
 * `price: null` inseamna cu totul altceva: Play A RASPUNS si nu exista produsul
 * pentru contul si build-ul asta.
 *
 * Diferenta n-a fost mereu aici, si lipsa ei a costat: entitlement.ts trata
 * amandoua cazurile ca "nu se poate cumpara nimic", deci nu bloca nicio functie
 * platita. La prima pornire de dupa instalare, cat timp Play inca nu raspunsese,
 * TOT ce e rezervat abonatilor era deschis. Vezi isPremiumFeatureLocked().
 *
 * Distinctia chiar exista in plugin (BillingPlugin.kt): `price()` respinge apelul
 * cand interogarea esueaza, si raspunde cu un obiect FARA camp `price` cand
 * produsul lipseste. Aici doar n-o pierdem pe drum.
 */
export interface PriceAnswer {
  /** Play a raspuns (indiferent daca a avut sau nu un pret de dat). */
  answered: boolean;
  price: string | null;
}

export async function queryPremiumPriceAnswer(): Promise<PriceAnswer> {
  if (!isBillingAvailable()) return { answered: false, price: null };
  try {
    return { answered: true, price: (await BillingNative.price()).price ?? null };
  } catch (err) {
    console.error('Nu am putut citi pretul abonamentului:', err);
    return { answered: false, price: null };
  }
}

/**
 * Pretul formatat de Play, in moneda si limba contului. `null` cand nu poate fi
 * aflat — UI-ul trebuie sa poata deosebi "inca nu stiu pretul" de un pret real,
 * si sa NU inventeze niciodata unul scris in cod.
 */
export async function queryPremiumPrice(): Promise<string | null> {
  return (await queryPremiumPriceAnswer()).price;
}

/**
 * Un plan de abonament, asa cum l-a raspuns Play.
 *
 * Toate cifrele vin de la Play, niciuna nu e scrisa aici: pretul afisat e
 * `price` (formatat de Play in moneda si conventiile contului), iar `priceMicros`
 * exista tocmai ca sa nu fie nevoie sa parsam vreodata acel text ca sa comparam
 * doua planuri. Un "19,99 lei" si un "$4.99" nu se compara ca siruri.
 */
export interface PremiumPlan {
  id: string;
  price: string;
  /** Pretul in micro-unitati de moneda (1 000 000 = o unitate), ca numar. */
  priceMicros: number;
  currency: string;
  /** Durata ciclului de facturare, in zile (30 pentru lunar, 365 pentru anual). */
  periodDays: number;
  /** Zile gratuite inainte de prima plata; absent cand oferta nu are perioada de proba. */
  trialDays?: number;
}

/** Acelasi tipar cu trei stari ca la pret: „n-am putut intreba" nu e „nu exista planuri". */
export interface PlansAnswer {
  answered: boolean;
  plans: PremiumPlan[];
}

function toPlan(raw: RawPlan): PremiumPlan | null {
  const micros = Number(raw.priceMicros);
  // Un plan fara pret utilizabil n-are ce cauta pe ecran: butonul lui ar
  // deschide o plata al carei cost nu-l stim, deci nu-l putem nici arata.
  if (!raw.id || !raw.price || !Number.isFinite(micros) || micros <= 0) return null;
  return {
    id: raw.id,
    price: raw.price,
    priceMicros: micros,
    currency: raw.currency,
    periodDays: Number.isFinite(raw.periodDays) ? raw.periodDays : 0,
    ...(raw.trialDays && raw.trialDays > 0 ? { trialDays: raw.trialDays } : {})
  };
}

/**
 * Planurile pe care contul acesta chiar le poate cumpara ACUM.
 *
 * O lista goala cu `answered: true` inseamna „Play a raspuns si nu exista niciun
 * produs configurat" — aceeasi stare pe care o descrie si un pret absent, si
 * singura in care nu se blocheaza nimic (vezi core/entitlement.ts). Un plan care
 * lipseste doar el (tipic anualul, cat timp nu e creat in Play Console) nu e o
 * eroare: interfata arata ce a primit.
 */
export async function queryPlansAnswer(): Promise<PlansAnswer> {
  if (!isBillingAvailable()) return { answered: false, plans: [] };
  try {
    const raw = (await BillingNative.plans()).plans ?? [];
    return { answered: true, plans: raw.map(toPlan).filter((p): p is PremiumPlan => p !== null) };
  } catch (err) {
    console.error('Nu am putut citi planurile de abonament:', err);
    return { answered: false, plans: [] };
  }
}

export type SubscribeOutcome = 'purchased' | 'cancelled' | 'unavailable';

/**
 * Deschide fluxul de cumparare al lui Play si asteapta rezultatul lui.
 *
 * `productId` lipsa inseamna „planul implicit" (lunar) — asa apelantii care n-au
 * de ales intre planuri raman neschimbati. Partea nativa respinge un id
 * necunoscut in loc sa-l inlocuiasca tacut cu altul: a incasa alt abonament
 * decat cel pe care a apasat omul ar fi mai rau decat o eroare.
 */
export async function startSubscription(productId?: string): Promise<SubscribeOutcome> {
  if (!isBillingAvailable()) return 'unavailable';
  try {
    const result = await BillingNative.subscribe(productId ? { productId } : undefined);
    if (result.purchased) return 'purchased';
    return result.cancelled ? 'cancelled' : 'unavailable';
  } catch (err) {
    console.error('Fluxul de cumparare a esuat:', err);
    return 'unavailable';
  }
}
