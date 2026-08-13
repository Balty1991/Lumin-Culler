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

interface BillingPluginApi {
  status(): Promise<{ active: boolean }>;
  price(): Promise<{ price?: string }>;
  subscribe(): Promise<{ purchased: boolean; cancelled: boolean }>;
}

const BillingNative = registerPlugin<BillingPluginApi>('Billing');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv. */
export function isBillingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Billing');
}

/**
 * Abonamentul e activ ACUM, dupa Google Play.
 *
 * Orice esec (fara retea, Play indisponibil, produs neconfigurat inca)
 * inseamna `false`, nu o eroare aruncata mai departe: un utilizator care
 * deschide aplicatia in avion nu trebuie sa vada un ecran de eroare, iar
 * functiile gratuite nu au voie sa depinda de disponibilitatea unui magazin.
 * Consecinta acceptata constient: un abonat fara retea e tratat temporar ca
 * neabonat — vezi entitlement.ts, unde ultima stare CUNOSCUTA e pastrata tocmai
 * ca sa nu se intample asta la fiecare pornire.
 */
export async function queryPremiumActive(): Promise<boolean> {
  if (!isBillingAvailable()) return false;
  try {
    return (await BillingNative.status()).active;
  } catch (err) {
    console.error('Nu am putut verifica abonamentul (se continua ca neabonat):', err);
    return false;
  }
}

/**
 * Pretul formatat de Play, in moneda si limba contului. `null` cand nu poate fi
 * aflat — UI-ul trebuie sa poata deosebi "inca nu stiu pretul" de un pret real,
 * si sa NU inventeze niciodata unul scris in cod.
 */
export async function queryPremiumPrice(): Promise<string | null> {
  if (!isBillingAvailable()) return null;
  try {
    return (await BillingNative.price()).price ?? null;
  } catch (err) {
    console.error('Nu am putut citi pretul abonamentului:', err);
    return null;
  }
}

export type SubscribeOutcome = 'purchased' | 'cancelled' | 'unavailable';

/** Deschide fluxul de cumparare al lui Play si asteapta rezultatul lui. */
export async function startSubscription(): Promise<SubscribeOutcome> {
  if (!isBillingAvailable()) return 'unavailable';
  try {
    const result = await BillingNative.subscribe();
    if (result.purchased) return 'purchased';
    return result.cancelled ? 'cancelled' : 'unavailable';
  } catch (err) {
    console.error('Fluxul de cumparare a esuat:', err);
    return 'unavailable';
  }
}
