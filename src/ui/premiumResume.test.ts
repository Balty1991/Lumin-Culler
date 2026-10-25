import { describe, expect, it, vi } from 'vitest';
import { resumeFor, type ResumeStore } from './premiumResume';
import type { PremiumReason } from '../state/store';
import { ro } from '../i18n/ro';
import { en } from '../i18n/en';

/**
 * ui/premiumResume.test.ts
 * Ce se intampla dupa ce omul a platit.
 *
 * Ce se poate strica aici nu da nicio eroare si nu pica niciun ecran: butonul
 * duce pur si simplu in alta parte decat scrie pe el, sau lipseste — pentru
 * cineva care tocmai a scos banii. De-aia fiecare motiv e verificat individual,
 * nu "o data, generic".
 */
const REASONS: PremiumReason[] = ['locations', 'vault', 'contactSheet', 'presentation', 'xmp', 'persons', 'cap'];

function spyStore(): ResumeStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setContactSheetOpen: () => calls.push('contactSheet'),
    setPresentationOpen: () => calls.push('presentation'),
    setLocationsOpen: () => calls.push('locations'),
    setVaultOpen: () => calls.push('vault'),
    setPersonsOpen: () => calls.push('persons'),
    setExportDestinationsOpen: () => calls.push('export'),
    exportXMP: () => { calls.push('xmp'); return Promise.resolve(); }
  };
}

describe('resumeFor', () => {
  it('fiecare poarta are o cale inapoi — niciuna nu ramane fara', () => {
    // Daca cineva adauga a opta poarta si uita reluarea, aici pica, nu pe
    // telefonul unui abonat proaspat.
    for (const reason of REASONS) {
      expect(resumeFor(reason), `lipseste reluarea pentru "${reason}"`).not.toBeNull();
    }
  });

  it('deschis din meniu (fara motiv) nu propune nicio reluare', () => {
    // N-a cerut nimic anume, deci n-avem unde sa-l ducem inapoi.
    expect(resumeFor(null)).toBeNull();
  });

  it('fiecare motiv cheama exact actiunea lui, nu alta', () => {
    const expected: Record<PremiumReason, string> = {
      contactSheet: 'contactSheet', presentation: 'presentation', locations: 'locations',
      vault: 'vault', persons: 'persons', xmp: 'xmp',
      // Plafonul e singurul care nu poate relua chiar actiunea: foaia de export
      // a fost inchisa de poarta si nu s-a retinut destinatia. Un pas inapoi,
      // cu selectia intacta — nu zero.
      cap: 'export'
    };
    for (const reason of REASONS) {
      const store = spyStore();
      resumeFor(reason)!.run(store);
      expect(store.calls, `reluarea pentru "${reason}"`).toEqual([expected[reason]]);
    }
  });

  it('eticheta fiecarui buton exista in ambele limbi', () => {
    // Un buton cu textul "premium.resume.vault" pe el ar fi mai rau decat lipsa
    // lui: arata a aplicatie stricata exact dupa o plata.
    for (const reason of REASONS) {
      const key = resumeFor(reason)!.labelKey;
      expect(ro[key as keyof typeof ro], `lipseste ${key} in romana`).toBeTruthy();
      expect(en[key as keyof typeof en], `lipseste ${key} in engleza`).toBeTruthy();
    }
  });

  it('etichetele sunt verbe despre functia ceruta, nu un "Continua" generic', () => {
    // Omul a cerut ceva precis. Butonul trebuie sa spuna acel lucru precis —
    // altfel e inca un pas la care trebuie sa se gandeasca.
    const labels = REASONS.map(r => ro[resumeFor(r)!.labelKey as keyof typeof ro] as string);
    expect(new Set(labels).size).toBe(REASONS.length);
    for (const label of labels) expect(label).toMatch(/→$/);
  });
});

describe('nicio poarta nu e ocolita', () => {
  it('reluarea trece prin setter-ul public, deci prin gatePremium', () => {
    // Daca reluarea ar seta direct starea (`set({ vaultOpen: true })`), ar
    // deveni a doua cale de intrare in functie — adica exact portita pe care
    // gatePremium exista ca s-o inchida. Testul verifica structural ca se
    // cheama un setter, nu ca se scrie o stare.
    const store = spyStore();
    const spy = vi.spyOn(store, 'setVaultOpen');
    resumeFor('vault')!.run(store);
    expect(spy).toHaveBeenCalledWith(true);
  });
});
