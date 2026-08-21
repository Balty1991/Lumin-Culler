/**
 * core/vault.ts
 * "Dosar privat" (plan modernizare, ecran m-vault din mockup) — folder ascuns
 * din Albume/selectorul de foldere, deblocat cu un PIN local. Mockup-ul arata
 * amprenta digitala, dar niciun plugin biometric nu exista inca in proiect
 * (vezi android/ — doar modulele ML Kit/MediaPipe din nativeAnalysis.ts,
 * fara BiometricPrompt) — un PIN e echivalentul realist, fara sa promitem o
 * functie pe care n-o putem livra acum.
 *
 * PIN-ul e hash-uit (SHA-256 + prefix fix, nu doar stocat clar) inainte de a
 * ajunge in localStorage — suficient impotriva unei citiri accidentale a
 * localStorage (ex. DevTools), NU un vault criptografic real: fotografiile
 * insele raman in acelasi IndexedDB necriptat ca restul bibliotecii. "Privat"
 * aici inseamna ascuns din navigare normala, nu criptat pe disc.
 */
import { db, type CollectionRecord } from './db';

const PIN_HASH_KEY = 'lumin-vault-pin-hash';
/** Sesiunea ramane deblocata doar in memorie (NU persistata) — un restart al
    aplicatiei/paginii cere din nou PIN-ul, exact ce te-ai astepta de la un folder privat. */
let unlockedInSession = false;

async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode('lumin-culler-vault-v1:' + pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 4-6 cifre — suficient pentru un lacat local rapid de introdus, nu o parola completa. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hasVaultPin(): boolean {
  try {
    return localStorage.getItem(PIN_HASH_KEY) !== null;
  } catch {
    return false;
  }
}

export async function setVaultPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  try { localStorage.setItem(PIN_HASH_KEY, hash); } catch {
    // stocare indisponibila (mod privat strict etc.) — PIN-ul nu se poate salva, vaultul ramane efectiv inaccesibil pana la stocare disponibila
  }
}

export async function verifyVaultPin(pin: string): Promise<boolean> {
  let stored: string | null;
  try { stored = localStorage.getItem(PIN_HASH_KEY); } catch { return false; }
  if (!stored) return false;
  return (await hashPin(pin)) === stored;
}

export function isVaultUnlockedInSession(): boolean {
  return unlockedInSession;
}

export function setVaultUnlockedInSession(unlocked: boolean): void {
  unlockedInSession = unlocked;
}

/** Sterge PIN-ul (nu si continutul folderului — vezi VaultPanel pentru dezactivare completa, care muta pozele inapoi in biblioteca normala). */
export function clearVaultPin(): void {
  try { localStorage.removeItem(PIN_HASH_KEY); } catch {
    // stocare indisponibila — fara efect, PIN-ul ramane oricum needefinit la urmatoarea citire
  }
}

/**
 * Foldere obisnuite (CollectionRecord) sunt vizibile mereu in Albume/selector
 * — cel privat foloseste EXACT acelasi model de date (memberIds), doar cu
 * isPrivate:true, filtrat explicit din acele liste (vezi CollectionsPanel/
 * CollectionPicker) si din grila principala (filtered()/secondaryFiltered()
 * din store.ts) cat timp nu e deblocat in aceasta sesiune.
 */
export async function getOrCreateVaultCollection(): Promise<CollectionRecord> {
  const existing = await db.collections.filter(c => c.isPrivate === true).first();
  if (existing) return existing;
  const record: CollectionRecord = { id: crypto.randomUUID(), name: 'Dosar privat', createdAt: Date.now(), memberIds: [], isPrivate: true };
  await db.collections.put(record);
  return record;
}
