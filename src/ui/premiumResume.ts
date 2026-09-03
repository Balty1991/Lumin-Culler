import type { PremiumReason } from '../state/store';

/**
 * ui/premiumResume.ts
 * Dupa ce a platit, aplicatia face lucrul pentru care a platit.
 *
 * BUGUL, gasit auditand drumul complet spre plata (si e cel mai scump din tot
 * ecranul Premium, fiindca loveste exact omul care TOCMAI a scos banii):
 *
 *   apesi "Planșa de contact" -> poarta te trimite in ecranul Premium -> te
 *   abonezi -> ecranul iti confirma ca esti abonat -> si ATAT. Planșa de
 *   contact nu se deschide. Trebuie sa inchizi ecranul, sa gasesti din nou
 *   functia in meniu si s-o apesi a doua oara.
 *
 * Pentru un om care tocmai a facut singurul lucru pe care i-l ceream, e cea mai
 * proasta secunda posibila: a platit si nu s-a intamplat nimic. In cazul
 * plafonului de export e si mai rau — venea dupa un triaj lung, iar ecranul de
 * export era deja inchis de poarta.
 *
 * `premiumReason` retinea deja de ce s-a deschis ecranul (se folosea doar ca
 * sa marcheze randul cerut in lista de beneficii). Aici capata a doua treaba:
 * dupa cumparare devine calea inapoi.
 *
 * DE CE UN BUTON, si nu deschidere automata. Ecranul NU se inchide singur la
 * cumparare reusita, si e o decizie veche si buna: inainte disparea fara niciun
 * cuvant, adica singura confirmare a unei plati era absenta ei. Un salt automat
 * ar reintroduce exact asta, doar cu alt ecran deasupra. Butonul pastreaza
 * confirmarea pe ecran SI duce inapoi dintr-o apasare.
 *
 * NU se ocoleste nicio poarta: fiecare actiune de mai jos e chiar setter-ul
 * public din store, acelasi pe care il apasa si butonul obisnuit — deci trece
 * din nou prin gatePremium. Daca ceva tot n-ar fi deblocat, ecranul se
 * redeschide, in loc sa promita o functie care apoi nu porneste.
 */

/** Ce se cheama din store pentru fiecare motiv, si ce cheie de text il descrie. */
export interface ResumeAction {
  /** Cheia i18n pentru eticheta butonului — verbul potrivit functiei, nu un "Continuă" generic. */
  labelKey: string;
  /** Ce se apeleaza pe store. Primeste store-ul ca sa nu importe nimic din UI. */
  run: (store: ResumeStore) => void;
}

/** Doar bucata din store de care are nevoie reluarea — tipata minimal, ca testul sa poata da un dublu. */
export interface ResumeStore {
  setContactSheetOpen: (open: boolean) => void;
  setPresentationOpen: (open: boolean) => void;
  setLocationsOpen: (open: boolean) => void;
  setVaultOpen: (open: boolean) => void;
  setPersonsOpen: (open: boolean) => void;
  setExportDestinationsOpen: (open: boolean) => void;
  exportXMP: () => Promise<void>;
}

const ACTIONS: Record<PremiumReason, ResumeAction> = {
  contactSheet: { labelKey: 'premium.resume.contactSheet', run: s => s.setContactSheetOpen(true) },
  presentation: { labelKey: 'premium.resume.presentation', run: s => s.setPresentationOpen(true) },
  locations: { labelKey: 'premium.resume.locations', run: s => s.setLocationsOpen(true) },
  vault: { labelKey: 'premium.resume.vault', run: s => s.setVaultOpen(true) },
  persons: { labelKey: 'premium.resume.persons', run: s => s.setPersonsOpen(true) },
  xmp: { labelKey: 'premium.resume.xmp', run: s => { void s.exportXMP(); } },
  /**
   * Plafonul e singurul caz in care nu se poate relua chiar ACTIUNEA: pozele
   * alese sunt in continuare selectate in biblioteca, dar foaia de export a
   * fost inchisa de poarta, iar noi n-am retinut ce destinatie alesese. Deci
   * reluarea e un pas mai devreme — foaia se redeschide, cu selectia intacta.
   * Un pas inapoi, nu zero.
   */
  cap: { labelKey: 'premium.resume.cap', run: s => s.setExportDestinationsOpen(true) }
};

/** Ce se poate relua pentru motivul dat. `null` cand ecranul a fost deschis din meniu (fara motiv). */
export function resumeFor(reason: PremiumReason | null): ResumeAction | null {
  return reason === null ? null : ACTIONS[reason] ?? null;
}
